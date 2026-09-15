// ui.mjs — tasks 本地只读仪表盘（零依赖：node:http + 单文件内联 HTML/CSS/vanilla JS）。
// 看板（按状态/分类分列）+ 依赖 DAG（手绘 SVG 分层布局）+ 卡片详情 + 审计条。
// V1 严格只读：claim/complete 等变更只走 CLI（锁 + 校验的唯一机械路径）。

import { createServer } from "node:http"
import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { basename, dirname, relative } from "node:path"
import process from "node:process"
import { computeLedger, readRegistry } from "./tasks.mjs"

function git(args, cwd) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
  } catch {
    return null
  }
}

export function buildState(registries) {
  const state = { generatedAt: new Date().toISOString(), registries: [] }
  let mainInfo = null
  for (const reg of registries) {
    const { doc, path } = readRegistry(reg)
    let ctx = {}
    try {
      const root = git(["rev-parse", "--show-toplevel"], dirname(path))?.trim()
      const wt = git(["worktree", "list", "--porcelain"], dirname(path))
      let main = root
      if (wt) {
        const blocks = wt.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)
        for (const b of blocks) {
          const br = /^branch refs\/heads\/(.+)$/m.exec(b)
          const m = /^worktree (.+)$/m.exec(b)
          if (br && br[1] === "main" && m) main = m[1]
        }
      }
      ctx = { mainRoot: main, mainRef: "main" }
    } catch {}
    const ledger = computeLedger(doc, ctx)
    state.registries.push({
      name: doc.feature?.title ?? basename(dirname(path)),
      path: relative(process.cwd(), path),
      feature: doc.feature ?? {},
      tasks: ledger.tasks,
      audit: ledger.audit,
    })
    if (!mainInfo && ctx.mainRoot) {
      const dirty = (git(["status", "--porcelain"], ctx.mainRoot) ?? "").split("\n").filter((l) => l.trim()).map((l) => l.slice(3).trim())
      mainInfo = { mainRoot: ctx.mainRoot, dirty }
    }
  }
  state.main = mainInfo
  return state
}

/* ---------- HTML 渲染（自包含，无 CDN） ---------- */

export function renderHtml({ static: isStatic }) {
  const boot = isStatic
    ? `window.__STATE__ = __STATE_JSON__; render(window.__STATE__);`
    : `async function tick(){ const r = await fetch('/api/state'); render(await r.json()); }
       tick(); setInterval(tick, 3000);`
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>任务卡仪表盘</title>
<style>
  :root{
    --ink:#111;--muted:#6B7280;--faint:#9CA3AF;--border:#E5E7EB;--subtle:#F9FAFB;--hover:#F3F4F6;--surface:#fff;
    --primary:#1D4ED8;--primary-weak:#EFF6FF;--success:#15803D;--success-weak:#F0FDF4;
    --warning:#B45309;--warning-weak:#FFFBEB;--danger:#B91C1C;--danger-weak:#FEF2F2;
    --mono:ui-monospace,SFMono-Regular,Menlo,monospace;
  }
  *{box-sizing:border-box}
  body{margin:0;font:12px/1.5 system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--ink);background:var(--subtle)}
  header{display:flex;align-items:center;gap:12px;padding:10px 20px;background:var(--surface);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:5}
  header h1{font-size:15px;margin:0}
  .tabs{display:flex;gap:4px}
  .tabs button{border:0;background:none;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;color:var(--muted)}
  .tabs button[aria-selected="true"]{background:var(--primary-weak);color:var(--primary);font-weight:600}
  .meta{margin-left:auto;color:var(--muted);font-size:11px}
  .audit{display:flex;flex-wrap:wrap;gap:8px;padding:8px 20px;background:var(--surface);border-bottom:1px solid var(--border)}
  .chip{display:inline-flex;gap:6px;align-items:center;border-radius:6px;padding:2px 8px;font-size:11px}
  .chip b{font-weight:600}
  main{padding:16px 20px;display:flex;flex-direction:column;gap:16px}
  section h2{font-size:13px;margin:0 0 8px}
  .board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(215px,1fr);gap:10px;overflow-x:auto;padding-bottom:4px}
  .col{background:var(--surface);border:1px solid var(--border);border-radius:8px;min-height:90px}
  .col>header{position:static;padding:6px 10px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center}
  .col>header span{font-size:11px;font-weight:600;color:var(--muted)}
  .col>header b{font-size:11px;color:var(--faint);font-weight:500}
  .cards{padding:6px;display:flex;flex-direction:column;gap:6px}
  .card{border:1px solid var(--border);border-radius:6px;padding:6px 8px;cursor:pointer;background:var(--surface)}
  .card:hover{background:var(--hover)}
  .card .id{font-family:var(--mono);font-size:11px;font-weight:600}
  .card .t{color:var(--muted);font-size:11px;margin-top:2px}
  .card .o{color:var(--faint);font-size:10px;margin-top:2px;font-family:var(--mono)}
  .badge{display:inline-block;border-radius:4px;padding:0 5px;font-size:10px;font-weight:600;margin-left:4px}
  .b-done{background:var(--success-weak);color:var(--success)}
  .b-ready{background:var(--primary-weak);color:var(--primary)}
  .b-progress{background:#ECFEFF;color:#0E7490}
  .b-await{background:var(--warning-weak);color:var(--warning)}
  .b-pending{background:var(--hover);color:var(--muted)}
  .b-warn{background:var(--danger-weak);color:var(--danger)}
  svg.dag{background:var(--surface);border:1px solid var(--border);border-radius:8px;width:100%;height:auto;display:block}
  .node rect{fill:var(--surface);stroke:var(--border);stroke-width:1.2;rx:5}
  .node text{font-size:10px;font-family:var(--mono);fill:var(--ink)}
  .node.done rect{stroke:var(--success);fill:var(--success-weak)}
  .node.ready rect{stroke:var(--primary);fill:var(--primary-weak)}
  .node.inprogress rect{stroke:#0E7490;fill:#ECFEFF}
  .node.blocked rect,.node.review rect,.node.failed rect{stroke:var(--danger);fill:var(--danger-weak)}
  .edge{stroke:var(--faint);stroke-width:1;fill:none}
  .edge.todone{stroke:var(--success);stroke-dasharray:3 2}
  aside{position:fixed;top:0;right:0;bottom:0;width:min(460px,92vw);background:var(--surface);border-left:1px solid var(--border);box-shadow:-6px 0 24px rgba(0,0,0,.06);padding:16px 18px;overflow:auto;z-index:10;transform:translateX(100%);transition:transform .15s}
  aside.open{transform:none}
  aside h3{margin:0 0 6px;font-size:14px;font-family:var(--mono)}
  aside .close{position:absolute;top:10px;right:12px;border:0;background:none;font-size:16px;cursor:pointer;color:var(--muted)}
  aside h4{font-size:11px;color:var(--muted);margin:14px 0 4px;text-transform:uppercase;letter-spacing:.04em}
  aside p,aside li{font-size:12px;margin:2px 0}
  aside ul{padding-left:18px;margin:2px 0}
  .kv{display:grid;grid-template-columns:90px 1fr;gap:2px 10px;font-size:12px}
  .kv span:nth-child(odd){color:var(--muted)}
  .ev{border-left:2px solid var(--success);padding:2px 8px;margin:4px 0;background:var(--subtle);border-radius:0 4px 4px 0}
  .ev .c{font-family:var(--mono);font-size:11px}
  .ev .s{color:var(--muted);font-size:11px}
  .viol{color:var(--danger)}
</style>
</head>
<body>
<header>
  <h1>任务卡仪表盘</h1>
  <nav class="tabs" id="tabs" role="tablist"></nav>
  <span class="meta" id="meta"></span>
</header>
<div class="audit" id="audit"></div>
<main>
  <section><label>搜索任务 <input id="search" type="search" placeholder="任务名称、编号、负责人" oninput="render(LAST)"></label>
  <label><input id="hide-done" type="checkbox" checked onchange="render(LAST)"> 隐藏已完成</label>
  <p id="progress-label"></p><progress id="progress" style="width:100%"></progress>
  <small>卡片完成率来自任务账本，不代表业务验收覆盖率。点击卡片查看验收要求与证据。${isStatic ? '静态快照：重新运行 preview.mjs 更新。' : '实时只读预览：每 3 秒刷新。'}</small></section>
  <section><h2>看板</h2><div class="board" id="board"></div></section>
  <section><h2>依赖图</h2><div id="dag"></div></section>
</main>
<aside id="detail"><button class="close" onclick="document.getElementById('detail').classList.remove('open')">✕</button><div id="detail-body"></div></aside>
<script>
const COLS = [
  ["ready_to_claim","可领取","b-ready"],
  ["in_progress","进行中","b-progress"],
  ["awaiting_integration","待集成","b-await"],
  ["pending","等待依赖","b-pending"],
  ["blocked","受阻","b-warn"],
  ["needs_arch_review","需架构裁决","b-warn"],
  ["failed","失败","b-warn"],
  ["done","已完成","b-done"],
]
const CLASS2COL = {done:"done",ready_to_claim:"ready_to_claim",in_progress:"in_progress",awaiting_integration:"awaiting_integration",pending:"pending",blocked:"blocked",needs_arch_review:"needs_arch_review",failed:"failed"}
const NODECLS = {done:"done",ready_to_claim:"ready",pending:"pending",in_progress:"inprogress",awaiting_integration:"inprogress",blocked:"blocked",needs_arch_review:"review",failed:"failed"}
let CURRENT = 0
let LAST
function taskName(t){return (t.title || '名称待核实')+'（'+t.id+'）'}
window.render = function(state){
  LAST=state
  const tabs = document.getElementById('tabs')
  tabs.innerHTML = ''
  state.registries.forEach((r,i)=>{
    const b = document.createElement('button')
    b.textContent = r.name
    b.setAttribute('role','tab')
    b.setAttribute('aria-selected', String(i===CURRENT))
    b.onclick = ()=>{CURRENT=i;render(state)}
    tabs.appendChild(b)
  })
  document.getElementById('meta').textContent = new Date(state.generatedAt).toLocaleString('zh-CN',{hour12:false}) + (state.main ? ' · main: '+state.main.mainRoot.split('/').slice(-1)[0] : '')
  const reg = state.registries[CURRENT] ?? state.registries[0]
  if(!reg) return
  renderAudit(reg, state)
  const done=reg.tasks.filter(t=>t.status==='done').length
  const progress=document.getElementById('progress'); progress.max=Math.max(reg.tasks.length,1);progress.value=done
  document.getElementById('progress-label').textContent='账本已完成 '+done+' / '+reg.tasks.length+' · '+(reg.tasks.length?Math.round(done/reg.tasks.length*100):0)+'%'
  const query=document.getElementById('search').value.toLowerCase()
  const filtered={...reg,tasks:reg.tasks.filter(t=>(!document.getElementById('hide-done').checked||t.status!=='done') && (taskName(t)+' '+(t.owner||'')).toLowerCase().includes(query))}
  renderBoard(filtered)
  renderDag(filtered)
}
function renderAudit(reg, state){
  const a = document.getElementById('audit')
  const counts = {}
  for (const t of reg.tasks) counts[t.classification] = (counts[t.classification]??0)+1
  const chips = []
  chips.push(chip('done '+((counts.done??0))+'/'+reg.tasks.length,'var(--success-weak)','var(--success)'))
  if(counts.ready_to_claim) chips.push(chip('可领取 '+counts.ready_to_claim,'var(--primary-weak)','var(--primary)'))
  if(counts.in_progress) chips.push(chip('进行中 '+counts.in_progress,'#ECFEFF','#0E7490'))
  if(counts.awaiting_integration) chips.push(chip('待集成 '+counts.awaiting_integration,'var(--warning-weak)','var(--warning)'))
  if(counts.pending) chips.push(chip('等待依赖 '+counts.pending,'var(--hover)','var(--muted)'))
  for(const v of reg.audit.violations) chips.push(chip('⚠ '+v,'var(--danger-weak)','var(--danger)'))
  for(const z of reg.audit.zombies.filter(z=>reg.tasks.some(t=>t.status!=='done'&&String(z).includes(t.id)))) chips.push(chip('需核实占用 '+z,'var(--danger-weak)','var(--danger)'))
  if(state.main && state.main.dirty.length) chips.push(chip('main 脏文件 '+state.main.dirty.length+'（归属需确认）','var(--warning-weak)','var(--warning)'))
  a.innerHTML = chips.join('')
}
function chip(text,bg,fg){return '<span class="chip" style="background:'+bg+';color:'+fg+'">'+esc(text)+'</span>'}
function renderBoard(reg){
  const board = document.getElementById('board'); board.innerHTML=''
  for(const [cls,label] of COLS){
    const col = document.createElement('div'); col.className='col'
    const items = reg.tasks.filter(t=>CLASS2COL[t.classification]===cls)
    col.innerHTML = '<header><span>'+label+'</span><b>'+items.length+'</b></header>'
    const cards = document.createElement('div'); cards.className='cards'
    for(const t of items){
      const c = document.createElement('div'); c.className='card'; c.tabIndex=0
      c.innerHTML = '<span class="t">'+esc(taskName(t))+'</span><div class="o">'+esc(t.owner??'')+(t.branch?' · '+esc(t.branch):'')+'</div>'
      c.onclick=()=>showDetail(reg,t)
      c.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();showDetail(reg,t)}}
      cards.appendChild(c)
    }
    col.appendChild(cards); board.appendChild(col)
  }
}
function renderDag(reg){
  if(!reg.tasks.length){document.getElementById('dag').textContent='没有匹配任务';return}
  const byId = new Map(reg.tasks.map(t=>[t.id,t]))
  const level = {}
  function lv(id, seen){
    if(level[id]!==undefined) return level[id]
    if(seen.has(id)) return 0
    seen.add(id)
    const t = byId.get(id)
    const deps = (t?.dependencies??[]).filter(d=>byId.has(d))
    level[id] = deps.length? Math.max(...deps.map(d=>lv(d,seen)))+1 : 0
    return level[id]
  }
  for(const t of reg.tasks) lv(t.id,new Set())
  const layers = []
  for(const t of reg.tasks){(layers[level[t.id]??0] ??= []).push(t)}
  const W=170,H=44,GX=60,GY=16
  const maxCol = Math.max(...layers.map(l=>l.length))
  const width = layers.length*W + (layers.length-1)*GX + 40
  const height = maxCol*H + (maxCol-1)*GY + 40
  let svg = '<svg class="dag" viewBox="0 0 '+width+' '+height+'" xmlns="http://www.w3.org/2000/svg">'
  const pos = {}
  layers.forEach((layer,li)=>layer.forEach((t,ci)=>{
    pos[t.id]={x:20+li*(W+GX), y:20+ci*(H+GY)}
  }))
  const edges=[]
  for(const t of reg.tasks) for(const d of t.dependencies){
    if(!pos[d]||!pos[t.id]) continue
    const a=pos[d], b=pos[t.id]
    const ax=a.x+W, ay=a.y+H/2, bx=b.x, by=b.y+H/2
    const mx=(ax+bx)/2
    edges.push('<path class="edge'+(byId.get(d)?.status==='done'?' todone':'')+'" d="M'+ax+' '+ay+' C'+mx+' '+ay+' '+mx+' '+by+' '+bx+' '+by+'"/>')
  }
  svg+=edges.join('')
  for(const t of reg.tasks){
    const p=pos[t.id]
    const cls = NODECLS[t.classification]??'pending'
    svg+='<g class="node '+cls+'" transform="translate('+p.x+','+p.y+')">'
    svg+='<rect width="'+W+'" height="'+H+'" rx="5"/>'
    svg+='<title>'+esc(taskName(t))+'</title><text x="8" y="18">'+esc(t.id)+'</text>'
    svg+='<text x="8" y="34" style="fill:#6B7280">'+esc(trunc(t.title,18))+'</text>'
    svg+='</g>'
  }
  svg+='</svg>'
  document.getElementById('dag').innerHTML=svg
}
function showDetail(reg,t){
  const d=document.getElementById('detail-body')
  const r=t.result??{}
  let h='<h3>'+esc(taskName(t))+'</h3><div class="kv">'
    +'<span>标题</span><span>'+esc(t.title)+'</span>'
    +'<span>状态</span><span>'+esc(t.status)+'（'+esc(t.classification)+'）</span>'
    +'<span>owner</span><span>'+esc(t.owner??'—')+'</span>'
    +'<span>风险</span><span>'+esc(t.risk||'—')+'</span>'
    +'<span>依赖</span><span>'+esc(t.dependencies.length?t.dependencies.join(', '):'无')+'</span>'
    +(r.branch?'<span>分支</span><span>'+esc(r.branch)+(t.mergedIntoMain?'（已并入 main）':(t.aheadBehind?'（ahead '+t.aheadBehind.ahead+'）':''))+'</span>':'')
    +(r.worktree?'<span>worktree</span><span>'+esc(r.worktree)+'</span>':'')
    +(r.claimed_at?'<span>领取于</span><span>'+esc(r.claimed_at)+'</span>':'')
    +(r.completed_at?'<span>完成于</span><span>'+esc(r.completed_at)+'</span>':'')
    +'</div>'
  if(t.goal) h+='<h4>Goal</h4><p>'+esc(t.goal)+'</p>'
  if(t.scope?.in?.length) h+='<h4>Scope.in</h4><ul>'+t.scope.in.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>'
  if(t.scope?.out?.length) h+='<h4>Scope.out</h4><ul>'+t.scope.out.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>'
  if(t.acceptance?.length) h+='<h4>Acceptance</h4><ul>'+t.acceptance.map(a=>'<li>'+(a.type==='command'?'[cmd] <code>'+esc(a.run)+'</code>':'[assert] '+esc(a.expect))+'</li>').join('')+'</ul>'
  if(r.evidence?.length) h+='<h4>Evidence</h4>'+r.evidence.map(e=>'<div class="ev"><div class="c">'+esc(e.check??e.type??'')+' · '+esc(e.status??'')+'</div><div class="s">'+esc(e.summary??'')+'</div></div>').join('')
  if(r.follow_up_candidates?.length) h+='<h4>Follow-ups</h4><ul>'+r.follow_up_candidates.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>'
  d.innerHTML=h
  document.getElementById('detail').classList.add('open')
}
function esc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function trunc(s,n){s=String(s??'');return s.length>n?s.slice(0,n-1)+'…':s}
${boot}
</script>
</body>
</html>`
}

/* ---------- server / export ---------- */

export async function runUi(registries, opts = {}) {
  if (opts.export) {
    const state = buildState(registries)
    const html = renderHtml({ static: true }).replace(
      "__STATE_JSON__",
      () => JSON.stringify(state).replace(/</g, "\\u003c"),
    )
    writeFileSync(opts.export, html)
    console.log(`✓ 已导出静态仪表盘 → ${opts.export}（${state.registries.length} 个 registry）`)
    return
  }
  const server = createServer((req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" })
      res.end(renderHtml({ static: false }))
      return
    }
    if (req.url === "/api/state") {
      try {
        const state = buildState(registries)
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" })
        res.end(JSON.stringify(state))
      } catch (e) {
        res.writeHead(500, { "content-type": "application/json" })
        res.end(JSON.stringify({ error: e.message }))
      }
      return
    }
    res.writeHead(404)
    res.end("not found")
  })
  server.listen(opts.port ?? 0, "127.0.0.1", async () => {
    const { port } = server.address()
    const url = `http://127.0.0.1:${port}`
    console.log(`✓ 任务卡仪表盘（只读）：${url}`)
    console.log(`  registry: ${registries.join(", ")}`)
    console.log(`  Ctrl+C 停止`)
    if (opts.open) {
      const { execFile } = await import("node:child_process")
      const cmd = process.platform === "darwin" ? "open" : "xdg-open"
      execFile(cmd, [url], () => {})
    }
  })
}
