import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readRegistry, discoverRegistries } from './tasks.mjs';

export const statuses = ['ready','in_progress','awaiting_integration','pending','blocked','needs_arch_review','failed','done'];
const list = v => Array.isArray(v) ? v : [];
const text = v => v == null ? '' : String(v);
export function normalize(doc, fallback = 'Project') {
  if (!doc || !Array.isArray(doc.tasks)) throw new Error('输入必须包含 tasks 数组');
  const seen = new Set();
  const tasks = doc.tasks.map(t => {
    if (!t || typeof t.id !== 'string' || !t.id.trim() || seen.has(t.id)) throw new Error('任务 ID 必须为唯一非空字符串');
    seen.add(t.id);
    const r = t.result || {};
    return { id: t.id, title: text(t.title || t.name || '名称待核实'), status: text(t.status || 'unknown'),
      owner: text(t.owner ?? r.owner), dependencies: list(t.dependencies).map(text), goal: text(t.goal),
      risk: text(t.risk_level ?? t.risk), kind: text(t.kind || 'unclassified'), group: text(t.group),
      acceptance: list(t.acceptance), evidence: list(t.evidence ?? r.evidence), scope: t.scope || {},
      branch: text(t.branch ?? r.branch), worktree: text(t.worktree ?? r.worktree),
      completedAt: text(t.completedAt ?? r.completed_at), claimedAt: text(t.claimedAt ?? r.claimed_at) };
  });
  const warnings = [];
  const byId = new Map(tasks.map(t => [t.id,t]));
  const visiting = new Set(), visited = new Set();
  function visit(id) {
    if (visiting.has(id)) { warnings.push('依赖环：' + id); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of byId.get(id).dependencies) {
      if (!byId.has(dep)) warnings.push(id + ' 缺少依赖：' + dep); else visit(dep);
    }
    visiting.delete(id); visited.add(id);
  }
  for (const t of tasks) visit(t.id);
  const milestones = list(doc.milestones).map((m,i) => {
    const ids = list(m.tasks).map(text), verification = list(m.verificationTasks).map(text);
    const all = [...new Set([...ids,...verification])];
    for (const id of all) if (!byId.has(id)) warnings.push('里程碑 ' + text(m.title) + ' 引用未知任务：' + id);
    return { id: text(m.id || 'milestone-' + i), title: text(m.title || '未命名里程碑'), tasks:ids,
      verificationTasks:verification, group:text(m.group), plannedDate:text(m.plannedDate),
      release: m.release?.date && m.release?.evidence ? {date:text(m.release.date),evidence:text(m.release.evidence)} : null,
      completed: all.length > 0 && all.every(id => byId.get(id)?.status === 'done') };
  });
  return {
    project: text(doc.project?.name || doc.project || doc.feature?.title || fallback),
    projectStatus: text(doc.project?.status || doc.feature?.status),
    tasks,
    milestones,
    warnings:[...new Set(warnings)]
  };
}

export function git(root, args) {
  try { return execFileSync('git', ['--no-optional-locks',...args], {cwd:root,encoding:'utf8',timeout:5000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','ignore']}).trimEnd(); }
  catch { return null; }
}
const key = s => createHash('sha256').update(s).digest('hex').slice(0,20);
export function gitInfo(root, baseOverride) {
  const top = git(root,['rev-parse','--show-toplevel']);
  if (!top) return { available:false, worktrees:[], branches:[], base:null };
  const refs = git(root,['for-each-ref','--format=%(refname:short)','refs/heads'])?.split('\n').filter(Boolean) || [];
  const remoteDefault = git(root,['symbolic-ref','--quiet','refs/remotes/origin/HEAD'])?.replace('refs/remotes/','');
  const configured = git(root,['config','--get','init.defaultBranch']);
  const base = baseOverride || remoteDefault || (refs.includes(configured) ? configured : refs.includes('main') ? 'main' : refs.includes('master') ? 'master' : null);
  const baseSha = base ? git(root,['rev-parse','--verify','--end-of-options',base+'^{commit}']) : null;
  const head = git(root,['rev-parse','--verify','HEAD^{commit}']);
  const commitCount = head ? Number(git(root,['rev-list','--count',head]) || 0) : 0;
  if (baseOverride && !baseSha) throw new Error('无法解析 --base：' + baseOverride);
  const raw = git(root,['worktree','list','--porcelain','-z']) || '';
  const worktrees = [];
  let wt;
  for (const part of raw.split('\0')) {
    if (part.startsWith('worktree ')) { wt = {path:part.slice(9),branch:'',head:''};worktrees.push(wt); }
    else if (wt && part.startsWith('branch ')) wt.branch=part.slice(7).replace(/^refs\/heads\//,'');
    else if (wt && part.startsWith('HEAD ')) wt.head=part.slice(5);
  }
  for (const w of worktrees) {
    w.id=key(w.path); w.exists=existsSync(w.path);
    w.dirty = w.exists ? (git(w.path,['status','--porcelain','-uno']) || '').split('\n').filter(Boolean) : [];
  }
  return {available:true,root:top,base:baseSha ? base : null,baseSha,commitCount,worktrees,branches:refs};
}
export function associate(tasks, info, root) {
  const canonical=p=>existsSync(p)?realpathSync(p):resolve(p);
  return tasks.map(t => {
    let candidates = t.worktree ? info.worktrees.filter(w=>canonical(resolve(root,t.worktree))===canonical(w.path)) : [];
    if (!candidates.length && t.branch) candidates=info.worktrees.filter(w=>w.branch===t.branch);
    const explicit = candidates.length > 0;
    if (!candidates.length && !t.branch && !t.worktree) {
      const escaped=t.id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      const pattern=new RegExp('(^|[^a-zA-Z0-9])'+escaped+'($|[^a-zA-Z0-9])','i');
      candidates=info.worktrees.filter(w=>pattern.test(w.branch)||pattern.test(basename(w.path)));
    }
    const branch=t.branch || (candidates.length===1 ? candidates[0].branch : '');
    const sha=branch && info.branches.includes(branch) ? git(root,['rev-parse','--verify','--end-of-options','refs/heads/'+branch+'^{commit}']) : null;
    let comparison=null;
    if(sha && info.baseSha) {
      const raw=git(root,['rev-list','--left-right','--count',info.baseSha+'...'+sha]);
      if(raw) {const [behind,ahead]=raw.split(/\s+/).map(Number);comparison={behind,ahead,merged:ahead===0};}
    }
    return {...t, candidates:candidates.map(w=>w.id), association:candidates.length ? explicit?'explicit':'inferred':'unknown', resolvedBranch:branch, head:sha, comparison};
  });
}
export function loadState(options) {
  const root=resolve(options.root || process.cwd());
  let source;
  if(options.data && options.registry) throw new Error('--data 与 --registry 不能同时使用');
  if(options.data || options.registry) source=resolve(root,options.data || options.registry);
  else {
    const candidates=discoverRegistries(root);
    if(candidates.length!==1) throw new Error('发现 '+candidates.length+' 个账本，请指定 --registry 或 --data');
    source=candidates[0];
  }
  const doc=options.data ? JSON.parse(readFileSync(source,'utf8')) : readRegistry(source).doc;
  const roadmap=options.roadmap ? resolve(root,options.roadmap) : resolve(root,'.tasks/roadmap.json');
  if(options.roadmap || existsSync(roadmap)) doc.milestones=JSON.parse(readFileSync(roadmap,'utf8')).milestones;
  const state=normalize(doc,basename(root));
  const architecture=options.architecture ? resolve(root,options.architecture) : resolve(root,'.tasks/architecture.md');
  if(options.architecture && !existsSync(architecture)) throw new Error('无法读取 --architecture：' + architecture);
  state.architecture=existsSync(architecture)
    ? { path:architecture, markdown:readFileSync(architecture,'utf8') }
    : null;
  const info=gitInfo(root,options.base);
  state.tasks=associate(state.tasks,info,root);
  return {...state,root,source,key:key(source),generatedAt:new Date().toISOString(),git:info};
}
export function history(root, head, baseSha, offset=0) {
  if(!/^[a-f0-9]{40,64}$/.test(head || '')) throw new Error('无有效提交');
  if(!Number.isInteger(offset)||offset<0||offset>10000) throw new Error('分页范围无效');
  const raw=git(root,['log','--format=%H%x00%aI%x00%s','-n','31','--skip='+offset,head,'--']);
  if(raw===null) throw new Error('读取 Git 历史失败');
  const rows=raw.split('\n').filter(Boolean).map(line=>{const [hash,date,...subject]=line.split('\0');return {hash,date,subject:subject.join(' '),inBase:baseSha ? git(root,['merge-base','--is-ancestor',hash,baseSha])!==null : null};});
  return {commits:rows.slice(0,30),hasMore:rows.length>30,offset};
}
export function commitFiles(root, head, hash) {
  if(!/^[a-f0-9]{40,64}$/.test(hash||'')||!head||git(root,['merge-base','--is-ancestor',hash,head])===null) throw new Error('提交不属于所选历史');
  const raw=git(root,['show','--format=','--numstat','--no-renames',hash,'--']);
  if(raw===null) throw new Error('提交统计不可用');
  return raw.split('\n').filter(Boolean).map(line=>{const [added,deleted,...name]=line.split('\t');return {added,deleted,path:name.join('\t')};});
}
export function permittedWorktree(state,id) {
  const fresh=gitInfo(state.root);
  const wt=fresh.worktrees.find(w=>w.id===id);
  if(!wt || !wt.exists) throw new Error('工作区已不存在或未登记');
  return realpathSync(wt.path);
}
