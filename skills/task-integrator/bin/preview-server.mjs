import { mkdirSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { loadState, history, commitFiles, permittedWorktree, git } from './preview-data.mjs';
import { renderPage } from './preview-page.mjs';

export async function openLocal(target) {
  const command=process.platform==='darwin'?'open':process.platform==='win32'?'explorer.exe':'xdg-open';
  await promisify(execFile)(command,[target],{timeout:10000});
}
export function createPreviewServer(options,{opener=openLocal}={}) {
  const token=randomBytes(24).toString('hex');
  let cached,at=0;
  const getState=()=>{
    if(!cached||Date.now()-at>10000){
      const next=loadState(options);
      const head=next.git.baseSha || (next.git.available?git(next.root,['rev-parse','HEAD']):null);
      if(head)next.recent=history(next.root,head,next.git.baseSha);
      cached=next;at=Date.now();
    }
    return cached;
  };
  getState();
  const historyCache=new Map();
  function taskHead(state,url){
    const task=state.tasks.find(t=>t.id===url.searchParams.get('task'));
    if(!task)throw new Error('任务不存在');
    const wtID=url.searchParams.get('worktree');
    if(wtID){if(!task.candidates.includes(wtID))throw new Error('工作区不属于该任务');return state.git.worktrees.find(w=>w.id===wtID)?.head;}
    if(task.candidates.length>1&&!task.head)throw new Error('请选择工作区');
    return task.head || (task.candidates.length===1?state.git.worktrees.find(w=>w.id===task.candidates[0])?.head:null);
  }
  const server=createServer(async(req,res)=>{
    const origin='http://127.0.0.1:'+server.address().port;
    const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
    try {
      if(req.headers.host!==new URL(origin).host)return send(403,{error:'仅允许本机访问'});
      const url=new URL(req.url,origin);
      if(req.method==='POST'&&url.pathname==='/api/open') {
        if(req.headers.origin!==origin||req.headers['x-preview-token']!==token)return send(403,{error:'操作来源无效'});
        let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)return send(413,{error:'请求过大'});}
        const target=permittedWorktree(getState(),JSON.parse(raw).id);
        await opener(target);return send(200,{opened:true});
      }
      if(req.method!=='GET')return send(405,{error:'不支持的操作'});
      if(req.headers.origin&&req.headers.origin!==origin)return send(403,{error:'不允许跨域访问'});
      if(req.headers['sec-fetch-site']==='cross-site')return send(403,{error:'不允许跨站访问'});
      const state=getState();
      if(url.pathname==='/') {
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"});
        return res.end(renderPage(state,{live:true,token}));
      }
      if(url.pathname==='/api/state')return send(200,state);
      if(['/api/history','/api/commit'].includes(url.pathname)) {
        const head=taskHead(state,url),offset=Number(url.searchParams.get('offset')||0);
        const key=[url.pathname,head,state.git.baseSha,offset,url.searchParams.get('hash')].join('|');
        const entry=historyCache.get(key);let value=entry&&Date.now()-entry.at<10000?entry.value:undefined;
        if(!value){value=url.pathname==='/api/history'?history(state.root,head,state.git.baseSha,offset):commitFiles(state.root,head,url.searchParams.get('hash'));if(historyCache.size>100)historyCache.clear();historyCache.set(key,{value,at:Date.now()});}
        return send(200,value);
      }
      return send(404,{error:'未找到'});
    }catch(error){return send(400,{error:error.message});}
  });
  server.requestTimeout=15000;
  return server;
}

export function parseArgs(args){
  const opts={};
  for(let i=0;i<args.length;i++){
    const arg=args[i];
    if(['--help','-h'].includes(arg)){opts.help=true;continue;}
    if(['--open','--live'].includes(arg)){opts[arg.slice(2)]=true;continue;}
    if(!['--root','--registry','--data','--roadmap','--architecture','--base','--out','--port'].includes(arg))throw new Error('未知参数：'+arg);
    const value=args[++i];if(!value||value.startsWith('--'))throw new Error(arg+' 缺少值');opts[arg.slice(2)]=value;
  }
  if(opts.port!==undefined&&(!/^\d+$/.test(opts.port)||Number(opts.port)>65535))throw new Error('端口必须为 0–65535');
  if(opts.out&&opts.live)throw new Error('--out 与 --live 不能同时使用');
  if(opts.port&&!opts.live)throw new Error('--port 需要 --live');
  return opts;
}
export async function main(args=process.argv.slice(2)){
  const opts=parseArgs(args);
  if(opts.help){console.log('通用项目进度预览\nnode preview.mjs [--root PROJECT] [--registry FILE | --data JSON] [--roadmap JSON] [--architecture FILE.md] [--base REF] [--out FILE.html] [--open]\nnode preview.mjs [--root PROJECT] [--registry FILE | --data JSON] [--architecture FILE.md] --live [--port 0] [--open]\n相对输入/输出路径基于 --root；默认读取 .tasks/architecture.md，生成 .tasks/preview.html。静态快照含本地路径与证据，分享前请检查。');return;}
  if(opts.live){
    const server=createPreviewServer(opts);await new Promise((ok,fail)=>{server.once('error',fail);server.listen(Number(opts.port||0),'127.0.0.1',ok);});
    const url='http://127.0.0.1:'+server.address().port;console.log('只读项目进度预览：'+url+'\nCtrl+C 停止');
    if(opts.open)try{await openLocal(url);}catch(e){console.error('自动打开失败：'+e.message);}
    return server;
  }
  const state=loadState(opts),output=resolve(state.root,opts.out||'.tasks/preview.html');
  if(!output.endsWith('.html'))throw new Error('--out 必须为 .html 文件');
  const inputs=[state.source,resolve(state.root,opts.roadmap||'.tasks/roadmap.json'),resolve(state.root,opts.architecture||'.tasks/architecture.md')];
  if(inputs.some(p=>p===output||(existsSync(p)&&existsSync(output)&&realpathSync(p)===realpathSync(output))))throw new Error('输出不能覆盖输入');
  state.histories=Object.create(null);state.commitFiles=Object.create(null);
  if(state.git.available){
    const head=state.git.baseSha||git(state.root,['rev-parse','HEAD']);
    if(head)state.recent=history(state.root,head,state.git.baseSha);
    const seen=new Map();
    for(const t of state.tasks.filter(t=>t.head&&t.status!=='done').slice(0,20)){
      if(!seen.has(t.head))seen.set(t.head,history(state.root,t.head,state.git.baseSha));
      state.histories[t.id]=seen.get(t.head);
      for(const c of state.histories[t.id].commits.slice(0,3))if(!state.commitFiles[c.hash])state.commitFiles[c.hash]=commitFiles(state.root,t.head,c.hash);
    }
  }
  mkdirSync(dirname(output),{recursive:true});writeFileSync(output,renderPage(state));
  console.log('预览已生成：'+output+'\n'+state.tasks.length+' 张任务 · 分享前请检查任务证据与本机路径');
  if(opts.open)try{await openLocal(pathToFileURL(output).href);}catch(e){console.error('自动打开失败：'+e.message);}
}
