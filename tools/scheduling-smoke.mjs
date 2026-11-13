import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
const dir = await mkdtemp(join(tmpdir(),'reals-scheduling-smoke-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${dir}`,'--autoplay-policy=no-user-gesture-required','about:blank'],{ windowsHide:true, stdio:'ignore' });
let ws;
try {
  let target;
  for(let i=0;i<60;i++) { try { const port=(await readFile(join(dir,'DevToolsActivePort'),'utf8')).split('\n')[0].trim(); const list=await (await fetch(`http://127.0.0.1:${port}/json`)).json(); target=list.find(t=>t.type==='page'); if(target) break; } catch {} await new Promise(r=>setTimeout(r,100)); }
  if(!target) throw new Error('Chrome did not start');
  ws=new WebSocket(target.webSocketDebuggerUrl); await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  let id=0; const pending=new Map(); ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id){const p=pending.get(m.id); pending.delete(m.id); m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params}));});
  await call('Network.enable');const network=[];ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Network.requestWillBeSent')network.push(m.params.type);});
  await call('Page.navigate',{url:'http://127.0.0.1:5174'}); await new Promise(r=>setTimeout(r,1800));
  const evaluate = async expression => {const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  const delay=ms=>new Promise(r=>setTimeout(r,ms));


  const check=(v,label)=>{if(!v)throw Error(label);console.log('PASS',label);};
  await mkdir('artifacts/scheduling',{recursive:true});
  const screenshot=async name=>writeFile('artifacts/scheduling/'+name+'.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  await evaluate(`(async()=>{
    const React=await import('/node_modules/.vite/deps/react.js'),ReactDOM=await import('/node_modules/.vite/deps/react-dom_client.js');const {Home}=await import('/src/home/Home.tsx');const {ApiError}=await import('/src/auth/api.ts');await import('/src/styles/tokens.css');await import('/src/styles/global.css');
    document.body.innerHTML='<main class="login-page"><div class="login-panel"><div id="probe"></div></div></main>';
    const snapshot={phase:'ready',authContextVersion:1,account:{id:'me'},profile:{id:'profile',userId:'me',status:'ACTIVE',displayName:'Lucia'}};
    window.writes=[];window.rev=1;window.uncertain=false;window.fail=false;
    const stamp=new Date().toISOString(),end=new Date(Date.now()+86400000).toISOString();
    window.n={id:'n',connectionId:'c',roundNumber:1,status:'PENDING',confirmedDateTime:null,schedulingExpiresAt:end,createdAt:stamp,updatedAt:stamp};window.proposals=[];window.connection={id:'c',matchId:'m',userAId:'me',userBId:'them',state:'SCHEDULING_PHASE',schedulingExpiresAt:end,createdAt:stamp,updatedAt:stamp};
    window.slot=()=>{const d=new Date();d.setDate(d.getDate()+1);d.setHours(16,0,0,0);return d.toISOString();};
    const home=()=>({profileStatus:'ACTIVE',matchmaking:{inQueue:false,canSearch:true,blockedReason:null},activeInteractionsSummary:{activeInitialCount:0,activeConnectionCount:1,actionableConnectionCount:1,hasPendingSchedulingConnection:false},pendingActions:[],nextSteps:connection.state==='CLOSED'?[]:[{type:'SCHEDULING',matchId:'m',connectionId:'c',requiresAction:true,partner:{displayName:'Maria'},createdAt:stamp,schedulingExpiresAt:end}],passiveNotices:[]});
    const controller={snapshot,getSnapshot:()=>snapshot,subscribe:()=>()=>{},request:async(path,signal,method='GET',body)=>{
      if(method!=='GET'){writes.push({path,method,body});await new Promise(r=>setTimeout(r,80));if(path.endsWith('/block')){connection.state='CLOSED';rev++;return {id:'block'};}
      if(path.endsWith('/rejections')){proposals=proposals.map(p=>({...p,status:'REJECTED'}));return n;}
      if(path.endsWith('/acceptance')){n={...n,status:'CONFIRMED',confirmedDateTime:proposals[0].proposedDateTime};connection.state='SECOND_CHAT_SCHEDULED';rev++;return n;}
      proposals=body.proposedDateTimes.map((v,i)=>({id:'own'+i,connectionId:'c',userId:'me',roundNumber:n.roundNumber,preferenceOrder:i+1,proposedDateTime:v,status:'PENDING',createdAt:stamp}));if(uncertain){uncertain=false;throw new ApiError('network');}return proposals;}
      if(fail&&path.startsWith('/connections/'))throw new ApiError('network');
      if(path==='/me/home/status')return {version:rev,dirty:false,nextRefreshAt:null,serverTime:new Date().toISOString()};if(path==='/me/profile')return snapshot.profile;if(path==='/me/home')return home();
      if(path.endsWith('/visual-profile'))return {profileId:'partner',displayName:'Maria',age:29,bio:'Synthetic profile',photos:[],affinityIndicators:[],profileQuestions:[],myPersonalMessageSubmitted:false,partnerPersonalMessageSubmitted:false,partnerPersonalMessageRead:false,decisionRequiresPartnerPersonalMessageRead:false};
      if(path.endsWith('/negotiation'))return {...n};if(path.endsWith('/proposals'))return [...proposals];if(path.endsWith('/scheduling-availability'))return {conflictWindowMinutes:60,unavailableWindows:[],serverTime:new Date().toISOString()};if(path==='/connections/c')return {...connection};throw new ApiError('backend',404);
    }};
    window.fixtureRoot=ReactDOM.default.createRoot(document.querySelector('#probe'));fixtureRoot.render(React.default.createElement(Home,{controller}));
  })()`);
  const waitFor=async(expression,label)=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(40);}throw Error(label+': '+await evaluate('document.body.innerText'));};
  const clickText=async text=>{await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>(b.textContent===${JSON.stringify(text)}||b.getAttribute('aria-label')===${JSON.stringify(text)})&&!b.closest('[hidden]')).click()`);await delay(100);};
  for(const [width,height] of [[390,844],[1440,900]]){
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<768});
    await waitFor("!!document.querySelector('[aria-label=\"Ver Actividad\"]')",'Home');
    await evaluate("document.querySelector('.home-activity-entry[aria-label]').click()");await delay(200);await clickText('Elegir horarios');await waitFor("!!document.querySelector('select')",'picker');
    check(await evaluate("document.querySelector('select').options.length===7&&document.documentElement.scrollWidth<=innerWidth"),'seven days and no overflow '+width);
    await clickText('Agregar opci'+String.fromCharCode(243)+'n');check(await evaluate("!!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Enviar horarios'&&!b.disabled)"),'draft enables submission '+width);
    await clickText('Ver perfil');await waitFor("document.body.innerText.includes('Synthetic profile')",'browse profile');check(await evaluate("!Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Aprobar')"),'Browse has no decisions '+width);
    await evaluate('history.back()');await waitFor("!!document.querySelector('select')",'profile Back');check(await evaluate("!!Array.from(document.querySelectorAll('button')).find(b=>b.textContent.startsWith('Quitar'))"),'draft preserved '+width);
    await evaluate("document.documentElement.style.fontSize='32px'");check(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'large font no overflow '+width);await evaluate("document.documentElement.style.fontSize=''");await screenshot('selector-'+width);
    await evaluate("uncertain=true");await clickText('Enviar horarios');await waitFor("document.body.innerText.includes('Esperando a la otra persona')",'uncertain submission reconciled');check(await evaluate("writes.filter(w=>w.path.endsWith('/proposals')).length===1"),'one POST despite uncertain response '+width);
    await evaluate("proposals.push({id:'received',connectionId:'c',userId:'them',roundNumber:1,preferenceOrder:1,proposedDateTime:slot(),status:'PENDING',createdAt:new Date().toISOString()});dispatchEvent(new Event('online'))");await waitFor("document.body.innerText.includes('Horarios que recibiste')",'received review');await screenshot('review-'+width);
    await clickText('Aceptar opci'+String.fromCharCode(243)+'n 1');await waitFor("document.body.innerText.includes('Horario confirmado')",'confirmed');check(await evaluate("!document.querySelector('select')"),'terminal stops selector '+width);await screenshot('confirmed-'+width);
    await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Volver a Actividad').click()");await waitFor("!document.querySelector('.scheduling')",'Activity return');
    await evaluate("n={...n,status:'PENDING',confirmedDateTime:null};connection.state='SCHEDULING_PHASE';proposals=[];writes=[];rev++");
    if(width===390){await clickText('Volver a Inicio');}
  }
  // The same local wall time must not be silently moved across a DST gap.
  await call('Emulation.setTimezoneOverride',{timezoneId:'Europe/Berlin'});
  check(await evaluate(`(async()=>{const {localSlot}=await import('/src/scheduling/policy.ts');return localSlot('2027-03-28',2,30)===null&&localSlot('2027-10-31',2,30)?.endsWith('+02:00');})()`),'DST gap rejected and overlap offset preserved');
  await call('Emulation.setTimezoneOverride',{timezoneId:'America/Argentina/Buenos_Aires'});
  await clickText('Elegir horarios');await waitFor("!!document.querySelector('select')",'rejection fixture');
  await evaluate("proposals=[{id:'expired',connectionId:'c',userId:'them',roundNumber:1,preferenceOrder:1,proposedDateTime:'2020-01-01T12:00:00Z',status:'PENDING',createdAt:new Date().toISOString()}];dispatchEvent(new Event('online'))");
  await waitFor("document.body.innerText.includes('Vencido')",'expired partner proposal');
  check(await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Aceptar opción 1').disabled"),'expired acceptance disabled');
  await clickText('Rechazar estas opciones');await waitFor("!!document.querySelector('select')",'same-round rejection');
  check(await evaluate("n.roundNumber===1&&writes.filter(w=>w.path.endsWith('/rejections')).length===1"),'rejection does not locally advance round');
  await evaluate("fail=true;dispatchEvent(new Event('online'))");await waitFor("!!document.querySelector('[role=alert]')",'read failure');
  check(await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Enviar horarios').disabled"),'failed availability locks writes');
  await evaluate("fail=false");await clickText('Reintentar');await waitFor("!document.querySelector('[role=alert]')",'read recovery');
  await evaluate("n={...n,roundNumber:3,status:'FAILED'};connection.state='CLOSED';dispatchEvent(new Event('online'))");await waitFor("document.body.innerText.includes('No hubo acuerdo')",'final failure');await screenshot('failed-1440');
  await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Volver a Actividad').click()");await waitFor("!document.querySelector('.scheduling')",'failure return');
  await evaluate("n={...n,roundNumber:1,status:'PENDING'};connection.state='SCHEDULING_PHASE';proposals=[];writes=[];rev++;dispatchEvent(new Event('online'))");await delay(300);
  await clickText('Elegir horarios');await waitFor("!!document.querySelector('select')",'block fixture');await evaluate("document.querySelector('[aria-label=\"Más acciones\"]').click()");await delay(80);await evaluate("document.querySelector('[role=menuitem]').click()");await delay(80);check(await evaluate("!!document.querySelector('dialog[open]')"),'permanent block confirmation');await clickText('Bloquear definitivamente');await waitFor("!document.querySelector('.scheduling')",'blocked return');check(await evaluate("writes.filter(w=>w.path.endsWith('/block')).length===1"),'single block POST');
} finally { ws?.close(); chrome.kill(); await new Promise(r=>setTimeout(r,500)); if(!resolve(dir).startsWith(resolve(tmpdir())+sep)||!dir.includes('reals-scheduling-smoke-'))throw Error('Unsafe temporary directory');await rm(dir,{recursive:true,force:true,maxRetries:5}).catch(()=>{}); }
