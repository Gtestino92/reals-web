import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
const dir = await mkdtemp(join(tmpdir(),'reals-visual-smoke-'));
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
  await mkdir('artifacts/visual-review',{recursive:true});
  const screenshot=async name=>writeFile('artifacts/visual-review/'+name+'.png',Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  const mediaRequests=[];
  await call('Fetch.enable',{patterns:[{urlPattern:'https://synthetic.example/*'}]});
  ws.addEventListener('message',async event=>{const m=JSON.parse(event.data);if(m.method==='Fetch.requestPaused'){
    mediaRequests.push(m.params.request.url);
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#D6C39A"/><circle cx="200" cy="160" r="65" fill="#31435A"/><path d="M80 470 Q80 270 200 270 Q320 270 320 470" fill="#31435A"/><text x="200" y="490" text-anchor="middle" fill="#0F1F35">Synthetic test image</text></svg>';
    await call('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'image/svg+xml'},{name:'Cache-Control',value:'no-store'}],body:Buffer.from(svg).toString('base64')});
  }});
  await evaluate(`(async()=>{
    const React=await import('/node_modules/.vite/deps/react.js'),ReactDOM=await import('/node_modules/.vite/deps/react-dom_client.js');const {Home}=await import('/src/home/Home.tsx');const {TabGate}=await import('/src/tabs/TabGate.tsx');const {TabOwnershipManager}=await import('/src/tabs/TabOwnershipManager.ts');const {ApiError}=await import('/src/auth/api.ts');await import('/src/styles/tokens.css');await import('/src/styles/global.css');
    document.body.innerHTML='<main class="login-page"><section class="login-panel"><div id="probe"></div></section></main>';
    window.decided=false;window.writes=[];window.signature=0;window.reads=[];window.mode='ok';window.lag=0;window.rev=1;
    const snapshot={phase:'ready',authContextVersion:1,account:{id:'me'},profile:{id:'p',userId:'me',status:'ACTIVE',displayName:'Lucía'}};
    const photo=(id,position)=>({id,position,url:'https://synthetic.example/'+id,moderationStatus:'APPROVED'});
    const profile={myPersonalMessageSubmitted:false,partnerPersonalMessageSubmitted:true,partnerPersonalMessageRead:false,decisionRequiresPartnerPersonalMessageRead:false,profileId:'partner',displayName:'María',age:29,bio:'Me gusta caminar.',visualExpiresAt:'2099-11-12T18:00:00Z',photos:[photo('one',1),photo('two',2),photo('three',3),photo('four',4)],affinityIndicators:[{categoryId:'outdoors',title:'Aire libre'}],profileQuestions:[{questionId:'q',prompt:'¿Tu lugar favorito?',answer:'El bosque',position:0}]};
    const controller={snapshot,getSnapshot:()=>snapshot,subscribe:()=>()=>{},request:async(path,signal,method='GET',body)=>{if(method!=='GET')writes.push({path,method,body});reads.push(path);if(path==='/me/home/status')return {version:rev,dirty:false,nextRefreshAt:null,serverTime:new Date().toISOString()};if(path==='/me/profile')return snapshot.profile;if(path==='/me/home')return {profileStatus:'ACTIVE',matchmaking:{inQueue:false,canSearch:true,blockedReason:null},activeInteractionsSummary:{activeInitialCount:1,activeConnectionCount:0,actionableConnectionCount:0,hasPendingSchedulingConnection:false},pendingActions:decided?[]:[{type:'VISUAL_REVIEW',matchId:'m',visualStartedAt:'2026-11-12T00:00:00Z',visualExpiresAt:profile.visualExpiresAt}],nextSteps:[],passiveNotices:[]};
    if(path.endsWith('/personal-messages/partner')){profile.partnerPersonalMessageRead=true;return {message:'Hola, este es un mensaje sintético.'};}if(path.endsWith('/personal-messages/me')){profile.myPersonalMessageSubmitted=true;return undefined;}if(path.endsWith('/visual-decision')||path.endsWith('/block')){decided=true;rev++;return {id:path.endsWith('/block')?'block':'m',state:'VISUAL_PHASE'};}if(path==='/matches/m'){if(lag)await new Promise(r=>setTimeout(r,lag));if(mode==='expired')throw new ApiError('backend',409,'VISUAL_CONTENT_NOT_AVAILABLE');if(mode==='error')throw new ApiError('network');return {id:'m',userAId:'me',userBId:'them',state:'VISUAL_PHASE'};}if(path==='/matches/m/visual-profile')return {...profile,photos:profile.photos.map(p=>({...p,url:p.url+'?X-Amz-Signature='+signature}))};throw new ApiError('backend',404);}};
    window.owner=new TabOwnershipManager();window.renderFixture=()=>{decided=false;profile.myPersonalMessageSubmitted=false;profile.partnerPersonalMessageRead=false;window.fixtureRoot?.unmount();window.fixtureRoot=ReactDOM.default.createRoot(document.querySelector('#probe'));fixtureRoot.render(React.default.createElement(TabGate,{manager:owner},()=>React.default.createElement(Home,{controller})));};renderFixture();
  })()`);
  const waitFor=async(expression,label)=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(40);}throw Error(label+': '+await evaluate('document.body.innerText'));};
  const click=async selector=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await delay(80);};
  for(const [width,height] of [[390,844],[1440,900]]){
    await evaluate("mode='ok';reads=[];renderFixture()");
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<768});
    await waitFor("!!document.querySelector('.home-activity-entry[aria-label=\"Ver Actividad\"]')",'Home ready');
    await evaluate("window.retained=document.querySelector('.home');void 0");
    await click('[aria-label="Ver Actividad"]');
    await evaluate("document.querySelector('.home:not([hidden])').style.minHeight='1600px';window.scrollTo(0,180);window.savedScroll=scrollY;void 0");
    await evaluate("document.querySelector('.visual-activity').click()");
    await waitFor("!!document.querySelector('.visual-profile')",'profile ready');
    check(await evaluate("Array.from(document.querySelector('.visual-profile').children).map(e=>e.tagName).join(',')==='HEADER,FIGURE,SECTION,FIGURE,SECTION,FIGURE,SECTION,FIGURE'"),'Android Review order '+width);
    check(await evaluate("document.documentElement.scrollWidth<=innerWidth"),'no horizontal overflow '+width);
    await waitFor("document.querySelector('.visual-profile img')?.complete",'first image loaded');
    const before=mediaRequests.filter(url=>url.includes('/one?')).length;
    await evaluate("window.firstImage=document.querySelector('.visual-profile img');window.firstSrc=firstImage.getAttribute('src');window.priorReads=reads.length;signature++;dispatchEvent(new Event('online'));void 0");
    await waitFor("reads.length>priorReads+1&&document.querySelector('.visual-review')?.getAttribute('aria-busy')==='false'",'signed revalidation complete');
    check(await evaluate("firstImage===document.querySelector('.visual-profile img')&&firstImage.getAttribute('src')===firstSrc"),'signature rotation preserves img and src '+width);
    check(mediaRequests.filter(url=>url.includes('/one?')).length===before,'no extra image download '+width);
    check(await evaluate("!reads.some(p=>p.endsWith('/partner'))"),'no unread message GET '+width);
    await evaluate("scrollTo(0,800);window.readingScroll=scrollY;window.readingHeight=document.documentElement.scrollHeight;void 0");
    const other=await call('Target.createTarget',{url:'about:blank'});await call('Target.activateTarget',{targetId:other.targetId});await delay(100);
    check(await evaluate("document.visibilityState==='hidden'&&firstImage.isConnected"),'hidden tab retains image DOM '+width);
    await call('Target.activateTarget',{targetId:target.id});await delay(200);await call('Target.closeTarget',{targetId:other.targetId});
    check(await evaluate("firstImage===document.querySelector('.visual-profile img')"),'foreground keeps same image '+width);
    check(await evaluate("Math.abs(scrollY-readingScroll)<2&&document.documentElement.scrollHeight===readingHeight"),'foreground retains reading position and document height '+width);
    check(mediaRequests.filter(url=>url.includes('/one?')).length===before,'foreground no image download '+width);
    await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Leer mensaje').click()");await waitFor("document.body.textContent.includes('Hola, este es un mensaje')",'explicit message read');
    await evaluate("var input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Hola desde Web');input.dispatchEvent(new Event('input',{bubbles:true}));");await delay(50);
    await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Guardar mensaje').click()");await waitFor("document.body.textContent.includes('Ya guardaste tu mensaje personal')",'save message');
    await evaluate("document.querySelector('.visual-decisions').scrollIntoView({block:'center'})");
    check(await evaluate("Array.from(document.querySelectorAll('.visual-decisions button')).every(b=>b.getBoundingClientRect().height>=48)&&document.documentElement.scrollWidth<=innerWidth"),'decision touch targets and layout '+width);
    await screenshot('actions-'+width);
    await evaluate("document.documentElement.style.fontSize='32px'");
    check(await evaluate("document.documentElement.scrollWidth<=innerWidth&&document.querySelectorAll('.visual-decisions button')[0].getBoundingClientRect().top!==document.querySelectorAll('.visual-decisions button')[1].getBoundingClientRect().top"),'text scaling stacks decisions '+width);
    await evaluate("document.documentElement.style.fontSize='';scrollTo(0,0)");
    await screenshot('review-'+width);
    await evaluate("history.back()");await waitFor("!document.querySelector('.visual-review')",'Back Activity');
    check(await evaluate("retained===document.querySelector('.home')&&Math.abs(scrollY-savedScroll)<2"),'retained Home and Activity scroll '+width);
    await evaluate('history.forward()');await waitFor("!!document.querySelector('.visual-profile')",'Forward profile');
    await evaluate("mode='error';dispatchEvent(new Event('online'))");await waitFor("!!document.querySelector('.visual-review [role=alert]')",'error');check(await evaluate("!document.querySelector('.visual-profile')"),'failure clears profile');await screenshot('error-'+width);
    await evaluate("mode='ok';Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Reintentar').click()");await waitFor("!!document.querySelector('.visual-profile')",'retry');
    await evaluate("mode='expired';dispatchEvent(new Event('online'))");await waitFor("!!document.querySelector('.visual-review [role=alert]')",'expiry');check(await evaluate("!document.querySelector('.visual-profile')"),'expiry clears profile');
    await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Volver a Actividad').click()");await waitFor("!document.querySelector('.visual-review')",'explicit return');await evaluate("mode='ok';history.back()");await waitFor("!!document.querySelector('[aria-label=\"Ver Actividad\"]')&&!document.querySelector('.visual-review')",'Home return');
  }
  for(const action of ['Aprobar','Rechazar','block']){
    await evaluate("mode='ok';renderFixture()");await waitFor("!!document.querySelector('[aria-label=\"Ver Actividad\"]')",'fresh Home');await click('[aria-label="Ver Actividad"]');await click('.visual-activity');await waitFor("!!document.querySelector('.visual-profile')",'fresh profile');
    if(action==='block'){await click('[aria-label="Más acciones"]');await click('[role=menuitem]');check(await evaluate("!!document.querySelector('dialog[open]')"),'block confirmation');await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Bloquear definitivamente').click()");}
    else await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(action)}).click()`);
    await waitFor("!document.querySelector('.visual-review')",'action returns Activity');check(await evaluate("!document.querySelector('.visual-activity')"),'acted card removed '+action);
  }
  // Real Web Locks / BroadcastChannel ownership transfer from a second page.
  await evaluate("renderFixture()");await waitFor("!!document.querySelector('[aria-label=\"Ver Actividad\"]')",'Home ownership');await click('[aria-label="Ver Actividad"]');await click('.visual-activity');await waitFor("!!document.querySelector('.visual-profile')",'ownership profile');
  await evaluate("window.oldPrivateImage=document.querySelector('.visual-profile img');void 0");
  const peer=await call('Target.createTarget',{url:'http://127.0.0.1:5174'});await delay(1000);
  const port=(await readFile(join(dir,'DevToolsActivePort'),'utf8')).split('\n')[0].trim();const peers=await(await fetch(`http://127.0.0.1:${port}/json`)).json();const peerSocket=new WebSocket(peers.find(p=>p.id===peer.targetId).webSocketDebuggerUrl);await new Promise(r=>peerSocket.addEventListener('open',r,{once:true}));
  const peerEval=expression=>new Promise((resolve,reject)=>{const listener=e=>{const m=JSON.parse(e.data);if(m.id===1){peerSocket.removeEventListener('message',listener);m.result.exceptionDetails?reject(Error('peer evaluation failed')):resolve(m.result);}};peerSocket.addEventListener('message',listener);peerSocket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,awaitPromise:true}}));});
  await peerEval("import('/src/tabs/TabOwnershipManager.ts').then(({TabOwnershipManager})=>{window.peerOwner=new TabOwnershipManager();peerOwner.start();})");
  await waitFor("owner.getSnapshot()==='blocked'",'ownership revoked');check(await evaluate("!oldPrivateImage.isConnected&&!document.querySelector('.visual-profile')"),'ownership loss destroys private DOM');
  await evaluate('owner.request()');await waitFor("owner.getSnapshot()==='active'&&!!document.querySelector('[aria-label=\"Ver Actividad\"]')",'ownership regained');check(await evaluate("!oldPrivateImage.isConnected"),'regained ownership has no previous partner DOM');
  peerSocket.close();await call('Target.closeTarget',{targetId:peer.targetId});

} finally { ws?.close(); chrome.kill(); await new Promise(r=>setTimeout(r,500)); if(!resolve(dir).startsWith(resolve(tmpdir())+sep)||!dir.includes('reals-visual-smoke-'))throw Error('Unsafe temporary directory');await rm(dir,{recursive:true,force:true,maxRetries:5}).catch(()=>{}); }
