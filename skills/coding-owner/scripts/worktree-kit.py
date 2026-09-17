#!/usr/bin/env python3
"""Local worktree acceleration; no task ownership, commits, or ZG dependency."""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import uuid


def capture(args, cwd):
    return subprocess.check_output(args, cwd=cwd, text=True, stderr=subprocess.PIPE, timeout=30).strip()


def tool_version(path, name, cwd, env=None):
    args = [path, 'version'] if name == 'go' else [path, '--version']
    output = subprocess.check_output(args, cwd=cwd, env=env, text=True,
                                     stderr=subprocess.STDOUT, timeout=30).strip()
    if name == 'go' and output.startswith('go version '):
        return output.split()[2]
    return output


def locations(root):
    root = Path(capture(['git', 'rev-parse', '--show-toplevel'], root)).resolve()
    private = Path(capture(['git', 'rev-parse', '--absolute-git-dir'], root)) / 'coding-owner'
    private.mkdir(mode=0o700, exist_ok=True)
    return root, private


def save(path, data):
    temp = path.with_name(path.name + '.' + uuid.uuid4().hex)
    with temp.open('x') as stream:
        os.chmod(temp, 0o600)
        json.dump(data, stream, ensure_ascii=False, indent=2)
    os.replace(temp, path)


def stamp(root):
    # Evidence metadata only: ignored runtime/config data is deliberately not hashed.
    diff = subprocess.check_output(['git', 'diff', 'HEAD', '--binary'], cwd=root)
    digest = hashlib.sha256(diff)
    names = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', '-z'], cwd=root)
    for name in sorted(names.split(b'\0')):
        if name:
            path = root / os.fsdecode(name)
            digest.update(name)
            if path.is_symlink():
                digest.update(os.readlink(path).encode())
            else:
                with path.open('rb') as stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                        digest.update(chunk)
    return {'head': capture(['git', 'rev-parse', 'HEAD'], root),
            'dirty_sha256': digest.hexdigest(),
            'status': capture(['git', 'status', '--short'], root),
            'coverage': 'tracked diff + nonignored untracked files; not environment/ignored data'}


def probe_cache_write(path):
    """Probe actual writes under the current sandbox, not just mode bits."""
    path.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryFile(dir=path) as stream:
        stream.write(b'cache probe')
        stream.flush()


def select_build_cache(requested, private):
    try:
        probe_cache_write(Path(requested))
        return requested, {'mode': 'reuse', 'reason': 'write probe passed'}
    except OSError as error:
        fallback = private / 'cache' / 'go-build'
        probe_cache_write(fallback)  # A failed fallback must stop preparation.
        return str(fallback), {'mode': 'private-fallback', 'requested': requested,
                               'reason': type(error).__name__, 'errno': error.errno,
                               'note': 'May require a cold build; no existing cache was cleared.'}


def prepare(root, private, source):
    source = Path(source).resolve() if source else root
    capture(['git', 'rev-parse', '--show-toplevel'], source)
    env, tools, tool_paths, cache_decisions = {}, {}, {}, {}
    go_path = shutil.which('go')
    if go_path:
        tool_paths['go'] = str(Path(go_path).resolve())
        values = json.loads(capture(['go', 'env', '-json', 'GOCACHE', 'GOMODCACHE', 'GOVERSION'], source))
        for key in ('GOCACHE', 'GOMODCACHE'):
            if values[key] == 'off' or not Path(values[key]).is_absolute():
                raise ValueError(f'{key} must be an enabled absolute cache path')
            env[key] = values[key]
        env['GOCACHE'], cache_decisions['GOCACHE'] = select_build_cache(env['GOCACHE'], private)
        tools['go'] = values['GOVERSION']
    node_path = shutil.which('node')
    if node_path:
        tool_paths['node'] = str(Path(node_path).resolve())
        tools['node'] = tool_version(tool_paths['node'], 'node', source)
    store = None
    pnpm_path = shutil.which('pnpm')
    if pnpm_path:
        tool_paths['pnpm'] = str(Path(pnpm_path).resolve())
        store = capture(['pnpm', 'store', 'path'], source).splitlines()[-1]
        if not Path(store).is_absolute():
            raise ValueError('pnpm store path must be absolute')
        tools['pnpm'] = capture(['pnpm', '--version'], source)
    runtime = private / 'runtime'
    runtime.mkdir(exist_ok=True)
    if tool_paths:
        toolchain = private / 'toolchain'
        toolchain.mkdir(exist_ok=True)
        for name, path in tool_paths.items():
            link = toolchain / name
            if link.is_symlink() or link.exists():
                link.unlink()
            link.symlink_to(path)
        env['PATH'] = os.pathsep.join([str(toolchain), os.environ.get('PATH', os.defpath)])
    env['CODING_OWNER_RUNTIME_DIR'] = str(runtime)
    data = {'root': str(root), 'cache_source': str(source), 'env': env,
            'tool_paths': tool_paths, 'cache_decisions': cache_decisions,
            'pnpm_store': store, 'tools': tools,
            'retrieval': 'Follow SKILL.md retrieval routing: ZG first for concepts/relationships; exact lookup uses rg; record fallback reasons',
            'isolation': 'install/build directories remain worktree-local; allocate app ports explicitly'}
    save(private / 'environment.json', data)
    return data


def execution_context(root, private, cwd_arg, required):
    cwd = (root / cwd_arg).resolve()
    if not cwd.is_relative_to(root) or not cwd.is_dir():
        raise ValueError('cwd must be an existing directory inside the worktree')
    config_path = private / 'environment.json'
    config = json.loads(config_path.read_text()) if config_path.exists() else {'env': {}}
    env = {**os.environ, **config['env']}
    # Resolve relative PATH entries against the child working directory.
    search_path = os.pathsep.join(str((cwd / p).resolve()) for p in env.get('PATH', os.defpath).split(os.pathsep))
    resolved = {}
    for name in required:
        candidate = str((cwd / name).resolve()) if '/' in name else name
        found = shutil.which(candidate, path=search_path)
        if not found:
            raise ValueError(f'required executable missing: {name}; fix PATH/toolchain before retrying')
        resolved[name] = found
    return cwd, env, resolved


def doctor(root, private, args):
    command = args.command[1:] if args.command[:1] == ['--'] else args.command
    cwd, env, resolved = execution_context(root, private, args.cwd,
                                           args.require + command[:1])
    versions = {name: tool_version(path, name, cwd, env) for name, path in resolved.items()
                if name in ('go', 'node', 'pnpm')}
    result = {'cwd': str(cwd), 'resolved': resolved, 'versions': versions, 'exit_code': 0,
              'note': 'Run the repository toolchain check here; nested shell dependencies must be declared with --require.'}
    if command:
        command[0] = resolved[command[0]]
        check = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True, timeout=30)
        result.update(exit_code=check.returncode, output=(check.stdout + check.stderr)[-4000:])
    print(json.dumps(result, ensure_ascii=False))
    return result['exit_code'] if result['exit_code'] >= 0 else 128 - result['exit_code']


def run(root, private, args):
    wrapper_started = time.monotonic()
    if not math.isfinite(args.timeout) or args.timeout <= 0:
        raise ValueError('timeout must be finite and positive')
    config = json.loads((private / 'environment.json').read_text())
    cwd = (root / args.cwd).resolve()
    if not cwd.is_relative_to(root):
        raise ValueError('cwd must remain inside the worktree')
    command = args.command
    if command and command[0] == '--':
        command = command[1:]
    if args.action == 'install':
        if not config['pnpm_store'] or not (cwd / 'pnpm-lock.yaml').is_file():
            raise ValueError('install requires pnpm and a lockfile in cwd')
        if (cwd / 'node_modules').is_symlink():
            raise ValueError('refusing a shared/symlinked node_modules')
        prepared_pnpm = config.get('tool_paths', {}).get('pnpm', 'pnpm')
        if tool_version(prepared_pnpm, 'pnpm', cwd, {**os.environ, **config['env']}) != config['tools']['pnpm']:
            raise ValueError('pnpm version changed; prepare using matching cache-source directory')
        command = [prepared_pnpm, 'install', '--frozen-lockfile', '--prefer-offline', '--store-dir', config['pnpm_store']]
    if not command:
        raise ValueError('provide a command after --')
    cwd, env, resolved = execution_context(root, private, args.cwd, args.require + command[:1])
    resolved_versions = {name: tool_version(path, name, cwd, env) for name, path in resolved.items()
                         if name in ('go', 'node', 'pnpm')}
    for name, version in resolved_versions.items():
        prepared = config.get('tools', {}).get(name)
        if prepared is not None and version != prepared:
            raise ValueError(f'{name} version changed since prepare: prepared {prepared}, resolved {version}; rerun prepare intentionally')
    executable = resolved[command[0]]
    before = stamp(root)
    log = private / (str(time.time_ns()) + '.log')
    started = time.monotonic()
    timed_out = False
    with log.open('xb') as stream:
        os.chmod(log, 0o600)
        child = subprocess.Popen([executable, *command[1:]], cwd=cwd, env=env,
                                 stdout=stream, stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = child.wait(timeout=args.timeout)
        except (subprocess.TimeoutExpired, KeyboardInterrupt):
            timed_out = True
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=3)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
            # The leader may exit while a descendant ignores SIGTERM.
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            code = 124
    result = {'label': args.label, 'elapsed_seconds': round(time.monotonic() - started, 4),
              'exit_code': code, 'timed_out': timed_out, 'command': command, 'cwd': str(cwd),
              'before': before, 'after': stamp(root), 'tools': config['tools'],
              'resolved_executables': resolved,
              'resolved_versions': resolved_versions,
              'tools_note': 'Prepared versions and paths are persisted; required executables are version-checked at run time.',
              'log': str(log), 'output_bytes': log.stat().st_size,
              'note': 'Not automatic acceptance or a token measurement; inspect environment separately.'}
    result['total_seconds'] = round(time.monotonic() - wrapper_started, 4)
    save(log.with_suffix('.json'), result)
    summary = {key: result[key] for key in ('label', 'elapsed_seconds', 'total_seconds',
               'exit_code', 'timed_out', 'tools', 'log', 'output_bytes')}
    summary.update(record=str(log.with_suffix('.json')), head=before['head'],
                   changed_during_run=before != result['after'])
    print(json.dumps(summary, ensure_ascii=False))
    if code:
        with log.open('rb') as stream:
            stream.seek(max(0, log.stat().st_size - 4000))
            print(stream.read().decode(errors='replace'), file=sys.stderr)
    return code if code >= 0 else 128 - code


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True, help='existing owned worktree; never created/claimed here')
    sub = parser.add_subparsers(dest='action', required=True)
    p = sub.add_parser('prepare')
    p.add_argument('--cache-source', help='main checkout or matching package directory')
    p = sub.add_parser('doctor')
    p.add_argument('--cwd', default='.')
    p.add_argument('--require', action='append', default=[], help='required executable, repeatable')
    p.add_argument('command', nargs=argparse.REMAINDER, help='optional repository-native preflight after --')
    for name in ('run', 'install'):
        p = sub.add_parser(name)
        p.add_argument('--cwd', default='.')
        p.add_argument('--label', required=True, help='nonsecret phase/check name')
        p.add_argument('--timeout', type=float, default=600)
        p.add_argument('--require', action='append', default=[])
        p.add_argument('command', nargs=argparse.REMAINDER)
    p = sub.add_parser('checkpoint')
    p.add_argument('--brief', required=True, help='existing concise task handoff JSON file')
    sub.add_parser('resume')
    sub.add_parser('report')
    args = parser.parse_args()
    root, private = locations(args.root)
    if args.action == 'prepare':
        print(json.dumps(prepare(root, private, args.cache_source), ensure_ascii=False))
    elif args.action == 'doctor':
        return doctor(root, private, args)
    elif args.action in ('run', 'install'):
        return run(root, private, args)
    elif args.action == 'checkpoint':
        brief_path = Path(args.brief).resolve()
        if brief_path.stat().st_size > 16000:
            raise ValueError('brief exceeds 16 KB; link evidence instead of copying it')
        brief = json.loads(brief_path.read_text())
        for field in ('task', 'entry_paths', 'decisions', 'remaining', 'next_command'):
            if field not in brief:
                raise ValueError(f'missing brief field: {field}')
        data = {'source': str(brief_path), 'brief': brief, 'revision': stamp(root),
                'branch': capture(['git', 'branch', '--show-current'], root)}
        save(private / 'checkpoint.json', data)
        print(json.dumps(data, ensure_ascii=False))
    elif args.action == 'resume':
        data = json.loads((private / 'checkpoint.json').read_text())
        current = stamp(root)
        data.update(current=current, unchanged=current == data['revision'],
                    warning='Recheck ownership and environment; snapshot is not test acceptance.')
        print(json.dumps(data, ensure_ascii=False))
    else:
        records = [json.loads(p.read_text()) for p in sorted(private.glob('*.json')) if p.stem.isdigit()]
        print(json.dumps([{'label': r['label'], 'seconds': r['elapsed_seconds'],
                           'total_seconds': r['total_seconds'],
                           'exit': r['exit_code'], 'output_bytes': r['output_bytes'],
                           'record': str(Path(r['log']).with_suffix('.json'))} for r in records]))
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        print(f'worktree-kit: {error}', file=sys.stderr)
        sys.exit(2)
