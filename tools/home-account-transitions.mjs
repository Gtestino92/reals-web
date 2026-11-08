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
  if(path==='/me/home/status')result={version:current.version,dirty:false,nextRefreshAt:null,serverTime:new Date().toISOString()};
  else if(path==='/me')result={id:'me',status:'ACTIVE'};
  else if(path==='/me/notification-preferences'){if(method==='PUT')current.preferences=JSON.parse(body);result=current.preferences??{activityEnabled:true,remindersEnabled:false,availabilityEnabled:true};}
  else if(path==='/reference/countries')result=[{code:'AR',displayName:'Argentina'}];
  else if(path==='/me/legal-status')result={requirementsSatisfied:true,documents:[]};
  else if(path==='/legal/documents/current')result={documents:[]};
  else if(path==='/me/profile/photos')result=[];
  else if(path==='/me/profile'){
    if(method==='PATCH') current.profileStatus='DRAFT';
    result={id:'p',userId:'me',status:current.profileStatus??'ACTIVE',displayName:'Lucía',birthDate:'1995-01-01',gender:'MALE',lookingForGenders:['FEMALE'],intention:'DATE',city:'Fixture',countryCode:'AR',bio:'Bio sintética',preferredMinAge:18,preferredMaxAge:45,maxDistanceKm:50,authenticityVerificationStatus:'STALE'};
  }
  else if(path==='/me/home')result={profileStatus:'ACTIVE',matchmaking:{inQueue:current.inQueue,canSearch:true,blockedReason:null},activeInteractionsSummary:{activeInitialCount:current.kind==='chat'?1:0,activeConnectionCount:0,actionableConnectionCount:0,hasPendingSchedulingConnection:false},pendingActions:current.kind==='chat'?[{type:'FIRST_CHAT',matchId:'m',chatId:'c'}]:[],nextSteps:[],passiveNotices:current.passive};
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
  const sample=async(selector)=>evaluate((sel)=>{const e=document.querySelector(sel),r=e?.getBoundingClientRect();return{busy:document.querySelector('.home')?.getAttribute('aria-busy'),opacity:e?getComputedStyle(e).opacity:null,background:e?getComputedStyle(e).backgroundColor:null,disabled:e?.disabled,rect:r?.toJSON(),focus:document.activeElement?.tagName+':'+(document.activeElement?.getAttribute('aria-label')??document.activeElement?.id??''),focusPreserved:document.activeElement===window.focusedControl,scroll:document.querySelector('.chat-timeline')?.scrollTop,mountCount,cleanupCount,documents:performance.getEntriesByType('navigation').length};},selector);
  const tabAway=async()=>{const other=await call('Target.createTarget',{url:'about:blank'});await call('Target.activateTarget',{targetId:other.targetId});await delay(80);check(await evaluate("document.visibilityState==='hidden'"),'real Chrome tab hidden');return other;};
  const tabBack=async(other)=>{await call('Target.activateTarget',{targetId:target.id});await delay(60);check(await evaluate("document.visibilityState==='visible'"),'real Chrome tab visible');await call('Target.closeTarget',{targetId:other.targetId});};
  const artifactDirectory=process.argv.includes('--management')?'artifacts/home-navigation-polish/regression':'artifacts/home-account';
  await mkdir(artifactDirectory,{recursive:true});const screenshot=async name=>writeFile(artifactDirectory+'/'+name+'.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  for(const [width,height] of [[390,844],[1440,900]]){
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<768});reset();await evaluate('renderFixture()');await waitFor("!!document.querySelector('.home-search button:not(:disabled)')&&!document.querySelector('.home-search')?.closest('[hidden]')",'Home ready');
    await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Afinidades')).click()");
    await delay(80);fixture.delay=180;
    await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Volver a Inicio').click()");
    await delay(50);const transition=await evaluate("({loading:document.body.textContent.includes('Actualizando Inicio'),greeting:!!document.querySelector('.home-heading p'),search:!!document.querySelector('.home-search'),homeNodes:document.querySelectorAll('.home').length})");
    await delay(900);fixture.delay=0;evidence.push({width,transition});
    if(!baseline) {
      check(transition.search && transition.greeting, 'retained Home while reconciling');
      await waitFor("!!document.querySelector('.home-search button:not(:disabled)')&&!document.querySelector('.home-search')?.closest('[hidden]')",'returned Home');
      const homeNode=await evaluate("(window.homeNode=document.querySelector('.home'),true)");
      await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Afinidades')).click()");
      await evaluate('history.back()');
      await waitFor("!!document.querySelector('.home-search button:not(:disabled)')&&!document.querySelector('.home-search')?.closest('[hidden]')&&!document.querySelector('.home-search').closest('[hidden]')",'browser Back returns Home');
      check(homeNode&&await evaluate("homeNode===document.querySelector('.home')"),'browser Back retains Home node');
      await evaluate("document.querySelector('button[aria-label=Cuenta]').click()");
      await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Notificaciones'&&b.getClientRects().length).click()");
      await waitFor("document.querySelectorAll('.home-account input[type=checkbox]').length===3",'preferences loaded');
      const start=requests.length;
      await evaluate("(()=>{const input=document.querySelector('.home-account input[type=checkbox]');input.click();input.click()})()");
      await delay(150);
      check(requests.slice(start).filter(r=>r.method==='PUT').length===1,'notification duplicate excluded');
      check(!await evaluate('document.documentElement.scrollWidth>innerWidth'),'no horizontal overflow');
      await screenshot('account-'+width);
      reset();await evaluate('renderFixture()');await waitFor("!!document.querySelector('.home-search button:not(:disabled)')&&!document.querySelector('.home-search')?.closest('[hidden]')",'profile Home');
      await evaluate("document.querySelector('[aria-label=\"Tu perfil\"]').click()");
      await waitFor("!!document.querySelector('.onboarding .profile-submit:not(:disabled)')",'profile loaded');
      check(await evaluate("!!(document.querySelector('.onboarding form').compareDocumentPosition(document.querySelector('summary'))&Node.DOCUMENT_POSITION_FOLLOWING)"),'profile details precede photos');
      await screenshot('profile-'+width);
      await evaluate("document.querySelector('.profile-submit').click()");
      await waitFor("document.body.textContent.includes('Estado: DRAFT')&&!!document.querySelector('.profile-submit:not(:disabled)')",'draft reconciliation stays in editor');
      check(await evaluate("!!document.querySelector('form[aria-label=\"Datos del perfil\"]')&&!Array.from(document.querySelectorAll('h2')).some(h=>h.textContent==='Completá tu perfil')"),'authoritative draft does not flash setup');
      reset();await evaluate('renderFixture()');await waitFor("!!document.querySelector('.home-search button:not(:disabled)')&&!document.querySelector('.home-search')?.closest('[hidden]')",'preferences Home');
      await evaluate("document.querySelector('[aria-label=Preferencias]').click()");
      await waitFor("!!document.querySelector('.onboarding .profile-submit:not(:disabled)')",'preferences loaded');
      check(await evaluate("!document.querySelector('.onboarding details')"),'management preferences non-collapsible');
      await screenshot('preferences-'+width);
      reset();await evaluate('window.signouts=0;renderFixture()');await waitFor("!!document.querySelector('.home-search button:not(:disabled)')&&!document.querySelector('.home-search')?.closest('[hidden]')",'account Home');
      check(!await evaluate("Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Cerrar sesión'&&b.getClientRects().length)"),'no global sign-out');
      await evaluate("document.querySelector('button[aria-label=Cuenta]').focus()");
      await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',windowsVirtualKeyCode:13});
      await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
      await waitFor("!!document.querySelector('.home-account')?.getClientRects().length",'keyboard expansion');
      acceptDialog=false;await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Cerrar sesión'&&b.getClientRects().length).click()");await delay(80);
      check(await evaluate('signouts===0'),'cancel native confirmation keeps session');
      acceptDialog=true;await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Cerrar sesión'&&b.getClientRects().length).click()");
      await waitFor("document.body.textContent.includes('Ingresar')&&!document.querySelector('.home')",'confirmed sign-out');
      check(await evaluate('signouts===1'),'confirmed sign-out occurs once');
      for(const scenario of ['quick','delayed','error']) {
        reset('chat');fixture.writeDelay=scenario==='delayed'?650:0;fixture.failDecision=scenario==='error';
        await evaluate('renderFixture()');await waitFor("!!document.querySelector('.chat-approve:not(:disabled)')",'chat ready');
        const started=Date.now();await click('.chat-approve');
        const pending=await evaluate("document.querySelector('.chat-approve')?.textContent.includes('Aprobando')");
        if(scenario==='delayed') await screenshot('approval-pending-'+width);
        if(scenario!=='error') await evaluate("document.querySelector('.chat-approve')?.click()");
        if(scenario==='error') {
          await waitFor("!!document.querySelector('.first-chat [role=alert]')",'immediate actionable error');
          check(fixture.writes.length===1,'error never replays decision');
        } else {
          check(pending,'approval progress is perceptible');
          await waitFor("!!document.querySelector('.home-search button:not(:disabled)')&&!document.querySelector('.home-search')?.closest('[hidden]')",'authoritative return Home');
          check(fixture.writes.length===1,'decision duplicate excluded');
          check(await evaluate("document.body.textContent.includes('Tu decisión quedó registrada.')&&!document.body.textContent.includes('Ambas personas aprobaron')"),'neutral decision feedback');
          check(!await evaluate("!!document.querySelector('.first-chat')"),'approved chat suppressed');
        }
        evidence.push({width,scenario,pending,elapsed:Date.now()-started,writes:fixture.writes.length});
      }
    }
  }

  const result={evidence,visibility:await evaluate('visibilityLog'),networkTypes:network,documentRequests:network.filter(type=>type==='Document').length};await writeFile(artifactDirectory+'/'+(process.argv.includes('--notice')?'notice-polish':baseline?'before':'after')+'.json',JSON.stringify(result,null,2));
} finally { server.closeAllConnections();server.close();ws?.close(); chrome.kill(); await new Promise(r=>setTimeout(r,500)); if(!resolve(dir).startsWith(resolve(tmpdir())+sep)||!dir.includes('reals-chat-smoke-'))throw Error('Unsafe temporary directory');await rm(dir,{recursive:true,force:true,maxRetries:5}).catch(()=>{}); }
