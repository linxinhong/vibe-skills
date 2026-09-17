#!/usr/bin/env node
// Read-only context projection. Node 18+, no sibling skill or package dependency.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

function scalar(value) {
  const s = value.trim();
  if (s.startsWith('"')) {
    const match = s.match(/^("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/);
    if (!match) throw new Error('不支持的双引号值');
    return JSON.parse(match[1]);
  }
  if (s.startsWith("'")) {
    const match = s.match(/^'((?:[^']|'')*)'\s*(?:#.*)?$/);
    if (!match) throw new Error('不支持的单引号值');
    return match[1].replaceAll("''", "'");
  }
  return s.replace(/\s+#.*$/, '').trim();
}

function dependencyIds(raw) {
  if (!raw) return [];
  const value = raw.replace(/^\s*dependencies:\s*/, '').trim();
  if (/^\[\s*\]\s*(?:#.*)?$/.test(value) || !value) return [];
  let values;
  if (value.startsWith('[')) {
    const match = value.match(/^\[([\s\S]*)\]\s*(?:#.*)?$/);
    if (!match) throw new Error('dependencies 必须是 ID 数组');
    values = match[1].split(',').filter(s => s.trim()).map(scalar);
  } else {
    values = value.split('\n').filter(s => s.trim() && !s.trim().startsWith('#')).map(s => {
      const match = s.match(/^\s*-\s+(.+)$/);
      if (!match) throw new Error('dependencies 必须是 ID 列表');
      return scalar(match[1]);
    });
  }
  if (values.some(id => typeof id !== 'string' || !/^[\w.-]+$/.test(id))) {
    throw new Error('dependency ID 仅支持字母、数字、下划线、点和连字符');
  }
  return [...new Set(values)];
}

// Keep arbitrary card fields verbatim instead of implementing a general YAML parser.
export function readCards(text) {
  if (text.trimStart().startsWith('{')) {
    const doc = JSON.parse(text);
    if (!Array.isArray(doc.tasks)) throw new Error('JSON 必须包含 tasks 数组');
    return indexCards(doc.tasks.map(task => {
      if (!task || typeof task !== 'object') throw new Error('无效任务对象');
      if (task.dependencies != null && (!Array.isArray(task.dependencies) || task.dependencies.some(id => typeof id !== 'string'))) throw new Error('无效 dependencies');
      return { id: task.id, title: task.title, status: task.status,
        dependencies: task.dependencies || [], raw: JSON.stringify(task, null, 2), format: 'json',
        fields: Object.fromEntries(Object.entries(task).map(([key, value]) => [key, JSON.stringify(value, null, 2)])) };
    }));
  }
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const start = lines.findIndex(line => /^tasks:\s*(?:#.*)?$/.test(line));
  if (start < 0) throw new Error('仅支持顶层 tasks: 列表；其他 YAML 格式请先导出 JSON');
  let end = lines.findIndex((line, i) => i > start && /^\S/.test(line) && !line.startsWith('#') && !line.startsWith('- '));
  if (end < 0) end = lines.length;
  const body = lines.slice(start + 1, end);
  const first = body.find(line => line.trim() && !line.trim().startsWith('#'));
  if (!first) return new Map();
  const initial = first.match(/^( *)- id:\s*(.+)$/);
  if (!initial) throw new Error('YAML 每张卡必须以同层级的 - id: 开始；其他格式请导出 JSON');
  const indent = initial[1].length;
  const header = new RegExp('^ {' + indent + '}- id:\\s*(.+)$');
  const item = new RegExp('^ {' + indent + '}- ');
  const field = new RegExp('^ {' + (indent + 2) + '}([\\w.-]+):');
  const blocks = [];
  for (const line of body) {
    if (/^\s*\t/.test(line)) throw new Error('不支持 Tab 缩进');
    const match = line.match(header);
    if (match) blocks.push({ id: scalar(match[1]), lines: [line] });
    else if (item.test(line)) throw new Error('每张卡的首字段必须是 id');
    else if (blocks.length) blocks.at(-1).lines.push(line);
  }
  return indexCards(blocks.map(block => {
    const fields = {};
    let key;
    for (const line of block.lines.slice(1)) {
      const match = line.match(field);
      if (match) {
        key = match[1];
        if (Object.hasOwn(fields, key)) throw new Error(block.id + ' 存在重复字段：' + key);
        fields[key] = line;
      } else if (key) fields[key] += '\n' + line;
    }
    const value = key => fields[key] ? scalar(fields[key].split('\n')[0].replace(/^\s*[\w.-]+:\s*/, '')) : null;
    return { id: block.id, title: value('title'), status: value('status'),
      dependencies: dependencyIds(fields.dependencies), raw: block.lines.join('\n').trimEnd(), format: 'yaml', fields };
  }));
}

function indexCards(cards) {
  const byId = new Map();
  for (const card of cards) {
    if (typeof card.id !== 'string' || !card.id || byId.has(card.id)) throw new Error('任务 ID 缺失或重复：' + card.id);
    byId.set(card.id, card);
  }
  return byId;
}

export function getContext(text, id, { dependencyChars = 2400 } = {}) {
  if (!Number.isInteger(dependencyChars) || dependencyChars < 200) throw new Error('--dependency-chars 必须是至少 200 的整数');
  const cards = readCards(text), task = cards.get(id);
  if (!task) throw new Error('未找到任务：' + id);
  const dependencies = task.dependencies.map(depId => {
    const dep = cards.get(depId);
    if (!dep) return { id: depId, missing: true };
    // Bound each section so long goals cannot displace evidence or interface pointers.
    const selected = ['goal', 'contracts', 'interfaces', 'investigation_hints', 'entry_map', 'design_refs', 'result', 'evidence'];
    const available = selected.filter(key => dep.fields[key]);
    const limit = Math.floor(dependencyChars / Math.max(1, available.length));
    const sections = available.map(key => {
      const raw = dep.fields[key];
      return { field: key, text: raw.slice(0, limit), omittedChars: Math.max(0, raw.length - limit) };
    });
    return { id: dep.id, title: dep.title, status: dep.status, dependencies: dep.dependencies, sections,
      omittedFields: Object.keys(dep.fields).filter(key => !['id', 'title', 'status', 'dependencies', ...selected].includes(key)) };
  });
  return { task: { id: task.id, title: task.title, status: task.status, format: task.format, raw: task.raw }, dependencies,
    warnings: dependencies.filter(dep => dep.missing || dep.status !== 'done' || dep.id === id).map(dep =>
      dep.missing ? '缺失依赖：' + dep.id : dep.id === id ? '自依赖：' + id : '依赖尚未完成：' + dep.id + ' (' + dep.status + ')'),
    note: '仅为账本快照，done 不代表已验证代码；直接依赖为摘要，间接依赖未展开。需要完整依赖卡时以其 ID 再运行本命令。' };
}

export function renderContext(context) {
  const { task, dependencies } = context;
  const output = ['# ' + (task.title || '名称待核实') + '（' + task.id + '）', context.note];
  if (context.source) output.push('来源：' + context.source);
  output.push(...context.warnings.map(s => '注意：' + s), '\n## 目标卡（完整）', task.raw);
  output.push('\n## 直接依赖（' + dependencies.length + '）');
  for (const dep of dependencies) {
    output.push('\n### ' + (dep.title || '名称待核实') + '（' + dep.id + '）', '状态：' + (dep.status || '缺失'));
    if (dep.missing) continue;
    output.push('间接依赖（未展开）：' + (dep.dependencies.join(', ') || '无'));
    for (const section of dep.sections) output.push(section.field + ':\n' + section.text + (section.omittedChars ? '\n[省略 ' + section.omittedChars + ' 字符；用此依赖 ID 获取完整卡]' : ''));
    if (dep.omittedFields.length) output.push('未展开字段：' + dep.omittedFields.join(', '));
  }
  return output.join('\n\n') + '\n';
}

export function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    root: { type: 'string', default: process.cwd() }, registry: { type: 'string', default: '.tasks/tasks.yaml' },
    'dependency-chars': { type: 'string', default: '2400' }, json: { type: 'boolean' }, help: { type: 'boolean' }
  } });
  if (values.help) {
    console.log('Usage: node get-task.mjs <ID> [--root <authoritative-checkout>] [--registry <path>] [--dependency-chars 2400] [--json]\n只读：完整目标卡 + 直接依赖摘要。支持 JSON 和以 - id: 分块的 YAML；不读取关联文件、不操作 Git。');
    return;
  }
  if (positionals.length !== 1) throw new Error('需要一个任务 ID；用 --help 查看用法');
  const source = resolve(values.root, values.registry);
  const context = getContext(readFileSync(source, 'utf8'), positionals[0], { dependencyChars: Number(values['dependency-chars']) });
  context.source = source;
  console.log(values.json ? JSON.stringify(context, null, 2) : renderContext(context));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); } catch (error) { console.error('get-task: ' + error.message); process.exitCode = 1; }
}
