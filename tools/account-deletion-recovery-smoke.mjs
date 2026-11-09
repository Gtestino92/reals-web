// Native Chromium + real React app/SessionController/ApiClient with controlled HTTP.
// Start Vite on 5174, then run: node tools/account-deletion-recovery-smoke.mjs
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
let fixture;
const deleted={id:'u',status:'DELETED',deletedAt:'2026-11-01T00:00:00Z',deletionFinalizesAt:'2026-12-01T00:00:00Z'};
const reset=()=>{fixture={account:{...deleted},writes:[],uncertain:false};};reset();
const server=createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  let result,status=200;
  if(req.method==='POST') {fixture.writes.push(req.url);await new Promise(r=>setTimeout(r,200));}
  if(req.url==='/me')result=fixture.account;
  else if(req.url==='/me/reactivation') {fixture.account={id:'u',status:'ACTIVE'};result=fixture.account;if(fixture.uncertain){status=503;result={code:'UNAVAILABLE'};}}
  else if(req.url==='/me/deletion/finalization'){fixture.account={...deleted,deletionFinalizesAt:null};result=fixture.account;}
  else if(req.url==='/me/profile')result={id:'p',userId:'u',status:'DRAFT',displayName:'Lucía',birthDate:'1995-01-01',gender:'FEMALE',lookingForGenders:['MALE'],intention:'DATE',city:'Córdoba',countryCode:'AR',bio:'',preferredMinAge:18,preferredMaxAge:45,maxDistanceKm:50,authenticityVerificationStatus:'NOT_STARTED'};
  else if(req.url==='/me/legal-status')result={documents:[],requirementsSatisfied:true};
  else if(req.url==='/legal/documents/current')result={documents:[]};
  else if(req.url==='/me/profile/photos'||req.url==='/reference/countries')result=[];
  else if(req.url==='/me/home')result={activeInteractionsSummary:{activeInitialCount:0,activeConnectionCount:0,actionableConnectionCount:0,hasPendingSchedulingConnection:false},pendingActions:[],nextSteps:[],passiveNotices:[]};
  else {status=404;result={code:'SYNTHETIC_NOT_FOUND'};}
  res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`, dir=await mkdtemp(join(tmpdir(),'reals-deletion-recovery-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${dir}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let ws;
try {
  let target;
  for(let i=0;i<60;i++){try{const port=(await readFile(join(dir,'DevToolsActivePort'),'utf8')).split('\n')[0].trim();target=(await(await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t=>t.type==='page');if(target)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  if(!target)throw Error('Chrome did not start');
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  let serial=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async(expression,label)=>{for(let i=0;i<120;i++){if(await evaluate(expression))return;await delay(40);}throw Error(label);};
  const check=(ok,label)=>{if(!ok)throw Error(label);console.log('PASS',label);};
  const textButton=async text=>{const expression=`Array.from(document.querySelectorAll('button')).find(n=>n.getClientRects().length&&n.textContent===${JSON.stringify(text)}&&!n.disabled)`;await wait(`!!(${expression})`,text);await evaluate(`(()=>{const button=${expression};button.focus();button.click()})()`);};
  const key=async(key,code,windowsVirtualKeyCode)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode,...(key===' '?{text:' '}:{})});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode});};
  const click=async selector=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);const p=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});};
  await call('Page.enable');await call('Page.navigate',{url:'http://127.0.0.1:5174'});await delay(1200);
  await evaluate(`(async()=>{const {default:React}=await import('/node_modules/.vite/deps/react.js'),{default:ReactDOM}=await import('/node_modules/.vite/deps/react-dom_client.js'),{OperationalApp}=await import('/src/App.tsx'),{ApiClient}=await import('/src/auth/api.ts');document.getElementById('root').hidden=true;const el=document.createElement('div');document.body.append(el);let root;window.renderRecovery=()=>{root?.unmount();root=ReactDOM.createRoot(el);root.render(React.createElement(OperationalApp,{firebase:{service:{observe:next=>{next({uid:'synthetic',emailVerified:true,getIdToken:async()=>'synthetic',reload:async()=>{}});return()=>{}},signOut:async()=>{}},localVerification:false},api:new ApiClient((path,options)=>fetch(${JSON.stringify(origin)}+String(path).slice(4),options))}));};renderRecovery();})()`);
  await mkdir('artifacts/account-deletion-recovery',{recursive:true});const screenshot=async name=>writeFile(`artifacts/account-deletion-recovery/${name}.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  const results=[];
  for(const width of [390,1440]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:width<700?844:900,deviceScaleFactor:1,mobile:width<700});
    reset();await evaluate('renderRecovery()');await wait("!!document.querySelector('.deletion-recovery')",'recovery');
    check(await evaluate("document.activeElement.textContent==='Cuenta pendiente de eliminación'"),'heading focus');
    check(await evaluate("document.querySelector('.deletion-recovery').textContent.includes('conexiones activas anteriores no se restaurarán')"),'canonical copy');
    await screenshot(`recovery-${width}`);
    await textButton('Eliminar definitivamente ahora');await wait("!!document.querySelector('dialog[open]')",'dialog');
    check(await evaluate("document.activeElement.textContent==='Cancelar'"),'safe initial focus');
    await key('Escape','Escape',27);await wait("!document.querySelector('dialog')",'Escape');
    check(await evaluate("document.activeElement.textContent==='Eliminar definitivamente ahora'"),'restored focus');
    await textButton('Eliminar definitivamente ahora');await screenshot(`confirmation-${width}`);
    await evaluate("history.pushState({},'',location.href);history.back()");await wait("!document.querySelector('dialog')",'browser Back');
    check(fixture.writes.length===0,'cancel and Back do not mutate');
    fixture.uncertain=true;await textButton('Reactivar cuenta');
    await wait("!!document.querySelector('.deletion-recovery [role=alert]')",'uncertain');
    check(await evaluate("Array.from(document.querySelectorAll('button')).find(n=>n.textContent==='Reactivar cuenta').disabled"),'uncertainty excludes writes');
    check(fixture.writes.length===1,'one reactivation POST');
    await textButton('Consultar estado de la cuenta');await wait("!document.querySelector('.deletion-recovery')",'fresh bootstrap');
    check(fixture.writes.length===1,'read reconciliation never replays POST');
    await wait("document.body.textContent.includes('Completá tu perfil')&&document.body.textContent.includes('Estado: DRAFT')",'DRAFT setup');check(true,'confirmed DRAFT setup');await screenshot(`draft-${width}`);
    reset();await evaluate('renderRecovery()');await wait("!!document.querySelector('.deletion-recovery')",'recovery');
    await textButton('Eliminar definitivamente ahora');await textButton('Eliminar definitivamente');await wait("!!document.querySelector('input[type=email]')",'finalization signout');
    check(fixture.writes.join(',')==='/me/deletion/finalization','one confirmed finalization POST');
    reset();await evaluate('renderRecovery()');await wait("!!document.querySelector('.deletion-recovery')",'recovery');
    await textButton('Mantener eliminación');await wait("!!document.querySelector('input[type=email]')",'keep signout');check(fixture.writes.length===0,'keep does not change schedule');
    check(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'no horizontal overflow');results.push({width,passed:true});
  }
  await writeFile('artifacts/account-deletion-recovery/results.json',JSON.stringify(results,null,2));

} finally {
  server.closeAllConnections();server.close();ws?.close();chrome.kill();await new Promise(r=>setTimeout(r,500));
  if(!resolve(dir).startsWith(resolve(tmpdir())+sep)||!dir.includes('reals-deletion-recovery-'))throw Error('Unsafe temporary directory');
  await rm(dir,{recursive:true,force:true,maxRetries:5});
}
