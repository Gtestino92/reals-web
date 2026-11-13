// Real Home + useHomeNavigation + SecondChat, driven by two synthetic participants.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixtureServer, scenario, advance, iso } from './second-chat-synthetic.mjs';
const {server,scenarios,origin}=await fixtureServer();
const directory=await mkdtemp(join(tmpdir(),'reals-second-review-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${directory}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
const sockets=[], results=[];let checks=0,port;
const audioBytes=(await readFile(new URL('../src/chat/fixtures/valid-aac-short.m4a',import.meta.url))).toString('base64');
const recorderStub=`window.activeTracks=0; Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>{window.activeTracks++;let live=true;return{getTracks:()=>[{stop:()=>{if(live){live=false;window.activeTracks--;}}}]};}}});window.MediaRecorder=class {static isTypeSupported(){return true;}constructor(){this.mimeType='audio/mp4';this.state='inactive';} start(){this.state='recording';} stop(){this.state='inactive';const bytes=Uint8Array.from(atob('${audioBytes}'),c=>c.charCodeAt(0));this.ondataavailable?.({data:new Blob([bytes],{type:'audio/mp4'})});queueMicrotask(()=>this.onstop?.());}};`;
async function page(group,user,width){
 const target=await(await fetch(`http://127.0.0.1:${port}/json/new?about:blank`,{method:'PUT'})).json();const ws=new WebSocket(target.webSocketDebuggerUrl);sockets.push(ws);await new Promise(r=>ws.addEventListener('open',r,{once:true}));let id=0;const pending=new Map();
 ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
 const call=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params}));});
 const evaluate=async(expression)=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
 await call('Page.enable');await call('Page.addScriptToEvaluateOnNewDocument',{source:recorderStub});await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<500});
 await call('Page.navigate',{url:`http://127.0.0.1:5175/tools/second-chat-fixture.html?user=${user}&backend=${encodeURIComponent(origin+'/'+group)}`});
 return {call,evaluate,close:()=>call('Page.close')};
}
async function wait(p,expression){await p.call('Page.bringToFront');for(let i=0;i<120;i++){if(await p.evaluate(expression)){checks++;return;}await new Promise(r=>setTimeout(r,100));}throw Error('Timeout '+expression+' '+await p.evaluate('document.body.innerText+JSON.stringify([...document.querySelectorAll(\"audio\")].map(a=>({src:a.src,error:a.error?.code,paused:a.paused})))'));}
async function refresh(p){await p.call('Page.bringToFront');await p.evaluate("document.dispatchEvent(new Event('visibilitychange'))");}
const visible="!b.closest('[hidden]')";
async function click(p,text){await wait(p,`!![...document.querySelectorAll('button')].find(b=>(b.textContent===${JSON.stringify(text)}||b.getAttribute('aria-label')===${JSON.stringify(text)})&&!b.disabled&&${visible})`);await p.evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>(b.textContent===${JSON.stringify(text)}||b.getAttribute('aria-label')===${JSON.stringify(text)})&&!b.disabled&&${visible});b.click();})()`);}
async function setText(p,selector,text){await p.evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);}
async function open(p,label='Entrar al segundo chat'){await click(p,'Ver Actividad');await click(p,label);await wait(p,"!!document.querySelector('.second-chat')");await wait(p,"!document.querySelector('.second-chat').innerText.includes('Cargando el segundo chat')");}
async function send(p,text){await wait(p,"!!document.querySelector('#second-draft:not(:disabled)')");await setText(p,'#second-draft',text);await click(p,'Enviar mensaje');await wait(p,"!document.querySelector('.second-chat').innerText.includes('Enviando…')");}
async function completion(p){await click(p,'Opciones del chat');await click(p,'Finalizar de común acuerdo');await click(p,'Enviar solicitud');await wait(p,"document.querySelector('.second-chat').innerText.includes('Cierre propuesto')");}
async function safety(p,kind){await click(p,'Opciones del chat');await click(p,kind==='block'?'Bloquear':'Reportar por seguridad');if(kind!=='block'){await wait(p,"!!document.querySelector('dialog textarea')");await setText(p,'dialog textarea','Reporte sintético de prueba');}await click(p,'Confirmar');await wait(p,"!document.querySelector('.second-chat') && !![...document.querySelectorAll('h2')].find(h=>h.textContent==='Inicio'&&!h.closest('[hidden]'))");}
async function history(p,delta){await p.evaluate(`history.go(${delta})`);}
async function assert(p,expr){await wait(p,expr);}
async function run(name,width,initial,body){const key=`${width}-${name}`,s=scenario(initial);scenarios.set(key,s);const a=await page(key,'a',width),b=await page(key,'b',width===390?1280:390);try{await body({a,b,s});results.push({name,width,result:'PASS'});console.log(`${width} ${name}: PASS`);}catch(error){console.log(JSON.stringify({name,width,audioReads:s.audioReads,audioVersion:s.audioVersion}));throw error;}finally{await a.close();await b.close();}}
try{
 for(let i=0;i<60;i++){try{port=(await readFile(join(directory,'DevToolsActivePort'),'utf8')).split('\n')[0].trim();break;}catch{}await new Promise(r=>setTimeout(r,100));}
 for(const width of [390,1280]){
  await run('available-and-scheduled',width,{joined:new Set(),status:'AVAILABLE'},async({a,b,s})=>{
   await open(a);await open(b);await assert(a,"!document.querySelector('.second-chat').innerText.match(/ya no está activo|no está disponible para lectura/)");
   s.scheduled=s.now+60000;await refresh(a);await assert(a,"document.querySelector('.second-chat').innerText.includes('Todavía no está disponible')");await assert(a,"!document.querySelector('.second-chat').innerText.match(/ya no está activo|no está disponible para lectura/)");
   await refresh(b);await assert(b,"!document.querySelector('.second-chat').innerText.includes('ya no está activo')");
  });
  await run('no-show-concurrent-join',width,{joined:new Set(['a'])},async({a,b,s})=>{
   await open(a);await open(b);const gate={path:'/connections/connection/second-chat/no-show-claims'};s.gate=gate;
   await click(a,'Bruno no se presentó');while(!gate.started)await new Promise(r=>setTimeout(r,10));await click(b,'Entrar al segundo chat');await wait(b,"!!document.querySelector('#second-draft')");gate.release();await refresh(a);await assert(a,"!document.querySelector('.second-chat').innerText.includes('Reclamo por ausencia pendiente') && !document.querySelector('.second-chat').innerText.includes('Esperando a')");
   if(s.claim||s.status!=='ACTIVE'||s.joined.size!==2)throw Error('Join/claim race');checks++;
  });
  await run('no-show-countdown-hard-cutoff',width,{joined:new Set(['a'])},async({a,b,s})=>{
   s.now=s.scheduled+15*60000-10000;await open(a);await click(a,'Bruno no se presentó');await assert(a,"document.querySelector('.second-chat').innerText.includes('Quedan')");advance(s,10000);await refresh(a);await assert(a,"document.querySelector('.second-chat').innerText.includes('Podés leerlo hasta') && !document.querySelector('#second-draft')");await open(b,'Ver segundo chat');await assert(b,"!document.querySelector('#second-draft')");await history(a,-1);await assert(a,"!document.querySelector('.second-chat')");await history(a,1);await assert(a,"!document.querySelector('.second-chat')");
  });
  await run('inactivity-response-timeout',width,{},async({a,b,s})=>{
   await open(a);await open(b);await send(a,'Mensaje pendiente de respuesta');await refresh(a);await click(a,'La otra persona no respondió');await click(a,'Enviar reclamo');await refresh(b);await assert(b,"document.querySelector('.second-chat').innerText.includes('Respondé para mantener el chat')");await send(b,'Respuesta que cancela');await refresh(a);await assert(a,"!document.querySelector('.second-chat').innerText.includes('Reclamo por falta de respuesta')");await send(a,'Otra respuesta');await click(a,'La otra persona no respondió');await click(a,'Enviar reclamo');advance(s,60000);await refresh(a);await assert(a,"document.querySelector('.second-chat').innerText.includes('terminó por falta de respuesta') && !document.querySelector('#second-draft')");
  });
  await run('completion-timeout-cooldown-message',width,{},async({a,b,s})=>{
   await open(a);await open(b);await completion(a);advance(s,60000);await refresh(a);await assert(a,"document.querySelector('.second-chat').innerText.includes('Podrás volver a proponer')");advance(s,60000);await refresh(a);await completion(a);await send(b,'Mensaje que cancela cierre');await refresh(a);await assert(a,"!document.querySelector('.second-chat').innerText.includes('Cierre propuesto') && !!document.querySelector('#second-draft')");advance(s,60000);await refresh(a);await completion(a);await refresh(b);await click(b,'Finalizar el chat');await refresh(a);await assert(a,"document.querySelector('.second-chat').innerText.includes('Podés leerlo hasta')");await history(a,-1);await assert(a,"!document.querySelector('.second-chat')");await history(a,1);await assert(a,"!document.querySelector('.second-chat')");
  });
  await run('safety-after-uncertain-message',width,{failSend:true},async({a,b,s})=>{
   await open(a);await open(b);await send(a,'Envío sin confirmar');await assert(a,"document.querySelector('.second-chat').innerText.includes('Sin confirmar')");await safety(a,'report');if(s.writes.filter(w=>w.path==='/chats/c/messages').length!==1)throw Error('Safety replayed message');checks++;await refresh(b);await wait(b,"!document.querySelector('#second-draft')");
  });
  await run('block-home-with-inaccessible-chat',width,{},async({a,b})=>{await open(a);await open(b);await safety(a,'block');await history(a,-1);await history(a,1);await assert(a,"!document.querySelector('.second-chat')");});
  await run('active-back-cutoff-forward',width,{joined:new Set(['a'])},async({a,b,s})=>{
   await open(a);await open(b);const length=await a.evaluate('history.length');await history(a,-1);await assert(a,"!!document.querySelector('.second-chat') && history.state.trail.at(-1)==='second-chat'");if(await a.evaluate('history.length')!==length)throw Error('History grew');checks++;
   s.now=s.scheduled+15*60000;await refresh(a);await assert(a,"!![...document.querySelectorAll('.second-chat button')].find(b=>b.textContent==='Volver a Inicio')");await history(a,-1);await assert(a,"!document.querySelector('.second-chat')");await history(a,1);await assert(a,"!document.querySelector('.second-chat')");
  });
  await run('absolute-expiry-home',width,{},async({a,b,s})=>{await open(a);await open(b);s.now=s.scheduled+120*60000;await refresh(a);await assert(a,"!document.querySelector('.second-chat') && document.body.innerText.includes('El segundo chat venció.')");});
  await run('audio-policy-url-upload-and-identity',width,{},async({a,b,s})=>{
   s.messages.push({id:'1',chatSessionId:'c',senderId:'b',clientMessageId:null,messageType:'AUDIO',content:null,sentAt:iso(s.now),replyTo:null,reactionType:null,audio:{url:'placeholder',durationMillis:1000,sizeBytes:2000,contentType:'audio/mp4'}});
   await open(a);await open(b);await assert(a,"!document.querySelector('[aria-label=\"Grabar audio\"]')");await click(a,'Reproducir audio');await wait(a,`document.querySelector('audio')?.src.includes('audio-valid')`);if(s.audioReads<1)throw Error('No audio request');checks++;
   s.writableAudio=true;s.failUpload=true;await refresh(a);await click(a,'Grabar audio');await assert(a,"window.activeTracks===1");await click(a,'Detener');await assert(a,"!!document.querySelector('.chat-audio-draft')");await click(a,'Enviar audio');await assert(a,"document.querySelector('.second-chat').innerText.includes('Sin confirmar')");await safety(a,'block');await assert(a,"window.activeTracks===0 && !document.querySelector('audio')");
   await b.evaluate('window.fixture.invalidate()');await assert(b,"document.body.innerText.includes('Sesión finalizada') && !document.querySelector('audio') && !document.querySelector('.second-chat')");
  });
  await run('recording-ownership-replacement',width,{writableAudio:true},async({a,b})=>{await open(a);await open(b);await click(a,'Grabar audio');await assert(a,'window.activeTracks===1');await a.evaluate('window.fixture.replace()');await assert(a,"window.activeTracks===0 && !document.querySelector('.second-chat') && !document.querySelector('audio')");await history(a,-1);await history(a,1);await assert(a,"!document.querySelector('.second-chat')");});
  await run('terminal-and-retention-withdrawal',width,{},async({a,b,s})=>{await open(a);await open(b);s.status='CLOSED';await refresh(a);await assert(a,"!document.querySelector('.second-chat')");await history(a,-1);await history(a,1);await assert(a,"!document.querySelector('.second-chat')");s.status='FINISHED';s.retention=s.now+60000;await refresh(b);await assert(b,"!!document.querySelector('.second-chat') && !document.querySelector('#second-draft')");advance(s,60000);await refresh(b);await assert(b,"!document.querySelector('.second-chat')");});
  await run('large-font-retained',width,{status:'FINISHED'},async({a,b})=>{await open(a,'Ver segundo chat');await open(b,'Ver segundo chat');for(const p of[a,b]){await p.evaluate("document.documentElement.style.fontSize='200%'");await assert(p,'document.documentElement.scrollWidth<=innerWidth');}});
 }
 console.log(JSON.stringify({result:'PASS',checks,cases:results,limitations:'Synthetic scheduler/HTTP and recorder; real Home/history/MP4 validation/playback. No real backend concurrency, microphone or Android screenshot parity claimed.'}));
}finally{sockets.forEach(s=>s.close());chrome.kill();server.close();}
