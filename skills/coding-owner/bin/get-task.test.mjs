import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { getContext, readCards, renderContext } from './get-task.mjs';

const yaml = `project:
  name: Example
tasks:
  - id: A
    title: "目标"
    status: ready
    goal: |
      保留多行与全部要求
      - id: THIS-IS-TEXT
    dependencies: ['B', C]
    custom_acceptance:
      nested: "不得丢失"
  - id: B
    title: 前置
    status: done
    dependencies:
      - D
    interfaces: [公开接口]
    result:
      evidence: [证据]
  - id: C
    status: in_progress
    dependencies: []
  - id: D
    status: done
    goal: 不应展开间接依赖
metadata:
  value: 不属于卡片
`;

test('preserves the complete target and only expands direct dependencies', () => {
  const context = getContext(yaml, 'A');
  assert.match(context.task.raw, /custom_acceptance/);
  assert.match(context.task.raw, /THIS-IS-TEXT/);
  assert.deepEqual(context.dependencies.map(d => d.id), ['B', 'C']);
  assert.deepEqual(context.dependencies[0].dependencies, ['D']);
  assert.match(renderContext(context), /公开接口/);
  assert.match(renderContext(context), /证据/);
  assert.doesNotMatch(renderContext(context), /不应展开间接依赖|不属于卡片/);
  assert.equal(context.warnings.length, 1);
});

test('bounds dependency excerpts with explicit omissions and keeps target unabridged', () => {
  const text = JSON.stringify({ tasks: [
    { id: 'A', goal: 'a'.repeat(4000), acceptance: ['required'], dependencies: ['B', 'missing'] },
    { id: 'B', goal: 'b'.repeat(4000), result: { evidence: ['c'.repeat(4000)] }, scope: { in: ['extra'] } }
  ] });
  const result = getContext(text, 'A', { dependencyChars: 200 });
  assert.equal(JSON.parse(result.task.raw).goal.length, 4000);
  assert.ok(result.dependencies[0].sections.every(s => s.omittedChars > 0));
  assert.equal(result.dependencies[0].sections.reduce((n, s) => n + s.text.length, 0), 200);
  assert.deepEqual(result.dependencies[0].omittedFields, ['scope']);
  assert.equal(result.dependencies[1].missing, true);
});

test('rejects ambiguous input and handles dependency cycles without recursion', () => {
  assert.equal(readCards('tasks:\n  - id: "A" # comment\n    title: "Issue #123"').get('A').title, 'Issue #123');
  assert.throws(() => getContext(yaml, 'absent'), /未找到/);
  assert.throws(() => readCards('tasks:\n  - title: nope\n    id: A'), /首|必须/);
  assert.throws(() => readCards('tasks:\n  - id: A\n  - id: A'), /重复/);
  assert.throws(() => readCards('tasks:\n  - id: A\n    dependencies: *alias'), /列表/);
  const result = getContext(JSON.stringify({ tasks: [{ id: 'A', dependencies: ['A'] }] }), 'A');
  assert.match(result.warnings[0], /自依赖/);
});

test('standalone CLI resolves explicit root, leaves registry unchanged, and fails cleanly', t => {
  const root = mkdtempSync(join(tmpdir(), 'get-task-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const registry = join(root, 'cards.yaml');
  writeFileSync(registry, yaml);
  const script = new URL('./get-task.mjs', import.meta.url);
  const args = [script.pathname, 'A', '--root', root, '--registry', 'cards.yaml', '--json'];
  const out = JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8', cwd: tmpdir() }));
  assert.equal(out.source, registry);
  assert.equal(readFileSync(registry, 'utf8'), yaml);
  const failed = spawnSync(process.execPath, [script.pathname, 'unknown', '--registry', registry], { encoding: 'utf8' });
  assert.equal(failed.status, 1);
  assert.equal(failed.stdout, '');
});
