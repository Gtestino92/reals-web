import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
const dir = await mkdtemp(join(tmpdir(),'reals-chat-smoke-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port=9444',`--user-data-dir=${dir}`,'--autoplay-policy=no-user-gesture-required','about:blank'],{ windowsHide:true, stdio:'ignore' });
let ws;
try {
  let target;
  for(let i=0;i<60;i++) { try { const list=await (await fetch('http://127.0.0.1:9444/json')).json(); target=list.find(t=>t.type==='page'); if(target) break; } catch {} await new Promise(r=>setTimeout(r,100)); }
  if(!target) throw new Error('Chrome did not start');
  ws=new WebSocket(target.webSocketDebuggerUrl); await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  let id=0; const pending=new Map(); ws.addEventListener('message',e=>{const m=JSON.parse(e.data); if(m.id){const p=pending.get(m.id); pending.delete(m.id); m.error?p.reject(new Error(m.error.message)):p.resolve(m.result);}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params}));});
  await call('Page.navigate',{url:'http://127.0.0.1:5173'}); await new Promise(r=>setTimeout(r,1800));
  const result=await call('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(async()=>{
    const {inspectAudio,recordingMime}=await import('/src/chat/audio.ts');
    const mime=recordingMime(); const result={userAgent:navigator.userAgent,mime};
    if(!mime) return result;
    const ctx=new AudioContext();await ctx.resume();const osc=ctx.createOscillator(),dest=ctx.createMediaStreamDestination();osc.connect(dest);osc.start();
    const recorder=new MediaRecorder(dest.stream,{mimeType:mime});const chunks=[];recorder.ondataavailable=e=>chunks.push(e.data);
    await new Promise((resolve,reject)=>{recorder.onstop=resolve;recorder.onerror=reject;recorder.start();setTimeout(()=>recorder.stop(),1500);});
    osc.stop();dest.stream.getTracks().forEach(t=>t.stop());await ctx.close();
    const blob=new Blob(chunks,{type:recorder.mimeType});result.bytes=blob.size;result.actualMime=blob.type;const data=await blob.arrayBuffer(),view=new DataView(data),bytes=new Uint8Array(data);result.topBoxes=[];for(let p=0;p+8<=bytes.length;){const size=view.getUint32(p);result.topBoxes.push(String.fromCharCode(...bytes.slice(p+4,p+8)));if(size<8)break;p+=size;}
    try{result.duration=inspectAudio(await blob.arrayBuffer(),60000,2097152);result.admitted=true;}catch{result.admitted=false;}
    result.headings=[...document.querySelectorAll('h1,h2')].map(e=>e.textContent);
    return result;
  })()`});
  if(result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  console.log(JSON.stringify(result.result.value,null,2));
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  const fixture = await call('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(async()=>{
    const {default:React}=await import('/node_modules/.vite/deps/react.js'),{default:ReactDOM}=await import('/node_modules/.vite/deps/react-dom_client.js'),{FirstChat}=await import('/src/chat/FirstChat.tsx'); const {createRoot}=ReactDOM;
    document.getElementById('root').style.display='none';const el=document.createElement('div');document.body.append(el);
    const messages=[{id:'1',chatSessionId:'c',senderId:'them',clientMessageId:null,messageType:'TEXT',content:'¡Hola! ¿Cómo estás?',reactionType:null,replyTo:null,audio:null,sentAt:new Date().toISOString()}];
    const controller={snapshot:{account:{id:'me'}},request:async(path,signal,method='GET',body)=>{
      signal.throwIfAborted();
      if(path==='/matches/m')return{id:'m',userAId:'me',userBId:'them',state:'CHAT_ACTIVE'};
      if(path==='/matches/m/chat')return{id:'c',matchId:'m',chatType:'FIRST_CHAT',status:'ACTIVE',partner:{userId:'them',displayName:'María'},myDecision:'PENDING',partnerDecision:'PENDING',timeoutAt:new Date(Date.now()+600000).toISOString(),inactivityExpiresAt:new Date(Date.now()+300000).toISOString(),serverTime:new Date().toISOString(),guidance:null,audioPolicy:null};
      if(path.endsWith('exit-requests'))return[];
      if(path==='/chats/c/messages'&&method==='POST'){const m={...messages[0],...body,id:'2',senderId:'me',sentAt:new Date().toISOString()};messages.push(m);return m;}
      if(path.includes('/messages?'))return[...messages];throw Error('Unexpected fixture endpoint');
    }};
    createRoot(el).render(React.createElement(FirstChat,{controller,matchId:'m',chatId:'c',onHome:()=>{}}));
    await new Promise(r=>setTimeout(r,500));
    const input=el.querySelector('textarea');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(input,'¡Mensaje de prueba!');input.dispatchEvent(new Event('input',{bubbles:true}));await new Promise(r=>setTimeout(r,100));
    el.querySelector('form').requestSubmit();await new Promise(r=>setTimeout(r,400));
    const mobile={width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,heading:el.querySelector('h2')?.textContent,messages:el.querySelectorAll('.chat-message').length,confirmed:input.value===''};
    el.querySelector('button')?.focus();
    return mobile;
  })()`});
  if(fixture.exceptionDetails) throw new Error(fixture.exceptionDetails.exception?.description ?? fixture.exceptionDetails.text);
  if (fixture.result.value.overflow || fixture.result.value.messages !== 2 || !fixture.result.value.confirmed) throw Error('Synthetic chat smoke failed');
  console.log('Synthetic chat/mobile smoke:',JSON.stringify(fixture.result.value));
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  console.log('Synthetic chat/desktop:',JSON.stringify((await call('Runtime.evaluate',{returnByValue:true,expression:'({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth})'})).result.value));
} finally { ws?.close(); chrome.kill(); await new Promise(r=>setTimeout(r,500)); if (!resolve(dir).startsWith(resolve(tmpdir())+sep) || !dir.includes('reals-chat-smoke-')) throw Error('Unsafe temporary directory'); await rm(dir,{recursive:true,force:true,maxRetries:5}).catch(()=>{}); }
