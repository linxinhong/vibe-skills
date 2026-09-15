import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const script = path.resolve(import.meta.dirname, '../bin/preview.mjs');
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-preview-regression-'));
  const task = path.join(root, 'TASK-076');
  const images = path.join(task, 'images');
  fs.mkdirSync(images, { recursive: true });
  for (const file of ['before-v001.png', 'design-v001.png', 'design-v002.png', 'design-v003.png']) {
    fs.writeFileSync(path.join(images, file), tinyPng);
  }
  fs.writeFileSync(path.join(task, 'proposal.md'), [
    '# Proposal',
    '- 决定：批准 `images/design-v003.png` 作为 TASK-076 的视觉与信息层级基线。',
  ].join('\n'));
  return { root, task };
}

function generate(task) {
  execFileSync(process.execPath, [script, '--task', task], { encoding: 'utf8' });
  const html = fs.readFileSync(path.join(task, 'preview.html'), 'utf8');
  const match = html.match(/<script type="application\/json" id="preview-data">([\s\S]*?)<\/script>/);
  assert.ok(match, 'generated page embeds preview data');
  return { html, data: JSON.parse(match[1]) };
}

test('uses only the explicit proposal baseline decision and records its source', () => {
  const { root, task } = fixture();
  try {
    const sourceBefore = fs.readFileSync(path.join(task, 'proposal.md'), 'utf8');
    const { data } = generate(task);
    assert.deepEqual(data.versions.groups.map(({ version, status }) => [version, status]), [
      ['v001', '候选'], ['v002', '候选'], ['v003', '已批准基线'],
    ]);
    const approved = Object.values(data.entries).filter((entry) => entry.status === '已批准基线');
    assert.equal(approved.length, 1);
    assert.equal(data.images[approved[0].imageId].file, 'design-v003.png');
    assert.match(approved[0].statusSource, /^proposal\.md: - 决定：批准/);
    assert.equal(fs.readFileSync(path.join(task, 'proposal.md'), 'utf8'), sourceBefore);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('does not infer approval from negation, prose mention, fenced examples, or provisional choice', () => {
  const { root, task } = fixture();
  try {
    fs.writeFileSync(path.join(task, 'proposal.md'), [
      '# Proposal',
      '不要批准 `images/design-v001.png` 作为基线。',
      '临时选择 images/design-v002.png。',
      '```md',
      '- 决定：批准 `images/design-v003.png` 作为 TASK-076 的视觉与信息层级基线。',
      '```',
    ].join('\n'));
    const { data } = generate(task);
    assert.ok(data.versions.groups.every((group) => group.status === '候选'));
    assert.equal(Object.values(data.entries).filter((entry) => entry.status === '已批准基线').length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('generates collapsed responsive feedback, themes, safe Markdown, and exact image references', () => {
  const { root, task } = fixture();
  try {
    const { html } = generate(task);
    assert.match(html, /class: 'fb collapsed'/);
    assert.match(html, /@image\[' \+ version \+ '\|' \+ sourcePath \+ '\]'/);
    assert.match(html, /textarea\.addEventListener\('input'/);
    assert.match(html, /data-theme/);
    assert.match(html, /prefers-color-scheme: light/);
    assert.match(html, /function markdown\(text\)/);
    assert.match(html, /\^\(https\?:\|mailto:\)/);
    assert.doesNotMatch(html, /\.markdown[^}]*innerHTML/);
    assert.match(html, /@media \(max-height: 650px\)/);
    assert.match(html, /title: '按 Enter 放大'/);
    assert.match(html, /ev\.key === 'ArrowLeft'/);
    assert.match(html, /ev\.key === 'Enter' && \(ev\.metaKey \|\| ev\.ctrlKey\)/);
    assert.match(html, /快捷键：图片聚焦后 Enter 放大/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
