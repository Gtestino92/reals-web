// Synthetic Firebase/HTTP only. Start fresh Vite on 5175, then run this file.
// --baseline records the reviewed behavior; --quick skips the four 60-second waits.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
const baseline = process.argv.includes('--baseline'), quick = process.argv.includes('--quick');
const run = baseline ? 'before' : quick ? 'quick' : 'after';
const dir = await mkdtemp(join(tmpdir(), 'reals-lifecycle-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
let ws;
await mkdir('artifacts/lifecycle', { recursive: true });
// An isolated page avoids initializing real Firebase or reading local configuration.
await writeFile('artifacts/lifecycle/fixture.html', '<!doctype html><html lang="es"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>', 'utf8');
try {
  let target;
  for (let i = 0; i < 100; i++) { try { const port = (await readFile(join(dir, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === 'page'); if (target) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  if (!target) throw Error('Chromium did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let serial = 0; const pending = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (!m.id) return; const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const wait = async (expression, label) => { for (let i = 0; i < 200; i++) { if (await evaluate(expression)) return; await delay(40); } throw Error(label + ' ' + JSON.stringify(await evaluate('({phases:probe.phases,hmr:probe.hmr,mounts:probe.mounts})'))); };
  const check = (ok, label) => { if (!ok) throw Error(label); console.log('PASS', label); };
  const button = async text => { const expr = `Array.from(document.querySelectorAll('button')).find(n=>n.getClientRects().length&&n.textContent===${JSON.stringify(text)}&&!n.disabled)`; await wait(`!!(${expr})`, text); await evaluate(`(${expr}).focus();(${expr}).click()`); };
  const shot = async name => writeFile(`artifacts/lifecycle/${run}-${name}.png`, Buffer.from((await call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await call('Page.enable');
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.probe={document:crypto.randomUUID(),events:[],mounts:{},unmounts:{},mountEvents:[],phases:['checking'],ownership:[],shifts:[],hmr:[],otp:[],rootCount:0};
    const roots=new WeakSet();
    const names=new Set(['App','TabGate','OperationalApp','SessionApp','ReadySession','Home','HomeOverview','LoginScreen','Admin','AdminGate']);let previous=new Map(),ids=new WeakMap(),serial=0;
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__={supportsFiber:true,renderers:new Map(),inject:()=>1,onCommitFiberRoot:(_id,root)=>{if(!roots.has(root)){roots.add(root);probe.rootCount++;}const current=new Map();const walk=f=>{if(!f)return;const name=f.type?.name;if(names.has(name)){let id=ids.get(f)||ids.get(f.alternate);if(!id)id=++serial;ids.set(f,id);current.set(id,name);}walk(f.child);walk(f.sibling);};walk(root.current);for(const[id,name]of current)if(!previous.has(id)){probe.mounts[name]=(probe.mounts[name]||0)+1;probe.mountEvents.push({name,event:'mount',time:performance.now()});}for(const[id,name]of previous)if(!current.has(id)){probe.unmounts[name]=(probe.unmounts[name]||0)+1;probe.mountEvents.push({name,event:'unmount',time:performance.now()});}previous=current;},onCommitFiberUnmount:()=>{}};
    for(const name of ['visibilitychange','focus','blur','pagehide','pageshow'])addEventListener(name,e=>probe.events.push({name,visible:document.visibilityState,persisted:e.persisted??null,time:performance.now()}));
    new PerformanceObserver(list=>{for(const e of list.getEntries())probe.shifts.push({value:e.value,time:e.startTime,recent:e.hadRecentInput});}).observe({type:'layout-shift',buffered:true});
  ` });
  const results = [], extraLogins = [];
  for (const width of [390, 1440]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: width < 700 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 700 });
    await call('Emulation.setTouchEmulationEnabled', { enabled: width < 700 });
    for (const ownership of [false, true]) {
      await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: ownership ? 'reduce' : 'no-preference' }] });
      await call('Page.navigate', { url: 'http://127.0.0.1:5175/artifacts/lifecycle/fixture.html' }); await delay(300);
      await evaluate(`(async()=>{
        const RefreshRuntime=(await import('/@react-refresh')).default;RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
        const {createHotContext}=await import('/@vite/client');const hot=createHotContext('/tools/lifecycle-probe');for(const name of ['vite:beforeFullReload','vite:beforeUpdate'])hot.on(name,()=>probe.hmr.push(name));
        const React=(await import('/node_modules/.vite/deps/react.js')).default,ReactDOM=(await import('/node_modules/.vite/deps/react-dom_client.js')).default;
        await import('/src/styles/tokens.css');await import('/src/styles/global.css');
        const {App}=await import('/src/App.tsx'),{SessionController}=await import('/src/auth/session.ts'),{TabOwnershipManager}=await import('/src/tabs/TabOwnershipManager.ts'),{ApiClient}=await import('/src/auth/api.ts'),{defaults}=await import('/src/onboarding/contracts.ts'),{emptyHome,homeStatus}=await import('/src/home/fixtures.ts'),fixtures=await import('/src/admin/fixtures.ts');
        const install=SessionController.prototype.install;SessionController.prototype.install=function(patch){install.call(this,patch);if(probe.phases.at(-1)!==this.getSnapshot().phase)probe.phases.push(this.getSnapshot().phase);};
        const ownInstall=TabOwnershipManager.prototype.install;TabOwnershipManager.prototype.install=function(state){probe.ownership.push(state);ownInstall.call(this,state);};
        window.calls=[];window.pauseBootstrap=true;window.pauseSignIn=true;window.pauseRead=false;window.homeVersion=1;window.reads=[];window.observer=null;window.granted=false;
        const user={uid:'synthetic-admin',emailVerified:true,getIdToken:async()=>'synthetic-id',reload:async()=>{}};
        const auth={observe:next=>{let active=true;window.observer=next;window.releaseObserve=(restore=false)=>{if(active)next(restore?user:null);};return()=>{active=false;};},signIn:async()=>{if(pauseSignIn)await new Promise(r=>window.finishSignIn=r);window.activeProvider='password';return user;},google:async()=>{if(pauseSignIn)await new Promise(r=>window.finishSignIn=r);return user;},signOut:async()=>observer(null),googleContext:async()=>({provider:window.activeProvider??'google.com',authTime:Date.now()}),reauthenticateGoogle:async()=>{}};
        const api=new ApiClient(async(path,options)=>{
          calls.push({path,method:options.method});const headers=new Headers(options.headers);let data;
          if(path==='/api/me'){if(pauseBootstrap)await new Promise(r=>window.finishBootstrap=r);data={id:'u',status:'ACTIVE'};}
          else if(path==='/api/me/profile')data={...defaults,id:'p',userId:'u',status:'ACTIVE',displayName:'Operador',birthDate:'1990-01-01',city:'Ciudad',countryCode:'AR'};
          else if(path==='/api/me/home/status')data={...homeStatus(),version:homeVersion};
          else if(path==='/api/me/home') {if(pauseRead)await new Promise(r=>reads.push(r));data=emptyHome();}
          else if(path==='/api/reference/affinity-questions')data={catalogVersion:'empty',categories:[],questions:[]};
          else if(path==='/api/me/profile/affinity-answers')data={answers:[]};
          else if(path==='/api/admin-auth/status'){if(window.pauseStatus&&granted)await new Promise(r=>window.finishStatus=r);data={configured:true,grantValid:granted&&headers.get('X-Reals-Admin-Grant')==='A'.repeat(43)};}
          else if(path==='/api/admin-auth/verify'){if(window.pauseVerify)await new Promise(r=>window.finishVerify=r);if(window.invalidVerify){invalidVerify=false;return new Response(JSON.stringify({code:'ADMIN_MFA_INVALID_CODE'}),{status:400,headers:{'Retry-After':'1'}});}granted=true;data={grant:'A'.repeat(43),expiresAt:new Date(Date.now()+900000).toISOString()};}
          else if(path==='/api/admin-auth/revoke')return new Response(null,{status:204});
          else if(path.endsWith('/diagnostics/matchmaking'))data=fixtures.diag;
          else if(path.endsWith('/profile-photos/review')){if(pauseRead)await new Promise(r=>reads.push(r));data=Array.from({length:25},(_,i)=>({...fixtures.photo,photoId:'p'+i,displayName:'Foto '+i,readUrl:'data:invalid'}));}
          else return new Response('{}',{status:404});
          return new Response(JSON.stringify(data));
        }).withAppCheck(async()=>'synthetic-app-check');
        let root;window.renderSession=()=>{root?.unmount();window.releaseObserve=null;window.finishSignIn=null;window.finishBootstrap=null;window.activeProvider='google.com';window.pauseBootstrap=true;window.pauseSignIn=true;root=ReactDOM.createRoot(document.getElementById('root'));root.render(React.createElement(React.StrictMode,null,React.createElement(App,{firebase:{service:auth,localVerification:false},api,...(${ownership}?{ownership:new TabOwnershipManager()}: {})})));};window.renderSession();
        window.bounds=()=>Object.fromEntries(['.login-panel','#login-email','#login-password','.login-google'].map(s=>{const b=document.querySelector(s)?.getBoundingClientRect();return[s,b?{x:b.x,y:b.y,width:b.width,height:b.height}:null];}));
      })()`);
      await wait("!!window.releaseObserve", 'checking observer'); const checking = await evaluate('bounds()');
      await evaluate('releaseObserve()'); await wait("probe.phases.includes('login')", 'login ready');
      const login = await evaluate('bounds()'); await shot(`login-${width}-${ownership}`);
      await button('Continuar con Google'); await wait('!!window.finishSignIn', 'authenticating'); const authenticating = await evaluate('bounds()');
      await evaluate('pauseSignIn=false;finishSignIn()'); await wait('!!window.finishBootstrap', 'bootstrap pending'); const loading = await evaluate('bounds()'); await shot(`bootstrap-${width}-${ownership}`);
      if (!baseline) check(login['#login-email'].y === loading['#login-email'].y && login['.login-panel'].height === loading['.login-panel'].height, 'login bounds stable during bootstrap');
      await evaluate('pauseBootstrap=false;finishBootstrap()'); await wait("!!document.querySelector('.home[aria-busy=false] .home-admin-entry')", 'Home ready');
      const snapshot = () => evaluate(`({document:probe.document,timeOrigin:performance.timeOrigin,rootCount:probe.rootCount,navigation:performance.getEntriesByType('navigation').map(n=>({type:n.type,activationStart:n.activationStart})),mounts:{...probe.mounts},unmounts:{...probe.unmounts},mountEvents:[...probe.mountEvents],phases:[...probe.phases],ownership:[...probe.ownership],events:[...probe.events],hmr:[...probe.hmr],shifts:[...probe.shifts],otp:[...probe.otp],bootstraps:calls.filter(c=>c.path==='/api/me').length,verifies:calls.filter(c=>c.path==='/api/admin-auth/verify').length,revokes:calls.filter(c=>c.path==='/api/admin-auth/revoke').length})`);
      for (const mode of ['home', 'admin']) {
        if (mode === 'admin') {
          await button('Admin'); await wait("!!document.getElementById('admin-totp')", 'OTP ready');
          if (!baseline) {
            await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
            check(await evaluate("!!document.activeElement.closest('dialog')"), 'keyboard focus stays inside modal');
            await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
            await wait("!document.querySelector('dialog')&&document.activeElement===document.querySelector('.home-admin-entry')", 'Escape restores entry focus');
            check(await evaluate("calls.every(c=>!c.path.startsWith('/api/admin/'))&&location.pathname==='/'"), 'keyboard cancel retains normal route and protects private data');
            await button('Admin'); await wait("!!document.getElementById('admin-totp')", 'new deliberate challenge');
            await evaluate("new MutationObserver(()=>{const state=document.querySelector('.admin-otp-field')?.dataset.feedback??(document.querySelector('.admin-panels')?'admin':'none');if(probe.otp.at(-1)?.state!==state)probe.otp.push({state,time:performance.now()});}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['data-feedback']})");
            await evaluate("document.getElementById('admin-totp').focus()");
            check(await evaluate("getComputedStyle(document.querySelector('.admin-otp-caret')).display==='block'&&document.querySelectorAll('.admin-otp-slot-active').length===1"), 'single active caret');
            check(await evaluate("getComputedStyle(document.querySelector('.admin-otp-caret')).animationName") === (ownership ? 'none' : 'admin-otp-blink'), 'caret respects reduced motion');
            await call('Input.insertText', { text: '01' });
            await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 }); await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
            check(await evaluate("document.getElementById('admin-totp').value==='0'&&document.querySelector('.admin-otp-slot-active').dataset.slot==='1'"), 'native Backspace and leading zero');
            await shot(`otp-caret-${width}-${ownership}`);
            await evaluate("pauseVerify=true;invalidVerify=true;const data=new DataTransfer();data.setData('text','012345');document.getElementById('admin-totp').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data}));document.getElementById('admin-totp').dispatchEvent(new ClipboardEvent('paste',{bubbles:true,clipboardData:data}));void 0");
            await wait('!!window.finishVerify', 'pending verification');
            check(await evaluate("document.querySelector('.admin-otp-field').dataset.feedback==='pending'&&document.getElementById('admin-totp').value==='012345'&&document.getElementById('admin-totp').disabled&&!document.querySelector('.admin-otp-caret')&&calls.filter(c=>c.path.endsWith('/verify')).length===1"), 'one paste submission, pending digits retained without caret');
            await shot(`otp-pending-${width}-${ownership}`);
            await evaluate('pauseVerify=false;finishVerify();finishVerify=null');
            await wait("document.querySelector('.admin-otp-field')?.dataset.feedback==='invalid'", 'invalid code feedback');
            check(await evaluate("document.getElementById('admin-totp').value===''&&document.getElementById('admin-totp').disabled&&!!document.querySelector('[role=alert]')&&!document.querySelector('.admin-panels')"), 'invalid resets safely and respects Retry-After');
            await shot(`otp-invalid-${width}-${ownership}`);
            await wait("!document.getElementById('admin-totp').disabled", 'cooldown elapsed');
            await evaluate('pauseVerify=true;pauseStatus=true');
          }
          await evaluate("document.getElementById('admin-totp').focus()"); await call('Input.insertText', { text: '012345' });
          if (!baseline) {
            await wait('!!window.finishVerify', 'second deliberate attempt'); await evaluate('pauseVerify=false;finishVerify();finishVerify=null');
            await wait('!!window.finishStatus', 'grant status pending');
            check(await evaluate("document.querySelector('.admin-otp-field').dataset.feedback==='pending'&&!document.body.textContent.includes('Acceso verificado')&&!document.querySelector('.admin-panels')"), 'success waits for backend status');
            await evaluate('pauseStatus=false;finishStatus()'); await wait("document.querySelector('.admin-otp-field')?.dataset.feedback==='success'", 'confirmed feedback');
            check(await evaluate("getComputedStyle(document.querySelector('.admin-otp-slots span')).animationName") === (ownership ? 'none' : 'admin-otp-success'), 'success respects reduced motion');
            check(await evaluate("document.getElementById('admin-totp').value===''&&!document.querySelector('.admin-panels')"), 'confirmed feedback clears credential before private content');
            await shot(`otp-success-${width}-${ownership}`);
            await wait("!!document.querySelector('.admin-panels')", 'feedback completes');
            const transition = await evaluate("probe.otp.find(e=>e.state==='admin').time-probe.otp.find(e=>e.state==='success').time");
            check(transition >= 350 && transition < 650, `confirmed success duration ${Math.round(transition)}ms`);
          }
          await button('Siguiente'); await wait("document.body.textContent.includes('Foto 20')", 'second admin page');
        }
        await evaluate("window.savedScreen=document.querySelector('main');window.savedItem=document.querySelector('.admin-item')||document.querySelector('.home-search');void 0");
        const before = await snapshot();
        const other = await call('Target.createTarget', { url: 'about:blank' }); await call('Target.activateTarget', { targetId: other.targetId });
        await wait("document.visibilityState==='hidden'", 'hidden unrelated tab');
        console.log(`BACKGROUND ${mode} ${width} ownership=${ownership} for ${quick ? 0.1 : 60}s`);
        await delay(quick ? 100 : 60000);
        // Hold reconciliation so the intermediate presentation is measurable.
        await evaluate('pauseRead=true;homeVersion++');
        await call('Target.activateTarget', { targetId: target.id }); await wait("document.visibilityState==='visible'&&reads.length>0", 'foreground read');
        const during = await evaluate("({sameScreen:savedScreen===document.querySelector('main'),sameItem:!!savedItem?.isConnected,items:document.querySelectorAll('.admin-item').length,loadingText:document.body.textContent.includes('Cargando…'),page:document.body.textContent.match(/Página \\d+ de \\d+/)?.[0]})");
        await shot(`resume-${mode}-${width}-${ownership}`);
        await evaluate('pauseRead=false;reads.splice(0).forEach(r=>r())'); await delay(200);
        const after = await snapshot(); const page = await evaluate("document.body.textContent.match(/Página \\d+ de \\d+/)?.[0]??null");
        check(before.document === after.document && before.timeOrigin === after.timeOrigin, `${mode}: zero document reloads`);
        check(after.hmr.length === 0 && JSON.stringify(before.ownership) === JSON.stringify(after.ownership), `${mode}: no HMR or ownership transition`);
        check(JSON.stringify(before.mounts) === JSON.stringify(after.mounts) && JSON.stringify(before.unmounts) === JSON.stringify(after.unmounts), `${mode}: zero component remounts`);
        if (!baseline) check(before.rootCount === 1 && after.rootCount === 1, `${mode}: same React root`);
        check(before.bootstraps === after.bootstraps && before.verifies === after.verifies && after.revokes === 0, `${mode}: session/grant retained`);
        if (!baseline && mode === 'admin') check(during.sameItem && !during.loadingText && page === 'Página 2 de 2', 'foreground refresh preserves list, page and layout');
        results.push({ width, ownership, mode, checking, login, authenticating, loading, before, during, after, page });
        await call('Target.closeTarget', { targetId: other.targetId });
      }
      if (!baseline) {
        const verified = await evaluate("calls.filter(c=>c.path==='/api/admin-auth/verify').length");
        const successCount = await evaluate("probe.otp.filter(e=>e.state==='success').length");
        await button('Volver a Reals'); await wait("!!document.querySelector('.home[aria-busy=false] .home-admin-entry')", 'ordinary mode after confirmed grant');
        check(await evaluate("!document.querySelector('.admin-panels')&&!document.querySelector('.admin-item')"), 'ordinary mode removes private content');
        await button('Admin'); await wait("!!document.querySelector('.admin-panels')", 'retained grant status revalidation');
        check(await evaluate("calls.filter(c=>c.path==='/api/admin-auth/verify').length") === verified && await evaluate("probe.otp.filter(e=>e.state==='success').length") === successCount, 'retained grant has no new TOTP or success replay');
        const statusChecks = await evaluate("calls.filter(c=>c.path==='/api/admin-auth/status').length");
        await button('Cerrar acceso administrativo');
        await wait("location.pathname==='/'&&!!document.querySelector('.home[aria-busy=false] .home-admin-entry')", 'explicit revoke returns Home');
        check(await evaluate("!document.querySelector('dialog')&&!document.querySelector('.admin-panels')&&calls.filter(c=>c.path==='/api/admin-auth/revoke').length===1"), 'explicit revoke retires private UI without reopening MFA');
        check(await evaluate("calls.filter(c=>c.path==='/api/admin-auth/status').length") === statusChecks, 'explicit revoke never checks status automatically');
        await button('Admin'); await wait("!!document.getElementById('admin-totp')", 'deliberate entry requires new authorization');
        check(await evaluate("!Array.from(document.querySelectorAll('button')).some(n=>n.textContent==='Verificar nuevamente con Google')"), 'recent Google TOTP has no redundant Google action');
        await button('Cancelar');
      }
      if (!baseline) for (const method of ['password', 'restored']) {
        await evaluate('renderSession()'); await wait('!!window.releaseObserve', 'new checking observer');
        const checkingBounds = await evaluate('bounds()');
        await evaluate(`releaseObserve(${method === 'restored'})`);
        let initialBounds = checkingBounds;
        if (method === 'password') {
          await wait("!!document.getElementById('login-email')&&!document.getElementById('login-email').disabled", 'password login');
          await evaluate("document.getElementById('login-email').focus()"); await call('Input.insertText', { text: 'synthetic@example.invalid' });
          await evaluate("document.getElementById('login-password').focus()"); await call('Input.insertText', { text: 'synthetic-only' });
          initialBounds = await evaluate('bounds()'); await button('Ingresar'); await wait('!!window.finishSignIn', 'password pending');
          await evaluate('pauseSignIn=false;finishSignIn()');
        }
        await wait('!!window.finishBootstrap', 'slow backend'); const bootstrapBounds = await evaluate('bounds()');
        check(initialBounds['#login-email'].y === bootstrapBounds['#login-email'].y && initialBounds['.login-panel'].height === bootstrapBounds['.login-panel'].height, `${method}: stable fields/panel through bootstrap`);
        check(await evaluate("document.getElementById('login-email').disabled&&document.body.textContent.includes('Preparando tu sesión')&&!document.querySelector('.home')"), `${method}: feedback without optimistic Home`);
        await shot(`${method}-bootstrap-${width}-${ownership}`);
        await evaluate('pauseBootstrap=false;finishBootstrap()'); await wait("!!document.querySelector('.home[aria-busy=false]')", 'ready after bootstrap');
        if (method === 'password') check(await evaluate("!document.querySelector('.home-admin-entry')"), 'password context has no Admin entry');
        extraLogins.push({ width, ownership, method, checkingBounds, initialBounds, bootstrapBounds });
      }
    }
  }
  await writeFile(`artifacts/lifecycle/${run}.json`, JSON.stringify(results, null, 2), 'utf8');
  if (!baseline) await writeFile(`artifacts/lifecycle/${run}-login-cases.json`, JSON.stringify(extraLogins, null, 2), 'utf8');
  console.log('RESULTS', results.map(r => ({ width: r.width, ownership: r.ownership, mode: r.mode, loginEmailShift: r.loading['#login-email'].y-r.login['#login-email'].y, during: r.during, page: r.page })));
} finally {
  ws?.close(); chrome.kill(); await new Promise(r => setTimeout(r, 500));
  if (!resolve(dir).startsWith(resolve(tmpdir()) + sep) || !dir.includes('reals-lifecycle-')) throw Error('Unsafe temporary directory');
  await rm(dir, { recursive: true, force: true, maxRetries: 5 });
}
