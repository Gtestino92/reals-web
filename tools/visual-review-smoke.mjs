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
  await call('Fetch.enable',{patterns:[{urlPattern:'https://synthetic.example/*'}]});
  ws.addEventListener('message',async event=>{const m=JSON.parse(event.data);if(m.method==='Fetch.requestPaused'){
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#D6C39A"/><circle cx="200" cy="160" r="65" fill="#31435A"/><path d="M80 470 Q80 270 200 270 Q320 270 320 470" fill="#31435A"/><text x="200" y="490" text-anchor="middle" fill="#0F1F35">Synthetic test image</text></svg>';
    await call('Fetch.fulfillRequest',{requestId:m.params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'image/svg+xml'},{name:'Cache-Control',value:'no-store'}],body:Buffer.from(svg).toString('base64')});
  }});
  await evaluate(`(async()=>{
    const React=await import('/node_modules/.vite/deps/react.js'),ReactDOM=await import('/node_modules/.vite/deps/react-dom_client.js');const {Home}=await import('/src/home/Home.tsx');const {ApiError}=await import('/src/auth/api.ts');await import('/src/styles/tokens.css');await import('/src/styles/global.css');
    document.body.innerHTML='<main class="login-page"><section class="login-panel"><div id="probe"></div></section></main>';
    window.reads=[];window.mode='ok';window.lag=0;window.rev=1;
    const snapshot={phase:'ready',authContextVersion:1,account:{id:'me'},profile:{id:'p',userId:'me',status:'ACTIVE',displayName:'Lucía'}};
    const photo=(id,position)=>({id,position,url:'https://synthetic.example/'+id,moderationStatus:'APPROVED'});
    const profile={profileId:'partner',displayName:'María',age:29,bio:'Me gusta caminar.',visualExpiresAt:'2099-11-12T18:00:00Z',photos:[photo('one',1),photo('two',2),photo('three',3),photo('four',4)],affinityIndicators:[{categoryId:'outdoors',title:'Aire libre'}],profileQuestions:[{questionId:'q',prompt:'¿Tu lugar favorito?',answer:'El bosque',position:0}]};
    const controller={snapshot,getSnapshot:()=>snapshot,subscribe:()=>()=>{},request:async(path,signal)=>{reads.push(path);if(path==='/me/home/status')return {version:rev,dirty:false,nextRefreshAt:null,serverTime:new Date().toISOString()};if(path==='/me/profile')return snapshot.profile;if(path==='/me/home')return {profileStatus:'ACTIVE',matchmaking:{inQueue:false,canSearch:true,blockedReason:null},activeInteractionsSummary:{activeInitialCount:1,activeConnectionCount:0,actionableConnectionCount:0,hasPendingSchedulingConnection:false},pendingActions:[{type:'VISUAL_REVIEW',matchId:'m',visualExpiresAt:profile.visualExpiresAt}],nextSteps:[],passiveNotices:[]};
    if(path==='/matches/m'){if(lag)await new Promise(r=>setTimeout(r,lag));if(mode==='expired')throw new ApiError('backend',409,'VISUAL_CONTENT_NOT_AVAILABLE');if(mode==='error')throw new ApiError('network');return {id:'m',userAId:'me',userBId:'them',state:'VISUAL_PHASE'};}if(path==='/matches/m/visual-profile')return profile;throw new ApiError('backend',404);}};
    ReactDOM.default.createRoot(document.querySelector('#probe')).render(React.default.createElement(Home,{controller}));
  })()`);
  const waitFor=async(expression,label)=>{for(let i=0;i<100;i++){if(await evaluate(expression))return;await delay(40);}throw Error(label+': '+await evaluate('document.body.innerText'));};
  const click=async selector=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);await delay(80);};
  for(const [width,height] of [[390,844],[1440,900]]){
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<768});
    await waitFor("!!document.querySelector('.home-activity-entry[aria-label=\"Ver Actividad\"]')",'Home ready');
    await evaluate("window.retained=document.querySelector('.home');void 0");
    await click('[aria-label="Ver Actividad"]');
    await evaluate("document.querySelector('.home:not([hidden])').style.minHeight='1600px';window.scrollTo(0,180);window.savedScroll=scrollY;void 0");
    await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Descubrir ahora').click()");
    await waitFor("!!document.querySelector('.visual-profile')",'profile ready');
    check(await evaluate("Array.from(document.querySelector('.visual-profile').children).map(e=>e.tagName).join(',')==='HEADER,FIGURE,SECTION,FIGURE,SECTION,FIGURE,SECTION,FIGURE'"),'Android Review order '+width);
    check(await evaluate("document.documentElement.scrollWidth<=innerWidth"),'no horizontal overflow '+width);
    await screenshot('review-'+width);
    await evaluate("history.back()");await waitFor("!document.querySelector('.visual-review')",'Back Activity');
    check(await evaluate("retained===document.querySelector('.home')&&Math.abs(scrollY-savedScroll)<2"),'retained Home and Activity scroll '+width);
    await evaluate('history.forward()');await waitFor("!!document.querySelector('.visual-profile')",'Forward profile');
    await evaluate("mode='error';document.querySelector('.visual-review > button').click()");await waitFor("!!document.querySelector('.visual-review [role=alert]')",'error');check(await evaluate("!document.querySelector('.visual-profile')"),'failure clears profile');await screenshot('error-'+width);
    await evaluate("mode='ok';document.querySelector('.visual-review > button').click()");await waitFor("!!document.querySelector('.visual-profile')",'retry');
    await evaluate("mode='expired';document.querySelector('.visual-review > button').click()");await waitFor("!!document.querySelector('.visual-review [role=alert]')",'expiry');check(await evaluate("!document.querySelector('.visual-profile')"),'expiry clears profile');
    await click('.visual-review header button');await waitFor("!document.querySelector('.visual-review')",'explicit return');await evaluate("mode='ok';history.back()");await waitFor("!!document.querySelector('[aria-label=\"Ver Actividad\"]')&&!document.querySelector('.visual-review')",'Home return');
  }
  check(await evaluate("!reads.some(p=>p.includes('personal-message'))"),'no personal-message GET');
} finally { ws?.close(); chrome.kill(); await new Promise(r=>setTimeout(r,500)); if(!resolve(dir).startsWith(resolve(tmpdir())+sep)||!dir.includes('reals-visual-smoke-'))throw Error('Unsafe temporary directory');await rm(dir,{recursive:true,force:true,maxRetries:5}).catch(()=>{}); }
