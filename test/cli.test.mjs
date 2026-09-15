import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

test('vibe-skills exposes task-preview help', () => {
  const output = execFileSync(process.execPath, [join(root, 'bin/vibe-skills.mjs'), 'task-preview', '--help'], { encoding: 'utf8' });
  assert.match(output, /通用项目进度预览/);
  assert.match(output, /--live/);
});

test('task-preview binary renders a generic project', t => {
  const project = mkdtempSync(join(tmpdir(), 'vibe-skills-cli-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  mkdirSync(join(project, '.tasks'));
  writeFileSync(join(project, '.tasks/tasks.yaml'), 'version: 1\nproject:\n  name: CLI Example\nfeature:\n  title: Delivery\n  status: in_progress\ntasks: []\n');
  execFileSync(process.execPath, [join(root, 'bin/task-preview.mjs'), '--root', project]);
  assert.match(readFileSync(join(project, '.tasks/preview.html'), 'utf8'), /CLI Example/);
});

test('unknown command fails with a useful message', () => {
  const result = spawnSync(process.execPath, [join(root, 'bin/vibe-skills.mjs'), 'unknown'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown command/);
});
