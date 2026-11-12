// Vite on 5174; node tools/auth-controls-smoke.mjs. Isolated components with synthetic dependencies; no Firebase/backend requests.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'reals-auth-controls-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${dir}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
let ws;
try {
  let target;
  for(let i=0;i<60;i++){try{const port=(await readFile(join(dir,'DevToolsActivePort'),'utf8')).split('\n')[0];target=(await(await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t=>t.type==='page');if(target)break;}catch{}await new Promise(r=>setTimeout(r,100));}
  if(!target)throw Error('Chrome did not start');
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  let serial=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
  const call=(method,params={})=>new Promise((resolve,reject)=>{const id=++serial;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text);return r.result.value;};
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async(expression,label)=>{for(let i=0;i<120;i++){if(await evaluate(expression))return;await delay(40);}throw Error(label);};
  const check=(ok,label)=>{if(!ok)throw Error(label);console.log('PASS',label);};
  const button=async text=>{const expression=`Array.from(document.querySelectorAll('button')).find(n=>n.getClientRects().length&&(n.textContent===${JSON.stringify(text)}||n.getAttribute('aria-label')===${JSON.stringify(text)})&&!n.disabled)`;await wait(`!!(${expression})`,text);await evaluate(`(${expression}).click()`);};
  await call('Page.enable');await call('Page.navigate',{url:(process.env.REALS_SMOKE_URL??'http://127.0.0.1:5174')+'/tools/auth-controls-fixture.html'});await delay(1200);

  await evaluate(`(async()=>{
    const {default:React}=await import('/node_modules/.vite/deps/react.js'),{default:ReactDOM}=await import('/node_modules/.vite/deps/react-dom_client.js'),{LoginScreen}=await import('/src/auth/LoginScreen.tsx'),{AccountSection}=await import('/src/home/AccountSection.tsx'),{SessionController}=await import('/src/auth/session.ts'),{ApiClient}=await import('/src/auth/api.ts');
    let root;const el=document.getElementById('auth-controls-root');
    window.renderLogin=(busy=false)=>{root??=ReactDOM.createRoot(el);root.render(React.createElement(LoginScreen,{loading:busy,onSignIn:()=>{},onSignUp:()=>{},onGoogleSignIn:()=>{},onPasswordReset:()=>{}}));};
    window.renderAccount=()=>{root?.unmount();root=ReactDOM.createRoot(el);window.passwordWrites=0;const controller=new SessionController({observe:()=>()=>{},signOut:async()=>{}},new ApiClient(),false);Object.defineProperty(controller,'hasPasswordProvider',{get:()=>true});controller.changePassword=async()=>{passwordWrites++;await new Promise(resolve=>window.finishPassword=resolve)};root.render(React.createElement('main',{className:'login-page'},React.createElement('section',{className:'login-panel'},React.createElement('div',{className:'home'},React.createElement(AccountSection,{controller,disabled:false})))));};
    renderLogin();
  })()`);
  await mkdir('artifacts/auth-controls',{recursive:true});
  const screenshot=async name=>writeFile(`artifacts/auth-controls/${name}.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  const click=async selector=>{await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`);const point=await evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});await call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});};
  const key=async(value,code,virtual)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key:value,code,windowsVirtualKeyCode:virtual});await call('Input.dispatchKeyEvent',{type:'keyUp',key:value,code,windowsVirtualKeyCode:virtual});};
  const results=[];
  for(const width of [320,390,1440])for(const theme of ['light','dark']) {
    await call('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:width<768});
    await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme},{name:'prefers-reduced-motion',value:'reduce'}]});
    await evaluate('renderLogin(false)');await wait("!!document.querySelector('.login-remember input')",'login');
    // Reset through the real checkbox before testing label and keyboard activation.
    if(await evaluate("document.querySelector('.login-remember input').checked"))await click('.login-remember input');
    const row=await evaluate("(()=>{const r=document.querySelector('.login-remember').getBoundingClientRect(),i=document.querySelector('.login-remember input');return{height:r.height,width:i.getBoundingClientRect().width,appearance:getComputedStyle(i).appearance}})()");
    check(row.height>=48&&row.width===20&&row.appearance==='none','checkbox geometry '+width+' '+theme);
    await screenshot(`login-unchecked-${width}-${theme}`);
    await click('.login-remember span');check(await evaluate("document.querySelector('.login-remember input').checked"),'label click checks once');
    await key('Tab','Tab',9);await evaluate("document.querySelector('.login-remember input').focus()");await key(' ','Space',32);check(await evaluate("!document.querySelector('.login-remember input').checked"),'keyboard Space toggles');
    await key(' ','Space',32);await screenshot(`login-checked-${width}-${theme}`);
    await evaluate('renderLogin(true)');await wait("document.querySelector('.login-remember input').disabled",'busy checkbox');await click('.login-remember span');check(await evaluate("document.querySelector('.login-remember input').checked"),'busy checkbox retains selection');
    check(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'login fits viewport');
    await evaluate('renderAccount()');await button('Cambiar contrase\u00f1a de Reals');await wait("!!document.querySelector('.password-dialog[open]')",'password modal');
    const geometry=await evaluate("(()=>{const d=document.querySelector('.password-dialog'),r=d.getBoundingClientRect(),title=d.querySelector('h2');return{width:r.width,left:r.left,right:r.right,scrollWidth:d.scrollWidth,clientWidth:d.clientWidth,font:getComputedStyle(title).fontFamily,buttons:Array.from(d.querySelectorAll('button')).map(n=>n.getBoundingClientRect().height),inputs:Array.from(d.querySelectorAll('input')).map(n=>({height:n.getBoundingClientRect().height,masked:n.type==='password'})),described:!!document.getElementById(d.getAttribute('aria-describedby')),focusInside:d.contains(document.activeElement)}})()");
    check(geometry.left>=0&&geometry.right<=width&&geometry.scrollWidth<=geometry.clientWidth,'modal fits viewport '+width+' '+theme);
    check(geometry.inputs.length===3&&geometry.inputs.every(i=>i.height>=56&&i.masked)&&geometry.buttons.every(h=>h>=48),'masked fields and action targets');
    check(geometry.described&&geometry.focusInside&&geometry.font.includes('serif'),'modal semantics and typography');
    await screenshot(`password-empty-${width}-${theme}`);
    await button('Guardar contrase\u00f1a');await wait("!!document.querySelector('.password-dialog [role=alert]')",'validation feedback');check(await evaluate('passwordWrites===0'),'invalid form performs no write');await screenshot(`password-error-${width}-${theme}`);
    for(let i=0;i<3;i++){await click(`.password-fields .login-field:nth-child(${i+1}) input`);await call('Input.insertText',{text:i?'New-synthetic-password':'Current-synthetic-password'});}
    await screenshot(`password-filled-${width}-${theme}`);
    await button('Guardar contrase\u00f1a');await wait("document.querySelector('.password-dialog form').getAttribute('aria-busy')==='true'",'pending form');
    check(await evaluate("passwordWrites===1&&Array.from(document.querySelectorAll('.password-dialog input,.password-dialog button')).every(n=>n.disabled)"),'pending controls blocked');
    await key('Escape','Escape',27);check(await evaluate("!!document.querySelector('.password-dialog[open]')"),'pending Escape stays guarded');
    await evaluate('finishPassword()');await wait("!document.querySelector('.password-dialog')",'successful write closes modal');
    await button('Cambiar contrase\u00f1a de Reals');await wait("!!document.querySelector('.password-dialog[open]')",'reopen');check(await evaluate("Array.from(document.querySelectorAll('.password-dialog input')).every(n=>n.value==='')"),'reopen clears passwords');
    await key('Escape','Escape',27);await wait("!document.querySelector('.password-dialog')",'idle Escape closes');
    results.push({width,theme,row,geometry,passed:true});
    // Switch away from Account before the next login render.
    await evaluate('renderLogin(false)');
  }
  await call('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]});await wait("!!document.querySelector('.login-remember input')",'forced colors');check(await evaluate("getComputedStyle(document.querySelector('.login-remember input')).appearance==='auto'"),'forced colors uses native checkbox');
  await writeFile('artifacts/auth-controls/results.json',JSON.stringify(results,null,2));
} finally {
  ws?.close();chrome.kill();await new Promise(r=>setTimeout(r,500));
  if(!resolve(dir).startsWith(resolve(tmpdir())+sep)||!dir.includes('reals-auth-controls-'))throw Error('Unsafe temporary directory');
  await rm(dir,{recursive:true,force:true,maxRetries:5});
}
