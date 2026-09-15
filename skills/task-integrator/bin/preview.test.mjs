import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Script } from 'node:vm';
import { normalize,loadState,history,commitFiles } from './preview-data.mjs';
import { renderPage } from './preview-page.mjs';
import { createPreviewServer, main, parseArgs } from './preview-server.mjs';

function fixture(t){const root=mkdtempSync(join(tmpdir(),'task-preview-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
function g(root,...args){return execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}
test('arbitrary IDs, unknown statuses, missing dependencies and cycles stay explicit',()=>{
  const state=normalize({project:{name:'Example'},tasks:[{id:'事项 α',title:'A',status:'reviewing',dependencies:['B']},{id:'B',dependencies:['事项 α','missing']}]});
  assert.equal(state.tasks[0].status,'reviewing');assert.equal(state.tasks[0].kind,'unclassified');
  assert.ok(state.warnings.some(w=>w.includes('依赖环')));assert.ok(state.warnings.some(w=>w.includes('missing')));
  assert.throws(()=>normalize({tasks:[{id:'x'},{id:'x'}]}));
});
test('non-Git JSON export, empty dataset and hostile text execute as data',async t=>{
  const root=fixture(t);const evil='</script><script>throw Error("injection")</script> $& $`';
  writeFileSync(join(root,'input.json'),JSON.stringify({project:'Independent',tasks:[{id:'N/1',title:evil,status:'done'}]}));
  const state=loadState({root,data:'input.json'});assert.equal(state.git.available,false);
  const html=renderPage(state);assert.ok(!html.includes(evil));new Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
  await main(['--root',root,'--data','input.json']);assert.ok(readFileSync(join(root,'.tasks/preview.html'),'utf8').includes('Independent'));
  assert.deepEqual(normalize({tasks:[]}).tasks,[]);
  assert.throws(()=>parseArgs(['--port','-1']));
});
test('milestones require release evidence and known tasks',()=>{
  const s=normalize({tasks:[{id:'x',status:'done'}],milestones:[{title:'Release',tasks:['x'],release:{date:'2026-01-01'}},{title:'Invalid',tasks:['missing']}]});
  assert.equal(s.milestones[0].release,null);assert.equal(s.milestones[0].completed,true);assert.equal(s.milestones[1].completed,false);
});
test('YAML adapter reads a task ledger without Git',t=>{
  const root=fixture(t);mkdirSync(join(root,'.tasks'));writeFileSync(join(root,'.tasks/tasks.yaml'),'version: 1\nfeature:\n  title: Example\n  status: in_progress\ntasks:\n  - id: CARD-1\n    title: Example task\n    status: ready\n    dependencies: []\n');
  writeFileSync(join(root,'.tasks/architecture.md'),'# Architecture\n\n<script>throw Error("unsafe")</script>\n\n| A | B |\n|---|---|\n| 1 | 2 |\n');
  const state=loadState({root});assert.equal(state.tasks[0].id,'CARD-1');assert.equal(state.project,'Example');assert.equal(state.projectStatus,'in_progress');assert.match(state.architecture.markdown,/Architecture/);
  const html=renderPage(state);assert.match(html,/data-view="architecture"/);assert.ok(!html.includes('<script>throw Error("unsafe")<\/script>'));
  writeFileSync(join(root,'tasks.yaml'),'tasks: []');assert.throws(()=>loadState({root}),/指定/);
});
test('custom base, worktrees, history pagination and controlled local open',async t=>{
  const root=fixture(t);g(root,'init','-b','trunk');g(root,'config','user.email','test@example.invalid');g(root,'config','user.name','Test');g(root,'config','init.defaultBranch','trunk');
  writeFileSync(join(root,'file.txt'),'one');g(root,'add','file.txt');g(root,'commit','-m','base');
  const wt=join(root,'wt');g(root,'worktree','add','-b','feature/ABC-1',wt);
  for(let i=0;i<32;i++)g(wt,'commit','--allow-empty','-m','Step '+i);
  writeFileSync(join(root,'input.json'),JSON.stringify({project:'Git example',tasks:[{id:'ABC-1',title:'Feature',status:'in_progress'}]}));
  const state=loadState({root,data:'input.json'}),task=state.tasks[0];
  assert.equal(state.git.base,'trunk');assert.equal(task.association,'inferred');assert.equal(task.status,'in_progress');assert.equal(task.comparison.ahead,32);
  assert.equal(history(root,task.head,state.git.baseSha).commits.length,30);assert.equal(history(root,task.head,state.git.baseSha,30).commits.length,3);
  assert.throws(()=>commitFiles(root,task.head,'--all'));assert.throws(()=>loadState({root,data:'input.json',base:'missing'}));
  let opened=null;const server=createPreviewServer({root,data:'input.json'},{opener:async p=>{opened=p;}});
  await new Promise(ok=>server.listen(0,'127.0.0.1',ok));t.after(()=>server.close());const origin='http://127.0.0.1:'+server.address().port;
  const html=await(await fetch(origin)).text();const token=html.match(/,"([a-f0-9]{48})"\);<\/script>/)[1];
  const post=(id,source=origin,key=token)=>fetch(origin+'/api/open',{method:'POST',headers:{Origin:source,'X-Preview-Token':key},body:JSON.stringify({id})});
  assert.equal((await post(task.candidates[0],'http://evil.invalid')).status,403);assert.equal((await post(task.candidates[0],origin,'bad')).status,403);
  assert.equal((await post('../../')).status,400);assert.equal(opened,null);
  assert.equal((await post(task.candidates[0])).status,200);assert.equal(opened,realpathSync(wt));
  const hs=await(await fetch(origin+'/api/history?task=ABC-1&offset=30')).json();assert.equal(hs.commits.length,3);
  assert.equal((await fetch(origin+'/api/commit?task=ABC-1&hash=--all')).status,400);
  const wt2=join(root,'wt2');g(root,'worktree','add','-b','other/ABC-1',wt2);
  const ambiguous=loadState({root,data:'input.json'}).tasks[0];assert.equal(ambiguous.candidates.length,2);assert.equal(ambiguous.head,null);
});
