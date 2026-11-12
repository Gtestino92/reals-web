// Start a fresh Vite process on 5175 (no prior HMR edits); node tools/admin-smoke.mjs. Synthetic identities/API only.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
const dir=await mkdtemp(join(tmpdir(),'reals-admin-'));
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
  await call('Page.enable');await call('Page.navigate',{url:'http://127.0.0.1:5175/admin'});await delay(1200);
  await evaluate(`(async()=>{
    const {default:React}=await import('/node_modules/.vite/deps/react.js'),{default:ReactDOM}=await import('/node_modules/.vite/deps/react-dom_client.js'),{OperationalApp}=await import('/src/App.tsx'),{ApiClient}=await import('/src/auth/api.ts'),fixtures=await import('/src/admin/fixtures.ts'),{defaults}=await import('/src/onboarding/contracts.ts'),{emptyHome,homeStatus}=await import('/src/home/fixtures.ts');
    document.getElementById('root').remove();const el=document.createElement('div');document.body.append(el);let root;
    window.renderAdmin=(admin=true,regular=false,provider='google.com',login=false)=>{root?.unmount();history.replaceState(null,'',regular?'/':'/admin');window.writes=[];window.calls=[];window.queue=Array.from({length:21},(_,i)=>({...fixtures.photo,photoId:'p'+i,displayName:'Foto '+i,readUrl:'data:invalid'}));
      let next;window.replaceIdentity=()=>next({uid:'ordinary',emailVerified:true,getIdToken:async()=>'ordinary',reload:async()=>{}});
      root=ReactDOM.createRoot(el);root.render(React.createElement(OperationalApp,{firebase:{service:{googleContext:async()=>({provider,authTime:Date.now()}),reauthenticateGoogle:async()=>{},observe:observer=>{next=observer;observer(login?null:{uid:admin?'admin':'ordinary',emailVerified:true,getIdToken:async()=>admin?'admin':'ordinary',reload:async()=>{}});return()=>{}},signIn:async()=>({uid:'admin',emailVerified:true,getIdToken:async()=>'admin',reload:async()=>{}}),google:async()=>({uid:'admin',emailVerified:true,getIdToken:async()=>'admin',reload:async()=>{}}),signOut:async()=>next(null)},localVerification:false},api:new ApiClient(async(path,o)=>{window.calls.push(path);if(o.headers['X-Firebase-AppCheck']!=='synthetic-app-check')throw Error('Missing App Check');if(path.startsWith('/api/admin/')&&o.headers['X-Reals-Admin-Grant']!=='A'.repeat(43))throw Error('Missing grant');let data,status=200;
        if(path==='/api/me'){if(window.pauseBootstrap)await new Promise(resolve=>{window.finishBootstrap=resolve});data={id:'u',status:'ACTIVE'};}
        else if(path==='/api/me/profile')data={...defaults,id:'p',userId:'u',status:'ACTIVE',displayName:'Operador',birthDate:'1990-01-01',city:'Ciudad',countryCode:'AR',authenticityVerificationStatus:'STALE'};
        else if(path==='/api/me/home')data=emptyHome();
        else if(path==='/api/me/home/status')data=homeStatus();
        else if(path==='/api/reference/affinity-questions')data={catalogVersion:'empty',categories:[],questions:[]};
        else if(path==='/api/me/profile/affinity-answers')data={answers:[]};
        else if(o.headers.Authorization==='Bearer ordinary'){status=403;data={code:'ADMIN_ACCESS_DENIED'};}
        else if(path.endsWith('/admin-auth/status'))data={configured:true,grantValid:o.headers['X-Reals-Admin-Grant']==='A'.repeat(43)};
        else if(path.endsWith('/admin-auth/verify')){if(JSON.parse(o.body).code!=='012345')throw Error('Leading zeros lost');if(window.verifyFailure){const code=window.verifyFailure;window.verifyFailure=null;return new Response(JSON.stringify({code}),{status:code==='ADMIN_MFA_RATE_LIMITED'?429:400,headers:{'Retry-After':'1'}});}data={grant:'A'.repeat(43),expiresAt:new Date(Date.now()+900000).toISOString()};}
        else if(path.endsWith('/admin-auth/revoke'))return new Response(null,{status:204});

        else if(o.method==='POST'){window.writes.push(JSON.parse(o.body));await new Promise(r=>setTimeout(r,100));window.queue=[];data={...fixtures.photo,moderationStatus:'APPROVED'};}
        else if(path.endsWith('/diagnostics/matchmaking'))data=fixtures.diag;
        else if(path.endsWith('/profile-photos/review'))data=window.queue;
        else if(path.endsWith('/safety-reports/pending'))data=[fixtures.summary];
        else if(path.endsWith('/safety-reports/report'))data={report:fixtures.summary,details:'<script>untrusted</script>',messages:[],evidence:null,penalty:null};
        else if(path.endsWith('/penalty-appeals/pending'))data=[fixtures.appeal];
        else {status=404;data={code:'NOT_FOUND'};}
        return new Response(JSON.stringify(data),{status});}).withAppCheck(async()=>'synthetic-app-check')}));};
  })()`);
  await mkdir('artifacts/admin',{recursive:true});const results=[];
  for(const width of [390,1440]){
    await call('Emulation.setDeviceMetricsOverride',{width,height:width<700?844:900,deviceScaleFactor:1,mobile:width<700});
    await evaluate("window.pauseBootstrap=true;renderAdmin(true,true,'google.com',true)");
    await writeFile(`artifacts/admin/login-${width}.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await evaluate("window.loginPanel=document.querySelector('.login-panel');window.loginEmail=document.querySelector('input[type=email]');window.loginOrigin=performance.timeOrigin");
    await button('Continuar con Google');await wait('!!window.finishBootstrap','deferred bootstrap');
    check(await evaluate("loginPanel===document.querySelector('.login-panel')&&loginEmail===document.querySelector('input[type=email]')&&loginEmail.disabled"),'login shell and input retained during backend bootstrap');
    check(await evaluate("performance.timeOrigin===loginOrigin&&!document.body.textContent.includes('Preparando Reals')&&document.body.textContent.includes('Preparando tu sesión')"),'no document reload or intermediate bootstrap screen');
    await writeFile(`artifacts/admin/login-bootstrap-${width}.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await evaluate('window.pauseBootstrap=false;window.finishBootstrap();window.finishBootstrap=null');
    await wait("!!document.querySelector('.home-admin-entry:not(:disabled)')",'early eligible Home header');
    check(await evaluate("document.querySelector('.home-admin-entry').closest('header').classList.contains('home-heading')&&!Array.from(document.querySelectorAll('button')).some(n=>n.textContent==='Actualizar')"),'Home header owns Admin without healthy refresh');
    await writeFile(`artifacts/admin/home-${width}.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await evaluate("window.homeBeforeMfa=document.querySelector('.home');document.querySelector('.home-admin-entry').focus()");
    await button('Admin');await wait("!!document.querySelector('dialog[open] #admin-totp')",'MFA modal over Reals');
    check(await evaluate("location.pathname==='/'&&document.querySelector('.home')===homeBeforeMfa&&document.querySelectorAll('.admin-otp-slots span').length===6"),'MFA retains Home and route with six visual slots');
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    check(await evaluate("!!document.activeElement.closest('dialog')"),'native modal contains keyboard focus');
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await wait("!document.querySelector('dialog')&&document.activeElement===document.querySelector('.home-admin-entry')",'Escape restores Admin focus');
    check(await evaluate("document.querySelector('.home')===homeBeforeMfa&&location.pathname==='/'&&calls.every(p=>!p.startsWith('/api/admin/'))"),'cancel preserves Home and never loads private resources');
    await button('Admin');
    await wait("!!document.getElementById('admin-totp')",'MFA input');
    check(await evaluate("calls.every(p=>!p.startsWith('/api/admin/'))"),'no privileged requests before MFA');
    check(await evaluate("document.getElementById('admin-totp').inputMode==='numeric'&&document.getElementById('admin-totp').type==='text'"),'numeric keyboard with leading-zero preservation');
    await writeFile(`artifacts/admin/mfa-${width}.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    check(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'MFA responsive width');
    await evaluate("document.getElementById('admin-totp').focus()");await call('Input.insertText',{text:'01234'});
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
    check(await evaluate("document.getElementById('admin-totp').value==='0123'&&document.querySelector('.admin-otp-slots').textContent==='0123'&&calls.every(p=>!p.endsWith('/verify'))"),'native OTP editing and Backspace preserve leading zeros without early submit');
    await evaluate("document.getElementById('admin-totp').select()");await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
    for(const failure of ['ADMIN_MFA_INVALID_CODE','ADMIN_MFA_RATE_LIMITED']){
      await evaluate(`window.verifyFailure=${JSON.stringify(failure)};document.getElementById('admin-totp').focus()`);await call('Input.insertText',{text:'012345'});
      await wait("!!document.querySelector('[role=alert]')",'explicit MFA failure');
      check(await evaluate("calls.every(p=>!p.startsWith('/api/admin/'))"),'MFA failure never loads privileged resources');
      if(!await evaluate("!!document.getElementById('admin-totp')"))throw Error('MFA failure must retain the code form');
      check(await evaluate("document.getElementById('admin-totp').value===''"),'submitted code cleared');
      await wait("!document.getElementById('admin-totp').disabled",'Retry-After cooldown');
    }
    await evaluate("document.getElementById('admin-totp').focus()");await call('Input.insertText',{text:'012345'});
    await button('Siguiente');await wait("document.body.textContent.includes('Foto 20')",'local page 2');
    const beforeSwitch=await evaluate("({timeOrigin:performance.timeOrigin,verifies:calls.filter(p=>p==='/api/admin-auth/verify').length,bootstraps:calls.filter(p=>p==='/api/me').length})");
    await evaluate("window.panelBeforeSwitch=document.querySelector('main');window.visibilityProbe={hidden:0,pagehide:0};document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')visibilityProbe.hidden++});window.addEventListener('pagehide',()=>visibilityProbe.pagehide++)");
    const other=await call('Target.createTarget',{url:'about:blank'});await call('Target.activateTarget',{targetId:other.targetId});await delay(1000);
    await call('Target.activateTarget',{targetId:target.id});await wait("document.visibilityState==='visible'",'return to Reals tab');await delay(100);
    const afterSwitch=await evaluate("({timeOrigin:performance.timeOrigin,verifies:calls.filter(p=>p==='/api/admin-auth/verify').length,bootstraps:calls.filter(p=>p==='/api/me').length,revokes:calls.filter(p=>p==='/api/admin-auth/revoke').length,samePanel:panelBeforeSwitch===document.querySelector('main'),probe:visibilityProbe})");
    check(afterSwitch.probe.hidden>0&&afterSwitch.probe.pagehide===0,'unrelated tab triggers visibility, not pagehide');
    check(beforeSwitch.timeOrigin===afterSwitch.timeOrigin,'same document after tab switch');
    check(afterSwitch.samePanel,'same backoffice DOM after tab switch');
    check(afterSwitch.revokes===0&&afterSwitch.verifies===beforeSwitch.verifies&&afterSwitch.bootstraps===beforeSwitch.bootstraps,'no revoke, MFA retry or Firebase bootstrap on tab switch');
    await call('Target.closeTarget',{targetId:other.targetId});
    if(!await evaluate("document.body.textContent.includes('Foto 20')"))await button('Siguiente');await button('Foto 20 · Posición 1');await button('Aprobar fotografía');
    check(await evaluate("document.activeElement.textContent==='Cancelar'"),'confirmation cancel focus');
    check(await evaluate('writes.length===0'),'no optimistic write');
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await wait("!document.querySelector('dialog')",'Escape closes');
    await button('Aprobar fotografía');await button('Confirmar decisión');await wait("document.body.textContent.includes('No hay elementos.')",'authoritative queue refresh');
    check(await evaluate('writes.length===1&&writes[0].expectedPhotoVersion===42'),'exact version once');
    await button('Apelaciones');await button('penalty');await button('Ver reporte de origen');
    await wait("document.body.textContent.includes('<script>untrusted</script>')",'authoritative source detail');
    check(await evaluate("!document.querySelector('[aria-label=Lista]')&&!document.querySelector('select')&&!Array.from(document.querySelectorAll('button')).some(n=>n.textContent==='penalty'||n.textContent==='Siguiente')"),'context excludes appeal rows, filters and pagination');
    check(await evaluate("calls.filter(x=>x.includes('/safety-reports')).join(',')==='/api/admin/safety-reports/report'"),'source context fetches detail only');
    await evaluate("document.dispatchEvent(new Event('visibilitychange'))");await wait("!!document.querySelector('[aria-label=Detalle]')",'source remains visible');
    check(await evaluate("calls.filter(x=>x.includes('/safety-reports')).every(x=>x==='/api/admin/safety-reports/report')"),'refresh keeps source context');
    await button('Volver a Apelaciones');await button('penalty');
    check(await evaluate("!document.body.textContent.includes('<script>untrusted</script>')"),'return clears source evidence');
    await button('Ver reporte de origen');await wait("document.body.textContent.includes('<script>untrusted</script>')",'reopen source');
    check(await evaluate("!document.querySelector('script[src=untrusted]')"),'no raw report HTML');
    await writeFile(`artifacts/admin/admin-${width}.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    check(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'responsive width');
    const modeTimeOrigin=await evaluate('performance.timeOrigin');
    const issuedVerifies=await evaluate("calls.filter(p=>p==='/api/admin-auth/verify').length");
    await button('Volver a Reals');await wait("location.pathname==='/'&&document.body.textContent.includes('Cuenta')",'ordinary Account mode');
    check(await evaluate("!document.body.textContent.includes('<script>untrusted</script>')&&!document.querySelector('.admin')"),'normal mode removes all private backoffice DOM');
    check(await evaluate("calls.every(p=>p!=='/api/admin-auth/revoke')"),'mode switch retains authorization');
    await wait("Array.from(document.querySelectorAll('button')).some(n=>n.textContent==='Admin'&&!n.disabled)",'eligible Home header entry');
    await writeFile(`artifacts/admin/account-mode-${width}.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    check(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'Home header entry responsive width');
    await button('Admin');await wait("!!document.querySelector('.admin [aria-label=Lista]')",'return with retained grant');
    check(await evaluate("calls.filter(p=>p==='/api/admin-auth/verify').length")===issuedVerifies,'return uses status without another TOTP');
    await call('Page.getNavigationHistory').then(async history=>{await call('Page.navigateToHistoryEntry',{entryId:history.entries[history.currentIndex-1].id});});
    await wait("location.pathname==='/'&&!document.querySelector('.admin')",'browser Back switches mode');
    await call('Page.getNavigationHistory').then(async history=>{await call('Page.navigateToHistoryEntry',{entryId:history.entries[history.currentIndex+1].id});});
    await wait("location.pathname==='/admin'&&!!document.querySelector('.admin [aria-label=Lista]')",'browser Forward checks grant and restores admin');
    check(await evaluate('performance.timeOrigin')===modeTimeOrigin,'mode Back/Forward never reloads document');
    await evaluate('replaceIdentity()');await wait("document.body.textContent.includes('Acceso administrativo denegado')",'identity replacement denied');
    check(await evaluate("!document.body.textContent.includes('untrusted')"),'private evidence cleared');
    await evaluate('renderAdmin(false)');await wait("document.body.textContent.includes('Acceso administrativo denegado')",'ordinary identity denied');
    check(await evaluate("calls.filter(x=>x.includes('/admin/')).length===0"),'nonadmin never loads privileged resources');
    await evaluate("renderAdmin(true,true,'password')");await wait("!!document.querySelector('.home[aria-busy=false]')",'password Home');await delay(150);
    check(await evaluate("!Array.from(document.querySelectorAll('button')).some(n=>n.textContent==='Admin')&&calls.every(p=>!p.includes('/admin'))"),'password session has no admin entry or eligibility request');
    await evaluate("renderAdmin(false,true)");await wait("!!document.querySelector('.home[aria-busy=false]')",'ordinary Google Home');await delay(150);
    check(await evaluate("!Array.from(document.querySelectorAll('button')).some(n=>n.textContent==='Admin')"),'ordinary Google account has no admin entry');
    await evaluate("renderAdmin(true,true)");await button('Admin');await wait("!!document.getElementById('admin-totp')",'eligible Google entry needs no prior grant');
    check(await evaluate("calls.every(p=>!p.startsWith('/api/admin/'))"),'eligibility alone never loads privileged resources');
    check(await evaluate('localStorage.length===0&&sessionStorage.length===0'),'no persistent admin data');results.push({width,passed:true});
  }
  await writeFile('artifacts/admin/results.json',JSON.stringify(results,null,2));
} finally {
  ws?.close();chrome.kill();await new Promise(r=>setTimeout(r,500));
  if(!resolve(dir).startsWith(resolve(tmpdir())+sep)||!dir.includes('reals-admin-'))throw Error('Unsafe temporary directory');
  await rm(dir,{recursive:true,force:true,maxRetries:5});
}
