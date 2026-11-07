import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
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
  await call('Page.navigate',{url:'http://127.0.0.1:5174'}); await new Promise(r=>setTimeout(r,1800));
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  const fixture = await call('Runtime.evaluate',{awaitPromise:true,returnByValue:true,expression:`(async()=>{
    const {default:React}=await import('/node_modules/.vite/deps/react.js'),{default:ReactDOM}=await import('/node_modules/.vite/deps/react-dom_client.js'),{FirstChat}=await import('/src/chat/FirstChat.tsx'); const {createRoot}=ReactDOM;
    document.getElementById('root').style.display='none';const el=document.createElement('div');document.body.append(el);
    const messages=[{id:'1',chatSessionId:'c',senderId:'them',clientMessageId:null,messageType:'TEXT',content:'¡Hola! ¿Cómo estás?',reactionType:null,replyTo:null,audio:null,sentAt:new Date().toISOString()}];
    const controller={snapshot:{account:{id:'me'}},request:async(path,signal,method='GET',body)=>{
      signal.throwIfAborted();
      if(path==='/matches/m'){const wait=window.reactionReadDelay??0;window.reactionReadDelay=0;if(wait)await new Promise(r=>setTimeout(r,wait));return{id:'m',userAId:'me',userBId:'them',state:'CHAT_ACTIVE'};}
      if(path==='/matches/m/chat')return{id:'c',matchId:'m',chatType:'FIRST_CHAT',status:'ACTIVE',partner:{userId:'them',displayName:'María'},myDecision:'PENDING',partnerDecision:'PENDING',timeoutAt:new Date(Date.now()+600000).toISOString(),inactivityExpiresAt:new Date(Date.now()+300000).toISOString(),serverTime:new Date().toISOString(),guidance:{question:{id:'q',instanceId:'q1',text:'Qué te inspira?'},questionOrdinal:1,maxQuestions:3,requiredParticipationScore:100,directQuestionReplyMultiplier:2,progressionAction:'NEXT_QUESTION',canRequestNext:true,myNextRequested:false,completed:false},audioPolicy:null};
      if(path.endsWith('exit-requests'))return[];
      if(path.endsWith('/reaction')){window.reactionCalls++;const id=path.split('/').at(-2);return new Promise((resolve,reject)=>{window.finishReaction=success=>{if(!success){window.reactionReadDelay=160;reject(new TypeError('Synthetic failure'));return;}const index=messages.findIndex(m=>m.id===id);messages[index]={...messages[index],reactionType:'HEART'};resolve(messages[index]);};});}
      if(path==='/chats/c/messages'&&method==='POST'){const m={...messages[0],...body,id:'2',senderId:'me',sentAt:new Date().toISOString()};messages.push(m);return m;}
      if(path.includes('/messages?'))return[...messages];throw Error('Unexpected fixture endpoint');
    }};
    let fixtureRoot;window.remountChat=()=>{fixtureRoot?.unmount();fixtureRoot=createRoot(el);fixtureRoot.render(React.createElement(React.StrictMode,null,React.createElement(FirstChat,{controller,matchId:'m',chatId:'c',onHome:()=>{}})));};window.remountChat(); window.fixtureMessages=messages; window.reactionCalls=0;
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
  const diagnose = process.argv.includes('--diagnose');
  const evidenceRoot = process.argv.includes('--composer') ? 'artifacts/first-chat-composer' : 'artifacts/first-chat-interactions';
  const evidence={gestures:[],reactions:[]};
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  const assert=(condition,label)=>{if(!condition&&!diagnose)throw Error(label);console.log(condition?'PASS':'REPRODUCED',label);};
  const point=async(selector,padding=false)=>evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});el.scrollIntoView({block:'nearest'});let r=el.getBoundingClientRect();if(!${padding}&&el.firstChild?.nodeType===Node.TEXT_NODE){const range=document.createRange();range.selectNodeContents(el);r=range.getClientRects()[0];}return {x:r.x+(${padding}?3:r.width/2),y:r.y+(${padding}?3:r.height/2)}})()`);
  const click=async selector=>{const p=await point(selector);await call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});await delay(40);};
  const clearReply=async()=>{if(await evaluate(`!!document.querySelector('.chat-composer aside')`))await click('.chat-composer aside button');await evaluate(`getSelection()?.removeAllRanges()`);};
  const seed=async count=>{await evaluate(`(()=>{const sample=fixtureMessages[0];fixtureMessages.splice(0,fixtureMessages.length,...Array.from({length:${count}},(_,i)=>({...sample,id:String(i+1),senderId:'them',reactionType:null,content:i===0?'Hola':i===2?'Un mensaje con varias líneas para probar el arrastre sobre contenido visible. '.repeat(3):'Mensaje de prueba '+i,sentAt:new Date(1000000+i*1000).toISOString()})));window.reactionCalls=0;window.remountChat();})()`);await delay(250);};
  const drag=async(selector,{touch=false,padding=false,fast=false,dx=90,dy=0,cancel=false,releaseOnly=false,shift=false}={})=>{
    const p=await point(selector,padding);await delay(30);
    const selectionsBefore=await evaluate('window.replySelections??0');
    await evaluate(`window.pointerTrace=[];window.dragTarget=document.querySelector(${JSON.stringify(selector)}).closest('.reply-swipe');void 0;`);
    if(touch)await call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...p,id:1}]});else await call('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1,modifiers:shift?8:0});
    const steps=fast?1:6;
    for(let i=1;i<=steps;i++){
      const part=releaseOnly ? .2 : i/steps;const q={x:p.x+dx*part,y:p.y+dy*part};
      if(touch)await call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...q,id:1}]});else await call('Input.dispatchMouseEvent',{type:'mouseMoved',...q,button:'left',buttons:1,modifiers:shift?8:0});
      if(!fast)await delay(25);
    }
    await evaluate(`new Promise(requestAnimationFrame)`);
    const displacement=await evaluate(`getComputedStyle(dragTarget).transform`);
    if(touch)await call('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});else await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:p.x+dx,y:p.y+dy,button:'left',clickCount:1,modifiers:shift?8:0});
    await delay(200);
    return {selected:await evaluate(`!!document.querySelector('.chat-composer aside')`),selections:await evaluate(`(window.replySelections??0)-${selectionsBefore}`),displacement,trace:await evaluate('pointerTrace')};
  };
  await evaluate(`for(const type of ['pointerdown','pointermove','pointerup','pointercancel','lostpointercapture'])document.addEventListener(type,e=>{if(e.target.closest('.reply-swipe'))pointerTrace.push({type,target:e.target.tagName,x:e.clientX,y:e.clientY});},true);window.pointerTrace=[];`);
  await call('Emulation.setTouchEmulationEnabled',{enabled:true});
  const geometry=()=>evaluate(`(()=>{const l=document.querySelector('.chat-timeline');return {scrollTop:l.scrollTop,scrollHeight:l.scrollHeight,clientHeight:l.clientHeight,top:l.getBoundingClientRect().top,status:!!document.querySelector('.chat-status'),bubbles:[...l.querySelectorAll('article')].map(e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height];})}})()`);
  const stable=(a,b)=>Math.abs(a.scrollTop-b.scrollTop)<1&&a.scrollHeight===b.scrollHeight&&a.clientHeight===b.clientHeight&&Math.abs(a.top-b.top)<1&&a.bubbles.every((r,i)=>r.every((v,j)=>Math.abs(v-b.bubbles[i][j])<1));
  for(const [width,height] of [[390,844],[1440,900]]){
    await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<768});await seed(3);
    await evaluate(`(()=>{window.replySelections=0;const input=document.querySelector('.chat-composer textarea'),focus=input.focus.bind(input);input.focus=()=>{replySelections++;focus();};})()`);
    for(const touch of [true,false])for(const fast of [true,false])for(const [label,selector,padding] of [
      ['short text','.chat-message-row:first-child p',false],['multiline text','.chat-message-row:nth-child(3) p',false],['bubble padding','.chat-message-row:first-child article',true],['question text','.chat-guidance p:nth-child(2)',false],
    ]){
      await clearReply();const result=await drag(selector,{touch,fast,padding});
      const moved=result.displacement!=='none'&&result.displacement!=='matrix(1, 0, 0, 1, 0, 0)';
      evidence.gestures.push({width,touch,fast,label,...result});
      assert(result.selected&&result.selections===1&&moved,`${width} ${touch?'touch':'mouse'} ${fast?'fast':'slow'} ${label}: ${JSON.stringify(result)}`);
    }
    await clearReply();const release=await drag('.chat-message-row:first-child article',{padding:true,fast:true,releaseOnly:true});assert(release.selected,`${width} release endpoint: ${JSON.stringify(release)}`);await clearReply();
    for(const options of [{touch:true,dx:45},{touch:false,dx:45},{touch:true,cancel:true}]){
      const result=await drag('.chat-message-row:first-child p',options);assert(!result.selected&&result.selections===0,`${width} incomplete/cancelled ${JSON.stringify(options)}`);
    }
    for(const key of ['Enter',' ']){
      await evaluate(`document.querySelector('.reply-keyboard-action').focus()`);
      await call('Input.dispatchKeyEvent',{type:'keyDown',key,code:key==='Enter'?'Enter':'Space',text:key==='Enter'?'\r':' ',windowsVirtualKeyCode:key==='Enter'?13:32});
      await call('Input.dispatchKeyEvent',{type:'keyUp',key,code:key==='Enter'?'Enter':'Space',windowsVirtualKeyCode:key==='Enter'?13:32});await delay(50);
      assert(await evaluate(`!!document.querySelector('.chat-composer aside')`),`${width} keyboard ${key==='Enter'?'Enter':'Space'}`);await clearReply();
    }
    const selection=await drag('.chat-message-row:nth-child(3) p',{shift:true});
    assert(!selection.selected&&await evaluate(`getSelection().toString().length>0`),`${width} native Shift-drag text selection`);await clearReply();
    const word=await point('.chat-message-row:first-child p');
    await call('Input.dispatchMouseEvent',{type:'mousePressed',...word,button:'left',clickCount:2});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...word,button:'left',clickCount:2});
    assert(await evaluate(`getSelection().toString().length>0&&!document.querySelector('.chat-composer aside')`),`${width} native double-click selection`);await clearReply();
    await seed(30);await evaluate(`document.querySelector('.chat-timeline').scrollTop=0`);await delay(50);
    const vertical=await drag('.chat-message-row:nth-child(3) p',{touch:true,dx:2,dy:-100});
    assert(!vertical.selected&&await evaluate(`document.querySelector('.chat-timeline').scrollTop>0`),`${width} native vertical scroll over text`);
    for(const mode of ['bottom','older','near-bottom'])for(const success of [true,false]){
      await seed(30);
      const index=mode==='bottom'?29:mode==='older'?0:28;
      await evaluate(`(()=>{const l=document.querySelector('.chat-timeline');l.scrollTop=${mode==='older'?'0':mode==='near-bottom'?'l.scrollHeight-l.clientHeight-30':'l.scrollHeight'};})()`);await delay(100);
      const before=await geometry();
      // Click without scrollIntoView: moving the viewport would invalidate the measurement.
      const q=await evaluate(`(()=>{const r=document.querySelectorAll('.chat-heart')[${index}].getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      for(let i=0;i<2;i++){await call('Input.dispatchMouseEvent',{type:'mousePressed',...q,button:'left',clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',...q,button:'left',clickCount:1});}
      await delay(100);const pending=await geometry();await evaluate(`finishReaction(${success})`);await delay(50);const reconciling=await geometry();await delay(250);const after=await geometry();
      evidence.reactions.push({width,mode,success,before,pending,reconciling,after});
      console.log('Reaction geometry',JSON.stringify({width,mode,success,before,pending,reconciling,after}));
      assert(stable(before,pending)&&stable(before,reconciling)&&stable(before,after),`${width} reaction ${mode} ${success?'success':'failure'} has no visual displacement`);
      assert(await evaluate(`reactionCalls===1`),'rapid repeated clicks submit only once');
      if(!success){
        assert(await evaluate(`!!document.querySelector('[role=alert] button')`),'failure exposes retry');
        if(mode==='older'){
          await mkdir(evidenceRoot,{recursive:true});
          await writeFile(`${evidenceRoot}/${width}-reaction-error.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
        }
        await click('[role=alert] button');assert(stable(before,await geometry()),'recovery preserves geometry too');
      }
    }
  }
  await mkdir(evidenceRoot,{recursive:true});
  await writeFile(evidenceRoot+'/regression-after.json',JSON.stringify(evidence,null,2));
} finally { ws?.close(); chrome.kill(); await new Promise(r=>setTimeout(r,500)); if (!resolve(dir).startsWith(resolve(tmpdir())+sep) || !dir.includes('reals-chat-smoke-')) throw Error('Unsafe temporary directory'); await rm(dir,{recursive:true,force:true,maxRetries:5}).catch(()=>{}); }
