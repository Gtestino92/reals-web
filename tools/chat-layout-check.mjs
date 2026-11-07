import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
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
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  const fixture = await call('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(async()=>{
    const {default:React}=await import('/node_modules/.vite/deps/react.js'),{default:ReactDOM}=await import('/node_modules/.vite/deps/react-dom_client.js'),{FirstChat}=await import('/src/chat/FirstChat.tsx'); const {createRoot}=ReactDOM;
    document.getElementById('root').style.display='none';const el=document.createElement('div');document.body.append(el);
    const messages=[{id:'1',chatSessionId:'c',senderId:'them',clientMessageId:null,messageType:'TEXT',content:'¡Hola! ¿Cómo estás?',reactionType:null,replyTo:null,audio:null,sentAt:new Date().toISOString()}];
    const controller={snapshot:{account:{id:'me'}},request:async(path,signal,method='GET',body)=>{
      signal.throwIfAborted();
      if(path==='/matches/m')return{id:'m',userAId:'me',userBId:'them',state:'CHAT_ACTIVE'};
      if(path==='/matches/m/chat')return{id:'c',matchId:'m',chatType:'FIRST_CHAT',status:'ACTIVE',partner:{userId:'them',displayName:'María'},myDecision:'PENDING',partnerDecision:'PENDING',timeoutAt:new Date(Date.now()+600000).toISOString(),inactivityExpiresAt:new Date(Date.now()+300000).toISOString(),serverTime:new Date().toISOString(),guidance:{question:{id:'q',instanceId:'q1',text:'Qué te inspira?'},questionOrdinal:1,maxQuestions:3,requiredParticipationScore:100,directQuestionReplyMultiplier:2,progressionAction:'NEXT_QUESTION',canRequestNext:true,myNextRequested:false,completed:false},audioPolicy:null};
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
  await mkdir('artifacts/first-chat',{recursive:true});
  for (const [width,height] of [[360,800],[390,844],[768,1024],[1280,800],[1440,900],[1920,1080]]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<768});
    await new Promise(r=>setTimeout(r,150));
    for (const empty of [false,true]) {
      await call('Runtime.evaluate',{expression:`document.querySelectorAll('.chat-timeline li').forEach(e=>e.style.display=${empty ? "'none'" : "''"})`});
      const shot=await call('Page.captureScreenshot',{format:'png'});
      await writeFile(`artifacts/first-chat/${width}x${height}-${empty?'empty':'messages'}.png`,Buffer.from(shot.data,'base64'));
      console.log(JSON.stringify((await call('Runtime.evaluate',{returnByValue:true,expression:`({width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth,chat:document.querySelector('.first-chat').getBoundingClientRect().toJSON(),timeline:document.querySelector('.chat-timeline').clientHeight,composerBottom:document.querySelector('.chat-composer').getBoundingClientRect().bottom})`})).result.value));
    }
  }
} finally { ws?.close(); chrome.kill(); await new Promise(r=>setTimeout(r,500)); if (!resolve(dir).startsWith(resolve(tmpdir())+sep) || !dir.includes('reals-chat-smoke-')) throw Error('Unsafe temporary directory'); await rm(dir,{recursive:true,force:true,maxRetries:5}).catch(()=>{}); }
