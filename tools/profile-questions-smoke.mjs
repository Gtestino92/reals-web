// Actual React/SessionController/ApiClient, controlled HTTP; run Vite on 5174 first.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const stamp = '2026-11-08T12:00:00Z';
const catalog = { catalogVersion: 'v1', questions: ['A','B','C','D'].map((id,i) => ({ id, prompt: `Pregunta ${id}`, displayOrder: i+1, semanticVersion: 1, contentVersion: 1 })) };
const answer = id => ({ questionId: id, questionSemanticVersion: 1, answer: `Respuesta ${id}`, selectedPosition: null, current: id !== 'A', createdAt: stamp, updatedAt: stamp });
let fixture;
const reset = status => { fixture = { status, answers: ['A','B','C','D'].map(answer), writes: [], writeDelay: 0 }; };
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
  const wait=async(expression,label)=>{ for(let i=0;i<120;i++){if(await evaluate(expression))return;await delay(40);}throw Error(label); };
  const visible=text=>`Array.from(document.querySelectorAll('body *')).some(n=>n.getClientRects().length&&n.textContent===${JSON.stringify(text)})`;
  const click=async(text,article='')=>{
    const expression=`Array.from(document.querySelectorAll(${JSON.stringify(article ? `article[aria-label="${article}"] button` : 'button')})).find(n=>n.getClientRects().length&&n.textContent===${JSON.stringify(text)}&&!n.disabled)`;
    await wait(`!!(${expression})`, 'enabled '+text); await evaluate(`${expression}.click()`);
  };
  const check=(value,label)=>{if(!value)throw Error(label);console.log('PASS',label);};
  const change=async(selector,value)=>evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const key=async(key,code,windowsVirtualKeyCode)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode,...(key==='Enter'?{text:'\r',unmodifiedText:'\r'}:{})});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode});};
  await call('Page.enable'); await call('Page.navigate',{url:'http://127.0.0.1:5174'}); await delay(1200);
  const mount=`(async()=>{const {default:React}=await import('/node_modules/.vite/deps/react.js'),{default:ReactDOM}=await import('/node_modules/.vite/deps/react-dom_client.js'),{OperationalApp}=await import('/src/App.tsx'),{ApiClient}=await import('/src/auth/api.ts');document.getElementById('root').hidden=true;const el=document.createElement('div');document.body.append(el);let root;window.renderQuestions=()=>{root?.unmount();root=ReactDOM.createRoot(el);root.render(React.createElement(React.StrictMode,null,React.createElement(OperationalApp,{firebase:{service:{observe:next=>{next({uid:'synthetic',emailVerified:true,getIdToken:async()=>'synthetic',reload:async()=>{}});return()=>{}},signOut:async()=>{}},localVerification:false},api:new ApiClient((path,options)=>fetch(${JSON.stringify(origin)}+String(path).slice(4),options))})));};renderQuestions();})()`;
  await evaluate(mount); await mkdir('artifacts/profile-questions',{recursive:true});
  const screenshot=async name=>writeFile(`artifacts/profile-questions/${name}.png`,Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
  const results=[];
  for(const [width,height] of [[390,844],[1440,900]]) for(const status of ['ACTIVE','DRAFT']) {
    reset(status); await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<768}); await evaluate('renderQuestions()');
    if(status==='ACTIVE') { await wait("!!document.querySelector('button[aria-label=\"Tu perfil\"]:not(:disabled)')",'Home');check(await evaluate("document.querySelectorAll('.home-management>button').length===4"),'four Home cards');check(await evaluate("document.querySelector('button[aria-label=\"Tu perfil\"]').textContent.includes('preguntas públicas.')&&!Array.from(document.querySelectorAll('button')).some(n=>n.getClientRects().length&&n.textContent==='Preguntas del perfil')"),'profile questions text reference only');await screenshot(`home-profile-text-${width}`);await evaluate("document.querySelector('button[aria-label=\"Tu perfil\"]').click()"); }
    await wait("!!document.querySelector('.profile-form textarea:not(:disabled)')",'profile');
    await change('.profile-form textarea','Mi bio sin guardar ñ'); await evaluate("void(window.parentBio=document.querySelector('.profile-form textarea'))");
    await click('Responder o editar');await wait(visible('4 de 4 respondidas'),'overview');await screenshot(`overview-${status}-${width}`);
    await click('Responder o editar preguntas');await wait(visible('Versión anterior'),'outdated');await click('Abrir');await wait("!!document.getElementById('profile-question-answer')",'editor');
    await change('#profile-question-answer','<texto>\nsegunda línea');check(await evaluate("document.querySelector('.profile-questions button[type=submit]').disabled"),'invalid pasted text');
    await change('#profile-question-answer','x'.repeat(161));check(await evaluate("document.querySelector('.profile-questions button[type=submit]').disabled"),'161 boundary');await change('#profile-question-answer','x'.repeat(160));await screenshot(`long-answer-${status}-${width}`);
    await click('Guardar');await wait(visible('Respuesta guardada'),'saved');check(fixture.answers.find(a=>a.questionId==='A').answer.length===160,'authoritative save');
    await change('#profile-question-answer','Respuesta editada');await click('Guardar');await wait("document.querySelector('.profile-questions button[type=submit]').disabled",'edit saved');
    await call('Page.getNavigationHistory');await evaluate('history.back()');await wait(visible('Responder preguntas'),'Back list');await evaluate('history.forward()');await wait(visible('Editar respuesta'),'Forward editor');
    await evaluate("document.getElementById('profile-question-answer').focus()");await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});check(await evaluate("document.activeElement.textContent==='Eliminar'"),'keyboard focus after unchanged answer');
    await click('Volver');await wait(visible('Responder preguntas'),'list');await click('Volver');await wait(visible('Preguntas del perfil'),'overview parent');
    await evaluate("document.querySelector('.profile-questions h2').focus()");for(let i=0;i<4;i++)await key('Tab','Tab',9);check(await evaluate("document.activeElement.textContent==='Elegir preguntas públicas'"),'keyboard-only overview action');await key('Enter','Enter',13);await wait(visible('Preguntas públicas'),'keyboard selection');
    for(const id of ['A','B','C'])await click('Agregar',`Pregunta ${id}`);
    await click('Quitar','Pregunta B');await click('Agregar','Pregunta B');await click('Subir','Pregunta B');await screenshot(`selection-${status}-${width}`);
    check(await evaluate("document.querySelector('article[aria-label=\"Pregunta D\"] button').disabled"),'three maximum');await click('Guardar selección');await wait(visible('Selección guardada'),'selection saved');check(JSON.stringify(fixture.writes.at(-1).body.questionIds)==='["A","B","C"]','ordered selection PUT');
    await click('Responder o editar preguntas');await click('Abrir');await click('Eliminar');await wait(visible('Respuesta eliminada'),'deleted');check(fixture.answers.find(a=>a.questionId==='B').selectedPosition===1,'delete compacts positions');
    await change('#profile-question-answer','Cambio demorado');fixture.writeDelay=650;await click('Guardar');await click('Volver');await wait(visible('Responder preguntas'),'pending Back');await delay(850);check(await evaluate(visible('Responder preguntas')),'late write keeps destination');fixture.writeDelay=0;
    await click('Volver');await wait(visible('Preguntas del perfil'),'overview');await click('Elegir preguntas públicas');await click('Limpiar selección');await click('Guardar selección');await wait(visible('Selección guardada'),'cleared');
    await click('Volver');await wait("!!document.querySelector('.profile-question-entry button:not(:disabled)')",'parent return');check(await evaluate("parentBio===document.querySelector('.profile-form textarea')&&parentBio.value==='Mi bio sin guardar ñ'"),'parent DOM and draft preserved '+status+' '+width);
    await click('Responder o editar');await wait(visible('4 de 4 respondidas'),'reopen');await click('Actualizar preguntas');await wait("document.querySelector('.profile-questions').getAttribute('aria-busy')==='false'",'refresh');check(fixture.answers.find(a=>a.questionId==='A').answer==='Cambio demorado','authoritative persisted answer');
    check(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'no overflow '+status+' '+width);
    results.push({width,height,status,writes:fixture.writes.length});
  }
  await writeFile('artifacts/profile-questions/results.json',JSON.stringify(results,null,2));
} finally {
  server.closeAllConnections();server.close();ws?.close();chrome.kill();await new Promise(r=>setTimeout(r,500));
  if(!resolve(dir).startsWith(resolve(tmpdir())+sep)||!dir.includes('reals-profile-questions-'))throw Error('Unsafe temporary directory');
  await rm(dir,{recursive:true,force:true,maxRetries:5});
}
