// tasks.test.mjs — 零依赖单测 + /tmp 夹具端到端（node --test）。
// 覆盖：YAML 子集解析（flow/块式两变体）、registry 校验、外科手术式编辑、
// claim/complete 状态机（含双领拦截、未并入 main 拦截、依赖解锁）。

import { test } from "node:test"
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { parseYamlTasks, setTaskField, setTaskResult, validateRegistry, canonicalOwner } from "./tasks.mjs"

const BIN = fileURLToPath(new URL("./tasks.mjs", import.meta.url))

/* ---------- 样例 registry（full-ga flow 变体） ---------- */
const FLOW_YAML = `version: 1

feature:
  title: "样例特性"
  status: in_progress

tasks:
  - id: T1
    title: "第一张卡"
    status: ready
    goal: >
      目标文本跨
      两行折叠。
    scope:
      in: ["范围一", "范围二"]
      out: ["排除项"]
    constraints: ["约束 A"]
    forbidden: ["禁止 X"]
    acceptance:
      - {type: command, run: "make check"}
      - {type: assertion, expect: "可观察行为"}
    dependencies: []
    risk_level: L2
    result: {owner: null, attempts: 0, completed_at: null, evidence: [], follow_up_candidates: []}
  - id: T2
    title: "第二张卡"
    status: pending
    goal: >
      依赖 T1。
    scope:
      in: ["范围"]
      out: []
    constraints: []
    forbidden: []
    acceptance:
      - {type: command, run: "go test ./..."}
    dependencies: [T1]
    risk_level: L3
    result: {owner: null, attempts: 0, completed_at: null, evidence: [], follow_up_candidates: []}
`

/* ---------- 样例 registry（delivery-rc 块式变体） ---------- */
const BLOCK_YAML = `version: 1

feature:
  title: "块式样例"
  status: in_progress

tasks:
  - id: B1
    title: "块式卡"
    status: done

    goal: >
      块式 goal。

    acceptance:
      - type: command
        run: "make check"
      - type: assertion
        expect: "块式断言"

    dependencies: []

    risk_level: L1

    result:
      owner: "agent-a"
      attempts: 1
      completed_at: "2026-08-25T10:00:00Z"
      evidence:
        - {type: command, check: "make check", status: pass, summary: "全部通过"}
      follow_up_candidates: []
`

test("解析：flow 变体（full-ga 风格）", () => {
  const doc = parseYamlTasks(FLOW_YAML)
  assert.equal(doc.version, 1)
  assert.equal(doc.feature.title, "样例特性")
  assert.equal(doc.tasks.length, 2)
  const t1 = doc.tasks[0]
  assert.equal(t1.id, "T1")
  assert.equal(t1.status, "ready")
  assert.equal(t1.goal, "目标文本跨 两行折叠。")
  assert.deepEqual(t1.scope.in, ["范围一", "范围二"])
  assert.deepEqual(t1.acceptance[0], { type: "command", run: "make check" })
  assert.deepEqual(t1.acceptance[1], { type: "assertion", expect: "可观察行为" })
  assert.equal(t1.result.owner, null)
  assert.equal(t1.result.attempts, 0)
  assert.deepEqual(doc.tasks[1].dependencies, ["T1"])
})

test("解析：块式变体（delivery-rc 风格）", () => {
  const doc = parseYamlTasks(BLOCK_YAML)
  const b1 = doc.tasks[0]
  assert.equal(b1.id, "B1")
  assert.equal(b1.status, "done")
  assert.equal(b1.goal, "块式 goal。")
  assert.deepEqual(b1.acceptance[0], { type: "command", run: "make check" })
  assert.deepEqual(b1.acceptance[1], { type: "assertion", expect: "块式断言" })
  assert.equal(b1.result.owner, "agent-a")
  assert.deepEqual(b1.result.evidence, [{ type: "command", check: "make check", status: "pass", summary: "全部通过" }])
})

test("解析：真实 full-ga registry golden（若存在）", () => {
  const real = process.env.TASK_INTEGRATOR_FULL_GA_FIXTURE
  if (!real) return // 可选的外部 golden 由调用者显式注入
  try {
    const doc = parseYamlTasks(readFileSync(real, "utf8"))
    assert.ok(doc.tasks.length >= 15, `任务数 ${doc.tasks.length}`)
    const ids = doc.tasks.map((t) => t.id)
    assert.ok(ids.includes("GA-001") && ids.includes("GA-GATE"))
    const ds = doc.tasks.find((t) => t.id === "DS-001")
    assert.equal(typeof ds.goal, "string")
    assert.ok(Array.isArray(ds.acceptance) && ds.acceptance.length >= 2)
  } catch (e) {
    if (e.code === "ENOENT") return // 机器无该文件时跳过
    throw e
  }
})

test("校验：结构/状态一致性捕获缺陷", () => {
  const doc = parseYamlTasks(FLOW_YAML)
  assert.deepEqual(validateRegistry(doc), [])
  // 破坏：ready 但依赖未 done
  doc.tasks[1].status = "ready"
  assert.ok(validateRegistry(doc).some((e) => e.includes("依赖未全 done")))
  // 破坏：环
  const c = parseYamlTasks(FLOW_YAML)
  c.tasks[0].dependencies = ["T2"]
  assert.ok(validateRegistry(c).some((e) => e.includes("依赖环")))
  // 破坏：缺 result 键
  const d = parseYamlTasks(FLOW_YAML)
  delete d.tasks[0].result.owner
  assert.ok(validateRegistry(d).some((e) => e.includes("缺键 owner")))
})

test("外科编辑：setTaskField / setTaskResult（flow → 块式 result，幂等可再解析）", () => {
  let text = FLOW_YAML
  text = setTaskField(text, "T1", "status", "in_progress")
  assert.ok(/ {4}status: in_progress/.test(text))
  text = setTaskResult(text, "T1", {
    owner: "agent-x",
    attempts: 0,
    claimed_at: "2026-08-25T09:00:00Z",
    completed_at: null,
    evidence: [{ type: "command", check: "make check", status: "pass", summary: "ok" }],
    follow_up_candidates: ["后续项"],
    worktree: "/tmp/wt-t1",
    branch: "t1/feat",
  })
  const doc = parseYamlTasks(text)
  const t1 = doc.tasks[0]
  assert.equal(t1.status, "in_progress")
  assert.equal(t1.result.owner, "agent-x")
  assert.equal(t1.result.branch, "t1/feat")
  assert.equal(t1.result.claimed_at, "2026-08-25T09:00:00Z")
  assert.deepEqual(t1.result.evidence[0].summary, "ok")
  assert.deepEqual(t1.result.follow_up_candidates, ["后续项"])
  // T2 原样
  assert.equal(doc.tasks[1].status, "pending")
  // 二次覆盖（块式 result → 块式）
  let text2 = setTaskResult(text, "T1", { ...doc.tasks[0].result, completed_at: "2026-08-25T12:00:00Z" })
  const doc2 = parseYamlTasks(text2)
  assert.equal(doc2.tasks[0].result.completed_at, "2026-08-25T12:00:00Z")
  // 块式变体上编辑
  let btext = setTaskField(BLOCK_YAML, "B1", "status", "in_progress")
  const bdoc = parseYamlTasks(btext)
  assert.equal(bdoc.tasks[0].status, "in_progress")
})

/* ---------- 夹具端到端（真实 git 仓库 + 子进程 CLI） ---------- */

function run(args, cwd, env = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, TASKS_NO_PROC_DETECT: "1", ...env },
  })
  return { status: r.status, out: (r.stdout ?? "") + (r.stderr ?? "") }
}

const T0_CARD = `  - id: T0
    title: "零号卡（探测署名用）"
    status: ready
    goal: >
      无依赖。
    scope:
      in: ["范围"]
      out: []
    constraints: []
    forbidden: []
    acceptance:
      - {type: command, run: "true"}
    dependencies: []
    risk_level: L1
    result: {owner: null, attempts: 0, completed_at: null, evidence: [], follow_up_candidates: []}
`

function setupFixture() {
  const dir = mkdtempSync(join(tmpdir(), "tasks-fixture-"))
  const sh = (cmd) => execFileSync("/bin/sh", ["-c", cmd], { cwd: dir, encoding: "utf8" })
  sh("git init -q && git branch -M main && git config user.email t@t && git config user.name t")
  mkdirSync(join(dir, "docs", "tasks", "demo"), { recursive: true })
  // e2e 专用：在样例基础上追加 T0（探测署名用），索引断言按 id 查找
  const fixtureYaml = FLOW_YAML.replace("\ntasks:\n", "\ntasks:\n" + T0_CARD)
  writeFileSync(join(dir, "docs", "tasks", "demo", "tasks.yaml"), fixtureYaml)
  sh("git add -A && git commit -qm init")
  return { dir, sh, reg: join(dir, "docs", "tasks", "demo", "tasks.yaml") }
}

test("端到端：claim → 双领拦截 → complete → 解锁", { skip: process.platform === "win32" }, () => {
  const { dir, sh, reg } = setupFixture()
  try {
    // 1. 领卡成功（自动发现 registry；裸名 → 自动补 4 位短 ID 并回显规范名）
    let r = run(["claim", "T1", "--owner", "agent-1", "--branch", "t1/feat", "--worktree", dir], dir)
    assert.equal(r.status, 0, r.out)
    const canon = /owner=([^\s)）]+)/.exec(r.out)?.[1] ?? ""
    assert.match(canon, /^agent-1-[0-9a-f]{4}$/, `规范署名：${canon}`)
    assert.match(r.out, /沿用 --owner/)
    let doc = parseYamlTasks(readFileSync(reg, "utf8"))
    const t1 = doc.tasks.find((t) => t.id === "T1")
    assert.equal(t1.status, "in_progress")
    assert.equal(t1.result.owner, canon)
    assert.equal(t1.result.branch, "t1/feat")
    assert.ok(t1.result.claimed_at)
    assert.equal(sh("git log --oneline | wc -l").trim(), "2") // claim 落 main 提交

    // 2. 双领拦截（消息含规范署名）
    r = run(["claim", "T1", "--owner", "agent-2"], dir)
    assert.notEqual(r.status, 0)
    assert.ok(r.out.includes(`已由 ${canon} 持有`), r.out)

    // 3. 依赖未完成拦截
    r = run(["claim", "T2", "--owner", "agent-2"], dir)
    assert.notEqual(r.status, 0)
    assert.ok(r.out.includes("依赖未完成"), r.out)

    // 4. 未并入 main 拦截
    sh("git checkout -qb t1/feat && echo x > work.txt && git add -A && git commit -qm feat && git checkout -q main")
    writeFileSync(join(dir, "ev.json"), JSON.stringify([{ type: "command", check: "make check", status: "pass", summary: "ok" }]))
    r = run(["complete", "T1", "--evidence-file", "ev.json"], dir)
    assert.notEqual(r.status, 0)
    assert.ok(r.out.includes("未并入 main"), r.out)

    // 5. 合并后 complete 成功 + 解锁 T2
    sh("git merge -q --no-ff t1/feat -m merge")
    r = run(["complete", "T1", "--evidence-file", "ev.json", "--follow-up", "后续 A"], dir)
    assert.equal(r.status, 0, r.out)
    doc = parseYamlTasks(readFileSync(reg, "utf8"))
    assert.equal(doc.tasks.find((t) => t.id === "T1").status, "done")
    assert.ok(doc.tasks.find((t) => t.id === "T1").result.completed_at)
    assert.deepEqual(doc.tasks.find((t) => t.id === "T1").result.evidence[0].check, "make check")
    assert.equal(doc.tasks.find((t) => t.id === "T2").status, "ready") // 解锁
    assert.match(r.out, /解锁 ready: T2/)

    // 6. 重复 complete 拦截
    r = run(["complete", "T1", "--evidence-file", "ev.json"], dir)
    assert.notEqual(r.status, 0)
    assert.ok(r.out.includes("仅接受 in_progress"), r.out)

    // 6b. 显式短 ID 署名：T2 已解锁 → claim "agent-2#sess9" → owner "agent-2-sess9"
    r = run(["claim", "T2", "--owner", "agent-2#sess9", "--branch", "t2/feat"], dir)
    assert.equal(r.status, 0, r.out)
    doc = parseYamlTasks(readFileSync(reg, "utf8"))
    assert.equal(doc.tasks.find((t) => t.id === "T2").result.owner, "agent-2-sess9")
    assert.equal(doc.tasks.find((t) => t.id === "T2").status, "in_progress")
    assert.ok(!/沿用/.test(r.out), "显式 ID 不提示沿用")

    // 6c. 进程探测署名：注入 opencode pid 23812 → 省略 --owner，owner="opencode-23812"
    const DETECT = { TASKS_NO_PROC_DETECT: "", TASKS_OWNER_PROC: "opencode", TASKS_OWNER_PID: "23812" }
    r = run(["claim", "T0", "--branch", "t0/feat"], dir, DETECT)
    assert.equal(r.status, 0, r.out)
    assert.ok(/owner=opencode-23812/.test(r.out) && /进程 opencode pid 23812/.test(r.out), r.out)
    doc = parseYamlTasks(readFileSync(reg, "utf8"))
    assert.equal(doc.tasks.find((t) => t.id === "T0").result.owner, "opencode-23812")
    // 探测存在但显式 # 优先
    r = run(["claim", "T0x", "--owner", "opencode#fixed"], dir, DETECT)
    assert.notEqual(r.status, 0) // T0x 不存在；但 owner 校验先于任务存在性？——fail 顺序：未找到任务在前
    assert.ok(/未找到任务 T0x/.test(r.out), r.out)

    // 7. 只读命令正常
    r = run(["list"], dir)
    assert.equal(r.status, 0)
    assert.ok(r.out.includes("T1"))
    r = run(["validate"], dir)
    assert.equal(r.status, 0, r.out)
    r = run(["preflight", "T1"], dir)
    assert.equal(r.status, 0)
    const pf = JSON.parse(r.out)
    assert.equal(pf.task.id, "T1")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
