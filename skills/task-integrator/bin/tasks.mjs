#!/usr/bin/env node
// tasks — 任务卡 CLI（architect / coding-owner / task-integrator 三件套的机械引擎）。
// 零依赖（node:fs / node:path / node:child_process / node:http[ui]），Node ≥18。
//
// 只读：list / show / validate / preflight / report / ui
// 变更（写 main 注册表 + git commit；mkdir 原子锁，锁内重读防并发）：
//   claim <id> --owner <名> [--worktree p] [--branch b]
//   complete <id> --evidence-file ev.json [--branch b] [--follow-up "…"]
//
// registry 发现：--registry <path> 显式；否则搜 .tasks/tasks.yaml 与 docs 下的 tasks.yaml。
// 多命中时只读命令展示全部，变更命令必须显式指定。
// YAML：architect §15 schema 的最小子集解析器（flow/块式两变体；golden 测试覆盖）。

import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import process from "node:process"

/* ============ YAML 子集解析器 ============ */

function parseYamlTasks(text) {
  const rawLines = text.split(/\r?\n/)
  const lines = []
  for (let n = 0; n < rawLines.length; n++) {
    const raw = rawLines[n]
    if (!raw.trim() || /^\s*#/.test(raw)) continue
    const indent = raw.length - raw.trimStart().length
    lines.push({ indent, text: raw.trim(), raw, no: n + 1 })
  }
  const [doc] = parseBlock(lines, 0, 0)
  return normalizeDoc(doc)
}

/** 在给定缩进层解析一个块（map 或 list）。返回 [value, 下一行索引]。 */
function parseBlock(lines, i, indent) {
  if (i >= lines.length) return [null, i]
  if (lines[i].text.startsWith("- ") || lines[i].text === "-") return parseList(lines, i, indent)
  return parseMap(lines, i, indent)
}

function parseList(lines, i, indent) {
  const out = []
  while (i < lines.length && lines[i].indent === indent && (lines[i].text.startsWith("- ") || lines[i].text === "-")) {
    const line = lines[i]
    const rest = line.text === "-" ? "" : line.text.slice(2)
    if (!rest) {
      const [v, ni] = parseBlock(lines, i + 1, deeperIndent(lines, i, indent))
      out.push(v)
      i = ni
      continue
    }
    // `- key: value` → 列表项是块 map，首对内联，后续键在 indent+2 列
    const kv = splitKey(rest)
    if (kv) {
      const itemIndent = indent + 2
      const item = {}
      const [v, ni0] = parseValue(lines, i, i + 1, itemIndent, kv.value)
      item[kv.key] = v
      i = ni0
      while (i < lines.length && lines[i].indent === itemIndent && !lines[i].text.startsWith("- ")) {
        const k2 = splitKey(lines[i].text)
        if (!k2) break
        const [v2, ni2] = parseValue(lines, i, i + 1, itemIndent, k2.value)
        item[k2.key] = v2
        i = ni2
      }
      out.push(item)
    } else {
      out.push(parseScalar(rest))
      i++
    }
  }
  return [out, i]
}

function parseMap(lines, i, indent) {
  const out = {}
  while (i < lines.length && lines[i].indent === indent && !lines[i].text.startsWith("- ")) {
    const kv = splitKey(lines[i].text)
    if (!kv) break
    const [v, ni] = parseValue(lines, i, i + 1, indent, kv.value)
    out[kv.key] = v
    i = ni
  }
  return [out, i]
}

/** 解析某键的值：rest 为空 → 嵌套块；`>`/`|` → 块标量；否则标量/flow。 */
function parseValue(lines, i, next, indent, rest) {
  if (rest === "" || rest === ">" || rest === "|" || /^>\d*$/.test(rest) || /^\|\d*$/.test(rest)) {
    const childIndent = deeperIndent(lines, next - 1, indent)
    if (rest === "" ) {
      if (next < lines.length && lines[next].indent > indent) {
        return parseBlock(lines, next, childIndent)
      }
      return [null, next]
    }
    // 块标量：收集更深层连续行
    const buf = []
    let j = next
    while (j < lines.length && lines[j].indent > indent) {
      buf.push(lines[j].raw.trim())
      j++
    }
    return [rest.startsWith(">") ? buf.join(" ") : buf.join("\n"), j]
  }
  return [parseScalar(rest), next]
}

function deeperIndent(lines, i, indent) {
  const next = lines[i + 1]
  return next && next.indent > indent ? next.indent : indent + 2
}

/** `key: value` 拆分（键侧不含冒号；返回 null 表示不是键值行）。 */
function splitKey(text) {
  const m = /^([A-Za-z_][\w-]*|"[^"]*"):\s*(.*)$/.exec(text)
  if (!m) return null
  return { key: m[1].replace(/^"|"$/g, ""), value: m[2] }
}

/** 标量 / flow 集合解析。 */
function parseScalar(s) {
  s = s.trim()
  if (s === "" || s === "null" || s === "~") return null
  if (s === "true") return true
  if (s === "false") return false
  if (/^-?\d+$/.test(s)) return Number(s)
  if (/^-?\d+\.\d+$/.test(s)) return Number(s)
  if (s.startsWith('"') && s.endsWith('"')) return unquote(s)
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'")
  if (s.startsWith("{")) return parseFlow(s)
  if (s.startsWith("[")) return parseFlow(s)
  return s
}

function unquote(s) {
  return s
    .slice(1, -1)
    .replace(/\\(["\\])/g, "$1")
}

/** flow（`{a: 1, b: "x"}` / `[1, "y", {..}]`）解析；tokenizer 感知引号与嵌套。 */
function parseFlow(s) {
  const [v, ni] = parseFlowValue(s, 0)
  if (skipWs(s, ni) !== s.length) throw new Error(`flow 残余内容: ${s.slice(ni)}`)
  return v
}

function parseFlowValue(s, i) {
  i = skipWs(s, i)
  if (s[i] === "{") return parseFlowMap(s, i)
  if (s[i] === "[") return parseFlowSeq(s, i)
  const [tok, ni] = readFlowToken(s, i)
  return [parseScalar(tok), ni]
}

function parseFlowMap(s, i) {
  const out = {}
  i = skipWs(s, i + 1)
  if (s[i] === "}") return [out, i + 1]
  for (;;) {
    i = skipWs(s, i)
    const colon = s.indexOf(":", i)
    const key = s.slice(i, colon).trim().replace(/^"|"$/g, "")
    i = skipWs(s, colon + 1)
    const [v, ni] = parseFlowValue(s, i)
    out[key] = v
    i = skipWs(s, ni)
    if (s[i] === ",") { i++; continue }
    if (s[i] === "}") return [out, i + 1]
    throw new Error(`flow map 语法错误 @${i}: ${s.slice(i, i + 20)}`)
  }
}

function parseFlowSeq(s, i) {
  const out = []
  i = skipWs(s, i + 1)
  if (s[i] === "]") return [out, i + 1]
  for (;;) {
    const [v, ni] = parseFlowValue(s, i)
    out.push(v)
    i = skipWs(s, ni)
    if (s[i] === ",") { i++; continue }
    if (s[i] === "]") return [out, i + 1]
    throw new Error(`flow seq 语法错误 @${i}: ${s.slice(i, i + 20)}`)
  }
}

function skipWs(s, i) {
  while (i < s.length && /\s/.test(s[i])) i++
  return i
}

function readFlowToken(s, i) {
  if (s[i] === '"' || s[i] === "'") {
    const q = s[i]
    let j = i + 1
    while (j < s.length && s[j] !== q) j += s[j] === "\\" ? 2 : 1
    return [s.slice(i, j + 1), j + 1]
  }
  let j = i
  while (j < s.length && ",}]".indexOf(s[j]) === -1) j++
  return [s.slice(i, j), j]
}

function normalizeDoc(doc) {
  const d = doc ?? {}
  const tasks = Array.isArray(d.tasks) ? d.tasks : []
  for (const t of tasks) {
    t.result = t.result ?? {}
    t.dependencies = Array.isArray(t.dependencies) ? t.dependencies : []
  }
  return { version: d.version, feature: d.feature ?? {}, tasks, ...d }
}

/* ============ registry 发现与读取 ============ */

export function discoverRegistries(cwd = process.cwd()) {
  const hits = []
  const candidates = [join(cwd, ".tasks", "tasks.yaml"), join(cwd, "tasks.yaml")]
  for (const c of candidates) if (existsSync(c)) hits.push(resolve(c))
  walkDocs(join(cwd, "docs"), hits)
  return hits
}

function walkDocs(dir, out) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const e of entries) {
    const full = join(dir, e)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walkDocs(full, out)
    else if (e === "tasks.yaml") out.push(resolve(full))
  }
}

export function readRegistry(absPath) {
  const text = readFileSync(absPath, "utf8")
  const doc = parseYamlTasks(text)
  return { path: absPath, text, doc }
}

/* ============ git 助手 ============ */

function git(args, cwd, opts = {}) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", opts.stderr ? "inherit" : "ignore"], ...opts })
}

function tryGit(args, cwd) {
  try {
    return git(args, cwd)
  } catch {
    return null
  }
}

function repoRoot(cwd) {
  return git(["rev-parse", "--show-toplevel"], cwd).trim()
}

function mainWorktree(cwd, mainRef = "main") {
  const out = git(["worktree", "list", "--porcelain"], cwd)
  const blocks = out.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
  for (const b of blocks) {
    const m = /^worktree (.+)$/m.exec(b)
    const br = /^branch refs\/heads\/(.+)$/m.exec(b)
    if (br && br[1] === mainRef && m) return m[1]
  }
  const first = /^worktree (.+)$/m.exec(blocks[0] ?? "")
  return first ? first[1] : repoRoot(cwd)
}

function branchExists(branch, cwd) {
  return Boolean(tryGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], cwd))
}

function isAncestor(a, b, cwd) {
  try {
    git(["merge-base", "--is-ancestor", a, b], cwd)
    return true
  } catch {
    return false
  }
}

function aheadBehind(branch, mainRef, cwd) {
  const out = tryGit(["rev-list", "--left-right", "--count", `${mainRef}...${branch}`], cwd)
  if (!out) return null
  const [behind, ahead] = out.trim().split(/\s+/).map(Number)
  return { ahead, behind }
}

function dirtyFiles(cwd) {
  const out = tryGit(["status", "--porcelain"], cwd)
  if (!out) return []
  return out.split("\n").filter((l) => l.trim()).map((l) => l.slice(3).trim())
}

/** registry 在 main 工作树中的对应路径（claim/complete 只写 main）。 */
function registryOnMain(absPath, mainRef) {
  const root = repoRoot(dirname(absPath))
  const rel = relative(root, absPath)
  const main = mainWorktree(dirname(absPath), mainRef)
  return { mainRoot: main, mainPath: join(main, rel), rel }
}

/* ============ 外科手术式编辑（保持其余文件字节不变） ============ */

function findTaskRegion(text, id) {
  const lines = text.split(/\r?\n/)
  let start = -1
  let dashIndent = 0
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)- id:\s*(?:"([^"]+)"|(\S+))\s*$/.exec(lines[i])
    if (m && (m[2] === id || m[3] === id)) {
      start = i
      dashIndent = m[1].length
      break
    }
  }
  if (start === -1) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    const ind = lines[i].length - lines[i].trimStart().length
    if (lines[i].trim().startsWith("- ") && ind === dashIndent && i > start) {
      end = i
      break
    }
    if (lines[i].trim() && ind < dashIndent) {
      end = i
      break
    }
  }
  return { lines, start, end, dashIndent, keyIndent: dashIndent + 2 }
}

function setTaskField(text, id, field, value) {
  const region = findTaskRegion(text, id)
  if (!region) throw new Error(`未找到任务 ${id}`)
  const { lines, start, end, keyIndent } = region
  const re = new RegExp(`^(\\s*)${field}:.*$`)
  for (let i = start; i < end; i++) {
    if (re.test(lines[i])) {
      lines[i] = `${" ".repeat(keyIndent)}${field}: ${value}`
      return lines.join("\n")
    }
  }
  // 字段缺失 → 插在 region 末尾（保持缩进）
  let insert = end
  while (insert > start && !lines[insert - 1].trim()) insert--
  lines.splice(insert, 0, `${" ".repeat(keyIndent)}${field}: ${value}`)
  return lines.join("\n")
}

function setTaskResult(text, id, result) {
  const region = findTaskRegion(text, id)
  if (!region) throw new Error(`未找到任务 ${id}`)
  const { lines, start, end, keyIndent } = region
  const re = /^(\s*)result:(.*)$/
  let keyLine = -1
  for (let i = start; i < end; i++) {
    if (re.test(lines[i])) {
      keyLine = i
      break
    }
  }
  const block = resultBlock(result, keyIndent)
  if (keyLine === -1) {
    let insert = end
    while (insert > start && !lines[insert - 1].trim()) insert--
    lines.splice(insert, 0, ...block)
    return lines.join("\n")
  }
  const inline = re.exec(lines[keyLine])[2].trim() !== ""
  if (inline) {
    lines.splice(keyLine, 1, ...block)
    return lines.join("\n")
  }
  // 块式 result：吞掉后续更深缩进行
  let j = keyLine + 1
  while (j < end && (!lines[j].trim() || lines[j].length - lines[j].trimStart().length > keyIndent)) j++
  lines.splice(keyLine, j - keyLine, ...block)
  return lines.join("\n")
}

function resultBlock(r, keyIndent) {
  const pad = " ".repeat(keyIndent)
  const pad2 = " ".repeat(keyIndent + 2)
  const out = [`${pad}result:`]
  out.push(`${pad2}owner: ${r.owner == null ? "null" : JSON.stringify(r.owner)}`)
  out.push(`${pad2}attempts: ${r.attempts ?? 0}`)
  out.push(`${pad2}claimed_at: ${r.claimed_at == null ? "null" : JSON.stringify(r.claimed_at)}`)
  out.push(`${pad2}completed_at: ${r.completed_at == null ? "null" : JSON.stringify(r.completed_at)}`)
  if (r.worktree) out.push(`${pad2}worktree: ${JSON.stringify(r.worktree)}`)
  if (r.branch) out.push(`${pad2}branch: ${JSON.stringify(r.branch)}`)
  const ev = Array.isArray(r.evidence) ? r.evidence : []
  if (ev.length === 0) out.push(`${pad2}evidence: []`)
  else {
    out.push(`${pad2}evidence:`)
    for (const e of ev) out.push(`${pad2}  - ${flowMapStr(e)}`)
  }
  const fu = Array.isArray(r.follow_up_candidates) ? r.follow_up_candidates.filter(Boolean) : []
  if (fu.length === 0) out.push(`${pad2}follow_up_candidates: []`)
  else {
    out.push(`${pad2}follow_up_candidates:`)
    for (const f of fu) out.push(`${pad2}  - ${JSON.stringify(f)}`)
  }
  return out
}

function flowMapStr(e) {
  const parts = Object.entries(e)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${typeof v === "string" ? JSON.stringify(v) : v}`)
  return `{${parts.join(", ")}}`
}

/* ============ 锁 ============ */

function acquireLock(lockDir) {
  try {
    mkdirSync(lockDir)
    writeFileSync(join(lockDir, "info"), `${process.pid} ${new Date().toISOString()}\n`)
    return () => rmSync(lockDir, { recursive: true, force: true })
  } catch (e) {
    if (e.code !== "EEXIST") throw e
    // 陈旧锁：>10 分钟视为残留
    const st = statSync(lockDir)
    if (Date.now() - st.mtimeMs > 10 * 60_000) {
      rmSync(lockDir, { recursive: true, force: true })
      mkdirSync(lockDir)
      writeFileSync(join(lockDir, "info"), `${process.pid} ${new Date().toISOString()}\n`)
      return () => rmSync(lockDir, { recursive: true, force: true })
    }
    throw new Error(`registry 被其他进程锁定（${lockDir}，<10min）。稍后重试。`)
  }
}

/* ============ 校验/审计核心 ============ */

export const STATUSES = new Set(["pending", "ready", "in_progress", "blocked", "needs_arch_review", "done", "failed"])

export function validateRegistry(doc) {
  const errs = []
  const ids = new Set()
  const byId = new Map(doc.tasks.map((t) => [t.id, t]))
  for (const t of doc.tasks) {
    if (ids.has(t.id)) errs.push(`任务 ID 重复：${t.id}`)
    ids.add(t.id)
    if (!STATUSES.has(t.status)) errs.push(`${t.id}: 非法 status "${t.status}"`)
    for (const d of t.dependencies ?? []) {
      if (!byId.has(d)) errs.push(`${t.id}: 依赖不存在 ${d}`)
    }
    if ((t.dependencies ?? []).includes(t.id)) errs.push(`${t.id}: 自依赖`)
    const r = t.result ?? {}
    for (const k of ["owner", "attempts", "completed_at", "evidence", "follow_up_candidates"]) {
      if (!(k in r)) errs.push(`${t.id}: result 缺键 ${k}`)
    }
  }
  // 依赖环
  const state = new Map()
  const visiting = new Set()
  const dfs = (id) => {
    if (state.get(id) === 1) return
    if (visiting.has(id)) {
      errs.push(`依赖环：涉及 ${id}`)
      return
    }
    visiting.add(id)
    for (const d of byId.get(id)?.dependencies ?? []) if (byId.has(d)) dfs(d)
    visiting.delete(id)
    state.set(id, 1)
  }
  for (const t of doc.tasks) dfs(t.id)
  // ready ⇔ 依赖全 done
  for (const t of doc.tasks) {
    const depsDone = (t.dependencies ?? []).every((d) => byId.get(d)?.status === "done")
    if (t.status === "ready" && !depsDone) errs.push(`${t.id}: ready 但依赖未全 done（${t.dependencies.filter((d) => byId.get(d)?.status !== "done").join(", ")}）`)
    if (t.status === "pending" && depsDone && (t.dependencies ?? []).length > 0) errs.push(`${t.id}: pending 但依赖已全 done（应解锁为 ready）`)
    if (t.status === "in_progress" && !t.result?.owner) errs.push(`${t.id}: in_progress 但无 owner`)
    if (t.status === "done" && !t.result?.completed_at) errs.push(`${t.id}: done 但缺 completed_at`)
  }
  return errs
}

/** 计算一个 registry 的账本（含 git/worktree 现状）。 */
export function computeLedger(doc, ctx = {}) {
  const { mainRoot, mainRef = "main" } = ctx
  const byId = new Map(doc.tasks.map((t) => [t.id, t]))
  const depsDone = (t) => (t.dependencies ?? []).every((d) => byId.get(d)?.status === "done")
  const tasks = doc.tasks.map((t) => {
    const r = t.result ?? {}
    const branch = r.branch
    const entry = {
      id: t.id,
      title: t.title ?? "",
      status: t.status,
      owner: r.owner ?? null,
      risk: t.risk_level ?? "",
      dependencies: t.dependencies ?? [],
      goal: t.goal ?? "",
      scope: t.scope ?? {},
      acceptance: t.acceptance ?? [],
      result: r,
      branch: branch ?? null,
      worktree: r.worktree ?? null,
    }
    if (mainRoot && branch) {
      entry.branchExists = branchExists(branch, mainRoot)
      if (entry.branchExists) {
        entry.aheadBehind = aheadBehind(branch, mainRef, mainRoot)
        entry.mergedIntoMain = isAncestor(branch, mainRef, mainRoot)
        entry.worktreeExists = entry.worktree ? existsSync(entry.worktree) : null
      }
    }
    entry.classification = classify(t, entry, byId)
    return entry
  })
  const audit = {
    claimable: tasks.filter((t) => t.status === "ready" && !t.owner && depsDone(byId.get(t.id))).map((t) => t.id),
    violations: [],
    zombies: [],
  }
  for (const e of tasks) {
    if (e.status === "ready" && !depsDone(byId.get(e.id))) audit.violations.push(`${e.id}: ready 但依赖未全 done`)
    if (e.status === "pending" && depsDone(byId.get(e.id)) && (e.dependencies ?? []).length) audit.violations.push(`${e.id}: pending 但依赖已全 done`)
    if (e.status === "in_progress" && !e.owner) audit.violations.push(`${e.id}: in_progress 无 owner`)
    if (e.status === "done" && e.branch && e.branchExists && !e.mergedIntoMain) audit.violations.push(`${e.id}: done 但分支未并入 main`)
    if (e.owner && e.result?.claimed_at && Date.now() - Date.parse(e.result.claimed_at) > 3 * 86400_000) {
      const staleBranch = !e.branch || !e.branchExists || (e.aheadBehind?.ahead ?? 0) === 0
      if (staleBranch) audit.zombies.push(`${e.id}: claim 超 3 天且分支无新提交（owner ${e.owner}）`)
    }
  }
  return { feature: doc.feature, tasks, audit }
}

function classify(t, entry, byId) {
  if (t.status === "done") return "done"
  if (t.status === "needs_arch_review") return "needs_arch_review"
  if (t.status === "blocked") return "blocked"
  if (t.status === "failed") return "failed"
  if (t.status === "ready") return "ready_to_claim"
  if (t.status === "pending") return "pending"
  // in_progress 细分
  if (entry.branchExists && !entry.mergedIntoMain && (entry.aheadBehind?.ahead ?? 0) > 0) return "awaiting_integration"
  return "in_progress"
}

/* ============ 命令实现 ============ */

function fmtCell(s, w) {
  s = String(s ?? "")
  return s.length > w ? s.slice(0, w - 1) + "…" : s.padEnd(w)
}

const STATUS_COLOR = {
  done: "\x1b[32m", ready: "\x1b[34m", in_progress: "\x1b[36m", pending: "\x1b[90m",
  blocked: "\x1b[33m", needs_arch_review: "\x1b[35m", failed: "\x1b[31m",
}
const C_RESET = "\x1b[0m"

function cmdList(registries) {
  for (const reg of registries) {
    const { doc, path } = readRegistry(reg)
    const ledger = computeLedger(doc, gitCtxOf(reg))
    const title = doc.feature?.title ?? basename(dirname(reg))
    console.log(`\n== ${title}（${relative(process.cwd(), path)}）==`)
    console.log(["ID", "状态", "Owner", "风险", "依赖", "标题"].map((h, i) => fmtCell(h, [9, 14, 18, 4, 22, 40][i])).join(" "))
    for (const t of ledger.tasks) {
      const color = STATUS_COLOR[t.status] ?? ""
      const deps = t.dependencies.length ? t.dependencies.join(",") : "-"
      console.log(
        [fmtCell(t.id, 9), color + fmtCell(t.status, 14) + C_RESET, fmtCell(t.owner ?? "", 18), fmtCell(t.risk, 4), fmtCell(deps, 22), fmtCell(t.title, 40)].join(" "),
      )
    }
  }
}

function gitCtxOf(regPath) {
  try {
    const { mainRoot, mainPath } = registryOnMain(regPath, "main")
    return { mainRoot, mainPath, mainRef: "main" }
  } catch {
    return {}
  }
}

function cmdShow(registries, id) {
  for (const reg of registries) {
    const { doc } = readRegistry(reg)
    const t = doc.tasks.find((x) => x.id === id)
    if (!t) continue
    console.log(`# ${t.id} — ${t.title}`)
    console.log(`状态: ${t.status}　owner: ${t.result?.owner ?? "—"}　风险: ${t.risk_level ?? "—"}`)
    console.log(`依赖: ${t.dependencies?.length ? t.dependencies.join(", ") : "无"}`)
    if (t.result?.worktree) console.log(`worktree: ${t.result.worktree}（branch ${t.result.branch ?? "?"}）`)
    console.log(`\n## Goal\n${t.goal ?? ""}`)
    if (t.scope?.in?.length) console.log(`\n## Scope.in\n${t.scope.in.map((s) => `- ${s}`).join("\n")}`)
    if (t.scope?.out?.length) console.log(`\n## Scope.out\n${t.scope.out.map((s) => `- ${s}`).join("\n")}`)
    if (t.constraints?.length) console.log(`\n## Constraints\n${t.constraints.map((s) => `- ${s}`).join("\n")}`)
    if (t.forbidden?.length) console.log(`\n## Forbidden\n${t.forbidden.map((s) => `- ${s}`).join("\n")}`)
    if (t.acceptance?.length) {
      console.log(`\n## Acceptance`)
      for (const a of t.acceptance) {
        if (a?.type === "command") console.log(`- [cmd] ${a.run}`)
        else if (a?.type === "assertion") console.log(`- [assert] ${a.expect}`)
        else console.log(`- ${JSON.stringify(a)}`)
      }
    }
    const r = t.result ?? {}
    if (r.evidence?.length) {
      console.log(`\n## Evidence`)
      for (const e of r.evidence) console.log(`- [${e.status ?? "?"}] ${e.check ?? e.type}: ${e.summary ?? ""}`)
    }
    if (r.follow_up_candidates?.length) console.log(`\n## Follow-ups\n${r.follow_up_candidates.map((s) => `- ${s}`).join("\n")}`)
    return
  }
  fail(`未找到任务 ${id}`)
}

function cmdValidate(registries) {
  let bad = 0
  for (const reg of registries) {
    const { doc } = readRegistry(reg)
    const errs = validateRegistry(doc)
    if (errs.length) {
      bad++
      console.log(`✗ ${relative(process.cwd(), reg)}`)
      for (const e of errs) console.log(`  - ${e}`)
    } else {
      console.log(`✓ ${relative(process.cwd(), reg)}（${doc.tasks.length} 张卡，图合法）`)
    }
  }
  if (bad) process.exit(1)
}

function cmdPreflight(registries, id, opts) {
  for (const reg of registries) {
    const { doc, path } = readRegistry(reg)
    const t = doc.tasks.find((x) => x.id === id)
    if (!t) continue
    const { mainRoot, mainPath } = registryOnMain(path, "main")
    const out = {
      registry: path,
      mainRoot,
      mainClean: true,
      dirtyFiles: [],
      task: { id, status: t.status, owner: t.result?.owner ?? null, branch: t.result?.branch ?? null, worktree: t.result?.worktree ?? null },
    }
    out.dirtyFiles = dirtyFiles(mainRoot).filter((f) => f !== relative(mainRoot, mainPath))
    out.mainClean = out.dirtyFiles.length === 0
    if (t.result?.branch) {
      out.branchExists = branchExists(t.result.branch, mainRoot)
      if (out.branchExists) {
        out.aheadBehind = aheadBehind(t.result.branch, "main", mainRoot)
        out.mergedIntoMain = isAncestor(t.result.branch, "main", mainRoot)
      }
    }
    console.log(JSON.stringify(out, null, 2))
    return
  }
  fail(`未找到任务 ${id}`)
}

function cmdReport(registries, { md = false } = {}) {
  const chunks = []
  for (const reg of registries) {
    const { doc, path } = readRegistry(reg)
    const ctx = gitCtxOf(reg)
    const ledger = computeLedger(doc, ctx)
    const name = doc.feature?.title ?? basename(dirname(reg))
    const n = (cls) => ledger.tasks.filter((t) => t.classification === cls).length
    const lines = []
    lines.push(`# 交付账本 — ${name}`)
    lines.push(``)
    lines.push(`## Progress`)
    lines.push(`- merged done: ${n("done")}/${ledger.tasks.length}`)
    lines.push(`- awaiting integration: ${n("awaiting_integration")}`)
    lines.push(`- in progress: ${n("in_progress")}`)
    lines.push(`- ready to claim: ${n("ready_to_claim")}`)
    lines.push(`- pending: ${n("pending")}　blocked: ${n("blocked")}　needs review: ${n("needs_arch_review")}　failed: ${n("failed")}`)
    lines.push(``)
    lines.push(`## Integration Ledger`)
    lines.push(`| task | main status | 分类 | branch | ahead | worktree | next action |`)
    lines.push(`|---|---|---|---|---|---|---|`)
    for (const t of ledger.tasks) {
      const next =
        t.classification === "awaiting_integration" ? "集成（merge→verify→complete）"
        : t.classification === "ready_to_claim" ? "可领取"
        : t.classification === "done" ? "—"
        : t.classification === "pending" ? "等待依赖"
        : t.status
      lines.push(`| ${t.id} | ${t.status} | ${t.classification} | ${t.branch ?? "—"} | ${t.aheadBehind ? t.aheadBehind.ahead : "—"} | ${t.worktree ? (t.worktreeExists === false ? "缺失" : "✓") : "—"} | ${next} |`)
    }
    lines.push(``)
    lines.push(`## Claimable Now`)
    lines.push(ledger.audit.claimable.length ? `- ${ledger.audit.claimable.join(", ")}` : `- none`)
    if (ledger.audit.violations.length) {
      lines.push(``)
      lines.push(`## Violations`)
      for (const v of ledger.audit.violations) lines.push(`- ${v}`)
    }
    if (ledger.audit.zombies.length) {
      lines.push(``)
      lines.push(`## Zombie Claims`)
      for (const z of ledger.audit.zombies) lines.push(`- ${z}`)
    }
    if (ctx.mainRoot) {
      const dirty = dirtyFiles(ctx.mainRoot)
      if (dirty.length) {
        lines.push(``)
        lines.push(`## Main 脏文件（归属需确认）`)
        for (const f of dirty) lines.push(`- ${f}`)
      }
    }
    chunks.push(lines.join("\n"))
  }
  const out = chunks.join("\n\n---\n\n")
  if (md) console.log(out)
  else console.log(renderMarkdownTerm(out))
}

/** 终端 markdown lite 渲染（标题/表格/列表/代码粗化）。 */
function renderMarkdownTerm(md) {
  const W = process.stdout.columns ?? 100
  return md
    .split("\n")
    .map((line) => {
      if (line.startsWith("# ")) return `\x1b[1;4m${line.slice(2)}\x1b[0m`
      if (line.startsWith("## ")) return `\x1b[1m${line.slice(3)}\x1b[0m`
      if (/^\|.*\|$/.test(line)) return `\x1b[36m${line}\x1b[0m`
      if (line.startsWith("- ")) return `  ${line}`
      return line
    })
    .join("\n")
}

/* ---- 变更命令 ---- */

/**
 * 署名规范：<agent>[-<短ID>]。并行多进程（如 5 个 opencode）同名不可分辨。
 * 短 ID 来源优先级：
 *  1. 显式 `name#tag` → `name-tag`（用户/会话指定，最高优先）；
 *  2. 进程探测：沿父进程链找到 agent 主进程（opencode/claude/codex/…）→ `<name>-<pid>`
 *     ——同会话多次调用自动得到同一署名（pid 即身份），可 ps -p 直接对上进程；
 *  3. 回退：裸名 + 随机 4 位 hex（输出提示沿用）。
 * 环境变量：TASKS_OWNER_PROC/TASKS_OWNER_PID 注入探测结果（测试/远端用）；
 * TASKS_NO_PROC_DETECT=1 关闭探测（确定性测试）。
 */
const AGENT_PROC_RE = /\b(opencode|claude|codex|cursor-agent|gemini|zcode|aider|goose)\b/i

function detectAgentProcess() {
  if (process.env.TASKS_NO_PROC_DETECT === "1") return null
  if (process.env.TASKS_OWNER_PROC && process.env.TASKS_OWNER_PID) {
    return { name: process.env.TASKS_OWNER_PROC.toLowerCase(), pid: Number(process.env.TASKS_OWNER_PID) }
  }
  try {
    let pid = process.ppid
    for (let hop = 0; hop < 12 && pid && pid !== 1; hop++) {
      const out = execFileSync("ps", ["-o", "ppid=,command=", "-p", String(pid)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim()
      const m = /^\s*(\d+)\s+(.*)$/.exec(out)
      if (!m) break
      const hit = AGENT_PROC_RE.exec(m[2])
      if (hit) return { name: hit[1].toLowerCase(), pid }
      pid = Number(m[1])
    }
  } catch {
    /* ps 不可用（非 POSIX）→ 回退 */
  }
  return null
}

/** 返回 [规范名, 来源：explicit|pid|random|null]。 */
function canonicalOwner(raw, takenOwners, detected) {
  const input = raw ? String(raw).trim() : ""
  const explicit = /^(.*)#([\w-]{2,12})$/.exec(input)
  if (explicit) return [`${explicit[1]}-${explicit[2]}`, "explicit"]
  const base = input || detected?.name || ""
  if (!base) return [null, "none"]
  if (detected?.pid) return [`${base}-${detected.pid}`, "pid"]
  const taken = new Set(takenOwners)
  for (let i = 0; i < 8; i++) {
    const suffix = Math.random().toString(16).slice(2, 6)
    if (!taken.has(`${base}-${suffix}`)) return [`${base}-${suffix}`, "random"]
  }
  return [`${base}-${Date.now().toString(36).slice(-4)}`, "random"]
}

function cmdClaim(registries, opts) {
  if (registries.length !== 1) fail(`变更命令需要唯一 registry（发现 ${registries.length} 个），请用 --registry 指定`)
  const detected = detectAgentProcess()
  if (!opts.owner && !detected) fail("claim 需要 --owner <name>（格式 <agent>[#<短ID>]，如 opencode#7f3a）")
  const reg = registries[0]
  const { mainRoot, mainPath } = registryOnMain(reg, "main")
  const lockDir = join(dirname(mainPath), ".tasks.lock")
  const release = acquireLock(lockDir)
  const backup = `${mainPath}.tasks-bak`
  try {
    // 锁内重读
    const { doc, text } = readRegistry(mainPath)
    const t = doc.tasks.find((x) => x.id === opts.id)
    if (!t) fail(`未找到任务 ${opts.id}`)
    if (t.result?.owner) fail(`任务 ${opts.id} 已由 ${t.result.owner} 持有（状态 ${t.status}）`)
    const byId = new Map(doc.tasks.map((x) => [x.id, x]))
    const notDone = (t.dependencies ?? []).filter((d) => byId.get(d)?.status !== "done")
    if (notDone.length) fail(`任务 ${opts.id} 依赖未完成：${notDone.join(", ")}（状态 ${t.status}）`)
    if (t.status !== "ready") fail(`任务 ${opts.id} 状态为 ${t.status}（仅 ready 可领取）`)

    // 署名归一：显式 #tag > 进程探测（name-pid，同会话自动一致）> 随机 4hex
    const [ownerName, ownerSource] = canonicalOwner(
      opts.owner,
      doc.tasks.map((x) => x.result?.owner).filter(Boolean),
      detected,
    )

    copyFileSync(mainPath, backup)
    let next = setTaskField(text, opts.id, "status", "in_progress")
    const r = {
      owner: ownerName,
      attempts: t.result?.attempts ?? 0,
      claimed_at: new Date().toISOString(),
      completed_at: null,
      evidence: t.result?.evidence ?? [],
      follow_up_candidates: t.result?.follow_up_candidates ?? [],
      worktree: opts.worktree,
      branch: opts.branch,
    }
    next = setTaskResult(next, opts.id, r)
    writeFileSync(mainPath, next)

    git(["add", relative(mainRoot, mainPath)], mainRoot)
    git(["commit", "-m", `tasks(cli): claim ${opts.id} → in_progress（owner ${ownerName}${opts.branch ? `，branch ${opts.branch}` : ""}）`], mainRoot)
    rmSync(backup, { force: true })
    const commit = git(["rev-parse", "--short", "HEAD"], mainRoot).trim()
    console.log(`✓ 已领取 ${opts.id}（owner=${ownerName}${opts.branch ? ` branch=${opts.branch}` : ""}）→ main ${commit}`)
    if (ownerSource === "pid") console.log(`  署名自动探测：进程 ${detected.name} pid ${detected.pid}（同会话自动一致，ps -p ${detected.pid} 可对上）`)
    if (ownerSource === "random") console.log(`  注：短 ID 已随机生成；本会话后续 claim/complete 请沿用 --owner "${ownerName}"`)
    console.log(`  registry: ${mainPath}`)
  } catch (e) {
    if (existsSync(backup)) copyFileSync(backup, mainPath), rmSync(backup, { force: true })
    throw e
  } finally {
    release()
  }
}

function cmdComplete(registries, opts) {
  if (registries.length !== 1) fail(`变更命令需要唯一 registry（发现 ${registries.length} 个），请用 --registry 指定`)
  const reg = registries[0]
  const { mainRoot, mainPath } = registryOnMain(reg, "main")
  const lockDir = join(dirname(mainPath), ".tasks.lock")
  const release = acquireLock(lockDir)
  const backup = `${mainPath}.tasks-bak`
  try {
    const { doc, text } = readRegistry(mainPath)
    const t = doc.tasks.find((x) => x.id === opts.id)
    if (!t) fail(`未找到任务 ${opts.id}`)
    if (t.status !== "in_progress") fail(`任务 ${opts.id} 状态为 ${t.status}（complete 仅接受 in_progress；先 claim）`)
    const branch = opts.branch ?? t.result?.branch
    if (!branch) fail(`缺少任务分支：claim 时记录或 complete 时 --branch 指定（完成校验需要并入证明）`)
    if (!branchExists(branch, mainRoot)) fail(`分支 ${branch} 不存在`)
    if (!isAncestor(branch, "main", mainRoot)) fail(`分支 ${branch} 未并入 main：先完成自助集成（merge 后再 complete）`)
    let evidence = []
    if (opts.evidenceFile) {
      evidence = JSON.parse(readFileSync(opts.evidenceFile, "utf8"))
      if (!Array.isArray(evidence)) fail("--evidence-file 需为 JSON 数组 [{type,check,status,summary}]")
    }
    const fus = [...(t.result?.follow_up_candidates ?? []), ...(opts.followUp ?? [])]

    copyFileSync(mainPath, backup)
    let next = setTaskField(text, opts.id, "status", "done")
    const r = {
      owner: t.result?.owner ?? opts.owner ?? "unknown",
      attempts: t.result?.attempts ?? 0,
      claimed_at: t.result?.claimed_at ?? null,
      completed_at: new Date().toISOString(),
      evidence,
      follow_up_candidates: fus,
      worktree: t.result?.worktree,
      branch,
    }
    next = setTaskResult(next, opts.id, r)

    // 依赖解锁：pending → ready（依赖已全 done）
    const byId2 = new Map(doc.tasks.map((x) => [x.id, x]))
    const unlocked = []
    for (const other of doc.tasks) {
      if (other.status !== "pending") continue
      const deps = other.dependencies ?? []
      if (other.id === opts.id) continue
      const doneAfter = deps.every((d) => d === opts.id || byId2.get(d)?.status === "done")
      if (doneAfter && deps.length) {
        next = setTaskField(next, other.id, "status", "ready")
        unlocked.push(other.id)
      }
    }
    writeFileSync(mainPath, next)

    git(["add", relative(mainRoot, mainPath)], mainRoot)
    git(
      ["commit", "-m", `tasks(cli): complete ${opts.id} → done（branch ${branch} 已并入 main）${unlocked.length ? `；unlock ${unlocked.join(", ")}` : ""}`],
      mainRoot,
    )
    rmSync(backup, { force: true })
    const commit = git(["rev-parse", "--short", "HEAD"], mainRoot).trim()
    console.log(`✓ ${opts.id} → done（main ${commit}）`)
    if (unlocked.length) console.log(`  解锁 ready: ${unlocked.join(", ")}`)
  } catch (e) {
    if (existsSync(backup)) copyFileSync(backup, mainPath), rmSync(backup, { force: true })
    throw e
  } finally {
    release()
  }
}

class TasksCliError extends Error {}

function fail(msg) {
  // 抛异常而非 process.exit：让 try/finally（锁释放/回滚）有机会执行，
  // 退出码由顶层 catch 统一处理。
  throw new TasksCliError(msg)
}

/* ============ 导出（ui.mjs / 测试复用） ============ */

export { parseYamlTasks, setTaskField, setTaskResult, canonicalOwner, detectAgentProcess }

/* ============ CLI 入口 ============ */

const HELP = `tasks — 任务卡 CLI（三件套机械引擎；零依赖）

用法：
  tasks list [--registry <path>]                    任务表（多 registry 全展示）
  tasks show <id>                                   卡片详情
  tasks validate [--registry]                       registry 结构/状态一致性校验
  tasks preflight <id>                              自助集成前评估（JSON）
  tasks report [--md]                               交付账本（integrator §9 机械版）
  tasks ui [--port N] [--open] [--export file.html] 本地只读仪表盘（看板/依赖图/审计）
  tasks claim <id> [--owner <名[#短ID]>] [--worktree p] [--branch b]
                                    领卡（写 main + commit；署名=进程名-pid 自动探测，
                                    显式 #tag 优先，探测失败回退随机短 ID）
  tasks complete <id> --evidence-file ev.json [--branch b] [--follow-up "…"]
                                                    标 done + 解锁（校验分支已并入 main）

选项：
  --registry <path>   显式 registry（变更命令在多命中时必须）
  --md                report 输出纯 markdown
  --owner/--branch/--worktree/--evidence-file/--follow-up/--port/--open/--export

完成校验：complete 要求任务分支 refs/heads/<branch> 已是 main 祖先（自助集成先合并）。
`

export async function main(argv = process.argv.slice(2)) {
  const opts = { followUp: [], positional: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--registry") opts.registry = argv[++i]
    else if (a === "--owner") opts.owner = argv[++i]
    else if (a === "--branch") opts.branch = argv[++i]
    else if (a === "--worktree") opts.worktree = argv[++i]
    else if (a === "--evidence-file") opts.evidenceFile = argv[++i]
    else if (a === "--follow-up" || a === "--follow") opts.followUp.push(argv[++i])
    else if (a === "--md") opts.md = true
    else if (a === "--port") opts.port = Number(argv[++i])
    else if (a === "--open") opts.open = true
    else if (a === "--export") opts.export = argv[++i]
    else if (a === "-h" || a === "--help" || a === "help") return console.log(HELP)
    else opts.positional.push(a)
  }
  const [cmd, ...rest] = opts.positional
  const registries = opts.registry ? [resolve(opts.registry)] : discoverRegistries(process.cwd())
  if (!registries.length) fail(`未发现 registry（搜索 .tasks/tasks.yaml、docs/**/tasks.yaml）；用 --registry 指定`)
  if (!cmd || cmd === "list") return cmdList(registries)
  if (cmd === "show") return cmdShow(registries, rest[0])
  if (cmd === "validate") return cmdValidate(registries)
  if (cmd === "preflight") return cmdPreflight(registries, rest[0], opts)
  if (cmd === "report") return cmdReport(registries, opts)
  if (cmd === "claim") return cmdClaim(registries, { ...opts, id: rest[0] })
  if (cmd === "complete") return cmdComplete(registries, { ...opts, id: rest[0] })
  if (cmd === "ui") {
    const { runUi } = await import("./ui.mjs")
    return runUi(registries, opts)
  }
  fail(`未知命令 ${cmd}\n${HELP}`)
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (invokedDirectly) {
  main().catch((e) => {
    console.error(`✗ ${e.message}`)
    process.exit(1)
  })
}