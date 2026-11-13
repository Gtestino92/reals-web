import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const joined=new Set(), messages=[], writes=[], start=Date.now()-12*60000, iso=t=>new Date(t).toISOString();
let resolution=null, terminal=false, retained=true;
const server=createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,OPTIONS');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  const [,me,...parts]=req.url.split('/'),path='/'+parts.join('/'), other=me==='a'?'b':'a';let body='';for await(const chunk of req)body+=chunk;const data=body?JSON.parse(body):{};
  if(req.method!=='GET')writes.push({me,path,body:data});
  let value={};
  if(path==='/matches/m')value={id:'m',userAId:'a',userBId:'b'};
  else if(path.endsWith('/join'))joined.add(me);
  else if(path.endsWith('/completion-requests'))resolution={id:'r',type:'MUTUAL_COMPLETION',requesterUserId:me,responderUserId:other,status:'PENDING',createdAt:iso(Date.now()),expiresAt:iso(Date.now()+60000)};
  else if(path.endsWith('/decision')){terminal=data.decision==='ACCEPTED';resolution=null;}
  else if(req.method==='POST'&&path.endsWith('/messages')){const m={id:String(messages.length+1),chatSessionId:'c',senderId:me,clientMessageId:data.clientMessageId,messageType:'TEXT',content:data.content,sentAt:iso(Date.now()),replyTo:null,reactionType:null,audio:null};messages.push(m);resolution=null;value=m;}
  else if(path.includes('/messages?'))value={messages,hasMore:false};
  else if(path==='/chats/c')value={id:'c',connectionId:'connection',matchId:'m',chatType:'SECOND_CHAT',partner:{userId:other,displayName:other==='a'?'Ana':'Bruno'}};
  else if(path.endsWith('/status'))value={connectionId:'connection',chatId:joined.size?'c':null,scheduledAt:iso(start),onTimeUntil:iso(start+5*60000),entryClosesAt:iso(start+15*60000),absoluteExpiresAt:iso(start+120*60000),serverTime:iso(Date.now()),myAttendanceStatus:joined.has(me)?'LATE':'PENDING',partnerAttendanceStatus:joined.has(other)?'LATE':'PENDING',myJoinedAt:null,partnerJoinedAt:null,canJoin:!joined.has(me),canClaimPartnerNoShow:joined.has(me)&&!joined.has(other),activeNoShowClaim:null,activeResolutionRequest:resolution,chatStatus:terminal?'FINISHED':joined.size?'ACTIVE':null,conversationStartedAt:joined.size===2?iso(start):null,readOnlyUntil:terminal?iso(Date.now()+(retained?60000:-1000)):null,endedReason:terminal?'SECOND_CHAT_MUTUAL_COMPLETION':null,canRequestMutualCompletion:joined.size===2&&messages.some(m=>m.senderId==='a')&&messages.some(m=>m.senderId==='b')&&!resolution&&!terminal,canClaimPartnerInactivity:false,mustRespondToPartner:false,audioPolicy:null};
  else if(path==='/test/withdraw')retained=false;
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const backend=`http://127.0.0.1:${server.address().port}`;
const directory=await mkdtemp(join(tmpdir(),'reals-second-chat-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${directory}`,'about:blank'],{windowsHide:true,stdio:'ignore'}),sockets=[];
let checks=0;
try{
 let port;for(let i=0;i<60;i++){try{port=(await readFile(join(directory,'DevToolsActivePort'),'utf8')).split('\n')[0].trim();break;}catch{}await new Promise(r=>setTimeout(r,100));}
 const page=async(user,width)=>{const target=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();const ws=new WebSocket(target.webSocketDebuggerUrl);sockets.push(ws);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});const call=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params}));});const evaluate=async(expression)=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});await call('Page.navigate',{url:`http://127.0.0.1:5175/tools/second-chat-fixture.html?user=${user}&backend=${encodeURIComponent(backend)}`});return{call,evaluate};};
 const wait=async(p,expression)=>{await p.call('Page.bringToFront');for(let i=0;i<120;i++){if(await p.evaluate(expression)){checks++;return;}await new Promise(r=>setTimeout(r,100));}throw Error('Timeout '+expression+' '+await p.evaluate('document.body.innerText'));};
 const click=(p,text)=>p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>(b.textContent===${JSON.stringify(text)}||b.getAttribute('aria-label')===${JSON.stringify(text)})&&!b.disabled);if(!b)throw Error('Missing button '+${JSON.stringify(text)});b.click();})()`);
 const send=async(p,text)=>{await p.evaluate(`(()=>{const input=document.querySelector('textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await click(p,'Enviar mensaje');};
 const a=await page('a',390),b=await page('b',1280);
 await wait(a,"document.body.innerText.includes('Entrar al segundo chat')");if(writes.length)throw Error('Preview mutated');checks++;
 await click(a,'Entrar al segundo chat');await wait(a,"document.body.innerText.includes('Podés mandar mensajes mientras esperás')");
 await wait(b,"!![...document.querySelectorAll('button')].find(b=>b.textContent==='Entrar al segundo chat'&&!b.disabled)");await click(b,'Entrar al segundo chat');await wait(b,"!!document.querySelector('textarea:not(:disabled)')");
 await send(a,'Hola desde Ana');await send(b,'Hola desde Bruno');await wait(a,"document.body.innerText.includes('Hola desde Bruno')");await wait(b,"document.body.innerText.includes('Hola desde Ana')");
 await click(a,'Opciones del chat');await wait(a,"!![...document.querySelectorAll('[role=menuitem]')].find(b=>b.textContent.startsWith('Finalizar')&&!b.disabled)");await click(a,'Finalizar de común acuerdo');await click(a,'Enviar solicitud');await wait(b,"document.body.innerText.includes('Te propusieron finalizar')");await click(b,'Seguir conversando');await wait(a,"!document.body.innerText.includes('Cierre propuesto')");
 await click(a,'Opciones del chat');await wait(a,"!![...document.querySelectorAll('[role=menuitem]')].find(b=>b.textContent.startsWith('Finalizar')&&!b.disabled)");await click(a,'Finalizar de común acuerdo');await click(a,'Enviar solicitud');await wait(b,"document.body.innerText.includes('Te propusieron finalizar')");await click(b,'Finalizar el chat');await wait(a,"document.body.innerText.includes('Podés leerlo hasta') && !document.querySelector('textarea')");await wait(b,"document.body.innerText.includes('Podés leerlo hasta')");
 for(const p of [a,b]){await p.evaluate("document.documentElement.style.fontSize='200%'");await wait(p,'document.documentElement.scrollWidth<=innerWidth');}
 retained=false;await wait(a,"!document.body.innerText.includes('Hola desde Ana') && document.body.innerText.includes('no está disponible para lectura')");
 console.log(JSON.stringify({checks,participants:2,messages:messages.length,mutationCount:writes.length,result:'PASS',limitations:'Synthetic lifecycle only; no live backend, Android visual or physical-device validation.'}));
}finally{sockets.forEach(s=>s.close());chrome.kill();server.close();}
