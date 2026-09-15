#!/usr/bin/env node
// preview.mjs — 零依赖 UI 设计交付预览页生成器
// 用法一(任务目录): node preview.mjs --task <任务目录> [--out <html路径>] [--open]
// 用法二(直接多图): node preview.mjs [图片...] [--img 图片 --title 标题 --version 版本 --prompt 提示词文件]... [--before 原图] [--name 标题] [--out 路径] [--open]
// 仅使用 node: 内置模块。生成单文件 preview.html(图片全部 base64 内嵌);任务模式另写 preview.json(发现清单)。

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const VERSION_RE = /^(before|design)-v(\d+)(-[a-z0-9-]+)?\.(png|jpe?g|webp|gif)$/i;
const PAGE_RE = /^(UI-\d+)(-[a-z0-9-]+)?\.(png|jpe?g|webp|gif)$/i;
const IMG_EXT_RE = /\.(png|jpe?g|webp|gif)$/i;
const PROMPT_RE = /^prompt-v(\d+)\.md$/i;

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const STATUS_ZH = {
  candidate: '候选',
  approved: '已批准',
  approved_reuse: '已批准复用',
  approved_baseline: '已批准基线',
  baseline: '基线',
  rejected: '已否决',
  draft: '草稿',
  superseded: '已取代',
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  process.stderr.write(
    [
      '用法一(任务目录): node preview.mjs --task <任务目录> [--out <html路径>] [--open]',
      '用法二(直接多图): node preview.mjs [图片...] [--img 图片 --title 标题 --version 版本 --prompt 提示词文件]... [--before 原图] [--name 标题] [--out 路径] [--open]',
      '',
      '  --task     任务目录(应包含 images/ 子目录;相对 CWD 或绝对路径)',
      '  --img      新增一张图片(也可以直接把图片路径写成位置参数);',
      '             其后的 --title/--version/--prompt 作用于这张图片',
      '  --title    当前图片的标题',
      '  --version  当前图片的版本标签,相同标签合并为一组;缺省时从文件名 design-vNNN / UI-NN 推导,',
      '             推导不出则按出现顺序命名为 图01、图02…',
      '  --prompt   当前图片的提示词 markdown 文件(内嵌展示)',
      '  --before   全局原图,与各方案并排对比;文件名 before-*.png 也会被识别为原图',
      '  --name     评审页标题(默认「命令行预览」)',
      '  --out      输出 HTML 路径;任务模式默认 <任务目录>/preview.html,多图模式默认 ./preview.html',
      '  --open     生成后用系统默认浏览器打开(不加则不打开)',
      '',
      '说明:--task 与直接传图二选一;任务模式会另写 preview.json 清单,多图模式不写。',
      '',
    ].join('\n'),
  );
}

function parseArgs(argv) {
  const out = { task: null, out: null, open: false, name: null, before: null, items: [] };
  let current = null; // 最后一个图片条目,--title/--version/--prompt 作用于它
  const addItem = (p) => {
    current = { path: p, title: null, version: null, prompt: null };
    out.items.push(current);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--task') {
      const v = argv[++i];
      if (v === undefined) return { error: '--task 需要一个目录参数' };
      out.task = v;
    } else if (a === '--out') {
      const v = argv[++i];
      if (v === undefined) return { error: '--out 需要一个路径参数' };
      out.out = v;
    } else if (a === '--open') {
      out.open = true;
    } else if (a === '--name') {
      const v = argv[++i];
      if (v === undefined) return { error: '--name 需要一个标题参数' };
      out.name = v;
    } else if (a === '--before') {
      const v = argv[++i];
      if (v === undefined) return { error: '--before 需要一个图片路径参数' };
      out.before = v;
    } else if (a === '--img' || a === '--image') {
      const v = argv[++i];
      if (v === undefined) return { error: a + ' 需要一个图片路径参数' };
      addItem(v);
    } else if (a === '--title' || a === '--version' || a === '--prompt') {
      const v = argv[++i];
      if (v === undefined) return { error: a + ' 需要一个参数' };
      if (!current) return { error: a + ' 必须出现在某张图片(--img 或位置参数)之后' };
      current[a.slice(2)] = v;
    } else if (a === '--help' || a === '-h') {
      return { error: null, help: true };
    } else if (a.startsWith('-')) {
      return { error: '无法识别的参数: ' + a };
    } else {
      addItem(a);
    }
  }
  if (out.task && (out.items.length > 0 || out.before)) {
    return { error: '--task 与直接传图(--img/位置参数/--before)不能同时使用' };
  }
  return out;
}

// ---------------------------------------------------------------------------
// 图片尺寸解析(零依赖): PNG / JPEG / GIF / WebP,失败返回 null
// ---------------------------------------------------------------------------

function readU16be(buf, off) {
  return (buf[off] << 8) | buf[off + 1];
}

function parseImageSize(buf) {
  try {
    if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47) return parsePng(buf);
    if (buf.length >= 10 && buf[0] === 0xff && buf[1] === 0xd8) return parseJpeg(buf);
    if (buf.length >= 10 && buf.toString('latin1', 0, 3) === 'GIF') return parseGif(buf);
    if (
      buf.length >= 16 &&
      buf.toString('latin1', 0, 4) === 'RIFF' &&
      buf.toString('latin1', 8, 12) === 'WEBP'
    ) {
      return parseWebp(buf);
    }
  } catch {
    // fallthrough
  }
  return null;
}

function validSize(w, h) {
  return Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0 ? { width: w, height: h } : null;
}

function parsePng(buf) {
  if (buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return validSize(buf.readUInt32BE(16), buf.readUInt32BE(20));
}

function parseGif(buf) {
  return validSize(buf.readUInt16LE(6), buf.readUInt16LE(8));
}

function parseWebp(buf) {
  const fourcc = buf.toString('latin1', 12, 16);
  if (fourcc === 'VP8 ') {
    // 有损:帧头 sync code 0x9d 0x01 0x2a 之后是 14bit 宽、14bit 高
    if (buf.length < 30) return null;
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    return validSize(buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff);
  }
  if (fourcc === 'VP8L') {
    // 无损:首字节 0x2f,随后 14bit 宽-1、14bit 高-1
    if (buf.length < 25) return null;
    if (buf[20] !== 0x2f) return null;
    const n = buf.readUInt32LE(21);
    return validSize((n & 0x3fff) + 1, ((n >>> 14) & 0x3fff) + 1);
  }
  if (fourcc === 'VP8X') {
    // 扩展:4 字节保留后是 24bit 画布宽-1、24bit 高-1
    if (buf.length < 30) return null;
    const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
    const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
    return validSize(w, h);
  }
  return null;
}

function parseJpeg(buf) {
  let off = 2;
  while (off + 4 < buf.length) {
    if (buf[off] !== 0xff) {
      off++;
      continue;
    }
    const marker = buf[off + 1];
    if (marker === 0xff) {
      off++;
      continue;
    } // 填充字节
    // 无长度段:SOI/EOI/独立段/RST
    if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      off += 2;
      continue;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return validSize(readU16be(buf, off + 7), readU16be(buf, off + 5));
    }
    off += 2 + readU16be(buf, off + 2);
  }
  return null;
}

// ---------------------------------------------------------------------------
// 元数据解析(gallery.md / page-map.yaml / prompt-record.md / proposal.md)
// ---------------------------------------------------------------------------

function readTextSafe(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function extractKeyLine(text, key) {
  const re = new RegExp('^' + key + '\\s*:[ \\t]*(.+?)[ \\t]*$', 'im');
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

// Only an explicit, standalone maintainer decision can promote an image. Mentions in
// prose, rejected/negated statements, and feedback selections deliberately do not.
function parseApprovedBaselines(text) {
  const byBasename = new Map();
  if (!text) return byBasename;
  let inFence = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^```/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    const m = line.match(/^[-*]\s+决定[：:]\s*批准\s+`(images\/[A-Za-z0-9._-]+)`\s+作为\s+.+?基线[。.]?$/);
    if (!m || !IMG_EXT_RE.test(m[1])) continue;
    byBasename.set(path.basename(m[1]), { status: '已批准基线', source: 'proposal.md: ' + line });
  }
  return byBasename;
}

function statusZh(raw) {
  if (!raw) return null;
  if (STATUS_ZH[raw]) return STATUS_ZH[raw];
  return raw;
}

// gallery.md:按 `##` 分节;行如 `- UI-01 [标题](images/x.png)` 或 `- UI-12浮层 [标题](路径)`
function parseGallery(text) {
  const sections = [];
  const byBasename = new Map(); // basename -> { title, label, target, overlay, heading }
  let heading = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const h = line.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      heading = h[1].trim();
      continue;
    }
    const m = line.match(/^[-*]\s+(?:(\S+)\s+)?\[([^\]]+)\]\(([^)\s]+)\)\s*$/);
    if (!m) continue;
    const label = m[1] || '';
    const title = m[2].trim();
    const target = m[3].trim();
    const base = path.basename(target);
    const overlay = /浮层/.test(label);
    const item = { label, title, target, overlay, heading };
    if (!IMG_EXT_RE.test(base)) continue;
    sections.push(item);
    if (!byBasename.has(base)) byBasename.set(base, item);
  }
  return { sections, byBasename };
}

// page-map.yaml:只解析扁平 `key: {k: v, ...}` / `key: path` 行,分节 pages / overlays / 其他
function parsePageMap(text) {
  const result = { pages: new Map(), overlays: new Map() }; // key -> { status, image } / image
  let section = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    const sec = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*$/);
    if (sec) {
      section = sec[1];
      continue;
    }
    if (/^-\s/.test(line)) continue; // 列表项(如 component_roots),忽略
    if (section !== 'pages' && section !== 'overlays') continue;
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1];
    const value = kv[2].trim();
    if (section === 'pages') {
      const inline = value.match(/^\{(.*)\}$/);
      let status = null;
      let image = null;
      if (inline) {
        const sm = inline[1].match(/status\s*:\s*([A-Za-z0-9_-]+)/);
        const im = inline[1].match(/image\s*:\s*([^,}\s]+)/);
        status = sm ? sm[1] : null;
        image = im ? im[1] : null;
      } else {
        image = value;
      }
      if (image) result.pages.set(key, { status, image });
    } else {
      result.overlays.set(key, value.replace(/^\{/, '').replace(/[}\s]+$/, ''));
    }
  }
  return result;
}

// prompt-record.md:`| UI-NN | 内容 |` 表格行 + `## 浮层提示` 小节的 `- 词条：内容`
function parsePromptRecord(text) {
  const byPage = new Map(); // UI-NN -> text
  const overlayHints = []; // { term, text }
  let inOverlayHints = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^#{1,6}\s/.test(line)) {
      inOverlayHints = /浮层提示/.test(line);
      continue;
    }
    const row = line.match(/^\|\s*(UI-\d+)\s*\|\s*(.+?)\s*\|\s*$/);
    if (row && !byPage.has(row[1])) {
      byPage.set(row[1], row[2]);
      continue;
    }
    if (inOverlayHints) {
      const bullet = line.match(/^[-*]\s+(.+)$/);
      if (bullet) {
        const kv = bullet[1].match(/^([^:：]{1,20})[:：]\s*(.+)$/);
        if (kv) overlayHints.push({ term: kv[1].trim(), text: bullet[1].trim() });
        else overlayHints.push({ term: null, text: bullet[1].trim() });
      }
    }
  }
  return { byPage, overlayHints };
}

// ---------------------------------------------------------------------------
// 任务发现
// ---------------------------------------------------------------------------

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function findPromptFiles(taskDir, imagesDir) {
  const map = new Map(); // num -> { abs, rel }
  for (const dir of [taskDir, imagesDir]) {
    for (const ent of listDir(dir)) {
      if (!ent.isFile()) continue;
      const m = ent.name.match(PROMPT_RE);
      if (!m) continue;
      const num = parseInt(m[1], 10);
      if (map.has(num)) continue; // 任务根目录优先
      map.set(num, { abs: path.join(dir, ent.name), rel: path.relative(taskDir, path.join(dir, ent.name)) });
    }
  }
  return map;
}

function slugToTitle(slug, fallback) {
  if (!slug) return fallback;
  const s = slug.replace(/^-/, '').replace(/-/g, ' ').trim();
  if (!s) return fallback;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function isDraftSlug(slug) {
  return !!slug && /-draft$/i.test(slug);
}

function versionStatusFromSlug(slug) {
  if (slug && /rejected/i.test(slug)) return '已否决';
  if (slug && /draft/i.test(slug)) return '草稿';
  return '候选';
}

function relRatioDiff(a, b) {
  const mean = (a + b) / 2;
  return Math.abs(a - b) / mean;
}

// ---------------------------------------------------------------------------
// 数据构建器(任务模式与命令行多图模式共用)
// ---------------------------------------------------------------------------

function createBuilders() {
  const images = {}; // id -> image
  const entries = {}; // id -> entry
  let idSeq = 0;
  const nextId = (p) => p + '-' + ++idSeq;
  function addImage(absFile, displayFile = path.basename(absFile), sourcePath = absFile) {
    const buf = fs.readFileSync(absFile);
    const size = parseImageSize(buf);
    const ext = path.extname(absFile).toLowerCase();
    const id = nextId('img');
    const ratio = size ? Math.round((size.width / size.height) * 100) / 100 : null;
    images[id] = {
      id,
      file: displayFile,
      sourcePath,
      dataUrl: 'data:' + (MIME[ext] || 'application/octet-stream') + ';base64,' + buf.toString('base64'),
      width: size ? size.width : null,
      height: size ? size.height : null,
      bytes: buf.length,
      ratio: ratio === null ? null : ratio.toFixed(2),
    };
    return id;
  }
  function addEntry(fields) {
    const id = nextId('e');
    entries[id] = Object.assign({ id }, fields);
    return id;
  }
  return { images, entries, addImage, addEntry };
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error || args.help) {
    if (args.error) process.stderr.write('错误: ' + args.error + '\n\n');
    usage();
    process.exit(args.error ? 1 : (args.help ? 0 : 1));
  }
  if (!args.task) return mainCli(args);

  const taskDir = path.resolve(process.cwd(), args.task);
  let st = null;
  try {
    st = fs.statSync(taskDir);
  } catch {
    /* not found */
  }
  if (!st || !st.isDirectory()) {
    process.stderr.write('错误: 路径无效或不是目录: ' + taskDir + '\n\n');
    usage();
    process.exit(1);
  }

  const imagesDir = path.join(taskDir, 'images');
  let imagesSt = null;
  try {
    imagesSt = fs.statSync(imagesDir);
  } catch {
    /* missing */
  }
  if (!imagesSt || !imagesSt.isDirectory()) {
    // 可能指向父目录:列出包含 images/ 的子目录
    const candidates = [];
    for (const ent of listDir(taskDir)) {
      if (!ent.isDirectory()) continue;
      let has = false;
      try {
        has = fs.statSync(path.join(taskDir, ent.name, 'images')).isDirectory();
      } catch {
        has = false;
      }
      if (has) candidates.push(path.join(taskDir, ent.name));
    }
    if (candidates.length > 0) {
      process.stdout.write(
        '该目录不是任务目录(缺少 images/ 子目录)。可用的任务子目录:\n' +
          candidates.map((c) => '  - ' + c).join('\n') +
          '\n请用 --task 指定其中一个后重试。\n',
      );
    } else {
      process.stdout.write(
        '该目录不是任务目录:未找到 ' + imagesDir + ',其子目录中也没有包含 images/ 的任务目录。\n',
      );
    }
    process.exit(2);
  }

  // ---- 扫描 images/ ----
  const imageFiles = [];
  for (const ent of listDir(imagesDir)) {
    if (!ent.isFile()) continue;
    if (!IMG_EXT_RE.test(ent.name)) continue;
    imageFiles.push(ent.name);
  }
  imageFiles.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));

  if (imageFiles.length === 0) {
    process.stdout.write(
      '任务目录没有任何图片。已检查 ' + imagesDir + '(仅扫描该目录,支持 png/jpeg/webp/gif)。\n',
    );
    process.exit(2);
  }

  // ---- 读取元数据 ----
  const proposalText = readTextSafe(path.join(taskDir, 'proposal.md'));
  const galleryText = readTextSafe(path.join(taskDir, 'gallery.md'));
  const pageMapText = readTextSafe(path.join(taskDir, 'page-map.yaml'));
  const promptRecordText = readTextSafe(path.join(taskDir, 'prompt-record.md'));
  const gallery = galleryText ? parseGallery(galleryText) : null;
  const pageMap = pageMapText ? parsePageMap(pageMapText) : null;
  const promptRecord = promptRecordText ? parsePromptRecord(promptRecordText) : null;
  const promptFiles = findPromptFiles(taskDir, imagesDir);
  const approvedBaselines = parseApprovedBaselines(proposalText);

  const generatedAt = new Date();
  const taskId = path.basename(taskDir);

  const { images, entries, addImage, addEntry } = createBuilders();

  const versionDesigns = new Map(); // num -> [{ file, slug }]
  const versionBefores = new Map(); // num -> file
  const pageFiles = []; // { file, pageId, slug }
  const otherFiles = [];

  for (const file of imageFiles) {
    const mv = file.match(VERSION_RE);
    const mp = mv ? null : file.match(PAGE_RE);
    if (mv) {
      const num = parseInt(mv[2], 10);
      const kind = mv[1].toLowerCase();
      const slug = mv[3] || '';
      if (kind === 'before') {
        if (!versionBefores.has(num)) versionBefores.set(num, file);
      } else {
        if (!versionDesigns.has(num)) versionDesigns.set(num, []);
        versionDesigns.get(num).push({ file, slug });
      }
    } else if (mp) {
      pageFiles.push({ file, pageId: mp[1].toUpperCase(), slug: mp[2] || '' });
    } else {
      otherFiles.push(file);
    }
  }

  // ---- 版本式条目 ----
  const groups = [];
  const beforeEntryByNum = new Map();
  const beforeNums = [...versionBefores.keys()].sort((a, b) => a - b);
  for (const num of beforeNums) {
    const f = versionBefores.get(num);
    const imgId = addImage(path.join(imagesDir, f), f);
    const pf = promptFiles.get(num);
    beforeEntryByNum.set(
      num,
      addEntry({
        kind: 'before',
        role: 'before',
        label: '原图(before)',
        title: '原图(参考截图)',
        status: null,
        version: 'v' + String(num).padStart(3, '0'),
        imageId: imgId,
        promptFile: pf ? pf.rel : null,
      }),
    );
  }
  const taskBeforeEntryId = beforeNums.length > 0 ? beforeEntryByNum.get(beforeNums[0]) : null;

  const groupNums = [...new Set([...versionDesigns.keys(), ...versionBefores.keys()])].sort((a, b) => a - b);
  for (const num of groupNums) {
    const version = 'v' + String(num).padStart(3, '0');
    const designs = versionDesigns.get(num) || [];
    const designEntryIds = [];
    const statuses = [];
    for (const d of designs) {
      const imgId = addImage(path.join(imagesDir, d.file), d.file);
      const recordedDecision = approvedBaselines.get(d.file);
      const status = recordedDecision ? recordedDecision.status : versionStatusFromSlug(d.slug);
      statuses.push(status);
      const pf = promptFiles.get(num);
      designEntryIds.push(
        addEntry({
          kind: 'design',
          role: 'design',
          label: '设计稿(design)',
          title: slugToTitle(d.slug, '设计稿 ' + version),
          status,
          statusSource: recordedDecision ? recordedDecision.source : '文件名规则',
          version,
          imageId: imgId,
          promptFile: pf ? pf.rel : null,
        }),
      );
    }
    // 组状态:有任何可用(候选)设计 → 候选;否则有草稿 → 草稿;否则已否决;无设计(仅原图) → 无状态
    const groupStatus = designs.length === 0
      ? null
      : statuses.includes('已批准基线') ? '已批准基线'
        : statuses.includes('候选') ? '候选' : statuses.includes('草稿') ? '草稿' : '已否决';
    const pf = promptFiles.get(num);
    groups.push({
      version,
      num,
      status: groupStatus,
      statusSource: designEntryIds.map((id) => entries[id].statusSource).find((s) => s && s.startsWith('proposal.md:')) || null,
      promptText: pf ? readTextSafe(pf.abs) : null,
      promptFile: pf ? pf.rel : null,
      designIds: designEntryIds,
      beforeId: null, // 稍后填充(组内或任务级)
      compareBeforeId: null,
      mismatch: null,
    });
  }

  // before 条目挂到对应版本组;其余组用任务级 before 对比;统一计算比例差异
  function computeMismatch(g, beforeEntryId) {
    if (!beforeEntryId || g.designIds.length === 0) return;
    const a = images[entries[g.designIds[0]].imageId];
    const b = images[entries[beforeEntryId].imageId];
    if (a.ratio && b.ratio && relRatioDiff(parseFloat(a.ratio), parseFloat(b.ratio)) > 0.02) {
      g.mismatch = { a: a.ratio, b: b.ratio };
    }
  }
  for (const g of groups) {
    const ownBefore = beforeEntryByNum.get(g.num);
    g.beforeId = ownBefore || null;
    g.compareBeforeId = ownBefore || taskBeforeEntryId;
    computeMismatch(g, g.compareBeforeId);
  }

  // ---- 页面式条目 ----
  // page-map:image 路径末段 → status;overlays 末段集合
  const statusByBasename = new Map();
  const overlayBasenames = new Set();
  if (pageMap) {
    for (const [, v] of pageMap.pages) {
      if (v.image) statusByBasename.set(path.basename(v.image), v.status);
    }
    for (const [, p] of pageMap.overlays) {
      overlayBasenames.add(path.basename(p));
    }
  }

  const taskReal = taskDir; // 已 resolve;再 realpath 以稳健判断“任务目录之外”
  let taskRealResolved = taskReal;
  try {
    taskRealResolved = fs.realpathSync(taskReal);
  } catch {
    /* keep */
  }
  // realpath 现存前缀、保留不存在的尾部,避免符号链接(如 /tmp → /private/tmp)造成的误判
  function realpathSoft(p) {
    try {
      return fs.realpathSync(p);
    } catch {
      const parent = path.dirname(p);
      if (parent === p) return p;
      return path.join(realpathSoft(parent), path.basename(p));
    }
  }
  function isInsideTask(targetRel) {
    const abs = path.resolve(taskDir, targetRel);
    const absReal = realpathSoft(abs);
    const relFromTask = path.relative(realpathSoft(taskRealResolved), absReal);
    return relFromTask === '' || (!relFromTask.startsWith('..') && !path.isAbsolute(relFromTask));
  }

  // gallery:basename → { title, label, target }
  const galleryByBase = gallery ? gallery.byBasename : new Map();
  const pageTitleByPageId = new Map();
  if (gallery) {
    for (const item of gallery.sections) {
      const m = item.label.match(/(UI-\d+)/i);
      const pid = m ? m[1].toUpperCase() : null;
      if (pid && !pageTitleByPageId.has(pid) && !item.overlay) pageTitleByPageId.set(pid, item.title);
    }
  }

  const mainIds = new Map(); // heading -> [entryId]
  const overlayEntryIds = [];
  const draftEntryIds = [];
  const pageEntryIdsAll = [];
  const externalEntries = new Map(); // resolvedPath -> entryId
  const externalOrder = [];

  function overlayHintFor(title) {
    if (!promptRecord || !title) return null;
    for (const hint of promptRecord.overlayHints) {
      if (hint.term && title.includes(hint.term)) return hint;
    }
    return null;
  }

  for (const pf of pageFiles) {
    const base = pf.file;
    const gItem = galleryByBase.get(base);
    const gTitleBase = pf.slug && isDraftSlug(pf.slug) ? galleryByBase.get(base.replace(/-draft\.([a-z0-9]+)$/i, '.$1')) : null;
    const overlayByMap = overlayBasenames.has(base);
    const overlayByGallery = !!(gItem && gItem.overlay);
    const isOverlay = overlayByMap || overlayByGallery;
    const isDraft = isDraftSlug(pf.slug);

    let title;
    if (isDraft) {
      const baseTitle = (gTitleBase && gTitleBase.title) || pageTitleByPageId.get(pf.pageId) || pf.pageId;
      title = baseTitle + '(草稿)';
    } else if (gItem) {
      title = gItem.title;
    } else {
      title = pageTitleByPageId.get(pf.pageId) || (pf.slug ? slugToTitle(pf.slug, pf.pageId) : pf.pageId);
    }

    let status = null;
    if (isDraft) status = '草稿';
    else if (statusByBasename.has(base)) status = statusZh(statusByBasename.get(base));

    const promptRow = promptRecord ? promptRecord.byPage.get(pf.pageId) || null : null;
    const hint = isOverlay ? overlayHintFor(title) : null;
    const promptText = hint ? hint.text : promptRow;
    const promptSource = hint
      ? 'prompt-record.md 浮层提示(' + hint.term + ')'
      : promptRow
        ? 'prompt-record.md 表格行 ' + pf.pageId
        : null;

    const imgId = addImage(path.join(imagesDir, base), base);
    const id = addEntry({
      kind: isOverlay ? 'overlay' : isDraft ? 'draft' : 'page',
      role: isOverlay ? 'overlay' : isDraft ? 'draft' : 'page',
      label: isOverlay ? '浮层' : isDraft ? '修订稿(草稿)' : '页面',
      title,
      status: status || (isDraft ? '草稿' : null),
      pageId: pf.pageId,
      imageId: imgId,
      promptText,
      promptSource,
    });
    pageEntryIdsAll.push(id);
    if (isOverlay) overlayEntryIds.push(id);
    else if (isDraft) draftEntryIds.push(id);
    else {
      const heading = gItem && gItem.heading ? gItem.heading : null;
      if (!mainIds.has(heading)) mainIds.set(heading, []);
      mainIds.get(heading).push(id);
    }
  }

  // 外部引用:gallery + page-map 中指向任务目录之外的条目(不内嵌)
  function addExternal(pageId, title, status, refPath) {
    const key = path.resolve(taskDir, refPath);
    if (externalEntries.has(key)) {
      const e = entries[externalEntries.get(key)];
      if (title && !e.title) e.title = title;
      if (status && !e.status) e.status = status;
      return;
    }
    const id = addEntry({
      kind: 'external',
      role: 'external',
      label: '外部文件',
      title: title || null,
      status: status || null,
      pageId: pageId || null,
      refPath,
      promptText: null,
      promptSource: null,
    });
    externalEntries.set(key, id);
    externalOrder.push(id);
  }
  if (gallery) {
    for (const item of gallery.sections) {
      if (isInsideTask(item.target)) continue;
      const m = item.label.match(/(UI-\d+)/i);
      addExternal(m ? m[1].toUpperCase() : null, item.title, null, item.target);
    }
  }
  if (pageMap) {
    for (const [key, v] of pageMap.pages) {
      if (!v.image || isInsideTask(v.image)) continue;
      addExternal(key, pageTitleByPageId.get(key) || null, statusZh(v.status), v.image);
    }
    for (const [, p] of pageMap.overlays) {
      if (isInsideTask(p)) continue;
      addExternal(null, null, null, p);
    }
  }
  const externalIds = [...externalOrder];

  // ---- 其他图片 ----
  const otherIds = [];
  for (const file of otherFiles) {
    const imgId = addImage(path.join(imagesDir, file), file);
    otherIds.push(
      addEntry({
        kind: 'other',
        role: 'other',
        label: '其他图片',
        title: file,
        status: null,
        imageId: imgId,
        promptText: null,
        promptSource: null,
      }),
    );
  }

  // ---- 汇总 ----
  const embeddedImageIds = Object.keys(images);
  const totalBytes = embeddedImageIds.reduce((s, id) => s + images[id].bytes, 0);
  const mismatchCount = groups.filter((g) => g.mismatch).length;

  // ---- preview.json ----
  const jsonEntries = [];
  const idToEntryPath = (e) => {
    const img = e.imageId ? images[e.imageId] : null;
    return {
      file: img ? img.file : e.refPath ? path.basename(e.refPath) : null,
      path: img ? 'images/' + img.file : e.refPath || null,
      width: img ? img.width : null,
      height: img ? img.height : null,
      bytes: img ? img.bytes : null,
      ratio: img && img.ratio !== null ? img.ratio : null,
      role: e.role,
      version: e.version || null,
      pageId: e.pageId || null,
      title: e.title || null,
      status: e.status || null,
      statusSource: e.statusSource || null,
      promptFile: e.promptFile || null,
      promptSource: e.promptSource || null,
      promptText: e.promptText || null,
      refPath: e.refPath || null,
    };
  };
  for (const g of groups) {
    for (const eid of g.designIds) jsonEntries.push(idToEntryPath(entries[eid]));
  }
  if (taskBeforeEntryId) jsonEntries.push(idToEntryPath(entries[taskBeforeEntryId]));
  for (const id of pageEntryIdsAll) jsonEntries.push(idToEntryPath(entries[id]));
  for (const id of externalIds) jsonEntries.push(idToEntryPath(entries[id]));
  for (const id of otherIds) jsonEntries.push(idToEntryPath(entries[id]));

  const previewJson = {
    taskPath: taskDir,
    taskId,
    generatedAt: generatedAt.toISOString(),
    counts: {
      images: embeddedImageIds.length,
      versionGroups: groups.length,
      pages: pageEntryIdsAll.filter((id) => entries[id].role === 'page').length,
      overlays: overlayEntryIds.length,
      drafts: draftEntryIds.length,
      externals: externalIds.length,
      others: otherIds.length,
      ratioMismatches: mismatchCount,
    },
    entries: jsonEntries,
  };
  const jsonPath = path.join(taskDir, 'preview.json');
  fs.writeFileSync(jsonPath, JSON.stringify(previewJson, null, 2) + '\n', 'utf8');

  // ---- 页面数据 ----
  const pageSections = [];
  if (pageFiles.length > 0 || externalIds.length > 0) {
    if (mainIds.size === 0 && (overlayEntryIds.length > 0 || draftEntryIds.length > 0)) {
      pageSections.push({ heading: null, items: [] });
    }
    for (const [heading, items] of mainIds) pageSections.push({ heading, items });
  }

  const clientData = {
    taskId,
    taskPath: taskDir,
    generatedAt: generatedAt.toISOString(),
    totals: {
      images: embeddedImageIds.length,
      bytes: totalBytes,
      externals: externalIds.length,
      mismatches: mismatchCount,
    },
    proposal: proposalText
      ? {
          statusLine: extractKeyLine(proposalText, 'Status'),
          decisionLine: extractKeyLine(proposalText, 'Decision'),
          text: proposalText,
        }
      : null,
    images,
    entries,
    versions:
      groups.length > 0
        ? {
            groups: groups.map((g) => ({
              version: g.version,
              status: g.status,
              statusSource: g.statusSource,
              promptText: g.promptText,
              promptFile: g.promptFile,
              designIds: g.designIds,
              beforeId: g.beforeId,
              compareBeforeId: g.compareBeforeId,
              mismatch: g.mismatch,
            })),
          }
        : null,
    pages:
      pageFiles.length > 0
        ? {
            sections: pageSections,
            overlays: overlayEntryIds,
            drafts: draftEntryIds,
            externals: externalIds,
          }
        : null,
    others: otherIds,
  };

  const html = buildHtml(clientData, taskId);
  const outPath = path.resolve(process.cwd(), args.out || path.join(taskDir, 'preview.html'));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, 'utf8');

  // ---- 摘要 ----
  const parts = [embeddedImageIds.length + ' 张图'];
  if (groups.length > 0) parts.push(groups.length + ' 个版本组');
  if (pageFiles.length > 0) {
    const mainCount = pageEntryIdsAll.filter((id) => entries[id].role === 'page').length;
    if (mainCount > 0) parts.push(mainCount + ' 个页面');
    if (overlayEntryIds.length > 0) parts.push(overlayEntryIds.length + ' 个浮层');
    if (draftEntryIds.length > 0) parts.push(draftEntryIds.length + ' 个草稿');
  }
  if (externalIds.length > 0) parts.push(externalIds.length + ' 个外部引用未内嵌');
  parts.push(fmtBytes(totalBytes));
  process.stdout.write('✔ 已生成 ' + path.basename(outPath) + '(' + parts.join(',') + ')→ ' + outPath + '\n');

  if (args.open) openInBrowser(outPath);
}

// ---------------------------------------------------------------------------
// 命令行多图模式:不依赖任务目录,直接展示传入的图片
// ---------------------------------------------------------------------------

function resolveInputFile(p) {
  const abs = path.resolve(process.cwd(), p);
  let st = null;
  try {
    st = fs.statSync(abs);
  } catch {
    /* not found */
  }
  if (!st || !st.isFile()) {
    process.stderr.write('错误: 文件不存在或不是普通文件: ' + abs + '\n');
    process.exit(1);
  }
  if (!IMG_EXT_RE.test(path.basename(abs))) {
    process.stderr.write('错误: 不支持的图片格式(仅 png/jpeg/webp/gif): ' + abs + '\n');
    process.exit(1);
  }
  return abs;
}

function mainCli(args) {
  const inputs = [];
  for (const it of args.items) {
    let promptText = null;
    if (it.prompt) {
      const promptAbs = path.resolve(process.cwd(), it.prompt);
      promptText = readTextSafe(promptAbs);
      if (promptText === null) {
        process.stderr.write('错误: 提示词文件不存在或不可读: ' + promptAbs + '\n');
        process.exit(1);
      }
    }
    inputs.push({
      abs: resolveInputFile(it.path),
      title: it.title || null,
      version: it.version || null,
      promptText,
      promptFile: it.prompt || null,
    });
  }
  if (inputs.length === 0 && !args.before) {
    process.stderr.write('错误: 多图模式至少需要一张图片,例如:node preview.mjs a.png b.png --open\n\n');
    usage();
    process.exit(1);
  }

  const generatedAt = new Date();
  const { images, entries, addImage, addEntry } = createBuilders();

  // --before 指定的全局原图:作为所有组的对比原图兜底
  let flagBeforeId = null;
  if (args.before) {
    const abs = resolveInputFile(args.before);
    flagBeforeId = addEntry({
      kind: 'before',
      role: 'before',
      label: '原图(before)',
      title: '原图(参考截图)',
      status: null,
      version: null,
      imageId: addImage(abs, path.basename(abs)),
      promptFile: null,
      promptText: null,
    });
  }

  const groupsByKey = new Map(); // 版本标签 -> 组
  const groupOrder = [];
  const beforeIdsInOrder = []; // 文件名 before-*.png 识别出的原图条目
  let seqNo = 0;

  function groupOf(key) {
    if (!groupsByKey.has(key)) {
      groupsByKey.set(key, { designIds: [], statuses: [], prompts: [], promptFiles: [], beforeId: null });
      groupOrder.push(key);
    }
    return groupsByKey.get(key);
  }

  for (const it of inputs) {
    const base = path.basename(it.abs);
    const mv = base.match(VERSION_RE);
    const mp = mv ? null : base.match(PAGE_RE);
    const stem = base.replace(IMG_EXT_RE, '');
    const slug = mv ? mv[3] || '' : mp ? mp[2] || '' : '';

    // 版本标签:显式 --version > 文件名推导(design-vNNN / UI-NN)> 出现顺序 图NN
    let key;
    if (it.version) key = it.version;
    else if (mv) key = 'v' + String(parseInt(mv[2], 10)).padStart(3, '0');
    else if (mp) key = mp[1].toUpperCase();
    else {
      seqNo += 1;
      key = '图' + String(seqNo).padStart(2, '0');
    }

    const imgId = addImage(it.abs, base);
    const g = groupOf(key);

    if (mv && mv[1].toLowerCase() === 'before') {
      const id = addEntry({
        kind: 'before',
        role: 'before',
        label: '原图(before)',
        title: '原图(参考截图)',
        status: null,
        version: key,
        imageId: imgId,
        promptFile: it.promptFile,
        promptText: it.promptText,
      });
      if (!g.beforeId) g.beforeId = id;
      if (beforeIdsInOrder.length === 0) beforeIdsInOrder.push(id);
      continue;
    }

    const title = it.title || slugToTitle(slug, null) || stem;
    const status = versionStatusFromSlug(slug);
    g.designIds.push(
      addEntry({
        kind: 'design',
        role: 'design',
        label: '设计稿(design)',
        title,
        status,
        version: key,
        imageId: imgId,
        promptFile: it.promptFile,
        promptText: it.promptText,
      }),
    );
    g.statuses.push(status);
    if (it.promptText) {
      g.prompts.push(it.promptText);
      g.promptFiles.push(it.promptFile);
    }
  }

  const groups = groupOrder.map((key) => {
    const g = groupsByKey.get(key);
    const groupStatus = g.designIds.length === 0
      ? null
      : g.statuses.includes('候选') ? '候选' : g.statuses.includes('草稿') ? '草稿' : '已否决';
    const compareBefore = g.beforeId || flagBeforeId || beforeIdsInOrder[0] || null;
    let mismatch = null;
    if (compareBefore && g.designIds.length > 0) {
      const a = images[entries[g.designIds[0]].imageId];
      const b = images[entries[compareBefore].imageId];
      if (a.ratio && b.ratio && relRatioDiff(parseFloat(a.ratio), parseFloat(b.ratio)) > 0.02) {
        mismatch = { a: a.ratio, b: b.ratio };
      }
    }
    return {
      version: key,
      status: groupStatus,
      promptText: g.prompts.length > 0 ? g.prompts.join('\n\n') : null,
      promptFile: g.promptFiles.length > 0 ? [...new Set(g.promptFiles)].join(', ') : null,
      designIds: g.designIds,
      beforeId: g.beforeId,
      compareBeforeId: compareBefore,
      mismatch,
    };
  });
  if (groups.length === 0 && flagBeforeId) {
    groups.push({
      version: '原图',
      status: null,
      promptText: null,
      promptFile: null,
      designIds: [],
      beforeId: flagBeforeId,
      compareBeforeId: flagBeforeId,
      mismatch: null,
    });
  }

  const embeddedImageIds = Object.keys(images);
  const totalBytes = embeddedImageIds.reduce((s, id) => s + images[id].bytes, 0);
  const mismatchCount = groups.filter((g) => g.mismatch).length;
  const taskId = args.name || '命令行预览';

  const clientData = {
    taskId,
    taskPath: null,
    generatedAt: generatedAt.toISOString(),
    totals: {
      images: embeddedImageIds.length,
      bytes: totalBytes,
      externals: 0,
      mismatches: mismatchCount,
    },
    proposal: null,
    images,
    entries,
    versions: { groups },
    pages: null,
    others: [],
  };

  const html = buildHtml(clientData, taskId);
  const outPath = path.resolve(process.cwd(), args.out || 'preview.html');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, 'utf8');

  const parts = [embeddedImageIds.length + ' 张图', groups.length + ' 个版本组', fmtBytes(totalBytes)];
  process.stdout.write('✔ 已生成 ' + path.basename(outPath) + '(' + parts.join(',') + ')→ ' + outPath + '\n');

  if (args.open) openInBrowser(outPath);
}

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

function openInBrowser(target) {
  try {
    if (process.platform === 'darwin') {
      spawn('open', [target], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '', target], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (err) {
    process.stderr.write('警告: 无法打开浏览器: ' + err.message + '\n');
  }
}

// ---------------------------------------------------------------------------
// HTML 生成
// ---------------------------------------------------------------------------

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const CLIENT_JS = String.raw`
(function () {
  'use strict';
  var DATA = JSON.parse(document.getElementById('preview-data').textContent);
  var CTX = {};      // ctxId -> [imageId]
  var ctxSeq = 0;

  // ---------- DOM 辅助:所有动态文本一律 textContent,禁止 innerHTML ----------
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var key in attrs) {
        var v = attrs[key];
        if (v === null || v === undefined) continue;
        if (key === 'text') node.textContent = v;
        else if (key === 'class') node.className = v;
        else if (key.indexOf('on') === 0 && typeof v === 'function') node.addEventListener(key.slice(2), v);
        else node.setAttribute(key, v);
      }
    }
    for (var i = 2; i < arguments.length; i++) appendKids(node, arguments[i]);
    return node;
  }
  function appendKids(parent, kid) {
    if (kid === null || kid === undefined || kid === false) return;
    if (Array.isArray(kid)) { for (var i = 0; i < kid.length; i++) appendKids(parent, kid[i]); return; }
    parent.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
  }
  function fmtBytes(n) {
    if (n === null || n === undefined) return '大小未知';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / (1024 * 1024)).toFixed(1) + ' MB';
  }
  function dimsLine(img) {
    if (!img) return '';
    var dims = (img.width === null || img.height === null) ? '尺寸未知' : ('实际 ' + img.width + ' × ' + img.height + ' · 比例 ' + img.ratio);
    return dims + ' · ' + img.file + ' · ' + fmtBytes(img.bytes);
  }
  var BADGE_CLASS = { '已否决': 'rejected', '草稿': 'draft', '候选': 'candidate', '已批准': 'approved', '已批准复用': 'approved', '已批准基线': 'approved', '基线': 'approved', '已取代': 'rejected' };
  function badge(status, source) {
    if (!status) return null;
    return el('span', { class: 'badge ' + (BADGE_CLASS[status] || 'plain'), text: status, title: source || null });
  }
  function fmtTime(iso) {
    var d = iso ? new Date(iso) : new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }

  // Safe, dependency-free Markdown subset: headings, paragraphs, unordered/ordered
  // lists, blockquotes, fenced code, pipe tables, emphasis, code and http(s)/mailto links.
  // Raw HTML and Markdown images are always rendered as inert text.
  function appendInline(parent, text) {
    var re = /(\x60[^\x60]+\x60|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_)/g;
    var at = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > at) parent.appendChild(document.createTextNode(text.slice(at, m.index)));
      if (m[0].charAt(0) === '\x60') parent.appendChild(el('code', { text: m[0].slice(1, -1) }));
      else if (m[2] !== undefined) {
        if (/^(https?:|mailto:)/i.test(m[3])) {
          parent.appendChild(el('a', { href: m[3], rel: 'noreferrer noopener', target: '_blank', text: m[2] }));
        } else parent.appendChild(document.createTextNode(m[0]));
      } else if (m[4] !== undefined || m[5] !== undefined) parent.appendChild(el('strong', { text: m[4] || m[5] }));
      else parent.appendChild(el('em', { text: m[6] || m[7] }));
      at = re.lastIndex;
    }
    if (at < text.length) parent.appendChild(document.createTextNode(text.slice(at)));
  }
  function markdown(text) {
    var root = el('div', { class: 'markdown' });
    var lines = String(text || '').split(/\r?\n/), i = 0;
    function inlineNode(tag, value) { var n = el(tag); appendInline(n, value); return n; }
    while (i < lines.length) {
      var line = lines[i];
      if (!line.trim()) { i++; continue; }
      var fence = line.match(/^\s*\x60\x60\x60([^\x60]*)$/);
      if (fence) {
        var code = [], lang = fence[1].trim(); i++;
        while (i < lines.length && !/^\s*\x60\x60\x60\s*$/.test(lines[i])) code.push(lines[i++]);
        if (i < lines.length) i++;
        root.appendChild(el('pre', null, el('code', { class: lang ? 'language-' + lang.replace(/[^a-z0-9_-]/gi, '') : null, text: code.join('\n') })));
        continue;
      }
      var h = line.match(/^(#{1,6})\s+(.+)$/);
      if (h) { root.appendChild(inlineNode('h' + h[1].length, h[2])); i++; continue; }
      if (/^\s*>\s?/.test(line)) {
        var quote = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
        root.appendChild(inlineNode('blockquote', quote.join('\n'))); continue;
      }
      var list = line.match(/^\s*(?:([-*+])|(\d+)\.)\s+(.+)$/);
      if (list) {
        var listNode = el(list[2] ? 'ol' : 'ul');
        while (i < lines.length) {
          var item = lines[i].match(/^\s*(?:([-*+])|(\d+)\.)\s+(.+)$/);
          if (!item || !!item[2] !== !!list[2]) break;
          listNode.appendChild(inlineNode('li', item[3])); i++;
        }
        root.appendChild(listNode); continue;
      }
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
        var rows = [], header = line; i += 2;
        rows.push(header);
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
        var table = el('table');
        rows.forEach(function (row, ri) {
          var tr = el('tr');
          row.trim().replace(/^\||\|$/g, '').split('|').forEach(function (cell) { tr.appendChild(inlineNode(ri ? 'td' : 'th', cell.trim())); });
          (ri ? (table.tBodies[0] || table.appendChild(el('tbody'))) : (table.tHead || table.appendChild(el('thead')))).appendChild(tr);
        });
        root.appendChild(table); continue;
      }
      var para = [line.trim()]; i++;
      while (i < lines.length && lines[i].trim() && !/^(#{1,6})\s|^\s*\x60\x60\x60|^\s*>|^\s*(?:[-*+] |\d+\. )/.test(lines[i])) para.push(lines[i++].trim());
      root.appendChild(inlineNode('p', para.join(' ')));
    }
    return root;
  }

  function renderThemeControl(header) {
    var modes = ['system', 'light', 'dark'];
    var labels = { system: '主题：跟随系统', light: '主题：浅色', dark: '主题：深色' };
    var mode = 'system';
    try { if (modes.indexOf(localStorage.getItem('ui-preview-theme')) >= 0) mode = localStorage.getItem('ui-preview-theme'); } catch (e) {}
    var btn = el('button', { class: 'btn theme-toggle', type: 'button' });
    function apply() {
      document.documentElement.setAttribute('data-theme', mode);
      btn.textContent = labels[mode];
      btn.setAttribute('aria-label', labels[mode] + '，点击切换');
      try { localStorage.setItem('ui-preview-theme', mode); } catch (e) {}
    }
    btn.addEventListener('click', function () { mode = modes[(modes.indexOf(mode) + 1) % modes.length]; apply(); });
    apply(); header.insertBefore(btn, header.firstChild);
  }

  // ---------- 图片卡片 ----------
  function newCtx() { var id = 'ctx-' + (++ctxSeq); CTX[id] = []; return id; }
  function figure(entry, ctxId, noBadge) {
    var img = DATA.images[entry.imageId];
    if (!img) return null;
    CTX[ctxId].push(img.id);
    var fig = el('figure', { class: 'fig' });
    var head = el('div', { class: 'fighead' },
      el('span', { class: 'figlabel', text: entry.label || '' }),
      noBadge ? null : badge(entry.status, entry.statusSource));
    var box = el('div', { class: 'figbox' });
    var im = el('img', {
      src: img.dataUrl,
      alt: (entry.title || img.file),
      'data-img': img.id,
      role: 'button',
      tabindex: '0',
      title: '按 Enter 放大',
      'aria-label': (entry.title || img.file) + '，按 Enter 放大',
    });
    im.addEventListener('click', function () { openLightbox(img.id, ctxId); });
    im.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      openLightbox(img.id, ctxId);
    });
    box.appendChild(im);
    fig.appendChild(head);
    fig.appendChild(box);
    fig.appendChild(el('figcaption', { class: 'figcap', text: dimsLine(img) }));
    if (entry.title && entry.kind !== 'other') {
      fig.insertBefore(el('div', { class: 'figtitle', text: entry.title }), head);
    }
    return fig;
  }
  function detailsPanel(summaryText, bodyText, open) {
    var d = el('details', { class: 'doc' });
    if (open) d.setAttribute('open', 'open');
    d.appendChild(el('summary', { text: summaryText }));
    if (bodyText) d.appendChild(markdown(bodyText));
    return d;
  }

  // ---------- 页头 ----------
  function renderHeader(app) {
    var t = DATA.totals;
    var meta = el('div', { class: 'meta' },
      el('span', { text: '图片 ' + t.images + ' 张' }),
      el('span', { text: '合计 ' + fmtBytes(t.bytes) }),
      el('span', { text: '生成时间 ' + fmtTime(DATA.generatedAt) }),
      el('span', { text: '比例不一致(与原图) ' + t.mismatches + ' 张' }),
      t.externals > 0 ? el('span', { class: 'warnmeta', text: '另有 ' + t.externals + ' 个外部引用未内嵌(任务目录之外的文件)' }) : null);
    var hd = el('header', { class: 'hd' },
      el('h1', { text: 'UI 设计评审 — ' + DATA.taskId }),
      meta,
      DATA.taskPath ? el('p', { class: 'taskpath', text: DATA.taskPath }) : null);
    renderThemeControl(hd);
    if (DATA.proposal) {
      var chips = el('div', { class: 'chips' });
      if (DATA.proposal.statusLine) chips.appendChild(el('span', { class: 'chip', text: 'Status: ' + DATA.proposal.statusLine }));
      if (DATA.proposal.decisionLine) chips.appendChild(el('span', { class: 'chip chip-decision', text: 'Decision: ' + DATA.proposal.decisionLine }));
      if (chips.childNodes.length) hd.appendChild(chips);
      hd.appendChild(detailsPanel('方案说明(proposal.md)', DATA.proposal.text, false));
    }
    app.appendChild(hd);
  }

  // ---------- 版本式区块 ----------
  function renderVersions(app) {
    var V = DATA.versions;
    if (!V || V.groups.length === 0) return;
    var block = el('section', { class: 'block' });
    block.appendChild(el('h2', { text: '版本方案' }));
    var tabbar = el('div', { class: 'tabbar' });
    var panels = {};
    var buttons = {};
    V.groups.forEach(function (g) {
      var b = el('button', { class: 'tab', type: 'button', 'data-version': g.version });
      b.appendChild(document.createTextNode(g.version + ' '));
      var bd = badge(g.status, g.statusSource);
      if (bd) b.appendChild(bd);
      b.addEventListener('click', function () { select(g.version); });
      buttons[g.version] = b;
      tabbar.appendChild(b);
      panels[g.version] = groupPanel(g);
      block.appendChild(panels[g.version]);
    });
    function select(v) {
      V.groups.forEach(function (g) {
        var on = g.version === v;
        panels[g.version].style.display = on ? '' : 'none';
        buttons[g.version].classList.toggle('active', on);
        buttons[g.version].setAttribute('aria-selected', on ? 'true' : 'false');
      });
    }
    block.insertBefore(tabbar, block.childNodes[1]);
    var defaultVersion = null;
    for (var i = V.groups.length - 1; i >= 0; i--) {
      if (V.groups[i].status !== '已否决') { defaultVersion = V.groups[i].version; break; }
    }
    if (!defaultVersion) defaultVersion = V.groups[V.groups.length - 1].version;
    select(defaultVersion);
    app.appendChild(block);
  }

  function groupPanel(g) {
    var panel = el('div', { class: 'grouppanel', 'data-version': g.version });
    panel.style.display = 'none';
    if (g.promptText) {
      panel.appendChild(detailsPanel('生成提示词(' + (g.promptFile || '未知来源') + ')', g.promptText, false));
    } else {
      panel.appendChild(el('p', { class: 'muted', text: '未找到该版本的提示词文件(prompt-vNNN.md,任务根目录与 images/ 均未命中)' }));
    }
    if (g.statusSource) panel.appendChild(el('p', { class: 'status-source', text: '状态来源：' + g.statusSource }));
    var ctxId = newCtx();
    var row = el('div', { class: 'imgrow' + (g.beforeId ? ' hasbefore' : '') });
    g.designIds.forEach(function (eid) {
      var f = figure(DATA.entries[eid], ctxId);
      if (f) row.appendChild(f);
    });
    var warn = null;
    var compareInput = null;
    if (g.beforeId) {
      var bf = figure(DATA.entries[g.beforeId], ctxId);
      if (bf) row.appendChild(bf);
    } else if (g.compareBeforeId) {
      compareInput = el('input', { type: 'checkbox' });
      var toggle = el('label', { class: 'comparetoggle' }, compareInput, el('span', { text: '与原图并排对比' }));
      var cf = figure(DATA.entries[g.compareBeforeId], ctxId);
      if (cf) cf.classList.add('comparefig');
      warn = el('div', { class: 'mismatchwarn' });
      if (g.mismatch) {
        warn.textContent = '比例不一致(' + g.mismatch.a + ' vs ' + g.mismatch.b + '),已按原比例显示,未拉伸';
      } else {
        warn.style.display = 'none';
      }
      compareInput.addEventListener('change', function () {
        row.classList.toggle('comparing', compareInput.checked);
        if (g.mismatch) warn.style.display = compareInput.checked ? '' : 'none';
      });
      panel.appendChild(toggle);
      if (cf) row.appendChild(cf);
    }
    panel.appendChild(row);
    if (warn) panel.appendChild(warn);
    return panel;
  }

  // ---------- 页面式区块 ----------
  function pageCard(entry, ctxId) {
    var card = el('div', { class: 'pcard' });
    var head = el('div', { class: 'pchead' },
      el('h3', { text: entry.title || entry.pageId }),
      el('span', { class: 'pid', text: entry.pageId || '' }),
      badge(entry.status));
    card.appendChild(head);
    if (entry.imageId) {
      var f = figure(entry, ctxId, true); // 卡片标题行已有状态徽标,图内不重复
      if (f) card.appendChild(f);
    }
    if (entry.promptText) {
      card.appendChild(detailsPanel('生成提示词(' + (entry.promptSource || 'prompt-record.md') + ')', entry.promptText, false));
    } else {
      card.appendChild(el('p', { class: 'muted', text: 'prompt-record.md 中没有该页的提示词行' }));
    }
    return card;
  }

  function externalCard(entry) {
    var card = el('div', { class: 'pcard pcard-ext' });
    card.appendChild(el('div', { class: 'pchead' },
      el('h3', { text: (entry.title || '外部文件') }),
      entry.pageId ? el('span', { class: 'pid', text: entry.pageId }) : null,
      badge(entry.status)));
    card.appendChild(el('p', { class: 'extpath' },
      el('span', { class: 'muted', text: '外部文件(未内嵌):' }),
      el('code', { text: entry.refPath })));
    card.appendChild(el('p', { class: 'muted', text: '该文件位于任务目录之外,未嵌入本页;请到任务目录树中查看原件。' }));
    return card;
  }

  function subSection(parent, heading, ids, isExternal) {
    var sec = el('div', { class: 'subsection' });
    sec.appendChild(el('h3', { class: 'subhead', text: heading }));
    var grid = el('div', { class: 'pgrid' });
    var ctxId = newCtx(); // 同一小节内的图在灯箱中可 ←/→ 切换
    ids.forEach(function (id) {
      var e = DATA.entries[id];
      grid.appendChild(isExternal ? externalCard(e) : pageCard(e, ctxId));
    });
    sec.appendChild(grid);
    parent.appendChild(sec);
  }

  function renderPages(app) {
    var P = DATA.pages;
    if (!P) return;
    var block = el('section', { class: 'block' });
    block.appendChild(el('h2', { text: '页面图稿' }));
    P.sections.forEach(function (sec) {
      if (!sec.items || sec.items.length === 0) return;
      subSection(block, sec.heading || '页面', sec.items, false);
    });
    if (P.overlays.length) subSection(block, '浮层', P.overlays, false);
    if (P.drafts.length) subSection(block, '修订稿(草稿)', P.drafts, false);
    if (P.externals.length) subSection(block, '外部文件(未内嵌)', P.externals, true);
    app.appendChild(block);
  }

  // ---------- 其他图片 ----------
  function renderOthers(app) {
    if (!DATA.others.length) return;
    var block = el('section', { class: 'block' });
    block.appendChild(el('h2', { text: '其他图片(未匹配版本号或页面编号)' }));
    var ctxId = newCtx();
    var grid = el('div', { class: 'pgrid' });
    DATA.others.forEach(function (id) {
      var f = figure(DATA.entries[id], ctxId);
      if (f) grid.appendChild(f);
    });
    block.appendChild(grid);
    app.appendChild(block);
  }

  // ---------- 灯箱 ----------
  var lb = { root: null, img: null, info: null, modeBtn: null, mode: 'fit', list: [], idx: 0 };
  function ensureLightbox() {
    if (lb.root) return;
    lb.img = el('img', { alt: '' });
    lb.info = el('span', { class: 'lbinfo' });
    lb.modeBtn = el('button', { class: 'lbbtn', type: 'button', text: '实际尺寸' });
    lb.modeBtn.addEventListener('click', function () { setLbMode(lb.mode === 'fit' ? 'actual' : 'fit'); });
    var prev = el('button', { class: 'lbbtn', type: 'button', text: '←' });
    prev.addEventListener('click', function () { stepLb(-1); });
    var next = el('button', { class: 'lbbtn', type: 'button', text: '→' });
    next.addEventListener('click', function () { stepLb(1); });
    var close = el('button', { class: 'lbbtn', type: 'button', text: '关闭 (Esc)' });
    close.addEventListener('click', closeLightbox);
    var bar = el('div', { class: 'lbbar' }, prev, next, lb.modeBtn, lb.info, close);
    var stage = el('div', { class: 'lbstage' }, lb.img);
    stage.addEventListener('click', function (ev) { if (ev.target === stage) closeLightbox(); });
    lb.root = el('div', { class: 'lb' }, stage, bar);
    document.body.appendChild(lb.root);
    document.addEventListener('keydown', function (ev) {
      if (!lb.root.classList.contains('open')) return;
      if (ev.key === 'Escape') { ev.preventDefault(); closeLightbox(); }
      else if (ev.key === 'ArrowLeft') { ev.preventDefault(); stepLb(-1); }
      else if (ev.key === 'ArrowRight') { ev.preventDefault(); stepLb(1); }
    });
  }
  function setLbMode(mode) {
    lb.mode = mode;
    var img = DATA.images[lb.list[lb.idx]];
    if (mode === 'actual' && img && img.width && img.height) {
      lb.img.style.width = img.width + 'px';
      lb.img.style.height = img.height + 'px';
      lb.modeBtn.textContent = '适应窗口';
    } else {
      lb.img.style.width = '';
      lb.img.style.height = '';
      lb.modeBtn.textContent = '实际尺寸';
    }
  }
  function showLb() {
    var img = DATA.images[lb.list[lb.idx]];
    if (!img) return;
    lb.img.src = img.dataUrl;
    lb.img.alt = img.file;
    var dims = (img.width === null || img.height === null) ? '尺寸未知' : (img.width + ' × ' + img.height + ' · 比例 ' + img.ratio);
    lb.info.textContent = dims + ' · ' + img.file + ' · ' + fmtBytes(img.bytes) + ' · ' + (lb.idx + 1) + '/' + lb.list.length;
    setLbMode(lb.mode);
  }
  function openLightbox(imageId, ctxId) {
    ensureLightbox();
    lb.list = (CTX[ctxId] || []).slice();
    if (lb.list.indexOf(imageId) === -1) lb.list.push(imageId);
    lb.idx = lb.list.indexOf(imageId);
    lb.mode = 'fit';
    lb.root.classList.add('open');
    showLb();
  }
  function stepLb(delta) {
    if (!lb.list.length) return;
    lb.idx = (lb.idx + delta + lb.list.length) % lb.list.length;
    showLb();
  }
  function closeLightbox() {
    if (lb.root) lb.root.classList.remove('open');
    lb.img.removeAttribute('src');
  }

  // ---------- 提示条 ----------
  var toastTimer = null;
  function toast(msg, ok) {
    var t = document.getElementById('toast');
    if (!t) {
      t = el('div', { id: 'toast' });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = ok ? 'ok' : 'err';
    t.style.display = 'block';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.style.display = 'none'; }, 2800);
  }

  // ---------- 反馈面板 ----------
  var fbRefs = { textarea: null };
  function renderFeedback(app) {
    var hasVersions = !!(DATA.versions && DATA.versions.groups.length);
    var pageChoiceIds = [];
    if (DATA.pages) {
      DATA.pages.sections.forEach(function (s) { (s.items || []).forEach(function (id) { pageChoiceIds.push(id); }); });
      DATA.pages.overlays.forEach(function (id) { pageChoiceIds.push(id); });
      DATA.pages.drafts.forEach(function (id) { pageChoiceIds.push(id); });
    }
    if (!hasVersions && pageChoiceIds.length === 0) return;

    var notice = el('div', { class: 'fb-notice', text: '页面内的选择只是临时标记,不构成批准;请复制或下载反馈后发回给 Agent,由 Agent 更新正式决策记录。' });

    var choices = el('div', { class: 'fb-choices' });
    if (hasVersions) {
      var fs1 = el('fieldset', null, el('legend', { text: '推荐采用(版本式)' }));
      DATA.versions.groups.forEach(function (g) {
        var input = el('input', { type: 'radio', name: 'fb-version', value: g.version });
        var lab = el('label', { class: 'fb-opt' }, input, el('span', { text: ' ' + g.version + ' ' }), badge(g.status));
        fs1.appendChild(lab);
      });
      choices.appendChild(fs1);
    }
    if (pageChoiceIds.length) {
      var fs2 = el('fieldset', null, el('legend', { text: '逐页选择(页面式)' }));
      var list = el('div', { class: 'fb-pages' });
      pageChoiceIds.forEach(function (id) {
        var e = DATA.entries[id];
        var name = 'fb-page-' + id;
        var row = el('div', { class: 'fb-prow' });
        row.appendChild(el('span', { class: 'fb-ptitle', text: (e.title || e.pageId) + (e.pageId ? '(' + e.pageId + ')' : '') }));
        var seg = el('span', { class: 'fb-seg' });
        [['adopt', '采用'], ['fix', '需修改'], ['pending', '待定']].forEach(function (pair, idx) {
          var input = el('input', { type: 'radio', name: name, value: pair[0] });
          if (idx === 2) input.checked = true;
          seg.appendChild(el('label', { class: 'fb-segopt' }, input, el('span', { text: pair[1] })));
        });
        row.appendChild(seg);
        list.appendChild(row);
      });
      fs2.appendChild(list);
      choices.appendChild(fs2);
    }

    fbRefs.textarea = el('textarea', { placeholder: '意见(可空):对方案的补充说明、需要修改的点等；可用下方控件插入精确图片引用', rows: '4' });
    var refSelect = el('select', { class: 'fb-refselect', 'aria-label': '选择要引用的图片' });
    refSelect.appendChild(el('option', { value: '', text: '选择图片引用…' }));
    Object.keys(DATA.entries).forEach(function (id) {
      var e = DATA.entries[id], img = e.imageId && DATA.images[e.imageId];
      if (!img) return;
      var version = e.version || e.pageId || '未标版本';
      var sourcePath = DATA.taskPath ? ('images/' + img.file) : img.sourcePath;
      var token = '@image[' + version + '|' + sourcePath + ']';
      refSelect.appendChild(el('option', { value: token, text: version + ' · ' + img.file + (e.title ? ' · ' + e.title : '') }));
    });
    var insertRef = el('button', { class: 'btn', type: 'button', text: '插入 @ 图片引用' });
    insertRef.addEventListener('click', function () {
      if (!refSelect.value) { toast('请先选择要引用的图片', false); refSelect.focus(); return; }
      var ta = fbRefs.textarea, start = ta.selectionStart, end = ta.selectionEnd;
      if (start > 0 && ta.value.charAt(start - 1) === '@') start -= 1;
      var spacer = start > 0 && !/\s$/.test(ta.value.slice(0, start)) ? ' ' : '';
      ta.value = ta.value.slice(0, start) + spacer + refSelect.value + ta.value.slice(end);
      ta.focus(); ta.selectionStart = ta.selectionEnd = start + spacer.length + refSelect.value.length;
    });
    fbRefs.textarea.addEventListener('input', function () {
      var at = fbRefs.textarea.selectionStart;
      if (at > 0 && fbRefs.textarea.value.charAt(at - 1) === '@') refSelect.focus();
    });
    var copyBtn = el('button', { class: 'btn btn-primary', type: 'button', text: '复制反馈' });
    copyBtn.addEventListener('click', copyFeedback);
    var dlBtn = el('button', { class: 'btn', type: 'button', text: '下载反馈' });
    dlBtn.addEventListener('click', downloadFeedback);
    var right = el('div', { class: 'fb-right' },
      el('div', { class: 'fb-rightlabel', text: '自由意见' }),
      fbRefs.textarea,
      el('div', { class: 'fb-refrow' }, refSelect, insertRef),
      el('div', { class: 'fb-actions' }, copyBtn, dlBtn));

    var collapseBtn = el('button', { class: 'btn fb-collapse', type: 'button', text: '收起面板' });
    function setFeedbackCollapsed(collapsed) {
      aside.classList.toggle('collapsed', collapsed);
      collapseBtn.textContent = collapsed ? '展开面板' : '收起面板';
      collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }
    collapseBtn.addEventListener('click', function () {
      setFeedbackCollapsed(!aside.classList.contains('collapsed'));
    });

    var aside = el('aside', { class: 'fb collapsed', id: 'feedback' }, notice,
      el('div', { class: 'fb-body' }, choices, right));
    aside.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !aside.classList.contains('collapsed')) {
        ev.preventDefault();
        setFeedbackCollapsed(true);
        collapseBtn.focus();
      }
    });
    fbRefs.textarea.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        copyFeedback();
      }
    });
    setFeedbackCollapsed(true);
    notice.appendChild(el('span', {
      class: 'shortcut-help',
      text: '快捷键：图片聚焦后 Enter 放大 · ←/→ 切图 · Esc 关闭/收起 · ⌘/Ctrl Enter 复制反馈',
    }));
    notice.appendChild(collapseBtn);
    app.appendChild(aside);
  }

  function radioValue(name) {
    var checked = document.querySelector('input[name="' + name + '"]:checked');
    return checked ? checked.value : null;
  }

  function buildFeedbackMd() {
    var lines = [];
    lines.push('# UI 设计反馈 — ' + DATA.taskId);
    lines.push('');
    lines.push('- 任务ID: ' + DATA.taskId);
    lines.push('- 任务目录: ' + (DATA.taskPath || '(命令行多图模式,未指定任务目录)'));
    lines.push('- 反馈时间: ' + fmtTime(null));
    if (DATA.versions && DATA.versions.groups.length) {
      var sel = radioValue('fb-version');
      lines.push('- 推荐采用版本: ' + (sel ? sel : '(未选择)'));
    }
    if (DATA.pages) {
      var rows = [];
      var ids = [];
      DATA.pages.sections.forEach(function (s) { (s.items || []).forEach(function (id) { ids.push(id); }); });
      DATA.pages.overlays.forEach(function (id) { ids.push(id); });
      DATA.pages.drafts.forEach(function (id) { ids.push(id); });
      var VALUE_ZH = { adopt: '采用', fix: '需修改', pending: '待定' };
      ids.forEach(function (id) {
        var e = DATA.entries[id];
        var v = radioValue('fb-page-' + id) || 'pending';
        if (v !== 'pending') {
          rows.push('| ' + (e.title || '') + (e.pageId ? '(' + e.pageId + ')' : '') + ' | ' + VALUE_ZH[v] + ' |');
        }
      });
      lines.push('');
      lines.push('## 逐页选择');
      if (rows.length) {
        lines.push('| 页面 | 选择 |');
        lines.push('| --- | --- |');
        rows.forEach(function (r) { lines.push(r); });
      } else {
        lines.push('(所有页面均为待定)');
      }
    }
    lines.push('');
    lines.push('## 意见');
    lines.push(fbRefs.textarea && fbRefs.textarea.value.trim() ? fbRefs.textarea.value.trim() : '(无)');
    return lines.join('\n');
  }

  function copyFeedback() {
    var md = buildFeedbackMd();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = md;
      ta.setAttribute('readonly', 'readonly');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) toast('✔ 反馈已复制到剪贴板', true);
      else toast('✖ 复制失败,请改用"下载反馈"', false);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(md).then(function () { toast('✔ 反馈已复制到剪贴板', true); }, fallback);
    } else {
      fallback();
    }
  }

  function downloadFeedback() {
    var md = buildFeedbackMd();
    var d = new Date();
    function p(n) { return (n < 10 ? '0' : '') + n; }
    var stamp = '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    var safeTask = DATA.taskId.replace(/[\\/:*?"<>|\s]+/g, '-');
    var name = 'feedback-' + safeTask + '-' + stamp + '.md';
    var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('✔ 已生成 ' + name, true);
  }

  // ---------- 启动 ----------
  var app = document.getElementById('app');
  renderHeader(app);
  renderVersions(app);
  renderPages(app);
  renderOthers(app);
  renderFeedback(app);
})();
`;

function buildHtml(data, taskId) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return [
    '<!doctype html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<title>UI 设计评审 — ' + escapeHtml(taskId) + '</title>',
    '<style>',
    CSS,
    '</style>',
    '</head>',
    '<body>',
    '<div id="app"></div>',
    '<script type="application/json" id="preview-data">' + json + '</' + 'script>',
    '<script>' + CLIENT_JS + '</' + 'script>',
    '</body>',
    '</html>',
  ].join('\n');
}

const CSS = `
:root {
  --bg: #17181b;
  --panel: #1f2126;
  --panel2: #26282e;
  --line: #34373f;
  --text: #d6d8dd;
  --muted: #8f939d;
  --accent: #6ea8ff;
  --ok: #6cc070;
  --warn: #d0a04a;
  --bad: #d98276;
  --canvas: #101114;
  --code-bg: #141518;
  --active-bg: #222a37;
  --active-text: #fff;
  --notice-bg: #262a31;
  --notice-text: #d8dce4;
  --chip-text: #c9cdd6;
  --warning-bg: #2a2416;
  --shadow: rgba(0, 0, 0, 0.4);
  color-scheme: dark;
}
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    --bg: #f4f6f8; --panel: #fff; --panel2: #eef1f5; --line: #cfd5dd;
    --text: #20242b; --muted: #616975; --accent: #1769c2; --ok: #267a36;
    --warn: #8a5a00; --bad: #a93428; --canvas: #e5e9ee; --code-bg: #f0f2f5;
    --active-bg: #dceaff; --active-text: #12385f; --notice-bg: #e8edf3;
    --notice-text: #303844; --chip-text: #3d4652; --warning-bg: #fff4d6;
    --shadow: rgba(28, 39, 53, 0.18); color-scheme: light;
  }
}
:root[data-theme="light"] {
  --bg: #f4f6f8; --panel: #fff; --panel2: #eef1f5; --line: #cfd5dd;
  --text: #20242b; --muted: #616975; --accent: #1769c2; --ok: #267a36;
  --warn: #8a5a00; --bad: #a93428; --canvas: #e5e9ee; --code-bg: #f0f2f5;
  --active-bg: #dceaff; --active-text: #12385f; --notice-bg: #e8edf3;
  --notice-text: #303844; --chip-text: #3d4652; --warning-bg: #fff4d6;
  --shadow: rgba(28, 39, 53, 0.18); color-scheme: light;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--text);
  font: 14px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
}
#app { max-width: 1400px; margin: 0 auto; padding: 24px 28px 240px; }
h1, h2, h3 { font-weight: 600; }
h2 { font-size: 17px; margin: 34px 0 12px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
.muted { color: var(--muted); }
code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: var(--chip-text); }

/* 页头 */
.hd { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 16px 20px 12px; }
.theme-toggle { float: right; margin-left: 12px; padding: 5px 10px; }
.hd h1 { margin: 0 0 8px; font-size: 20px; }
.hd .meta { display: flex; flex-wrap: wrap; gap: 4px 20px; color: var(--muted); margin-bottom: 4px; }
.hd .meta .warnmeta { color: var(--warn); }
.hd .taskpath { color: var(--muted); font-size: 12.5px; margin: 2px 0 6px; word-break: break-all; }
.chips { display: flex; flex-direction: column; gap: 4px; margin: 8px 0 4px; }
.chip { align-self: flex-start; background: var(--panel2); border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 4px; padding: 3px 10px; font-size: 12.5px; color: var(--chip-text); }
.chip-decision { border-left-color: var(--ok); }

/* 折叠文档 */
details.doc { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 8px 14px; margin: 10px 0; }
details.doc summary { cursor: pointer; color: var(--muted); user-select: none; }
.markdown { margin: 8px 0 4px; padding: 10px 12px; background: var(--code-bg); border: 1px solid var(--line); border-radius: 6px; max-height: 420px; overflow: auto; color: var(--text); }
.markdown > :first-child { margin-top: 0; } .markdown > :last-child { margin-bottom: 0; }
.markdown h1, .markdown h2, .markdown h3, .markdown h4, .markdown h5, .markdown h6 { margin: 1em 0 .4em; padding: 0; border: 0; font-size: 1em; }
.markdown p, .markdown ul, .markdown ol, .markdown blockquote, .markdown pre { margin: .55em 0; }
.markdown blockquote { border-left: 3px solid var(--accent); padding-left: 10px; color: var(--muted); white-space: pre-line; }
.markdown pre { white-space: pre-wrap; word-break: break-word; padding: 8px; background: var(--panel); border: 1px solid var(--line); border-radius: 5px; }
.markdown table { border-collapse: collapse; width: 100%; margin: .7em 0; }
.markdown th, .markdown td { border: 1px solid var(--line); padding: 5px 8px; text-align: left; }
.markdown a { color: var(--accent); }

/* 状态徽标 */
.badge { display: inline-block; font-size: 11.5px; line-height: 1.5; padding: 0 8px; border-radius: 9px; border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
.badge.rejected { color: var(--bad); border-color: #6a3a33; }
.badge.draft { color: var(--warn); border-color: #6b582f; }
.badge.candidate { color: var(--ok); border-color: #3a5a3c; }
.badge.approved { color: var(--accent); border-color: #2f4f76; }
.status-source { color: var(--muted); font-size: 12px; margin: 4px 0 10px; word-break: break-word; }

/* 版本 tab */
.tabbar { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 8px; background: var(--bg); padding: 10px 0; border-bottom: 1px solid var(--line); }
.tab { display: inline-flex; align-items: center; gap: 6px; background: var(--panel); border: 1px solid var(--line); color: var(--text); border-radius: 6px; padding: 5px 12px; cursor: pointer; font-size: 13.5px; }
.tab:hover { border-color: var(--muted); }
.tab.active { border-color: var(--accent); background: var(--active-bg); color: var(--active-text); }
.grouppanel { padding-top: 12px; }

/* 图片展示 */
.imgrow { display: grid; grid-template-columns: 1fr; gap: 14px; }
.imgrow.hasbefore, .imgrow.comparing { grid-template-columns: 1fr 1fr; }
@media (max-width: 980px) { .imgrow.hasbefore, .imgrow.comparing { grid-template-columns: 1fr; } }
.fig { margin: 0; min-width: 0; }
.fig.comparefig { display: none; }
.imgrow.comparing .fig.comparefig { display: block; }
.fighead { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.figlabel { color: var(--muted); font-size: 12.5px; }
.figtitle { font-weight: 600; margin-bottom: 6px; }
.figbox { height: 500px; background: var(--canvas); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.figbox img { width: 100%; height: 100%; object-fit: contain; display: block; cursor: zoom-in; }
.figbox img:focus-visible { outline: 2px solid var(--accent); outline-offset: -3px; }
.figcap { margin-top: 6px; color: var(--muted); font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; word-break: break-all; }
.comparetoggle { display: inline-flex; align-items: center; gap: 6px; margin: 4px 0 10px; color: var(--text); cursor: pointer; user-select: none; }
.comparetoggle input { accent-color: var(--accent); }
.mismatchwarn { display: none; margin-top: 10px; padding: 8px 12px; border: 1px solid var(--warn); background: var(--warning-bg); color: var(--warn); border-radius: 6px; }

/* 页面式 */
.pgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(560px, 1fr)); gap: 18px; }
@media (max-width: 1240px) { .pgrid { grid-template-columns: 1fr; } }
.pcard { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; min-width: 0; }
.pcard .figbox { height: 420px; }
.pchead { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.pchead h3 { margin: 0; font-size: 15px; }
.pid { color: var(--muted); font: 12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.subsection { margin-bottom: 8px; }
.subhead { margin: 18px 0 10px; font-size: 14px; color: var(--muted); font-weight: 600; }
.extpath { word-break: break-all; }
.pcard-ext { border-style: dashed; }

/* 灯箱 */
.lb { position: fixed; inset: 0; z-index: 60; background: rgba(8, 9, 11, 0.93); display: none; flex-direction: column; }
.lb.open { display: flex; }
.lbstage { flex: 1; overflow: auto; display: flex; padding: 14px; }
.lbstage img { margin: auto; max-width: 96vw; max-height: 90vh; cursor: zoom-out; }
.lbstage img.lbactual { max-width: none; max-height: none; cursor: move; }
.lbbar { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: var(--panel); border-top: 1px solid var(--line); flex-wrap: wrap; }
.lbinfo { color: var(--muted); font: 12.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; flex: 1; word-break: break-all; }
.lbbtn { background: var(--panel2); border: 1px solid var(--line); color: var(--text); border-radius: 6px; padding: 6px 12px; cursor: pointer; font-size: 13px; }
.lbbtn:hover { border-color: var(--muted); }

/* 反馈面板 */
.fb { position: fixed; left: 0; right: 0; bottom: 0; z-index: 50; background: var(--panel); border-top: 1px solid var(--line); box-shadow: 0 -8px 28px var(--shadow); }
.fb-notice { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 7px 20px; background: var(--notice-bg); border-bottom: 1px solid var(--line); color: var(--notice-text); font-size: 12.5px; }
.fb-notice .fb-collapse { flex: none; padding: 3px 10px; font-size: 12px; }
.shortcut-help { margin-left: auto; color: var(--muted); font-size: 11.5px; }
.fb-body { display: flex; gap: 24px; padding: 12px 20px 16px; align-items: stretch; }
.fb.collapsed .fb-body { display: none; }
.fb-choices { flex: 1.3; min-width: 0; max-height: 34vh; overflow: auto; padding-right: 6px; }
.fb-choices fieldset { border: 1px solid var(--line); border-radius: 8px; margin: 0 0 10px; padding: 8px 12px 10px; }
.fb-choices legend { color: var(--muted); font-size: 12.5px; padding: 0 6px; }
.fb-opt { display: inline-flex; align-items: center; margin: 2px 14px 2px 0; cursor: pointer; }
.fb-opt input { accent-color: var(--accent); }
.fb-pages { max-height: 22vh; overflow: auto; }
.fb-prow { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 3px 0; border-bottom: 1px dashed #2c2f36; font-size: 13px; }
.fb-ptitle { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fb-seg { display: inline-flex; gap: 2px; flex: none; }
.fb-segopt { display: inline-flex; align-items: center; gap: 3px; padding: 1px 8px; cursor: pointer; color: var(--muted); border-radius: 4px; }
.fb-segopt:hover { background: var(--panel2); color: var(--text); }
.fb-segopt input { accent-color: var(--accent); margin: 0; }
.fb-right { flex: 1; min-width: 260px; display: flex; flex-direction: column; gap: 8px; }
.fb-rightlabel { color: var(--muted); font-size: 12.5px; }
.fb-right textarea { flex: 1; min-height: 84px; resize: vertical; background: var(--panel2); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 8px 10px; font: inherit; }
.fb-refrow { display: flex; gap: 8px; align-items: center; }
.fb-refselect { min-width: 0; flex: 1; background: var(--panel2); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 7px 8px; font: inherit; }
.fb-actions { display: flex; gap: 10px; }
.btn { background: var(--panel2); border: 1px solid var(--line); color: var(--text); border-radius: 6px; padding: 8px 16px; cursor: pointer; font-size: 13.5px; }
.btn:hover { border-color: var(--muted); }
.btn-primary { border-color: var(--accent); color: var(--accent); }
@media (max-height: 650px) { .figbox { height: min(500px, 66vh); } }
@media (max-width: 720px) { #app { padding: 14px 12px 180px; } .fb-body { flex-direction: column; } .fb-right { min-width: 0; } .fb-notice { padding: 7px 10px; } }

/* 提示条 */
#toast { position: fixed; top: 18px; left: 50%; transform: translateX(-50%); z-index: 80; display: none; padding: 9px 18px; border-radius: 8px; font-size: 13.5px; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45); }
#toast.ok { background: #1e3323; border: 1px solid #3a5a3c; color: #9fd8a2; }
#toast.err { background: #38201d; border: 1px solid #6a3a33; color: #e5a49b; }
`;

main();
