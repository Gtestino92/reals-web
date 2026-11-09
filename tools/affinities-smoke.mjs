import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
let fixture;const requests=[];
function reset(kind='home'){fixture={kind,version:1,delay:0,expire:false,matchState:'CHAT_ACTIVE',partner:'PENDING',mine:'PENDING',inQueue:false,holdRead:false,passive:[],writes:[]};}
reset();
const server=createServer(async(req,res)=>{const current=fixture;
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS');if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  const path=req.url,method=req.method;requests.push({path,method});if(current.delay&&method==='GET')await new Promise(r=>setTimeout(r,current.delay));
  let body='';for await(const chunk of req)body+=chunk;let result;let status=200;
  if(path==='/me/home/status'){if(current.failHome){status=503;result={code:'SERVICE_UNAVAILABLE'};}else result={version:current.version,dirty:false,nextRefreshAt:null,serverTime:new Date().toISOString()};}
  else if(path==='/me'){
    if(method==='DELETE'){current.deletions=(current.deletions??0)+1;if(current.failDeletion){current.deleted=true;status=503;result={code:'SERVICE_UNAVAILABLE'};}else result=undefined;}
    else result={id:'me',status:current.deleted?'DELETED':'ACTIVE'};
  }
  else if(path==='/reference/affinity-questions')result={catalogVersion:'v1',categories:[{id:'music',title:'Música',displayOrder:1}],questions:['a','b','c'].map(id=>({id,categoryId:'music',prompt:'Pregunta '+id,semanticVersion:1,contentVersion:1,answerType:'SINGLE_CHOICE',options:[{code:'A',label:'Nada',displayOrder:1},{code:'B',label:'Bastante',displayOrder:2}]}))};
  else if(path.startsWith('/me/profile/affinity-answers')){current.answers??=[];if(method!=='GET'){current.writes.push({path,method});await new Promise(r=>setTimeout(r,current.writeDelay??0));if(method==='PATCH'){const a=JSON.parse(body).answers[0];current.answers=[...current.answers.filter(x=>x.questionId!==a.questionId),{...a,questionSemanticVersion:1}];}else current.answers=current.answers.filter(x=>!path.endsWith('/'+x.questionId));}result={answers:current.answers};}
  else if(path==='/reference/countries')result=[{code:'AR',displayName:'Argentina'}];
  else if(path==='/me/profile'){
    if(method==='PATCH') current.profileStatus='DRAFT';
    result={id:'p',userId:'me',status:current.profileStatus??'ACTIVE',displayName:'Lucía',birthDate:'1995-01-01',gender:'MALE',lookingForGenders:['FEMALE'],intention:'DATE',city:'Fixture',countryCode:'AR',bio:'Bio sintética',preferredMinAge:18,preferredMaxAge:45,maxDistanceKm:50,authenticityVerificationStatus:'STALE'};
  }
  else if(path==='/me/home')result={profileStatus:'ACTIVE',matchmaking:{inQueue:current.inQueue,canSearch:true,blockedReason:null},activeInteractionsSummary:{activeInitialCount:current.kind==='chat'?1:0,activeConnectionCount:0,actionableConnectionCount:0,hasPendingSchedulingConnection:false},pendingActions:current.kind==='chat'?[{type:'FIRST_CHAT',matchId:'m',chatId:'c'}]:current.hasActivity?[{type:'VISUAL_REVIEW',matchId:'v',chatId:null}]:[],nextSteps:[],passiveNotices:current.passive};
  else if(path==='/matchmaking/queue'){if(method==='POST')current.inQueue=true;if(method==='DELETE')current.inQueue=false;result={userId:'me',inQueue:current.inQueue};}
  else {status=404;result={code:'SYNTHETIC_NOT_FOUND'};}
  res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const dir = await mkdtemp(join(tmpdir(),'reals-chat-smoke-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${dir}`,'--autoplay-policy=no-user-gesture-required','about:blank'],{ windowsHide:true, stdio:'ignore' });
let ws;
try {
  let target;
  for(let i=0;i<60;i++) { try { const port=(await readFile(join(dir,'DevToolsActivePort'),'utf8')).split('\n')[0].trim(); const list=await (await fetch(`http://127.0.0.1:${port}/json`)).json(); target=list.find(t=>t.type==='page'); if(target) break; } catch {} await new Promise(r=>setTimeout(r,100)); }
  if(!target) throw new Error('Chrome did not start');
  ws=new WebSocket(target.webSocketDebuggerUrl); await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  let id=0; const pending=new Map(); ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id){const p=pending.get(m.id); pending.delete(m.id); m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params}));});
  let acceptDialog=false; await call('Page.enable'); ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Page.javascriptDialogOpening')void call('Page.handleJavaScriptDialog',{accept:acceptDialog});});
  await call('Network.enable');const network=[];ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Network.requestWillBeSent')network.push(m.params.type);});
  await call('Page.navigate',{url:'http://127.0.0.1:5174'}); await new Promise(r=>setTimeout(r,1800));
  const evaluate = async expression => {const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  const delay=ms=>new Promise(r=>setTimeout(r,ms));

  const evidence=[];const check=(v,label)=>{if(!v)throw Error(label);console.log('PASS',label);};
  const mountFixture = `(async()=>{const {default:React}=await import('/node_modules/.vite/deps/react.js'),{default:ReactDOM}=await import('/node_modules/.vite/deps/react-dom_client.js'),{App}=await import('/src/App.tsx'),{ApiClient}=await import('/src/auth/api.ts');document.getElementById('root').style.display='none';const el=document.createElement('div');document.body.append(el);window.mountCount=0;window.cleanupCount=0;window.visibilityLog=[];document.addEventListener('visibilitychange',()=>visibilityLog.push(document.visibilityState));let root;function Probe(){React.useEffect(()=>{mountCount++;return()=>cleanupCount++;},[]);return React.createElement(App,{firebase:{service:{observe:next=>{next({uid:'fixture',emailVerified:true,getIdToken:async()=>'synthetic',reload:async()=>{}});return()=>{}},signOut:async()=>{window.signouts=(window.signouts??0)+1}},localVerification:false},api:new ApiClient((path,options)=>fetch(${JSON.stringify(origin)}+String(path).slice(4),options))});}window.renderFixture=()=>{root?.unmount();root=ReactDOM.createRoot(el);root.render(React.createElement(React.StrictMode,null,React.createElement(Probe)));};Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:ok=>ok({coords:{latitude:12,longitude:-21,accuracy:25},timestamp:Date.now()})}});renderFixture();})()`; await evaluate(mountFixture);
  const click=async selector=>{await evaluate('document.querySelector('+JSON.stringify(selector)+').scrollIntoView({block:"center"})');const p=await evaluate('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');await call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});await delay(40);};
  const waitFor=async(expression,label)=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(40);}throw Error(label);};
  await mkdir('artifacts/affinities',{recursive:true});const screenshot=async name=>writeFile('artifacts/affinities/'+name+'.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));

  const textClick=async text=>{await evaluate(`Array.from(document.querySelectorAll('button')).find(n=>n.getClientRects().length&&n.textContent===${JSON.stringify(text)}).click()`);};
  const visible=text=>`Array.from(document.querySelectorAll('body *')).some(n=>n.getClientRects().length&&n.textContent===${JSON.stringify(text)})`;
  for(const [width,height] of [[390,844],[1440,900]]){
    reset();await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<768});await evaluate('renderFixture()');
    await waitFor("!!document.querySelector('button[aria-label=Afinidades]')&&!document.querySelector('button[aria-label=Afinidades]').disabled",'Home loaded');
    await click('button[aria-label=Afinidades]');await waitFor(visible('Empezar'),'overview');await textClick('Explorar por categoría');await waitFor(visible('Empezar categoría'),'categories');await screenshot('categories-'+width);await textClick('Empezar categoría');await waitFor(visible('Pregunta a'),'question');await screenshot('question-'+width);
    await textClick('Omitir');await waitFor(visible('Pregunta b'),'skip');await textClick('Volver');await waitFor(visible('Empezar categoría'),'category parent');await textClick('Volver');await waitFor(visible('Empezar'),'overview parent');await textClick('Empezar');await waitFor(visible('Pregunta a'),'revisit');
    await click('input[type=radio][name=a]');await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40});check(await evaluate("document.querySelectorAll('input[type=radio]')[1].checked&&document.activeElement===document.querySelectorAll('input[type=radio]')[1]"),'radio keyboard and stable focus '+width);const historyLength=await evaluate('history.length');
    await textClick('Siguiente');await waitFor(visible('Pregunta b'),'saved advance');check(await evaluate('history.length')===historyLength,'automatic advance replaces history '+width);
    await textClick('Volver');await waitFor(visible('Revisar mis respuestas'),'overview after save');await textClick('Revisar mis respuestas');await waitFor(visible('Editar respuesta'),'review');await screenshot('review-'+width);await textClick('Editar respuesta');await waitFor(visible('Guardar cambios')+'||'+visible('Volver a mis respuestas'),'edit');
    await evaluate("document.querySelectorAll('input[type=radio]')[0].click()");await textClick('Guardar cambios');await waitFor(visible('Editar respuesta'),'edit saved');
    await evaluate('history.back()');await waitFor(visible('Revisar mis respuestas'),'browser Back');await evaluate('history.forward()');await waitFor(visible('Editar respuesta'),'browser Forward');
    await textClick('Editar respuesta');await waitFor(visible('Quitar respuesta'),'removal');await textClick('Quitar respuesta');await waitFor(visible('Todavía no hay respuestas para revisar.'),'removed');
    await textClick('Volver');await waitFor(visible('Empezar'),'overview empty');await textClick('Empezar');await waitFor(visible('Pregunta a'),'delayed write question');await click('input[type=radio]');fixture.writeDelay=600;await textClick('Siguiente');await textClick('Volver');await waitFor(visible('Explorar por categoría'),'pending write Back');await delay(900);check(await evaluate(visible('Explorar por categoría')),'late completion does not navigate '+width);
    await textClick('Volver a Inicio');await waitFor("history.state.trail.at(-1)==='home'",'return Home');await waitFor(visible('1 de 3 respondidas'),'shared authoritative progress');
    await call('Page.reload');await delay(900);await evaluate(mountFixture);await waitFor(visible('1 de 3 respondidas'),'reload authoritative progress');await click('button[aria-label=Afinidades]');await waitFor(visible('Continuar'),'reopened');
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});check(await evaluate("document.activeElement.tagName==='BUTTON'"),'keyboard focus '+width);
    check(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'no horizontal overflow '+width);await screenshot('overview-'+width);
    evidence.push({width,writes:fixture.writes.length});
  }
  await writeFile('artifacts/affinities/results.json',JSON.stringify(evidence,null,2));
} finally { server.closeAllConnections();server.close();ws?.close();chrome.kill();await new Promise(r=>setTimeout(r,500));if(!resolve(dir).startsWith(resolve(tmpdir())+sep)||!dir.includes('reals-chat-smoke-'))throw Error('Unsafe temporary directory');await rm(dir,{recursive:true,force:true,maxRetries:5}); }
