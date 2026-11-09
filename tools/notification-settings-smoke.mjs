// Native Chromium + real React app/SessionController/ApiClient with controlled HTTP.
// Start Vite on 5174, then run: node tools/notification-settings-smoke.mjs
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
let fixture;
const initial = { activityEnabled:false, remindersEnabled:true, availabilityEnabled:false };
const authoritative = { activityEnabled:true, remindersEnabled:false, availabilityEnabled:true };
const reset = () => { fixture = { preferences:{...initial}, puts:[], readDelay:0, writeDelay:0, failRead:false, failWrite:false }; };
reset();
const server = createServer(async(req,res) => {
  const f = fixture;
  res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization'); res.setHeader('Access-Control-Allow-Methods','GET,PUT,OPTIONS');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  let raw='';for await(const chunk of req)raw+=chunk;
  let result, status=200;
  switch(req.url) {
    case '/me': result={id:'u',status:'ACTIVE'};break;
    case '/me/profile': result={id:'p',userId:'u',status:'ACTIVE',displayName:'Lucía'};break;
    case '/me/home/status': result={version:1,dirty:false,nextRefreshAt:null,serverTime:new Date().toISOString()};break;
    case '/me/home': result={profileStatus:'ACTIVE',matchmaking:{inQueue:false,canSearch:true,blockedReason:null},activeInteractionsSummary:{activeInitialCount:0,activeConnectionCount:0,actionableConnectionCount:0,hasPendingSchedulingConnection:false},pendingActions:[],nextSteps:[],passiveNotices:[]};break;
    case '/reference/affinity-questions': result={catalogVersion:'empty',categories:[],questions:[]};break;
    case '/me/profile/affinity-answers': result={answers:[]};break;
    case '/me/notification-preferences':
      if(req.method==='PUT') {
        f.puts.push(JSON.parse(raw));await new Promise(r=>setTimeout(r,f.writeDelay));
        if(f.failWrite){status=503;result={code:'SERVICE_UNAVAILABLE'};}else {f.preferences={...authoritative};result=f.preferences;}
      } else {
        await new Promise(r=>setTimeout(r,f.readDelay));
        if(f.failRead){status=503;result={code:'SERVICE_UNAVAILABLE'};}else result=f.preferences;
      }
      break;
    default: status=404;result={code:'SYNTHETIC_NOT_FOUND'};
  }
  res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`, dir=await mkdtemp(join(tmpdir(),'reals-notification-ui-'));
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
  const textButton=async text=>{const expression=`Array.from(document.querySelectorAll('button')).find(n=>n.getClientRects().length&&n.textContent===${JSON.stringify(text)}&&!n.disabled)`;await wait(`!!(${expression})`,text);await evaluate(`${expression}.click()`);};
  const key=async(key,code,windowsVirtualKeyCode)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode,...(key===' '?{text:' '}:{})});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode});};
  const click=async selector=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);const p=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});};
  await call('Page.enable');await call('Page.navigate',{url:'http://127.0.0.1:5174'});await delay(1200);
  await evaluate(`(async()=>{const {default:React}=await import('/node_modules/.vite/deps/react.js'),{default:ReactDOM}=await import('/node_modules/.vite/deps/react-dom_client.js'),{OperationalApp}=await import('/src/App.tsx'),{ApiClient}=await import('/src/auth/api.ts');document.getElementById('root').hidden=true;const el=document.createElement('div');document.body.append(el);let root;window.renderNotifications=()=>{root?.unmount();root=ReactDOM.createRoot(el);root.render(React.createElement(OperationalApp,{firebase:{service:{observe:next=>{next({uid:'synthetic',emailVerified:true,getIdToken:async()=>'synthetic',reload:async()=>{}});return()=>{}},signOut:async()=>{}},localVerification:false},api:new ApiClient((path,options)=>fetch(${JSON.stringify(origin)}+String(path).slice(4),options))}));};renderNotifications();})()`);
  await mkdir('artifacts/notification-settings',{recursive:true});const screenshot=async name=>writeFile(`artifacts/notification-settings/${name}.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  const enabled="document.querySelectorAll('.account-notifications [role=switch]:enabled').length===3";
  const disabled="document.querySelectorAll('.account-notifications [role=switch]:disabled').length===3";
  const rowRects=()=>evaluate("Array.from(document.querySelectorAll('.notification-row')).map(n=>n.getBoundingClientRect().y+scrollY)");
  const openAccount=async()=>{await wait("!!document.querySelector('button[aria-label=Cuenta]:not(:disabled)')",'Home');await evaluate("document.querySelector('button[aria-label=Cuenta]').click()");};
  const results=[];
  for(const width of [320,390,1440])for(const theme of ['light','dark']) {
    reset();await call('Emulation.setDeviceMetricsOverride',{width,height:width<700?844:900,deviceScaleFactor:1,mobile:width<700});await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});await evaluate('renderNotifications()');await openAccount();
    fixture.readDelay=500;await textButton('Notificaciones');await wait("document.querySelector('.account-notifications [role=status]')?.textContent==='Cargando notificaciones…'",'loading');
    check(await evaluate("!document.querySelector('[role=switch]')"),'no fake loading toggles');await screenshot(`loading-${width}-${theme}`);await wait(enabled,'loaded');fixture.readDelay=0;
    check(await evaluate("Array.from(document.querySelectorAll('[role=switch]')).map(n=>n.checked).join(',')==='false,true,false'"),'GET values');
    const ax=await call('Accessibility.getFullAXTree');const switches=ax.nodes.filter(n=>n.role?.value==='switch');check(switches.length===3&&switches.map(n=>n.name.value).join(',')==='Actividad,Recordatorios,Disponibilidad'&&switches.every(n=>n.description?.value),'switch names/descriptions in Chromium AX tree');
    check(await evaluate("Array.from(document.querySelectorAll('.notification-row')).every(n=>{const r=n.getBoundingClientRect(),s=n.querySelector('input').getBoundingClientRect(),c=n.querySelector('.notification-copy').getBoundingClientRect();return r.height>=72&&s.x>=c.right&&s.right<=r.right;})"),'row height and right aligned switch');
    const before=await rowRects();
    await evaluate("document.querySelector('.account-notifications h2').focus()");await key('Tab','Tab',9);await key('Tab','Tab',9);
    check(await evaluate("document.activeElement.getAttribute('role')==='switch'&&document.activeElement.matches(':focus-visible')&&getComputedStyle(document.activeElement).outlineStyle!=='none'"),'Tab and visible focus');await screenshot(`focus-${width}-${theme}`);
    await evaluate("(()=>{window.notificationFrames=[];window.recordNotificationFrames=true;const screen=document.querySelector('.account-notifications'),controls=Array.from(screen.querySelectorAll('[role=switch],button'));function frame(){const r=screen.getBoundingClientRect();notificationFrames.push({opacity:controls.map(n=>getComputedStyle(n).opacity).join(','),geometry:[r.x,r.y+scrollY,r.width,r.height],sameNodes:screen.isConnected&&screen===document.querySelector('.account-notifications')&&controls.every(n=>screen.contains(n))});if(recordNotificationFrames)requestAnimationFrame(frame)}frame()})()");
    fixture.writeDelay=400;await key(' ','Space',32);await wait(disabled,'saving disabled');check(await evaluate("document.querySelector('.notification-feedback').textContent.includes('Guardando preferencias')"),'saving copy');await screenshot(`saving-${width}-${theme}`);await wait(enabled,'saved');
    const frames=await evaluate('(recordNotificationFrames=false,notificationFrames)');
    if(process.argv.includes('--baseline'))console.log('OPACITY FRAMES',width,theme,[...new Set(frames.map(f=>f.opacity))]);
    else check(frames.length>2&&frames.every(f=>f.sameNodes&&f.opacity===frames[0].opacity&&JSON.stringify(f.geometry)===JSON.stringify(frames[0].geometry)),'no saving flash, remount or layout jump');
    if(!process.argv.includes('--baseline'))check(await evaluate("document.querySelector('.notification-feedback [role=status]').textContent===''"),'no saved-preferences notice');
    check(fixture.puts.length===1&&JSON.stringify(fixture.puts[0])===JSON.stringify({...initial,activityEnabled:true}),'one full PUT from Space');check(await evaluate("Array.from(document.querySelectorAll('[role=switch]')).map(n=>n.checked).join(',')==='true,false,true'"),'authoritative full response');
    fixture.failWrite=true;await click('.notification-row:last-child .notification-copy');await wait("!!document.querySelector('.notification-feedback [role=alert]')",'write error');check(fixture.puts.length===2&&await evaluate(disabled),'one row click PUT and uncertainty lock');
    check(JSON.stringify(before)===JSON.stringify(await rowRects()),'stable row positions through saving/error');await screenshot(`write-error-${width}-${theme}`);
    fixture.failRead=true;await textButton('Actualizar notificaciones');await wait("document.querySelector('[role=alert]')?.textContent.includes('No pudimos cargar')",'reconciliation failure');check(await evaluate(disabled),'failed GET keeps uncertainty');fixture.failRead=false;fixture.failWrite=false;await textButton('Actualizar notificaciones');await wait(enabled,'reconciled');check(fixture.puts.length===2,'GET reconciliation never replays PUT');
    await textButton('Volver a Cuenta');await wait("document.activeElement?.textContent==='Notificaciones'",'explicit Back focus');await evaluate('history.forward()');await wait("!!document.querySelector('.account-notifications')",'Forward');await evaluate('history.back()');await wait("document.activeElement?.textContent==='Notificaciones'",'browser Back focus');
    check(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'no overflow '+width+' '+theme);
    reset();fixture.failRead=true;await evaluate('renderNotifications()');await openAccount();await textButton('Notificaciones');await wait("!!document.querySelector('.notification-feedback [role=alert]')",'initial read failure');check(await evaluate("!document.querySelector('[role=switch]')"),'initial failure without switches');await screenshot(`read-error-${width}-${theme}`);fixture.failRead=false;await textButton('Actualizar notificaciones');await wait(enabled,'initial retry');results.push({width,theme,passed:true,frames});
  }
  await writeFile('artifacts/notification-settings/results.json',JSON.stringify(results,null,2));
} finally {
  server.closeAllConnections();server.close();ws?.close();chrome.kill();await new Promise(r=>setTimeout(r,500));
  if(!resolve(dir).startsWith(resolve(tmpdir())+sep)||!dir.includes('reals-notification-ui-'))throw Error('Unsafe temporary directory');
  await rm(dir,{recursive:true,force:true,maxRetries:5});
}
