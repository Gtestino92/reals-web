import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
let fixture;const requests=[];
const charMap = {
  '<': '\\u003C',
  '>': '\\u003E',
  '/': '\\u002F',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
  '\0': '\\0',
  '\u2028': '\\u2028',
  '\u2029': '\\u2029'
};
function escapeUnsafeChars(str){return str.replace(/[<>\/\\\b\f\n\r\t\0\u2028\u2029]/g,x=>charMap[x]);}
function reset(kind='home'){fixture={kind,version:1,delay:0,expire:false,matchState:'CHAT_ACTIVE',partner:'PENDING',mine:'PENDING',inQueue:false,holdRead:false,passive:[],writes:[]};}
reset();
const server=createServer(async(req,res)=>{const current=fixture;
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization');res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS');if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  const path=req.url,method=req.method;requests.push({path,method});if(current.delay&&method==='GET')await new Promise(r=>setTimeout(r,current.delay));
  let body='';for await(const chunk of req)body+=chunk;let result;let status=200;
  if(path===current.failPath){status=503;result={code:'SERVICE_UNAVAILABLE'};}
  else if(path==='/reference/affinity-questions')result={catalogVersion:'v1',categories:[],questions:[]};
  else if(path==='/me/profile/affinity-answers')result={answers:[]};
  else if(path==='/reference/profile-questions')result={catalogVersion:'v1',questions:[{id:'Q',prompt:'Pregunta sintética',displayOrder:1,semanticVersion:1,contentVersion:1}]};
  else if(path==='/me/profile/question-answers')result={answers:[]};
  else if(path==='/me/home/status'){if(current.failHome){status=503;result={code:'SERVICE_UNAVAILABLE'};}else result={version:current.version,dirty:false,nextRefreshAt:null,serverTime:new Date().toISOString()};}
  else if(path==='/me'){
    if(method==='DELETE'){current.deletions=(current.deletions??0)+1;if(current.failDeletion){current.deleted=true;status=503;result={code:'SERVICE_UNAVAILABLE'};}else result=undefined;}
    else result={id:'me',status:current.deleted?'DELETED':'ACTIVE'};
  }
  else if(path==='/me/notification-preferences'){if(method==='PUT')current.preferences=JSON.parse(body);result=current.preferences??{activityEnabled:true,remindersEnabled:false,availabilityEnabled:true};}
  else if(path==='/reference/countries')result=[{code:'AR',displayName:'Argentina'}];
  else if(path==='/me/legal-status')result={requirementsSatisfied:true,documents:[]};
  else if(path==='/legal/documents/current')result={documents:[]};
  else if(path==='/me/profile/photos')result=[];
  else if(path==='/me/profile'){
    if(method==='PATCH') current.profileStatus='DRAFT';
    result={id:'p',userId:'me',status:current.profileStatus??'ACTIVE',displayName:'Lucía',birthDate:'1995-01-01',gender:'MALE',lookingForGenders:['FEMALE'],intention:'DATE',city:'Fixture',countryCode:'AR',bio:'Bio sintética',preferredMinAge:18,preferredMaxAge:45,maxDistanceKm:50,authenticityVerificationStatus:'STALE'};
  }
  else if(path==='/me/home')result={profileStatus:'ACTIVE',matchmaking:{inQueue:current.inQueue,canSearch:true,blockedReason:null},activeInteractionsSummary:{activeInitialCount:current.kind==='chat'?1:0,activeConnectionCount:0,actionableConnectionCount:0,hasPendingSchedulingConnection:false},pendingActions:current.kind==='chat'?[{type:'FIRST_CHAT',matchId:'m',chatId:'c'}]:current.hasActivity?[{type:'VISUAL_REVIEW',matchId:'v',chatId:null}]:[],nextSteps:[],passiveNotices:current.passive};
  else if(path==='/matchmaking/queue'){if(method==='POST')current.inQueue=true;if(method==='DELETE')current.inQueue=false;result={userId:'me',inQueue:current.inQueue};}
  else if(path==='/matches/m')result={id:'m',userAId:'me',userBId:'them',state:current.matchState};
  else if(path==='/matches/m/chat'){if(current.expire){status=409;result={code:current.expiryCode??'CHAT_EXPIRED'};}else result={id:'c',matchId:'m',chatType:'FIRST_CHAT',status:'ACTIVE',partner:{userId:'them',displayName:'Marcus'},myDecision:current.mine,partnerDecision:current.partner,timeoutAt:new Date(Date.now()+600000).toISOString(),inactivityExpiresAt:new Date(Date.now()+300000).toISOString(),serverTime:new Date().toISOString(),guidance:{question:{id:'q',instanceId:'q1',text:'¿Qué te inspira?'},questionOrdinal:1,maxQuestions:3,requiredParticipationScore:100,directQuestionReplyMultiplier:2,progressionAction:'NEXT_QUESTION',canRequestNext:true,myNextRequested:false,completed:false},audioPolicy:null};}
  else if(path.startsWith('/chats/c/messages?'))result=Array.from({length:30},(_,i)=>({id:String(i+1),chatSessionId:'c',senderId:i%2?'me':'them',clientMessageId:null,messageType:'TEXT',content:'Mensaje sintético de conversación '+(i+1),replyTo:null,reactionType:null,audio:null,sentAt:new Date(1000000+i*1000).toISOString()}));
  else if(path==='/chats/c/exit-requests')result=[];
  else if(path==='/matches/m/chat-decision'){current.writes.push(JSON.parse(body));await new Promise(r=>setTimeout(r,current.writeDelay??0));if(current.failDecision){res.writeHead(409,{'Content-Type':'application/json'});res.end(JSON.stringify({code:'CHAT_APPROVAL_TOO_EARLY'}));return;}current.mine=JSON.parse(body).decision;if(current.mine==='REJECTED')current.matchState='CHAT_REJECTED';else if(current.partner==='APPROVED')current.matchState='VISUAL_PHASE';current.version++;result={id:'m',state:current.matchState};}
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

  const baseline=process.argv.includes('--baseline'),evidence=[];const check=(v,label)=>{if(!v&&!baseline)throw Error(label);console.log(baseline?'MEASURE':'PASS',label);};
  await evaluate(`(async()=>{const {default:React}=await import('/node_modules/.vite/deps/react.js'),{default:ReactDOM}=await import('/node_modules/.vite/deps/react-dom_client.js'),{App}=await import('/src/App.tsx'),{ApiClient}=await import('/src/auth/api.ts');document.getElementById('root').style.display='none';const el=document.createElement('div');document.body.append(el);window.mountCount=0;window.cleanupCount=0;window.visibilityLog=[];document.addEventListener('visibilitychange',()=>visibilityLog.push(document.visibilityState));let root;function Probe(){React.useEffect(()=>{mountCount++;return()=>cleanupCount++;},[]);return React.createElement(App,{firebase:{service:{observe:next=>{next({uid:'fixture',emailVerified:true,getIdToken:async()=>'synthetic',reload:async()=>{}});return()=>{}},signOut:async()=>{window.signouts=(window.signouts??0)+1}},localVerification:false},api:new ApiClient((path,options)=>fetch(${escapeUnsafeChars(JSON.stringify(origin))}+String(path).slice(4),options))});}window.renderFixture=()=>{root?.unmount();root=ReactDOM.createRoot(el);root.render(React.createElement(React.StrictMode,null,React.createElement(Probe)));};Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:ok=>ok({coords:{latitude:12,longitude:-21,accuracy:25},timestamp:Date.now()})}});renderFixture();})()`);
  const click=async selector=>{await evaluate('document.querySelector('+JSON.stringify(selector)+').scrollIntoView({block:"center"})');const p=await evaluate('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');await call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});await delay(40);};
  const waitFor=async(expression,label)=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(40);}throw Error(label);};
  const sample=async(selector)=>evaluate(`(()=>{const e=document.querySelector(${escapeUnsafeForEval(JSON.stringify(selector))}),r=e?.getBoundingClientRect();return{busy:document.querySelector('.home')?.getAttribute('aria-busy'),opacity:e?getComputedStyle(e).opacity:null,background:e?getComputedStyle(e).backgroundColor:null,disabled:e?.disabled,rect:r?.toJSON(),focus:document.activeElement?.tagName+':'+(document.activeElement?.getAttribute('aria-label')??document.activeElement?.id??''),focusPreserved:document.activeElement===window.focusedControl,scroll:document.querySelector('.chat-timeline')?.scrollTop,mountCount,cleanupCount,documents:performance.getEntriesByType('navigation').length};})()`);
  const tabAway=async()=>{const other=await call('Target.createTarget',{url:'about:blank'});await call('Target.activateTarget',{targetId:other.targetId});await delay(80);check(await evaluate("document.visibilityState==='hidden'"),'real Chrome tab hidden');return other;};
  const tabBack=async(other)=>{await call('Target.activateTarget',{targetId:target.id});await delay(60);check(await evaluate("document.visibilityState==='visible'"),'real Chrome tab visible');await call('Target.closeTarget',{targetId:other.targetId});};
  await mkdir('artifacts/navigation-flicker',{recursive:true});const screenshot=async name=>writeFile('artifacts/navigation-flicker/'+name+'.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));

  const unsafeEvalCharMap={'<':'\\u003C','>':'\\u003E','/':'\\u002F','\\':'\\\\','\b':'\\b','\f':'\\f','\n':'\\n','\r':'\\r','\t':'\\t','\0':'\\0','\u2028':'\\u2028','\u2029':'\\u2029'};
  const unsafeEvalCharPattern=/[<>\/\\\b\f\n\r\t\0\u2028\u2029]/g;
  const escapeUnsafeForEval=value=>value.replace(unsafeEvalCharPattern,ch=>unsafeEvalCharMap[ch]??ch);

  const visible = `n=>n.getClientRects().length&&!n.closest('[hidden]')`;
  const button = async name => { await evaluate(`Array.from(document.querySelectorAll('button')).filter(${visible}).find(n=>n.textContent===${JSON.stringify(name)}||n.getAttribute('aria-label')===${JSON.stringify(name)})?.click()`); };
  for(const [width,height] of [[390,844],[1440,900]]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<768});
    for(const surface of (baseline?['Tu perfil','Preferencias']:['Tu perfil','Preferencias','Cuenta','Afinidades','Actividad','Preguntas del perfil','Buscar chat'])) {
      reset(); fixture.hasActivity=true; await evaluate('renderFixture()');
      await waitFor("!!document.querySelector('.home-search button:not(:disabled)')",'Home ready');
      for(const visit of ['first','repeat','failed']) {
        if(surface==='Preguntas del perfil') {
          await button('Tu perfil'); await waitFor("!!document.querySelector('.profile-question-entry button:not(:disabled)')",'profile ready');
        }
        if(surface==='Notificaciones') await button('Cuenta');
        fixture.delay=100; fixture.failPath=visit==='failed'? surface==='Afinidades'?'/reference/affinity-questions':surface==='Preguntas del perfil'?'/reference/profile-questions':surface==='Cuenta'?'/me/notification-preferences':'/me/profile':null;
        const start=requests.length;
        await evaluate(`window.flickerFrames=[];window.frameEnd=performance.now()+1100;window.oldForm=document.querySelector('.onboarding form');window.oldHome=document.querySelector('.home-search');window.oldOrigin=performance.timeOrigin;window.shifts=0;window.shiftObserver?.disconnect();window.shiftObserver=new PerformanceObserver(list=>{for(const e of list.getEntries())shifts+=e.value});shiftObserver.observe({type:'layout-shift',buffered:false});function sampleFlicker(){const headings=Array.from(document.querySelectorAll('h2')).filter(${visible});const panel=document.querySelector('body>div:last-child .login-panel');const r=panel?.getBoundingClientRect();flickerFrames.push({title:headings.at(-1)?.textContent,loadingOnly:!!Array.from(document.querySelectorAll('.session-loading')).find(${visible}),fields:Array.from(document.querySelectorAll('.onboarding input')).filter(${visible}).length,skeleton:!!Array.from(document.querySelectorAll('.home-placeholder')).find(${visible}),x:r?.x,y:r?.y,width:r?.width,height:r?.height,scroll:scrollY,focus:document.activeElement?.tagName});if(performance.now()<frameEnd)requestAnimationFrame(sampleFlicker)}requestAnimationFrame(sampleFlicker)`);
        await button(surface==='Actividad'?'Ver Actividad':surface==='Preguntas del perfil'?'Responder o editar':surface);
        await delay(50); await screenshot(`${baseline?'before':'after'}-${width}-${surface.replaceAll(' ','-')}-${visit}-pending`);
        await delay(1150);
        const result=await evaluate(`({frames:flickerFrames,shifts,sameForm:oldForm===document.querySelector('.onboarding form'),sameHome:oldHome===document.querySelector('.home-search'),sameDocument:oldOrigin===performance.timeOrigin})`);
        check(result.sameDocument&&(['Actividad','Buscar chat'].includes(surface)||result.sameHome),'preserved document and Home '+surface+' '+visit);
        check(result.frames.every(f=>!f.loadingOnly),'no generic loading-only frame '+surface+' '+visit);
        if(visit!=='first'&&['Tu perfil','Preferencias'].includes(surface)) check(result.sameForm&&result.frames.every(f=>!f.skeleton),'retained confirmed form '+surface+' '+visit);
        if(surface==='Preguntas del perfil'&&visit==='repeat') check(!result.frames.some(f=>f.skeleton),'questions retain catalog');
        evidence.push({width,surface,visit,...result,requests:requests.slice(start)});
        fixture.delay=0;fixture.failPath=null;
        // Failed refresh deliberately leaves writes locked. Reconcile before returning.
        if(visit==='failed') {await button('Consultar estado');await button('Reintentar consulta');await delay(400);}
        if(surface==='Preguntas del perfil') { await button('Volver'); await delay(80); }
        if(surface==='Buscar chat') { await button('Cancelar búsqueda');await delay(200); }
        else await button('Volver a Inicio');
        await waitFor("!!document.querySelector('.home-search button:not(:disabled)')&&!document.querySelector('.home-search').closest('[hidden]')",'return Home '+surface);
      }
    }
    if(baseline) continue;
    // Notifications have a stable Account shell and keep confirmed switches on revisit.
    reset();await evaluate('renderFixture()');await waitFor("!!document.querySelector('.home-search button:not(:disabled)')",'notifications Home');await button('Cuenta');
    for(const visit of ['first','repeat','failed']) {fixture.failPath=visit==='failed'?'/me/notification-preferences':null;fixture.delay=200;await button('Notificaciones');await delay(40);await screenshot(`${baseline?'before':'after'}-${width}-notifications-${visit}`);if(visit!=='first')check(await evaluate("document.querySelectorAll('.account-notifications input').length===3"),'retained notification switches');await waitFor("document.querySelectorAll('.account-notifications input').length===3&&!document.querySelector('.account-notifications button').disabled",'notifications loaded');await button('Volver a Cuenta');await delay(100);check(await evaluate("document.activeElement?.textContent==='Notificaciones'"),'notification focus restored');}
    reset('chat');await evaluate('renderFixture()');await waitFor("!!document.querySelector('.chat-timeline')",'actual First Chat');
    await evaluate("window.chatHome=document.querySelector('.home-search');void 0");
    await screenshot(`after-${width}-chat`);
    fixture.delay=120;fixture.expire=true;fixture.kind='home';fixture.version++;
    await evaluate("document.dispatchEvent(new Event('visibilitychange'))");
    await waitFor("!document.querySelector('.first-chat')&&!!document.querySelector('.home-search button:not(:disabled)')",'terminal Chat returns Home');
    check(await evaluate("chatHome===document.querySelector('.home-search')"),'Chat return retains confirmed Home');
  }
  await writeFile('artifacts/navigation-flicker/'+(baseline?'before':'after')+'.json',JSON.stringify(evidence,null,2));
} finally { server.closeAllConnections();server.close();ws?.close(); chrome.kill(); await new Promise(r=>setTimeout(r,500)); if(!resolve(dir).startsWith(resolve(tmpdir())+sep)||!dir.includes('reals-chat-smoke-'))throw Error('Unsafe temporary directory');await rm(dir,{recursive:true,force:true,maxRetries:5}).catch(()=>{}); }
