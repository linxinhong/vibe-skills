"""Isolated integration tests; optional real Go cold/warm benchmark."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).with_name('worktree-kit.py')
spec = importlib.util.spec_from_file_location('kit', SCRIPT)
kit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kit)


class WorktreeKitTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='coding-owner-test-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / 'main'
        self.root.mkdir()
        self.git('init', '-q')
        (self.root / 'tracked.txt').write_text('first\n')
        self.git('add', '.')
        self.git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
                 'commit', '-qm', 'fixture')
        self.other = self.base / 'other'
        self.git('worktree', 'add', '-qb', 'test-other', str(self.other))
        self.root, self.private = kit.locations(self.root)
        # Proves preparation and execution work with no optional tool, including no ZG.
        with patch.object(kit.shutil, 'which', return_value=None):
            kit.prepare(self.root, self.private, None)

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root, stderr=subprocess.PIPE)

    def cli(self, *args, root=None):
        return subprocess.run([sys.executable, str(SCRIPT), '--root', str(root or self.root), *args],
                              capture_output=True, text=True)

    def test_no_optional_tools_and_real_execution(self):
        result = self.cli('run', '--label', 'no-zg', '--', sys.executable, '-c', 'print("executed")')
        self.assertEqual(result.returncode, 0, result.stderr)
        record = json.loads(result.stdout)
        self.assertEqual(Path(record['log']).read_text(), 'executed\n')
        self.assertEqual(record['tools'], {})
        self.assertEqual(len(result.stdout.splitlines()), 1)
        self.assertNotIn('stdout', record)
        self.assertEqual(self.git('status', '--porcelain'), b'')

    def test_writable_build_cache_is_reused(self):
        requested = self.base / 'shared-cache'
        selected, decision = kit.select_build_cache(str(requested), self.private)
        self.assertEqual(selected, str(requested))
        self.assertEqual(decision['mode'], 'reuse')
        self.assertEqual(list(requested.iterdir()), [])

    def test_denied_cache_falls_back_without_clearing_existing_data(self):
        requested = self.base / 'denied-cache'
        requested.mkdir()
        marker = requested / 'existing'
        marker.write_text('preserve')
        real_probe = kit.probe_cache_write
        def probe(path):
            if path == requested:
                raise PermissionError(13, 'fixture denial')
            return real_probe(path)
        with patch.object(kit, 'probe_cache_write', side_effect=probe):
            selected, decision = kit.select_build_cache(str(requested), self.private)
        self.assertEqual(selected, str(self.private / 'cache' / 'go-build'))
        self.assertEqual(decision['mode'], 'private-fallback')
        self.assertEqual(marker.read_text(), 'preserve')
        self.assertEqual(self.git('status', '--porcelain'), b'')

    def test_denied_fallback_stops_preparation(self):
        with patch.object(kit, 'probe_cache_write', side_effect=PermissionError(13, 'denied')):
            with self.assertRaises(PermissionError):
                kit.select_build_cache(str(self.base / 'denied'), self.private)

    def test_failure_code_and_bounded_tail(self):
        result = self.cli('run', '--label', 'failure', '--', sys.executable, '-c',
                          'print("x" * 10000); raise SystemExit(7)')
        self.assertEqual(result.returncode, 7)
        self.assertLess(len(result.stderr), 4100)
        self.assertGreater(json.loads(result.stdout)['output_bytes'], 10000)

    def test_timeout(self):
        result = self.cli('run', '--label', 'timeout', '--timeout', '0.05', '--',
                          sys.executable, '-c', 'import time; time.sleep(10)')
        self.assertEqual(result.returncode, 124)
        self.assertTrue(json.loads(result.stdout)['timed_out'])

    def test_missing_dependency_fails_before_work(self):
        for action in ('doctor', 'run'):
            options = ['--label', 'preflight'] if action == 'run' else []
            result = self.cli(action, *options, '--require', 'missing-fixture-tool-729135', '--',
                              sys.executable, '-c', 'from pathlib import Path; Path("side-effect").touch()')
            self.assertEqual(result.returncode, 2)
            self.assertFalse((self.root / 'side-effect').exists())

    def test_doctor_propagates_native_check_failure(self):
        result = self.cli('doctor', '--require', sys.executable, '--', sys.executable,
                          '-c', 'print("unsupported toolchain"); raise SystemExit(9)')
        self.assertEqual(result.returncode, 9)
        self.assertIn('unsupported toolchain', json.loads(result.stdout)['output'])

    def test_doctor_resolves_relative_command_in_child_cwd(self):
        directory = self.root / 'nested'
        directory.mkdir()
        (directory / 'python-local').symlink_to(sys.executable)
        result = self.cli('doctor', '--cwd', 'nested', '--', './python-local', '-c', 'print("ok")')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['output'], 'ok\n')

    def test_prepare_persists_selected_tool_path_and_run_detects_version_drift(self):
        tools = self.base / 'selected-tools'
        tools.mkdir()
        node = tools / 'node'
        node.write_text('#!/bin/sh\nprintf "v24.15.0\\n"\n')
        node.chmod(0o755)
        with patch.object(kit.shutil, 'which', side_effect=lambda name: str(node) if name == 'node' else None):
            config = kit.prepare(self.root, self.private, None)
        self.assertEqual(config['tool_paths']['node'], str(node.resolve()))
        self.assertEqual(config['tools']['node'], 'v24.15.0')
        self.assertEqual(config['env']['PATH'].split(os.pathsep)[0], str(self.private / 'toolchain'))
        self.assertEqual((self.private / 'toolchain' / 'node').resolve(), node.resolve())
        node.write_text('#!/bin/sh\nprintf "v25.0.0\\n"\n')
        result = self.cli('run', '--label', 'drift', '--require', 'node', '--', sys.executable, '-c', 'pass')
        self.assertEqual(result.returncode, 2)
        self.assertIn('node version changed since prepare', result.stderr)

    def test_isolated_runtime(self):
        _, private2 = kit.locations(self.other)
        with patch.object(kit.shutil, 'which', return_value=None):
            second = kit.prepare(self.other, private2, None)
        first = json.loads((self.private / 'environment.json').read_text())
        self.assertNotEqual(first['env']['CODING_OWNER_RUNTIME_DIR'],
                            second['env']['CODING_OWNER_RUNTIME_DIR'])

    def test_checkpoint_detects_dirty_contents(self):
        brief = self.base / 'brief.json'
        brief.write_text(json.dumps(dict(task='Fixture (TEST)', entry_paths=['tracked.txt'],
                                        decisions=[], remaining=[], next_command='git status')))
        self.assertEqual(self.cli('checkpoint', '--brief', str(brief)).returncode, 0)
        self.assertTrue(json.loads(self.cli('resume').stdout)['unchanged'])
        (self.root / 'tracked.txt').write_text('changed\n')
        self.assertFalse(json.loads(self.cli('resume').stdout)['unchanged'])
        first = kit.stamp(self.root)
        (self.root / 'tracked.txt').write_text('changed again\n')
        self.assertNotEqual(first['dirty_sha256'], kit.stamp(self.root)['dirty_sha256'])

    def test_reject_outside_cwd_and_shared_install(self):
        result = self.cli('run', '--cwd', '..', '--label', 'escape', '--', 'true')
        self.assertEqual(result.returncode, 2)
        config = json.loads((self.private / 'environment.json').read_text())
        config['pnpm_store'] = str(self.base / 'store')
        kit.save(self.private / 'environment.json', config)
        (self.root / 'pnpm-lock.yaml').write_text('lockfileVersion: 9\n')
        (self.root / 'node_modules').symlink_to(self.other, target_is_directory=True)
        self.assertEqual(self.cli('install', '--label', 'unsafe').returncode, 2)

    def test_report_records_failures_too(self):
        self.cli('run', '--label', 'ok', '--', sys.executable, '-c', 'pass')
        self.cli('run', '--label', 'bad', '--', sys.executable, '-c', 'raise SystemExit(3)')
        report = json.loads(self.cli('report').stdout)
        self.assertEqual([r['exit'] for r in report], [0, 3])

    def test_untracked_changes_detected(self):
        first = kit.stamp(self.root)
        (self.root / 'new.txt').write_text('new')
        self.assertNotEqual(first['dirty_sha256'], kit.stamp(self.root)['dirty_sha256'])

    @unittest.skipUnless(kit.shutil.which('pnpm'), 'pnpm unavailable')
    def test_real_pnpm_shared_store_isolated_installs(self):
        store = self.base / 'pnpm-store'
        for root in (self.root, self.other):
            (root / 'dep').mkdir()
            (root / 'dep' / 'package.json').write_text('{"name":"fixture-dep","version":"1.0.0"}')
            (root / 'package.json').write_text('{"private":true,"dependencies":{"fixture-dep":"file:./dep"}}')
            subprocess.check_output(['pnpm', 'install', '--lockfile-only', '--offline',
                                     '--ignore-scripts', '--store-dir', str(store)], cwd=root,
                                    stderr=subprocess.STDOUT)
            _, private = kit.locations(root)
            config = kit.prepare(root, private, self.root)
            # Use a disposable store, not the user's warmed cache, for this test.
            config['pnpm_store'] = str(store)
            kit.save(private / 'environment.json', config)
            result = self.cli('install', '--label', 'pnpm-fixture', root=root)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((root / 'node_modules' / 'fixture-dep' / 'package.json').is_file())
            self.assertFalse((root / 'node_modules').is_symlink())
        self.assertNotEqual((self.root / 'node_modules').stat().st_ino,
                            (self.other / 'node_modules').stat().st_ino)


def benchmark():
    """Same Go fixture in two worktrees, fresh disposable cache then reuse it."""
    test = WorktreeKitTest()
    test.setUp()
    try:
        (test.root / 'go.mod').write_text('module example.invalid/cachefixture\n\ngo 1.22\n')
        (test.root / 'cache_test.go').write_text(
            'package cachefixture\nimport "testing"\nfunc TestAdd(t *testing.T) { if 2+2 != 4 { t.Fatal("bad") } }\n')
        test.git('add', '.')
        test.git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'Go fixture')
        subprocess.check_call(['git', 'merge', '--ff-only', 'master' if
                               kit.capture(['git', 'branch', '--show-current'], test.root) == 'master'
                               else kit.capture(['git', 'branch', '--show-current'], test.root)],
                              cwd=test.other, stdout=subprocess.DEVNULL)
        caches = {'GOCACHE': str(test.base / 'fresh-build-cache'),
                  'GOMODCACHE': str(test.base / 'fresh-mod-cache'), 'GOTOOLCHAIN': 'local'}
        results = []
        with patch.dict(os.environ, caches):
            for root, label in [(test.root, 'cold'), (test.other, 'warm-other-worktree'),
                                (test.other, 'warm-repeat')]:
                _, private = kit.locations(root)
                kit.prepare(root, private, test.root)
                # -count=1 reruns the actual test rather than reusing test result output.
                result = test.cli('run', '--label', label, '--', 'go', 'test', '-count=1', './...', root=root)
                if result.returncode:
                    raise RuntimeError(result.stderr)
                record = json.loads(result.stdout)
                results.append({'label': label, 'seconds': record['elapsed_seconds'],
                                'total_seconds': record['total_seconds'],
                                'exit': record['exit_code'], 'head': record['head']})
        print(json.dumps({'go_cache_benchmark': results,
                          'scope': 'small synthetic fixture; not whole-project or token savings'}, indent=2))
    finally:
        test.doCleanups()


if __name__ == '__main__':
    if '--benchmark' in sys.argv:
        benchmark()
    else:
        unittest.main()
