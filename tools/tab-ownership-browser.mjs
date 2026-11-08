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
  if(method==='POST' && path==='/matchmaking/queue')await new Promise(r=>setTimeout(r,current.writeDelay??0));
  res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const dir = await mkdtemp(join(tmpdir(),'reals-chat-smoke-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${dir}`,'--autoplay-policy=no-user-gesture-required','about:blank'],{ windowsHide:true, stdio:'ignore' });

const sockets=[];
try {
 let port;
 for(let i=0;i<60;i++){try{port=(await readFile(join(dir,'DevToolsActivePort'),'utf8')).split('\n')[0].trim();break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const connect=async target=>{
  const ws=new WebSocket(target.webSocketDebuggerUrl); sockets.push(ws);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();
  ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  return {call,evaluate,target};
 };
 const page=async(kind,uid)=>{
  const target=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();const p=await connect(target); await p.call('Emulation.setDeviceMetricsOverride',{width:uid==='identity-a'?390:1280,height:850,deviceScaleFactor:1,mobile:uid==='identity-a'});
  await p.call('Page.navigate',{url:`http://127.0.0.1:5174/tools/tab-ownership-fixture.html?kind=${kind}&uid=${uid}&backend=${encodeURIComponent(origin)}`});return p;
 };
 const wait=async(p,expression)=>{for(let i=0;i<150;i++){if(await p.evaluate(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timeout '+expression+' '+await p.evaluate('document.body.innerText'));};
 const active=p=>wait(p,"window.ownership?.getSnapshot()==='active' && !!document.querySelector('.home, .onboarding, .login-form')");
 const blocked=p=>wait(p,"document.body.innerText.includes('Reals está activo en otra pestaña.') && !document.querySelector('.home, .onboarding, .first-chat, .login-form')");
 const takeover=async(p)=>{await p.evaluate("document.querySelector('button').click()");await active(p);};
 const close=async p=>{await p.call('Page.close');};
 const results=[];
 for(const [first,second] of [['login','login'],['login','home'],['home','home'],['chat','home'],['onboarding','home']]) {
  reset(first==='chat'?'chat':'home');
  const a=await page(first,'identity-a'); await active(a);
  if(first==='chat') await wait(a,"!!document.querySelector('.first-chat')");
  reset('home'); const b=await page(second,'identity-b');await active(b);await blocked(a);
  await a.call('Page.bringToFront'); await new Promise(r=>setTimeout(r,400));await blocked(a);
  await new Promise(r=>setTimeout(r,400)); const inactiveCount=await a.evaluate('requestLog.length');
  await new Promise(r=>setTimeout(r,600)); if(await a.evaluate('requestLog.length')!==inactiveCount)throw Error('Inactive polling continued');
  const before=requests.length;
  const rejected=await a.evaluate("fixtureApi.request('/matchmaking/queue',new AbortController().signal,undefined,'DELETE').then(()=>false,e=>e.name==='AbortError')");
  if(!rejected || requests.slice(before).some(r=>r.method!=='GET'))throw Error('Inactive mutation escaped');
  await takeover(a);await blocked(b);
  if(first==='home'){for(const [p,label] of [[a,'mobile-active'],[b,'desktop-blocked']]){const shot=await p.call('Page.captureScreenshot');await writeFile(join(dir,label+'.png'),Buffer.from(shot.data,'base64'));}console.log('Screenshots:',dir);}
  for(let i=0;i<4;i++){await takeover(i%2? a:b);await blocked(i%2? b:a);}
  await a.call('Page.reload');await active(a);await blocked(b);
  await close(a);await takeover(b);
  if(requests.some(r=>r.method!=='GET'))throw Error('Unexpected domain write');
  results.push({first,second,identities:'synthetic per-document Firebase identities',takeover:true,focus:true,inactiveMutationRejected:true,reload:true,close:true,rapid:true});
  await close(b);
 }
 reset('home'); const a=await page('home','identity-a');await active(a);
 fixture.writeDelay=10000;
 await a.evaluate("window.writeOutcome='pending';void fixtureApi.request('/matchmaking/queue',new AbortController().signal,undefined,'POST',{latitude:12,longitude:21}).then(()=>writeOutcome='success',e=>writeOutcome=e.name)");
 await new Promise(r=>setTimeout(r,100)); const b=await page('home','identity-b');await active(b);await blocked(a);
 await wait(a,"window.writeOutcome==='AbortError'");
 await takeover(a);await blocked(b);await wait(a,"document.body.innerText.includes('Buscando')");
 if(requests.filter(r=>r.method==='POST').length!==1 || requests.some(r=>r.method==='DELETE'))throw Error('Uncertain write replayed or canceled');
 results.push({pendingMutation:'aborted locally, persisted queue recovered without replay',inactivePollingStopped:true});
 await close(a);await close(b);
 console.log(JSON.stringify({sameBrowserContext:true,results,requests:requests.length,writes:requests.filter(r=>r.method!=='GET')},null,2));
} finally {
 server.closeAllConnections();server.close();for(const ws of sockets)ws.close();chrome.kill();
}
