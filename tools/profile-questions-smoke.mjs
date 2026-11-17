// Actual React/SessionController/ApiClient, controlled HTTP; run Vite on 5174 first.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const baseUrl = process.argv.find(arg => arg.startsWith('--url='))?.slice(6) ?? 'http://127.0.0.1:5174';
const stamp = '2026-11-08T12:00:00Z';
const catalog = { catalogVersion: 'v1', questions: ['A','B','C','D'].map((id,i) => ({ id, prompt: `Pregunta ${id}`, displayOrder: i+1, semanticVersion: 1, contentVersion: 1 })) };
const answer = id => ({ questionId: id, questionSemanticVersion: 1, answer: `Respuesta ${id}`, selectedPosition: null, current: id !== 'A', createdAt: stamp, updatedAt: stamp });
let fixture;
const reset = status => { fixture = { status, answers: ['A','B','C','D'].map(answer), writes: [], writeDelay: 0, readDelay: 0 }; };
reset('ACTIVE');
const server = createServer(async (req,res) => {
  const f = fixture;
  res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization'); res.setHeader('Access-Control-Allow-Methods','GET,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : null, path = req.url, method = req.method;
  let result, status = 200;
  if (path === '/me') result = { id:'u', status:'ACTIVE' };
  else if (path === '/me/profile') result = { id:'p', userId:'u', status:f.status, displayName:'Lucía', birthDate:'1995-01-01', gender:'FEMALE', lookingForGenders:['MALE'], intention:'DATE', city:'Córdoba', countryCode:'AR', bio:'Bio guardada', preferredMinAge:18, preferredMaxAge:45, maxDistanceKm:50, authenticityVerificationStatus:'STALE' };
  else if (path === '/reference/countries') result = [{ code:'AR', displayName:'Argentina' }];
  else if (path === '/me/legal-status') result = { requirementsSatisfied:true, documents:[] };
  else if (path === '/legal/documents/current') result = { documents:[] };
  else if (path === '/me/profile/photos') result = [];
  else if (path === '/matchmaking/queue') result = { userId:'u', inQueue:false };
  else if (path === '/me/home/status') result = { version:1, dirty:false, nextRefreshAt:null, serverTime:stamp };
  else if (path === '/me/home') result = { profileStatus:f.status, matchmaking:{ inQueue:false, canSearch:true, blockedReason:null }, activeInteractionsSummary:{ activeInitialCount:0, activeConnectionCount:0, actionableConnectionCount:0, hasPendingSchedulingConnection:false }, pendingActions:[], nextSteps:[], passiveNotices:[] };
  else if (path === '/reference/affinity-questions') result = { catalogVersion:'empty', categories:[], questions:[] };
  else if (path === '/me/profile/affinity-answers') result = { answers:[] };
  else if (path === '/reference/profile-questions') result = catalog;
  else if (path.startsWith('/me/profile/question-')) {
    if (method !== 'GET') {
      f.writes.push({ path, method, body });
      await new Promise(r => setTimeout(r, f.writeDelay));
      if (path === '/me/profile/question-selections') f.answers = f.answers.map(a => ({ ...a, selectedPosition:body.questionIds.includes(a.questionId) ? body.questionIds.indexOf(a.questionId)+1 : null }));
      else {
        const id = path.split('/').at(-1), saved = f.answers.find(a => a.questionId === id);
        f.answers = f.answers.filter(a => a.questionId !== id);
        if (method === 'PUT') f.answers.push({ ...answer(id), answer:body.answer, current:true, selectedPosition:saved?.selectedPosition ?? null });
        const selected = f.answers.filter(a => a.selectedPosition !== null).sort((a,b) => a.selectedPosition-b.selectedPosition);
        f.answers = f.answers.map(a => ({ ...a, selectedPosition:selected.includes(a) ? selected.indexOf(a)+1 : null }));
      }
    }
    result = { answers:f.answers };
  } else { status=404; result={ code:'SYNTHETIC_NOT_FOUND' }; }
  if (method === 'GET' && f.readDelay) await new Promise(r => setTimeout(r, f.readDelay));
  res.writeHead(status, { 'Content-Type':'application/json' }); res.end(JSON.stringify(result));
});
await new Promise(r => server.listen(0,'127.0.0.1',r));
const origin = `http://127.0.0.1:${server.address().port}`, dir = await mkdtemp(join(tmpdir(),'reals-profile-questions-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new','--remote-debugging-port=0',`--user-data-dir=${dir}`,'about:blank'], { windowsHide:true, stdio:'ignore' });
let ws;
try {
  let target;
  for (let i=0;i<60;i++) {
    try { const port=(await readFile(join(dir,'DevToolsActivePort'),'utf8')).split('\n')[0].trim(); target=(await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t=>t.type==='page'); if(target)break; } catch {}
    await new Promise(r=>setTimeout(r,100));
  }
  if (!target) throw Error('Chrome did not start');
  ws=new WebSocket(target.webSocketDebuggerUrl); await new Promise(r=>ws.addEventListener('open',r,{once:true}));
  let serial=0; const pending=new Map();
  ws.addEventListener('message',e=>{ const m=JSON.parse(e.data); if(m.id) { const p=pending.get(m.id); pending.delete(m.id); m.error?p.reject(Error(m.error.message)):p.resolve(m.result); } });
  const call=(method,params={})=>new Promise((resolve,reject)=>{ const id=++serial; pending.set(id,{resolve,reject}); ws.send(JSON.stringify({id,method,params})); });
  const evaluate=async expression=>{ const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}); if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text); return r.result.value; };
  const delay=ms=>new Promise(r=>setTimeout(r,ms));
  const wait=async(expression,label)=>{ for(let i=0;i<120;i++){if(await evaluate(expression))return;await delay(40);}throw Error(label+' '+await evaluate("JSON.stringify({text:document.body.innerText,trail:history.state?.trail})")); };
  const visible=text=>`Array.from(document.querySelectorAll('body *')).some(n=>n.getClientRects().length&&n.textContent===${JSON.stringify(text)})`;
  const click=async(text,article='')=>{
    const expression=`Array.from(document.querySelectorAll(${JSON.stringify(article ? `article[aria-label="${article}"] button` : 'button')})).find(n=>n.getClientRects().length&&(n.textContent===${JSON.stringify(text)}||n.getAttribute('aria-label')===${JSON.stringify(text)})&&!n.disabled)`;
    await wait(`!!(${expression})`, 'enabled '+text); await evaluate(`${expression}.click()`);
  };
  const check=(value,label)=>{if(!value)throw Error(label);console.log('PASS',label);};
  const change=async(selector,value)=>evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const key=async(key,code,windowsVirtualKeyCode)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode,...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode});};
  await call('Page.enable'); await call('Page.navigate',{url:baseUrl+'/tools/ux-audit-fixture.html'}); await delay(1200);
  const mount=`(async()=>{const {default:React}=await import('/node_modules/.vite/deps/react.js'),{default:ReactDOM}=await import('/node_modules/.vite/deps/react-dom_client.js'),{OperationalApp}=await import('/src/App.tsx'),{ApiClient}=await import('/src/auth/api.ts');document.getElementById('root').hidden=true;const el=document.createElement('div');document.body.append(el);let root;window.renderQuestions=()=>{root?.unmount();root=ReactDOM.createRoot(el);root.render(React.createElement(React.StrictMode,null,React.createElement(OperationalApp,{firebase:{service:{observe:next=>{next({uid:'synthetic',emailVerified:true,getIdToken:async()=>'synthetic',reload:async()=>{}});return()=>{}},signOut:async()=>{}},localVerification:false},api:new ApiClient((path,options)=>fetch(${JSON.stringify(origin)}+String(path).slice(4),options))})));};renderQuestions();})()`;
  await evaluate(mount); await mkdir('artifacts/profile-questions',{recursive:true});
  const screenshot=async name=>writeFile(`artifacts/profile-questions/${name}.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  const results=[];
  for(const [width,height] of [[390,844],[1440,900]]) for(const status of ['ACTIVE','DRAFT']) {
    if(process.argv.includes('--draft-only')&&status!=='DRAFT')continue;
    reset(status); await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<768}); await evaluate('renderQuestions()');
    if(status==='ACTIVE') { await wait("!!document.querySelector('button[aria-label=\"Tu perfil\"]:not(:disabled)')",'Home');check(await evaluate("document.querySelectorAll('.home-management>button').length===4"),'four Home cards');check(await evaluate("document.querySelector('button[aria-label=\"Tu perfil\"]').textContent.includes('preguntas públicas.')&&!Array.from(document.querySelectorAll('button')).some(n=>n.getClientRects().length&&n.textContent==='Preguntas del perfil')"),'profile questions text reference only');await screenshot(`home-profile-text-${width}`);await evaluate("document.querySelector('button[aria-label=\"Tu perfil\"]').click()"); }
    await wait("!!document.querySelector('.profile-form textarea:not(:disabled)')",'profile');
    if(status==='DRAFT')await evaluate("document.querySelector('.profile-form textarea').closest('details').open=true");
    await change('.profile-form textarea','Mi bio sin guardar ñ'); await evaluate("void(window.parentBio=document.querySelector('.profile-form textarea'))");
    const resume = async selector => {
      fixture.readDelay=250;
      await evaluate(`document.querySelector(${JSON.stringify(selector)}).focus();document.dispatchEvent(new Event('visibilitychange'));`);
      check(await evaluate(`document.activeElement===document.querySelector(${JSON.stringify(selector)})&&!document.activeElement.disabled&&!document.querySelector('.profile-questions[aria-busy=true]')&&!document.querySelector('.onboarding[aria-busy=true]')`),'quiet resume keeps focus and enabled input');
      await delay(1800);fixture.readDelay=0;
    };
    await resume('.profile-form textarea');
    check(await evaluate("parentBio.value==='Mi bio sin guardar \u00f1'"),'profile resume preserves draft');
    if(status==='ACTIVE') {
      check(await evaluate("document.querySelectorAll('.profile-submit').length===1&&!!(document.querySelector('.profile-form textarea').compareDocumentPosition(document.querySelector('.profile-submit'))&Node.DOCUMENT_POSITION_FOLLOWING)"),'one save below fields');
      const toggle='.photo-section-toggle';
      await evaluate(`document.querySelector('${toggle}').click()`);await delay(80);
      check(await evaluate("document.querySelector('.photo-section-toggle').getAttribute('aria-expanded')==='false'&&document.querySelector('.photo-section-expansion').inert"),'collapsed photos inert');
      await evaluate(`document.querySelector('${toggle}').click()`);await delay(300);
      await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
      check(await evaluate("getComputedStyle(document.querySelector('.photo-section-expansion')).transitionDuration==='0s'"),'reduced motion');
      await call('Emulation.setEmulatedMedia',{features:[]});
      await screenshot(`profile-${width}`);
    }
    await click('Responder o editar');await wait(visible('4 de 4 respondidas'),'overview');await screenshot(`overview-${status}-${width}`);
    check(await evaluate("!!document.querySelector('article[aria-label=\"Pregunta B\"]')"),'answered cards on overview');
    await click('Editar: Pregunta A');await wait("!!document.querySelector('article[aria-label=\"Pregunta A\"] textarea')",'inline editor');
    await change('article[aria-label="Pregunta A"] textarea','<texto>\nsegunda l\u00ednea');check(await evaluate("document.querySelector('.profile-questions button[type=submit]').disabled"),'invalid pasted text');
    await change('article[aria-label="Pregunta A"] textarea','x'.repeat(161));check(await evaluate("document.querySelector('.profile-questions button[type=submit]').disabled"),'161 boundary');await change('article[aria-label="Pregunta A"] textarea','x'.repeat(160));await screenshot(`long-answer-${status}-${width}`);
    await resume('article[aria-label="Pregunta A"] textarea');
    check(await evaluate("document.querySelector('article[aria-label=\"Pregunta A\"] textarea').value.length===160"),'answer resume retains draft');
    await click('Guardar');await wait(visible('Respuesta guardada'),'saved');check(fixture.answers.find(a=>a.questionId==='A').answer.length===160,'authoritative save');
    await change('article[aria-label="Pregunta A"] textarea','Respuesta editada');await click('Guardar');await wait("document.querySelector('.profile-questions').getAttribute('aria-busy')==='false'&&document.querySelector('.profile-questions button[type=submit]').disabled",'edit saved');
    await evaluate("document.querySelector('article[aria-label=\"Pregunta A\"] textarea').focus()");await key('Tab','Tab',9);check(await evaluate("document.activeElement.textContent==='Editar respuesta'"),'keyboard focus after unchanged answer');
    check(await evaluate("history.state.trail.at(-1)==='profile-questions'"),'edit stays on overview');
    for(const id of ['A','B','C'])await click('Agregar',`Pregunta ${id}`);
    await click('Quitar','Pregunta B');await click('Agregar','Pregunta B');await click('Subir','Pregunta B');await screenshot(`selection-${status}-${width}`);
    check(await evaluate("[...document.querySelectorAll('article[aria-label=\"Pregunta D\"] button')].find(n=>n.textContent==='Agregar').disabled"),'three maximum');await click('Guardar selecci\u00f3n');await wait(visible('Selecci\u00f3n guardada'),'selection saved');check(JSON.stringify(fixture.writes.at(-1).body.questionIds)==='["A","B","C"]','ordered selection PUT');
    await click('Eliminar','Pregunta A');await wait(visible('Respuesta eliminada'),'deleted on overview');check(fixture.answers.find(a=>a.questionId==='B').selectedPosition===1,'delete compacts positions');
    await click('Responder nuevas preguntas');
    check(await evaluate("document.querySelectorAll('.question-list article').length===1&&!Array.from(document.querySelectorAll('.profile-questions button')).some(n=>n.textContent==='Abrir'||n.textContent==='Eliminar')"),'extra screen has inline unanswered forms without open/delete');
    check(await evaluate("!document.querySelector('.profile-questions .home-error')&&document.querySelector('article[aria-label=\"Pregunta A\"] textarea').getAttribute('aria-invalid')!=='true'"),'pristine editor has no red error');
    await change('article[aria-label="Pregunta A"] textarea','Borrador nuevo');await screenshot(`inline-new-${status}-${width}`);
    await evaluate('history.back()');await wait(visible('Preguntas del perfil'),'Back overview');await evaluate('history.forward()');await wait(visible('Responder preguntas'),'Forward inline list');
    check(await evaluate("document.querySelector('article[aria-label=\"Pregunta A\"] textarea').value==='Borrador nuevo'"),'inline draft retained through History');
    await resume('article[aria-label="Pregunta A"] textarea');
    await change('article[aria-label="Pregunta A"] textarea','Cambio demorado');fixture.writeDelay=650;await click('Guardar');await click('Volver');await wait(visible('Preguntas del perfil'),'pending Back');await delay(850);check(await evaluate(visible('Preguntas del perfil')),'late write keeps destination');fixture.writeDelay=0;
    await click('Limpiar selecci\u00f3n');await click('Guardar selecci\u00f3n');await wait(visible('Selecci\u00f3n guardada'),'cleared');
    await click('Volver');await wait("!!document.querySelector('.profile-question-entry button:not(:disabled)')",'parent return');check(await evaluate("parentBio===document.querySelector('.profile-form textarea')&&parentBio.value==='Mi bio sin guardar \u00f1'"),'parent DOM and draft preserved '+status+' '+width);
    await click('Responder o editar');await wait(visible('4 de 4 respondidas'),'reopen');
    check(fixture.answers.find(a=>a.questionId==='A').answer==='Cambio demorado','authoritative persisted answer');
    check(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'no overflow '+status+' '+width);
    results.push({width,height,status,writes:fixture.writes.length});
  }
  await writeFile('artifacts/profile-questions/results.json',JSON.stringify(results,null,2));
} finally {
  server.closeAllConnections();server.close();ws?.close();chrome.kill();await new Promise(r=>setTimeout(r,500));
  if(!resolve(dir).startsWith(resolve(tmpdir())+sep)||!dir.includes('reals-profile-questions-'))throw Error('Unsafe temporary directory');
  await rm(dir,{recursive:true,force:true,maxRetries:5});
}
