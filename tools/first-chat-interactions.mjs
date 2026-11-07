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
  await call('Page.navigate',{url:'http://127.0.0.1:5174'}); await new Promise(r=>setTimeout(r,1800));
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
      if(path.endsWith('/reaction')){window.reactionCalls++;messages[0]={...messages[0],reactionType:'HEART'};await new Promise(r=>setTimeout(r,200));return messages[0];}
      if(path==='/chats/c/messages'&&method==='POST'){const m={...messages[0],...body,id:'2',senderId:'me',sentAt:new Date().toISOString()};messages.push(m);return m;}
      if(path.includes('/messages?'))return[...messages];throw Error('Unexpected fixture endpoint');
    }};
    createRoot(el).render(React.createElement(React.StrictMode,null,React.createElement(FirstChat,{controller,matchId:'m',chatId:'c',onHome:()=>{}}))); window.fixtureMessages=messages; window.reactionCalls=0;
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
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  const rect=selector=>evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+3,y:r.y+3}})()`);
  const click=async selector=>{const p=await rect(selector);await call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});await delay(50);};
  const drag=async(selector,dx,dy=0,touch=false,cancel=false)=>{
    const p=await rect(selector);
    if(touch){await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});}else await call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});
    for(let i=1;i<=5;i++){
      const point={x:p.x+dx*i/5,y:p.y+dy*i/5};
      if(touch)await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,id:1}]});else await call('Input.dispatchMouseEvent',{type:'mouseMoved',...point,button:'left',buttons:1});
      await delay(25);
    }
    if(touch)await call('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});else await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x+dx,y:p.y+dy,button:'left',clickCount:1});
    await delay(220);
  };
  const assert=async(expression,label)=>{if(!await evaluate(expression))throw Error(label);console.log('PASS',label);};
  await call('Emulation.setTouchEmulationEnabled',{enabled:true});
  for(const [width,height,touch] of [[390,844,true],[1440,900,false]]){
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:touch});await delay(100);
    const question='.first-chat > .reply-swipe';
    await drag(question,45,0,touch);await assert(`!document.querySelector('.chat-composer aside')`,'incomplete swipe does not reply');
    await drag(question,90,0,touch,touch);if(touch)await assert(`!document.querySelector('.chat-composer aside')`,'cancelled touch does not reply');else await click('.chat-composer aside button');
    await drag(question,90,0,touch);await assert(`document.querySelector('.chat-composer aside')?.textContent.includes('inspira')`,'question swipe selects question');
    await click('.chat-composer aside button');
    await drag('.chat-message-row.incoming .reply-swipe',90,0,touch);await assert(`document.querySelector('.chat-composer aside')?.textContent.includes('Hola')`,'incoming swipe selects direct message');
    await click('.chat-composer aside button');
    await assert(`!document.querySelector('.chat-message-row.outgoing .reply-keyboard-action')`,'own message cannot be replied to');
    await evaluate(`document.querySelector('.chat-message-row.incoming .reply-keyboard-action').focus()`);
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13});
    await delay(100);await assert(`!!document.querySelector('.chat-composer aside')`,'keyboard reply activation');await click('.chat-composer aside button');
    await mkdir('artifacts/first-chat-interactions',{recursive:true});
    await writeFile(`artifacts/first-chat-interactions/${width}-reply-reactions.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  }
  await click('.chat-heart');await click('.chat-heart:disabled');await delay(400);
  await assert(`reactionCalls===1 && !!document.querySelector('.chat-given-heart') && !document.querySelector('.chat-message .chat-heart')`,'reaction external lane and duplicate protection');
  await evaluate(`fixtureMessages[1]={...fixtureMessages[1],reactionType:'HEART'};dispatchEvent(new Event('online'))`);await delay(300);
  await assert(`!!document.querySelector('.chat-received-heart') && !document.querySelector('.chat-message .chat-received-heart')`,'own received heart is passive and external');
  for(const [width,height] of [[390,844],[1440,900]]) {
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<768});await delay(100);
    await writeFile(`artifacts/first-chat-interactions/${width}-confirmed-hearts.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  }
  await evaluate(`for(let i=3;i<40;i++)fixtureMessages.push({...fixtureMessages[0],id:String(i),content:'Mensaje largo de prueba '.repeat(8),reactionType:null});dispatchEvent(new Event('online'))`);await delay(300);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});await delay(200);
  await evaluate(`document.querySelector('.chat-timeline').scrollTop=100;`);await delay(100);
  // Scroll within the timeline using genuine touch; native pan must win over reply.
  const scrollBefore=await evaluate(`document.querySelector('.chat-timeline').scrollTop`);
  await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:100,y:550,id:1}]});
  for(let y=530;y>=400;y-=20){await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:102,y,id:1}]});await delay(25);}
  await call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await delay(250);
  await assert(`document.querySelector('.chat-timeline').scrollTop>${scrollBefore}&&!document.querySelector('.chat-composer aside')`,'vertical touch scrolling remains native');
  await evaluate(`document.querySelector('.chat-timeline').scrollTop=0`);await delay(100);
  await evaluate(`fixtureMessages[2]={...fixtureMessages[2],reactionType:'HEART'};dispatchEvent(new Event('online'))`);await delay(300);
  await assert(`document.querySelector('.chat-timeline').scrollTop===0`,'reaction update preserves older-message scroll');
  await assert(`document.documentElement.scrollWidth<=innerWidth`,'no mobile horizontal overflow');
} finally { ws?.close(); chrome.kill(); await new Promise(r=>setTimeout(r,500)); if (!resolve(dir).startsWith(resolve(tmpdir())+sep) || !dir.includes('reals-chat-smoke-')) throw Error('Unsafe temporary directory'); await rm(dir,{recursive:true,force:true,maxRetries:5}).catch(()=>{}); }
