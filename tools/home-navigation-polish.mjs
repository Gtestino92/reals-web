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

  const baseline=process.argv.includes('--baseline'),evidence=[];const check=(v,label)=>{if(!v)throw Error(label);console.log('PASS',label);};
  await evaluate(`(async()=>{const {default:React}=await import('/node_modules/.vite/deps/react.js'),{default:ReactDOM}=await import('/node_modules/.vite/deps/react-dom_client.js'),{App}=await import('/src/App.tsx'),{ApiClient}=await import('/src/auth/api.ts');document.getElementById('root').style.display='none';const el=document.createElement('div');document.body.append(el);window.mountCount=0;window.cleanupCount=0;window.visibilityLog=[];document.addEventListener('visibilitychange',()=>visibilityLog.push(document.visibilityState));let root;function Probe(){React.useEffect(()=>{mountCount++;return()=>cleanupCount++;},[]);return React.createElement(App,{firebase:{service:{observe:next=>{next({uid:'fixture',emailVerified:true,getIdToken:async()=>'synthetic',reload:async()=>{}});return()=>{}},signOut:async()=>{window.signouts=(window.signouts??0)+1}},localVerification:false},api:new ApiClient((path,options)=>fetch(${JSON.stringify(origin)}+String(path).slice(4),options))});}window.renderFixture=()=>{root?.unmount();root=ReactDOM.createRoot(el);root.render(React.createElement(React.StrictMode,null,React.createElement(Probe)));};Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:ok=>ok({coords:{latitude:12,longitude:-21,accuracy:25},timestamp:Date.now()})}});renderFixture();})()`);
  const click=async selector=>{await evaluate('document.querySelector('+JSON.stringify(selector)+').scrollIntoView({block:"center"})');const p=await evaluate('(()=>{const r=document.querySelector('+JSON.stringify(selector)+').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()');await call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});await delay(40);};
  const waitFor=async(expression,label)=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(40);}throw Error(label);};
  const sample=async(selector)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e?.getBoundingClientRect();return{busy:document.querySelector('.home')?.getAttribute('aria-busy'),opacity:e?getComputedStyle(e).opacity:null,background:e?getComputedStyle(e).backgroundColor:null,disabled:e?.disabled,rect:r?.toJSON(),focus:document.activeElement?.tagName+':'+(document.activeElement?.getAttribute('aria-label')??document.activeElement?.id??''),focusPreserved:document.activeElement===window.focusedControl,scroll:document.querySelector('.chat-timeline')?.scrollTop,mountCount,cleanupCount,documents:performance.getEntriesByType('navigation').length};})()`);
  const tabAway=async()=>{const other=await call('Target.createTarget',{url:'about:blank'});await call('Target.activateTarget',{targetId:other.targetId});await delay(80);check(await evaluate("document.visibilityState==='hidden'"),'real Chrome tab hidden');return other;};
  const tabBack=async(other)=>{await call('Target.activateTarget',{targetId:target.id});await delay(60);check(await evaluate("document.visibilityState==='visible'"),'real Chrome tab visible');await call('Target.closeTarget',{targetId:other.targetId});};
  await mkdir('artifacts/home-navigation-polish',{recursive:true});const screenshot=async name=>writeFile('artifacts/home-navigation-polish/'+name+'.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  for(const [width,height] of [[390,844],[1440,900]]){
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<768});
    const sample=async()=>evaluate(`(()=>{const panel=document.querySelector('body>div:last-child .login-panel'), headings=Array.from(document.querySelectorAll('h2')).filter(n=>n.getClientRects().length),backs=Array.from(document.querySelectorAll('button')).filter(n=>n.textContent==='Volver a Inicio'&&n.getClientRects().length);return{panel:panel?.getBoundingClientRect().toJSON(),heading:headings.at(-1)?.getBoundingClientRect().toJSON(),title:headings.at(-1)?.textContent,backs:backs.map(n=>({rect:n.getBoundingClientRect().toJSON(),header:n.parentElement.tagName})),loading:!!document.querySelector('.session-loading'),homeUpdating:Array.from(document.querySelectorAll('[role=status]')).some(n=>n.getClientRects().length&&n.textContent.includes('Actualizando Inicio')),scroll:scrollY}})()`);
    const frames=async action=>{
      await evaluate(`window.transitionFrames=[];window.captureUntil=performance.now()+1400;function recordTransition(){const el=document.querySelector('body>div:last-child .login-panel'),headings=Array.from(document.querySelectorAll('h2')).filter(n=>n.getClientRects().length),h=headings.at(-1),r=el?.getBoundingClientRect();transitionFrames.push({x:r?.x,y:r?.y,width:r?.width,title:h?.textContent,headingY:h?.getBoundingClientRect().y,loading:!!document.querySelector('.session-loading'),homeUpdating:Array.from(document.querySelectorAll('[role=status]')).some(n=>n.getClientRects().length&&n.textContent.includes('Actualizando Inicio')),scroll:scrollY});if(performance.now()<captureUntil)requestAnimationFrame(recordTransition)}requestAnimationFrame(recordTransition)`);
      await action();await delay(1500);return evaluate('transitionFrames.filter((f,i,a)=>!i||JSON.stringify(f)!==JSON.stringify(a[i-1]))');
    };
    for(const surface of ['Tu perfil','Preferencias','Afinidades',...(!baseline?['Cuenta']:[])]){
      reset();await evaluate('renderFixture()');await waitFor("!!document.querySelector('.home-search button:not(:disabled)')",'Home ready');
      const before=await sample();fixture.delay=180;
      const entering=await frames(()=>evaluate(`document.querySelector(${JSON.stringify('button[aria-label='+JSON.stringify(surface)+']')}).click()`));
      const loaded=await sample();await screenshot((baseline?'before':'after')+'-'+width+'-'+surface.replaceAll(' ','-'));
      const returning=await frames(()=>evaluate("Array.from(document.querySelectorAll('button')).find(n=>n.textContent==='Volver a Inicio'&&n.getClientRects().length).click()"));
      const returned=await sample();fixture.delay=0;
      if(!baseline){check(entering.every(f=>Math.abs(f.x-before.panel.x)<1&&Math.abs(f.width-before.panel.width)<1&&Math.abs(f.y-before.panel.y)<1),'stable panel entering '+surface);check(returning.every(f=>Math.abs(f.x-before.panel.x)<1&&Math.abs(f.width-before.panel.width)<1&&Math.abs(f.y-before.panel.y)<1),'stable panel returning '+surface);check(returning.every(f=>!f.homeUpdating),'no transient Home loading row');check(loaded.backs.length===1&&loaded.backs[0].header==='HEADER','single header Back '+surface);}
      evidence.push({width,surface,before,entering,loaded,returning,returned});
    }
    if(!baseline){
      reset();await evaluate('renderFixture()');await waitFor("!!document.querySelector('.home-search button:not(:disabled)')",'history Home');
      const length=await evaluate('history.length');
      for(let i=0;i<3;i++){
        await evaluate("document.querySelector('button[aria-label=Cuenta]').click()");await waitFor("!!document.querySelector('.home-account')?.getClientRects().length",'Account opened');
        await evaluate("Array.from(document.querySelectorAll('button')).find(n=>n.textContent==='Volver a Inicio'&&n.getClientRects().length).click()");
        await waitFor("history.state.trail.length===1&&!document.querySelector('.home-search').closest('[hidden]')",'explicit return consumes entry');
        await waitFor("!!document.querySelector('.home-search button:not(:disabled)')",'Home reconciliation before Forward');await evaluate('history.forward()');await waitFor("history.state.trail.at(-1)==='account'&&!!document.querySelector('.home-account')?.getClientRects().length",'Forward restores Account');
        await evaluate('history.back()');await waitFor("history.state.trail.length===1",'Back restores Home');
        await waitFor("!!document.querySelector('.home-search button:not(:disabled)')",'reconciled Home');
      }
      check(await evaluate(`history.length<=${length}+1`),'repeated open/return/Back/Forward does not accumulate entries');
      reset();fixture.hasActivity=true;await evaluate('renderFixture()');await waitFor("!!document.querySelector('button[aria-label=\"Ver Actividad\"]')",'Activity Home');
      await evaluate("document.querySelector('button[aria-label=\"Ver Actividad\"]').click()");await waitFor("history.state.trail.at(-1)==='activity'",'Activity opened');
      await evaluate("Array.from(document.querySelectorAll('button')).find(n=>n.textContent==='Volver a Inicio'&&n.getClientRects().length).click()");await waitFor("history.state.trail.length===1",'Activity explicit return');
      await evaluate('history.forward()');await waitFor("history.state.trail.at(-1)==='activity'",'Forward restores Activity');
      await evaluate('history.back()');await waitFor("history.state.trail.length===1",'Back restores Activity Home');
      await evaluate("document.querySelector('button[aria-label=Cuenta]').click()");await waitFor("!!document.querySelector('.home-account')?.getClientRects().length",'Account for nested history');
      await evaluate("Array.from(document.querySelectorAll('button')).find(n=>n.textContent==='Notificaciones'&&n.getClientRects().length).click()");await waitFor("document.querySelectorAll('.home-account input').length===3",'notifications loaded');
      await evaluate('history.back()');await waitFor("history.state.trail.at(-1)==='account'&&!document.querySelector('.account-notifications')",'Back restores Account only');
      await evaluate('history.forward()');await waitFor("!!document.querySelector('.account-notifications')",'Forward restores notifications');
      await evaluate("Array.from(document.querySelectorAll('button')).find(n=>n.textContent==='Volver a Cuenta').click()");await waitFor("history.state.trail.at(-1)==='account'",'explicit nested return');
      reset();fixture.failHome=true;await evaluate('window.signouts=0;renderFixture()');await waitFor("!!document.querySelector('.home [role=alert]')",'initial Home failure');
      acceptDialog=true;await evaluate("Array.from(document.querySelectorAll('button')).find(n=>n.textContent==='Cerrar sesión'&&n.getClientRects().length).click()");await evaluate("document.querySelector('dialog .login-primary').click()");await waitFor('signouts===1','recovery sign-out');
      for(const failure of [false,true]){
        reset();fixture.profileStatus='DRAFT';fixture.failDeletion=failure;await evaluate('window.signouts=0;renderFixture()');
        await waitFor("!!document.querySelector('button[aria-label=Cuenta]:not(:disabled)')",'setup Account');
        await evaluate("document.querySelector('button[aria-label=Cuenta]').click()");acceptDialog=true;
        await evaluate("(()=>{const b=Array.from(document.querySelectorAll('button')).find(n=>n.textContent==='Eliminar cuenta');b.click();b.click()})()");
        await evaluate("document.querySelector('dialog .deletion-destructive').click()");
        await waitFor(failure?"!!document.querySelector('.home-account [role=alert]')":"signouts===1",'deletion result');
        check(fixture.deletions===1,'single setup recoverable deletion');
        if(failure){
          check(await evaluate("Array.from(document.querySelectorAll('button')).find(n=>n.textContent==='Eliminar cuenta').disabled&&signouts===0"),'uncertain deletion stays blocked');
          await evaluate("Array.from(document.querySelectorAll('button')).find(n=>n.textContent==='Consultar estado de la cuenta').click()");
          await waitFor("!!document.querySelector('.deletion-recovery')",'authoritative deleted-account recovery');
          check(fixture.deletions===1,'account reconciliation never replays deletion');
        }
      }
      evidence.push({width,historyAndRecovery:'passed'});
    }
  }

  const result={evidence,visibility:await evaluate('visibilityLog'),networkTypes:network,documentRequests:network.filter(type=>type==='Document').length};await writeFile('artifacts/home-navigation-polish/'+(process.argv.includes('--notice')?'notice-polish':baseline?'before':'after')+'.json',JSON.stringify(result,null,2));
} finally { server.closeAllConnections();server.close();ws?.close(); chrome.kill(); await new Promise(r=>setTimeout(r,500)); if(!resolve(dir).startsWith(resolve(tmpdir())+sep)||!dir.includes('reals-chat-smoke-'))throw Error('Unsafe temporary directory');await rm(dir,{recursive:true,force:true,maxRetries:5}).catch(()=>{}); }
