// Real Page.reload with test-only sessionStorage authentication coordinates.
export async function runReloadCases(width,{run,open,click,assert,refresh,history,reload}) {
 const chat="!!document.querySelector('.second-chat') && !!document.querySelector('#second-draft:not(:disabled)')";
 const home="!!document.querySelector('.home:not([hidden]) button[aria-label=\"Ver Actividad\"]')";
 const noJoin=s=>{if(s.writes.some(w=>w.path.endsWith('/join')))throw Error('Passive restoration issued JOIN');};
 await run('reload-uncertain-join-guard',width,{joined:new Set(),status:'AVAILABLE',uncertainJoin:true},async({a,s})=>{
  await open(a);await assert(a,"!!document.querySelector('.second-chat [role=alert]') && ![...document.querySelectorAll('.second-chat button')].some(b=>b.textContent==='Volver a Inicio')");
  s.failStatus=false;await click(a,'Reintentar conexión');await assert(a,chat);
  await reload(a);await assert(a,chat);
  if(s.writes.filter(w=>w.path.endsWith('/join')).length!==1)throw Error('Uncertain JOIN was replayed');
 });
 await run('reload-explicit-history',width,{joined:new Set(),status:'AVAILABLE'},async({a,s})=>{
  await open(a);await assert(a,chat);const length=await a.evaluate('history.length');
  await reload(a);await assert(a,chat);
  await a.evaluate('history.back()');await assert(a,chat);await assert(a,"history.state.trail.at(-1)==='second-chat'");
  await a.evaluate('history.forward()');await assert(a,chat);
  if(await a.evaluate('history.length')!==length)throw Error('Reload/Back/Forward grew History');
  if(s.writes.filter(w=>w.path.endsWith('/join')).length!==1)throw Error('History replayed explicit entry');
 });
 for(const alone of [false,true])await run(`reload-active-${alone?'alone':'both'}`,width,{joined:new Set(alone?['a']:['a','b'])},async({a,s})=>{
  await assert(a,chat);const length=await a.evaluate('history.length');
  for(let i=0;i<2;i++){
   await reload(a);await assert(a,chat);await assert(a,"!window.homeInteractiveSeen && ![...document.querySelectorAll('.home')].some(n=>!n.closest('[hidden]')) && ![...document.querySelectorAll('.second-chat button')].some(b=>b.textContent==='Volver a Inicio')");
   if(await a.evaluate('history.length')!==length)throw Error('Reload grew History');
   await a.evaluate("dispatchEvent(new PopStateEvent('popstate',{state:{owner:history.state.owner,trail:['home']}}))");await assert(a,chat);
  }
  await a.evaluate('window.fixture.notifyAuth()');await assert(a,chat);noJoin(s);
 });
 await run('reload-alone-after-cutoff',width,{joined:new Set(['a']),scheduled:Date.now()-16*60000},async({a,s})=>{
  await assert(a,home);await reload(a);await assert(a,home);await refresh(a);await assert(a,home);noJoin(s);
 });
 await run('reload-status-failure-retry',width,{failStatus:true},async({a,s})=>{
  await assert(a,"!!document.querySelector('[aria-label=\"Verificando conversaciones\"] [role=alert]')");
  await reload(a);await assert(a,"!!document.querySelector('[aria-label=\"Verificando conversaciones\"] [role=alert]') && ![...document.querySelectorAll('.home')].some(n=>!n.closest('[hidden]'))");
  const homeReads=s.reads.filter(r=>r.me==='a'&&r.path==='/me/home').length;
  s.failStatus=false;await click(a,'Reintentar');await assert(a,chat);
  if(s.reads.filter(r=>r.me==='a'&&r.path==='/me/home').length!==homeReads)throw Error('Retry duplicated fresh Home');noJoin(s);
 });
 for(const expired of [false,true])await run(`reload-terminal-retention-${expired?'expired':'readable'}`,width,{status:'FINISHED',retention:Date.now()+(expired?-60000:3600000)},async({a,s})=>{
  await assert(a,home);await reload(a);await assert(a,home);await assert(a,"!document.querySelector('.second-chat')");noJoin(s);
 });
 await run('reload-different-account',width,{},async({a,s})=>{
  await assert(a,chat);await a.evaluate('window.fixture.replace()');await assert(a,home);await reload(a);await assert(a,home);await assert(a,"!document.querySelector('.second-chat')");noJoin(s);
 });
 await run('reload-tab-ownership-transfer',width,{ownership:true},async({a,b,s})=>{
  await assert(b,"!!document.querySelector('.second-chat') || document.body.innerText.includes('Usar Reals ac\u00e1')");if(await b.evaluate("!document.querySelector('.second-chat')"))await click(b,'Usar Reals ac\u00e1');await assert(b,chat);await assert(a,"document.body.innerText.includes('Usar Reals acá') && !document.querySelector('.second-chat')");
  await click(a,'Usar Reals acá');await assert(a,chat);await assert(b,"document.body.innerText.includes('Usar Reals acá') && !document.querySelector('.second-chat')");
  await reload(a);await assert(a,chat);noJoin(s);
 });
 for(const kind of ['success','terminal','recoverable','committed'])await run(`audio-reconciliation-${kind}`,width,{writableAudio:true,audioVersion:2,audioTerminal:kind==='terminal',audioRecoverable:kind==='recoverable',audioCommitAmbiguous:kind==='committed'},async({a,s})=>{
  await open(a);await click(a,'Grabar audio');await assert(a,'window.activeTracks===1');await click(a,'Detener');await assert(a,"!!document.querySelector('.chat-audio-draft')");await click(a,'Enviar audio');
  if(kind==='recoverable'){
   await assert(a,"document.querySelector('.second-chat').innerText.includes('Falló el envío') && !!document.querySelector('.chat-audio-draft')");
  }else if(kind==='success'){
   await assert(a,"!document.querySelector('.chat-audio-draft') && !document.querySelector('.second-chat').innerText.includes('Audio pendiente')");
  }else{
   await assert(a,"!document.querySelector('.chat-audio-draft') && !document.querySelector('#second-draft') && !document.querySelector('.second-chat').innerText.match(/Audio pendiente|Falló el envío|Reconciliar y reintentar|second-chat/)");
   await assert(a,`document.querySelector('.second-chat').innerText.includes('${kind==='committed'?'Tu audio quedó guardado':'El audio pendiente no se envió'}')`);
   await assert(a,"window.activeTracks===0 && window.activeObjectUrls.size===0 && !document.querySelector('[aria-label=\"Vista previa del audio\"]')");
   if(kind==='committed')await assert(a,"!!document.querySelector('.chat-timeline [aria-label=\"Reproducir audio\"]')");
  }
  if(s.writes.filter(w=>w.path.endsWith('/audio-messages')).length!==1)throw Error('Audio was replayed');
 });
}
