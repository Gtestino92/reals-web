// My Profile Preview: real React/SessionController/ApiClient, synthetic HTTP. Start Vite on 5174.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const baseUrl = process.argv.find(arg => arg.startsWith('--url='))?.slice(6) ?? 'http://127.0.0.1:5174';
const stamp = '2026-11-08T12:00:00Z';
const catalog = { catalogVersion: 'v1', questions: ['A','B','C','D'].map((id,i) => ({ id, prompt: `Pregunta ${id}`, displayOrder: i+1, semanticVersion: 1, contentVersion: 1 })) };
const answer = id => ({ questionId: id, questionSemanticVersion: 1, answer: `Respuesta ${id}`, selectedPosition: null, current: id !== 'A', createdAt: stamp, updatedAt: stamp });
let fixture;
const reset = status => { fixture = { status, answers: ['A','B','C','D'].map(answer), writes: [], previewReads:0, writeDelay: 0, readDelay: 0, writeStatus: 200 }; };
reset('ACTIVE');
const server = createServer(async (req,res) => {
  const f = fixture;
  res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization'); res.setHeader('Access-Control-Allow-Methods','GET,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : null, path = req.url, method = req.method;
  let result, status = 200;
  if (path === '/me') result = { id:'u', status:'ACTIVE' };
  else if (path === '/me/profile') result = { id:'p', userId:'u', status:f.status, displayName:'Lucía', birthDate:'1995-01-01', gender:'FEMALE', lookingForGenders:['MALE'], intention:'DATE', city:'Córdoba', countryCode:'AR', bio:'Bio guardada', preferredMinAge:18, preferredMaxAge:45, maxDistanceKm:50, authenticityVerificationStatus:'STALE' };
  else if (path === '/reference/countries') result = [{ code:'AR', displayName:'Argentina' }];
  else if (path === '/me/legal-status') result = { requirementsSatisfied:true, documents:[] };
  else if (path === '/legal/documents/current') result = { documents:[] };
  else if (path === '/me/profile/photos') result = [];
  else if (path === '/matchmaking/queue') result = { userId:'u', inQueue:false };
  else if (path === '/me/home/status') result = { version:1, dirty:false, nextRefreshAt:null, serverTime:stamp };
  else if (path === '/me/home') result = { profileStatus:f.status, matchmaking:{ inQueue:false, canSearch:true, blockedReason:null }, activeInteractionsSummary:{ activeInitialCount:0, activeConnectionCount:0, actionableConnectionCount:0, hasPendingSchedulingConnection:false }, pendingActions:[], nextSteps:[], passiveNotices:[] };
  else if (path === '/reference/affinity-questions') result = { catalogVersion:'empty', categories:[], questions:[] };
  else if (path === '/me/profile/affinity-answers') result = { answers:[] };
  else if (path === '/reference/profile-questions') result = catalog;
  else if (path === '/me/profile/question-answers' && method === 'GET') { f.previewReads++; result = { answers:f.answers }; }
  else if (method !== 'GET') { f.writes.push({ path, method }); status=405; result={ code:'READ_ONLY_FIXTURE' }; } else { status=404; result={ code:'SYNTHETIC_NOT_FOUND' }; }
  if (method === 'GET' && f.readDelay) await new Promise(r => setTimeout(r, f.readDelay));
  res.writeHead(status, { 'Content-Type':'application/json' }); res.end(JSON.stringify(result));
});
await new Promise(r => server.listen(0,'127.0.0.1',r));
const origin = `http://127.0.0.1:${server.address().port}`, dir = await mkdtemp(join(tmpdir(),'reals-profile-preview-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new','--remote-debugging-port=0',`--user-data-dir=${dir}`,'about:blank'], { windowsHide:true, stdio:'ignore' });
let ws;
try {
  let target;
  for (let i=0;i<60;i++) {
    try { const port=(await readFile(join(dir,'DevToolsActivePort'),'utf8')).split('\n')[0].trim(); target=(await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t=>t.type==='page'); if(target)break; } catch {}
    await new Promise(r=>setTimeout(r,100));
  }
  if (!target) throw Error('Chrome did not start');
  ws=new WebSocket(target.webSocketDebuggerUrl); await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  let serial=0; const pending=new Map();
  ws.addEventListener('message',e=>{ const m=JSON.parse(e.data); if(m.id) { const p=pending.get(m.id); pending.delete(m.id); m.error?p.reject(Error(m.error.message)):p.resolve(m.result); } });
  const call=(method,params={})=>new Promise((resolve,reject)=>{ const id=++serial; pending.set(id,{resolve,reject}); ws.send(JSON.stringify({id,method,params})); });
  const evaluate=async expression=>{ const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}); if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text); return r.result.value; };
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async(expression,label)=>{ for(let i=0;i<120;i++){if(await evaluate(expression))return;await delay(40);}throw Error(label+' '+await evaluate("JSON.stringify({text:document.body.innerText,trail:history.state?.trail})")); };
  const visible=text=>`Array.from(document.querySelectorAll('body *')).some(n=>n.getClientRects().length&&n.textContent===${JSON.stringify(text)})`;
  const click=async(text,article='')=>{
    const expression=`Array.from(document.querySelectorAll(${JSON.stringify(article ? `article[aria-label="${article}"] button` : 'button')})).find(n=>n.getClientRects().length&&(n.textContent===${JSON.stringify(text)}||n.getAttribute('aria-label')===${JSON.stringify(text)})&&!n.disabled)`;
    await wait(`!!(${expression})`, 'enabled '+text); await evaluate(`${expression}.click()`);
  };
  const check=(value,label)=>{if(!value)throw Error(label);console.log('PASS',label);};
  const change=async(selector,value)=>evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const key=async(key,code,windowsVirtualKeyCode)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode,...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode});};
  await call('Page.enable'); await call('Page.navigate',{url:baseUrl+'/tools/ux-audit-fixture.html'}); await delay(1200);
  const mount=`(async()=>{const {default:React}=await import('/node_modules/.vite/deps/react.js'),{default:ReactDOM}=await import('/node_modules/.vite/deps/react-dom_client.js'),{OperationalApp}=await import('/src/App.tsx'),{ApiClient}=await import('/src/auth/api.ts');document.getElementById('root').hidden=true;const el=document.createElement('div');document.body.append(el);let root;window.renderQuestions=()=>{root?.unmount();root=ReactDOM.createRoot(el);root.render(React.createElement(React.StrictMode,null,React.createElement(OperationalApp,{firebase:{service:{observe:next=>{next({uid:'synthetic',emailVerified:true,getIdToken:async()=>'synthetic',reload:async()=>{}});return()=>{}},signOut:async()=>{}},localVerification:false},api:new ApiClient((path,options)=>fetch(${JSON.stringify(origin)}+String(path).slice(4),options))})));};renderQuestions();})()`;
  await evaluate(mount); await mkdir('artifacts/profile-questions',{recursive:true});
  const screenshot=async name=>writeFile(`artifacts/profile-questions/${name}.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  const results=[];
  for(const [width,height] of [[390,844],[1440,900]]) for(const status of ['ACTIVE','DRAFT']) {
    reset(status); fixture.answers=[{...answer('B'), selectedPosition:1}];
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<768}); await evaluate('renderQuestions()');
    if(status==='ACTIVE') await click('Tu perfil');
    await wait("!!document.querySelector('.profile-form textarea:not(:disabled)')",'profile form');
    if(status==='DRAFT') await evaluate("document.querySelector('.profile-form').closest('details').open=true");
    await change('.profile-form textarea','Local draft');
    await click('Vista previa de mi perfil'); await wait(visible('Respuesta B'),'public answer');
    check(await evaluate(visible('Bio guardada')), 'confirmed bio '+status+' '+width);
    check(!await evaluate(visible('Local draft')), 'draft excluded');
    check(await evaluate("document.activeElement.textContent==='Vista previa de mi perfil'"),'preview focus');
    check(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'no overflow');
    await evaluate("window.resumeCard=document.querySelector('.visual-profile');window.resumeFocus=document.activeElement;window.resumeScroll=scrollY;window.resumeTimeOrigin=performance.timeOrigin;window.resumeEvents=[];window.captureResume=()=>resumeEvents.push(document.visibilityState);document.addEventListener('visibilitychange',captureResume)");
    const beforeResume=fixture.previewReads; fixture.readDelay=650;
    const other=await call('Target.createTarget',{url:'about:blank'});
    await call('Target.activateTarget',{targetId:other.targetId});
    await delay(100);
    await call('Page.bringToFront');
    await wait("resumeEvents.includes('hidden')&&resumeEvents.includes('visible')",'real tab visibility transition');
    check(fixture.previewReads>beforeResume,'real tab return starts revalidation');
    check(await evaluate("resumeCard.isConnected&&resumeCard===document.querySelector('.visual-profile')&&!document.querySelector('.visual-review [aria-label=\"Cargando perfil?\"]')"),'tab return retains card during delayed reads');
    check(await evaluate('document.activeElement===resumeFocus&&scrollY===resumeScroll&&performance.timeOrigin===resumeTimeOrigin'),'tab return retains focus scroll and document');
    await delay(1000); fixture.readDelay=0;
    check(await evaluate("resumeCard===document.querySelector('.visual-profile')"),'tab return retains card after reads');
    await call('Target.closeTarget',{targetId:other.targetId});
    await evaluate("document.removeEventListener('visibilitychange',captureResume)");
    await screenshot(`preview-${status}-${width}`);
    await evaluate('history.back()'); await wait("!!document.querySelector('.onboarding:not([hidden])')",'Back parent');
    check(await evaluate("document.querySelector('.profile-form textarea').value==='Local draft'"),'draft retained');
    check(await evaluate("document.activeElement.textContent==='Vista previa de mi perfil'"),'entry focus restored');
    await evaluate('history.forward()');await wait(visible('Respuesta B'),'Forward preview');
    check(fixture.writes.length===0,'read only');
    results.push({width,status,passed:true});
  }
  await writeFile('artifacts/profile-questions/preview-results.json',JSON.stringify(results,null,2));
} finally {
  server.closeAllConnections();server.close();ws?.close();chrome.kill();await new Promise(r=>setTimeout(r,500));
  if(!resolve(dir).startsWith(resolve(tmpdir())+sep)||!dir.includes('reals-profile-preview-'))throw Error('Unsafe temporary directory');
  await rm(dir,{recursive:true,force:true,maxRetries:5});
}
