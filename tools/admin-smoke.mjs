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
  const button=async text=>{const expression=`Array.from(document.querySelectorAll('button')).find(n=>n.getClientRects().length&&n.textContent===${JSON.stringify(text)}&&!n.disabled)`;await wait(`!!(${expression})`,text);await evaluate(`(${expression}).click()`);};
  await call('Page.enable');await call('Page.navigate',{url:'http://127.0.0.1:5175/admin'});await delay(1200);
  await evaluate(`(async()=>{
    const {default:React}=await import('/node_modules/.vite/deps/react.js'),{default:ReactDOM}=await import('/node_modules/.vite/deps/react-dom_client.js'),{OperationalApp}=await import('/src/App.tsx'),{ApiClient}=await import('/src/auth/api.ts'),fixtures=await import('/src/admin/fixtures.ts');
    document.getElementById('root').remove();const el=document.createElement('div');document.body.append(el);let root;
    window.renderAdmin=(admin=true)=>{root?.unmount();history.replaceState(null,'','/admin');window.writes=[];window.calls=[];window.queue=Array.from({length:21},(_,i)=>({...fixtures.photo,photoId:'p'+i,displayName:'Foto '+i,readUrl:'data:invalid'}));
      let next;window.replaceIdentity=()=>next({uid:'ordinary',emailVerified:true,getIdToken:async()=>'ordinary',reload:async()=>{}});
      root=ReactDOM.createRoot(el);root.render(React.createElement(OperationalApp,{firebase:{service:{googleContext:async()=>({provider:'google.com',authTime:Date.now()}),reauthenticateGoogle:async()=>{},observe:observer=>{next=observer;observer({uid:admin?'admin':'ordinary',emailVerified:true,getIdToken:async()=>admin?'admin':'ordinary',reload:async()=>{}});return()=>{}},signOut:async()=>next(null)},localVerification:false},api:new ApiClient(async(path,o)=>{window.calls.push(path);if(o.headers['X-Firebase-AppCheck']!=='synthetic-app-check')throw Error('Missing App Check');if(path.startsWith('/api/admin/')&&o.headers['X-Reals-Admin-Grant']!=='A'.repeat(43))throw Error('Missing grant');let data,status=200;
        if(path==='/api/me')data={id:'u',status:'ACTIVE'};
        else if(path==='/api/me/profile')data={id:'p',userId:'u',status:'DRAFT'};
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
    await evaluate('renderAdmin()');
    await wait("!!document.getElementById('admin-totp')",'MFA input');
    check(await evaluate("calls.every(p=>!p.startsWith('/api/admin/'))"),'no privileged requests before MFA');
    check(await evaluate("document.getElementById('admin-totp').inputMode==='numeric'&&document.getElementById('admin-totp').type==='text'"),'numeric keyboard with leading-zero preservation');
    await writeFile(`artifacts/admin/mfa-${width}.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    check(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'MFA responsive width');
    for(const failure of ['ADMIN_MFA_INVALID_CODE','ADMIN_MFA_RATE_LIMITED']){
      await evaluate(`window.verifyFailure=${JSON.stringify(failure)};document.getElementById('admin-totp').focus()`);await call('Input.insertText',{text:'012345'});await button('Verificar c\u00f3digo');
      await wait("!!document.querySelector('[role=alert]')",'explicit MFA failure');
      check(await evaluate("calls.every(p=>!p.startsWith('/api/admin/'))"),'MFA failure never loads privileged resources');
      if(!await evaluate("!!document.getElementById('admin-totp')"))throw Error('MFA failure must retain the code form');
      check(await evaluate("document.getElementById('admin-totp').value===''"),'submitted code cleared');
      await wait("!document.getElementById('admin-totp').disabled",'Retry-After cooldown');
    }
    await evaluate("document.getElementById('admin-totp').focus()");await call('Input.insertText',{text:'012345'});await button('Verificar c\u00f3digo');
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
    await button('Foto 20 · Posición 1');await button('Aprobar fotografía');
    check(await evaluate("document.activeElement.textContent==='Cancelar'"),'confirmation cancel focus');
    check(await evaluate('writes.length===0'),'no optimistic write');
    await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await wait("!document.querySelector('dialog')",'Escape closes');
    await button('Aprobar fotografía');await button('Confirmar decisión');await wait("document.body.textContent.includes('No hay elementos.')",'authoritative queue refresh');
    check(await evaluate('writes.length===1&&writes[0].expectedPhotoVersion===42'),'exact version once');
    await button('Apelaciones');await button('penalty');await button('Ver reporte de origen');
    await wait("document.body.textContent.includes('<script>untrusted</script>')",'authoritative source detail');
    check(await evaluate("!document.querySelector('[aria-label=Lista]')&&!document.querySelector('select')&&!Array.from(document.querySelectorAll('button')).some(n=>n.textContent==='penalty'||n.textContent==='Siguiente')"),'context excludes appeal rows, filters and pagination');
    check(await evaluate("calls.filter(x=>x.includes('/safety-reports')).join(',')==='/api/admin/safety-reports/report'"),'source context fetches detail only');
    await button('Actualizar');await wait("!!document.querySelector('[aria-label=Detalle]')",'source refresh');
    check(await evaluate("calls.filter(x=>x.includes('/safety-reports')).every(x=>x==='/api/admin/safety-reports/report')"),'refresh keeps source context');
    await button('Volver a Apelaciones');await button('penalty');
    check(await evaluate("!document.body.textContent.includes('<script>untrusted</script>')"),'return clears source evidence');
    await button('Ver reporte de origen');await wait("document.body.textContent.includes('<script>untrusted</script>')",'reopen source');
    check(await evaluate("!document.querySelector('script[src=untrusted]')"),'no raw report HTML');
    await writeFile(`artifacts/admin/admin-${width}.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
    check(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'responsive width');
    await evaluate('replaceIdentity()');await wait("document.body.textContent.includes('Acceso administrativo denegado')",'identity replacement denied');
    check(await evaluate("!document.body.textContent.includes('untrusted')"),'private evidence cleared');
    await evaluate('renderAdmin(false)');await wait("document.body.textContent.includes('Acceso administrativo denegado')",'ordinary identity denied');
    check(await evaluate("calls.filter(x=>x.includes('/admin/')).length===0"),'nonadmin never loads privileged resources');
    check(await evaluate('localStorage.length===0&&sessionStorage.length===0'),'no persistent admin data');results.push({width,passed:true});
  }
  await writeFile('artifacts/admin/results.json',JSON.stringify(results,null,2));
} finally {
  ws?.close();chrome.kill();await new Promise(r=>setTimeout(r,500));
  if(!resolve(dir).startsWith(resolve(tmpdir())+sep)||!dir.includes('reals-admin-'))throw Error('Unsafe temporary directory');
  await rm(dir,{recursive:true,force:true,maxRetries:5});
}
