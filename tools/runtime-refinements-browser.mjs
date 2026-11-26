import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { measureStartupHome } from './startup-home-browser-cases.mjs';

// Local synthetic backend: real HTTP, controlled latency, no real account data.
let inQueue = false, delay = 0;
let displayName = 'Fixture', version = 1;
const adminRace = process.argv.includes('--admin-race');
let grantIssued = false, homeStatusDelay = 0;
const fixtureGrant = 'A'.repeat(43);
const requests = [];
const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Reals-Admin-Grant');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  requests.push({ path: req.url, method: req.method, receivedAt: Date.now() });
  await new Promise(r => setTimeout(r, delay + (req.url === '/me/home/status' ? homeStatusDelay : 0)));
  let value;
  if (req.url === '/me/legal-status') value = { requirementsSatisfied: true, documents: [] };
  if (req.url === '/legal/documents/current') value = { documents: [] };
  if (req.url === '/me') value = { id: 'me', status: 'ACTIVE' };
  if (req.url === '/me/profile') {
    if (req.method === 'PATCH') {
      let body = '';
      for await (const chunk of req) body += chunk;
      displayName = JSON.parse(body).displayName;
    }
    value = { id: 'p', userId: 'me', status: 'ACTIVE', displayName, birthDate: '1995-01-01', gender: 'MALE', lookingForGenders: ['FEMALE'], intention: 'DATE', city: 'Fixture', countryCode: 'AR', bio: 'Bio sintética', preferredMinAge: 18, preferredMaxAge: 45, maxDistanceKm: 50, authenticityVerificationStatus: 'STALE' };
  }
  if (req.url === '/me/home/status') value = { version, dirty: false, nextRefreshAt: null, serverTime: new Date().toISOString() };
  if (req.url === '/admin-auth/status') value = { configured: true, grantValid: adminRace && grantIssued && req.headers['x-reals-admin-grant'] === fixtureGrant };
  if (adminRace && req.url === '/admin-auth/verify') {
    grantIssued = true;
    value = { grant: fixtureGrant, expiresAt: new Date(Date.now() + 60000).toISOString() };
  }
  if (adminRace && req.url.startsWith('/admin/')) value = {};
  if (req.url === '/reference/countries') value = [{ code: 'AR', displayName: 'Argentina' }];
  if (req.url === '/me/profile/photos') value = [];
  if (req.url === '/reference/affinity-questions') value = { catalogVersion: 'fixture', categories: [], questions: [] };
  if (req.url === '/me/profile/affinity-answers') value = { answers: [] };
  if (req.url === '/matchmaking/queue') {
    if (req.method === 'POST') inQueue = true;
    if (req.method === 'DELETE') inQueue = false;
    value = { userId: 'me', inQueue };
  }
  if (req.url === '/me/home') value = { profileStatus: 'ACTIVE', matchmaking: { inQueue, canSearch: !inQueue, blockedReason: null }, activeInteractionsSummary: { activeInitialCount: 0, activeConnectionCount: 0, actionableConnectionCount: 0, hasPendingSchedulingConnection: false }, pendingActions: [], nextSteps: [], passiveNotices: [] };
  res.writeHead(value ? 200 : 404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value ?? { code: 'FIXTURE_NOT_FOUND' }));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const generated = process.argv.includes('--startup-home') || adminRace ? [] : ['tools/latency-before-location.ts', 'tools/latency-before-home.ts'];
if (generated.length) {
  await writeFile(generated[0], execFileSync('git', ['show', 'a6864fe:src/home/location.ts'], { encoding: 'utf8' }), 'utf8');
  await writeFile(generated[1], execFileSync('git', ['show', 'a6864fe:src/home/useHome.ts'], { encoding: 'utf8' }).replaceAll('../auth/', '../src/auth/').replaceAll("'./contracts'", "'../src/home/contracts'").replaceAll("'./location'", "'./latency-before-location'"), 'utf8');
}
const directory = await mkdtemp(join(tmpdir(), 'reals-runtime-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${directory}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const sockets = [];
try {
  let port;
  for (let i = 0; i < 60; i++) { try { port = (await readFile(join(directory, 'DevToolsActivePort'), 'utf8')).split('\n')[0].trim(); break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const page = async (path, prepare) => {
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl); sockets.push(ws);
    await new Promise(r => ws.addEventListener('open', r, { once: true }));
    let id = 0; const pending = new Map();
    ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); } });
    const call = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params })); });
    const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
    await call('Page.enable'); await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 850, deviceScaleFactor: 1, mobile: true });
    await prepare?.(call);
    await call('Page.navigate', { url: `http://127.0.0.1:5174/tools/${path}&backend=${encodeURIComponent(origin)}` });
    return { call, evaluate };
  };
  const wait = async (p, expression) => { for (let i = 0; i < 150; i++) { if (await p.evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)); } throw Error('Timeout ' + expression + ' ' + await p.evaluate('document.body.innerText')); };
  const click = async (p, text) => p.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>(b.getAttribute('aria-label')===${JSON.stringify(text)}||b.textContent===${JSON.stringify(text)})&&!b.closest('[hidden]'))?.click()`);
  const results = [];
  if (adminRace) {
    delay = 75;
    const p = await page('tab-ownership-fixture.html?startup-home=1');
    const privateRequests = start => requests.slice(start).filter(r => r.path.startsWith('/admin/'));
    const homeReady = "!!document.querySelector('.home-search button:not(:disabled)')";
    await wait(p, homeReady);
    await wait(p, "!!document.querySelector('.home-admin-entry:not(:disabled)')");
    await click(p, 'Admin');
    await wait(p, "!!document.querySelector('#admin-totp:not(:disabled)')");
    await p.evaluate(`(() => {
      const input = document.querySelector('#admin-totp');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '123456');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    await wait(p, "location.pathname === '/admin'");
    for (const queued of [false, true]) {
      await click(p, 'Volver a Reals');
      await wait(p, homeReady);
      await click(p, 'Tu perfil');
      await wait(p, "!!document.querySelector('input[name=displayName]:not(:disabled)')");
      homeStatusDelay = 900;
      if (queued) { inQueue = true; version++; }
      const start = requests.length;
      await click(p, 'Volver a Inicio');
      await click(p, 'Admin');
      await wait(p, "document.body.innerText.includes('Cancelar entrada a Admin')");
      if (privateRequests(start).length || await p.evaluate("location.pathname === '/admin'")) throw Error('Admin entered before Home verification');
      if (queued) {
        await wait(p, "!!document.querySelector('.search-screen') && !document.body.innerText.includes('Cancelar entrada a Admin')");
        if (privateRequests(start).length) throw Error('Admin entered after queue discovery');
      } else {
        await wait(p, "location.pathname === '/admin' && !!document.querySelector('main.admin')");
        if (!privateRequests(start).length) throw Error('Original intent did not enter');
      }
      homeStatusDelay = 0;
      results.push({ retainedGrant: true, queued, noEarlyPrivateReads: true, entered: !queued });
    }
    await p.call('Page.close');
  } else if (process.argv.includes('--startup-home')) {
    delay = 160;
    results.push(...await measureStartupHome({ page, wait, click, requests,
      invalidate: (queued = false) => { version++; inQueue = queued; },
      reset: () => { inQueue = false; displayName = 'Fixture'; version = 1; },
    }));
  } else if (process.argv.includes('--search-only')) {
    inQueue = false; delay = 250;
    const p = await page('tab-ownership-fixture.html?kind=home&ownership=auto&geo=1');
    await p.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await wait(p, "!!document.querySelector('.home-search button:not(:disabled)')");
    const from = requests.length;
    await click(p, 'Buscar chat'); await wait(p, "!!document.querySelector('.search-screen')");
    await wait(p, "[...document.querySelectorAll('.search-dots span')].flatMap(n=>n.getAnimations()).filter(a=>a.startTime!==null).length===3");
    await p.evaluate(`(() => {
      const root=document.querySelector('.search-screen'), title=root.querySelector('h2'), body=root.querySelector('[role=status]'), logo=root.querySelector('img'), dots=root.querySelector('.search-dots');
      const animations=[...dots.children].flatMap(n=>n.getAnimations()), starts=animations.map(a=>a.startTime);
      const cancel=root.querySelector('button'); cancel.focus(); const scroll=scrollY;
      window.stableSamples=0; window.stabilityError=null;
      window.checkSearch=()=>{
        if (!root.isConnected) { if(document.querySelector('.search-screen')) throw Error('Search remounted'); return; }
        if(root!==document.querySelector('.search-screen')||root.querySelector('h2')!==title||root.querySelector('[role=status]')!==body||root.querySelector('img')!==logo||root.querySelector('.search-dots')!==dots) throw Error('Search nodes replaced');
        if(title.textContent!=='Buscando chat'||body.textContent!=='Estamos buscando a alguien compatible. Te avisaremos cuando encontremos una persona para conversar.'||body.hasAttribute('aria-label')) throw Error('Processing phase announced');
        const current=[...dots.children].flatMap(n=>n.getAnimations());
        if(current.length!==3||current.some((a,i)=>a!==animations[i]||a.startTime!==starts[i])) throw Error('Animation restarted');
        if(scrollY!==scroll) throw Error('Search scroll reset');
        if(!cancel.disabled&&document.activeElement!==cancel) throw Error('Search focus reset');
        window.stableSamples++;
      };
      window.searchWatch=setInterval(()=>{try{window.checkSearch();}catch(error){window.stabilityError=error.message;}},25);
      window.checkSearch();
    })()`);
    await wait(p, "document.querySelector('.search-screen')?.getAttribute('aria-busy')==='false'");
    await p.evaluate('window.checkSearch()');
    const history = await p.call('Page.getNavigationHistory');
    await p.call('Page.navigateToHistoryEntry', { entryId: history.entries[history.currentIndex - 1].id });
    await wait(p, "document.querySelector('.search-screen button')?.disabled===true");
    await p.evaluate('window.checkSearch()');
    await new Promise(r => setTimeout(r, 100));
    if (!await p.evaluate("!!document.querySelector('.search-screen') && !document.querySelector('.home-search')")) throw Error('Optimistic return Home');
    await wait(p, "!!document.querySelector('.home-search button:not(:disabled)')");
    const evidence = await p.evaluate('clearInterval(window.searchWatch); ({samples:window.stableSamples,error:window.stabilityError})');
    if(evidence.error) throw Error(evidence.error);
    const writes=requests.slice(from).filter(r=>r.method!=='GET').map(r=>r.method);
    if(JSON.stringify(writes)!==JSON.stringify(['POST','DELETE'])) throw Error('Duplicate or reordered writes');
    results.push({ stableSearch: true, animationInstancesPreserved: true, cancelDisabledPending: true, authoritativeReturnHome: true, ...evidence, writes });
    await p.call('Page.close');
  } else if (process.argv.includes('--opt-in')) {
    const a = await page('tab-ownership-fixture.html?kind=login&ownership=auto'); await wait(a, "!!document.querySelector('form')");
    const b = await page('tab-ownership-fixture.html?kind=login&ownership=auto'); await wait(b, "!!document.querySelector('form')");
    await wait(a, "!!document.querySelector('#tab-heading') && !document.querySelector('form')");
    await click(a, 'Usar Reals ac\u00e1'); await wait(a, "!!document.querySelector('form')");
    await wait(b, "!!document.querySelector('#tab-heading') && !document.querySelector('form')");
    results.push({ actualLocalEnvironmentOptIn: true }); await a.call('Page.close'); await b.call('Page.close');
  } else {
  for (const before of [true, false]) {
    inQueue = false; delay = 100;
    const p = await page(`queue-latency-fixture.html?run=1${before ? '&before=1' : ''}`);
    await wait(p, "document.querySelector('#search')?.disabled===false"); const from = requests.length;
    await p.evaluate("document.querySelector('#search').click()");
    await wait(p, "window.queuePhase==='queued'");
    const data = await p.evaluate('({trace,startAt,clickedAt,total:performance.now()-startAt})');
    const posts = requests.slice(from).filter(r => r.method === 'POST'); if (posts.length !== 1) throw Error('Duplicate admission');
    const post = data.trace.find(x => x.kind === 'POST /api/matchmaking/queue');
    const reads = data.trace.filter(x => x.kind.startsWith('GET '));
    results.push({ scenario: before ? 'before' : 'after', geoMs: data.trace.filter(x => x.kind.startsWith('geo-')).map(x => ({ kind: x.kind, ms: Math.round(x.end - x.start) })), tokenMs: Math.round(data.trace.find(x => x.kind === 'token').end - data.trace.find(x => x.kind === 'token').start), postMs: Math.round(post.end - post.start), serverReceiptMs: posts[0].receivedAt - data.clickedAt, reconciliationMs: Math.round(Math.max(...reads.map(x => x.end)) - post.end), totalMs: Math.round(data.total) });
    await p.call('Page.close');
  }
  inQueue = false; delay = 0;
  const localA = await page('tab-ownership-fixture.html?kind=login&ownership=auto'), localB = await page('tab-ownership-fixture.html?kind=login&ownership=auto');
  for (const p of [localA, localB]) await wait(p, "!!document.querySelector('form')");
  results.push({ localTwoOperational: true }); await localA.call('Page.close'); await localB.call('Page.close');
  const localHomeA = await page('tab-ownership-fixture.html?kind=home&ownership=auto&uid=synthetic-a'), localHomeB = await page('tab-ownership-fixture.html?kind=home&ownership=auto&uid=synthetic-b');
  for (const p of [localHomeA, localHomeB]) await wait(p, "!!document.querySelector('.home-search button:not(:disabled)')");
  results.push({ localTwoSyntheticIdentitiesOperational: true }); await localHomeA.call('Page.close'); await localHomeB.call('Page.close');
  const a = await page('tab-ownership-fixture.html?kind=login');
  await wait(a, "window.ownership?.getSnapshot()==='active' && !!document.querySelector('form')");
  const b = await page('tab-ownership-fixture.html?kind=login');
  await wait(b, "window.ownership?.getSnapshot()==='active' && !!document.querySelector('form')");
  await wait(a, "document.body.innerText.includes('Reals está activo en otra pestaña.')");
  await a.call('Page.bringToFront'); await new Promise(r => setTimeout(r, 350)); await wait(a, "window.ownership?.getSnapshot()==='blocked'");
  await click(a, 'Usar Reals acá'); await wait(a, "window.ownership?.getSnapshot()==='active'"); await wait(b, "window.ownership?.getSnapshot()==='blocked'");
  results.push({ enabledTakeover: true, focusDoesNotSteal: true }); await a.call('Page.close'); await b.call('Page.close');
  const p = await page('tab-ownership-fixture.html?kind=home&ownership=auto&geo=1&signout=1');
  await wait(p, "!!document.querySelector('.home-search button:not(:disabled)')");
  await click(p, 'Buscar chat'); await wait(p, "!!document.querySelector('.search-screen')");
  await wait(p, "document.querySelector('.search-screen')?.getAttribute('aria-busy')==='false'");
  await click(p, 'Cancelar búsqueda'); await wait(p, "!!document.querySelector('.home-search button:not(:disabled)')");
  await click(p, 'Cuenta'); await wait(p, "history.state?.trail.at(-1)==='account'"); await click(p, 'Cerrar sesión');
  await wait(p, "!!document.querySelector('.reals-sign-out-dialog[open]')");
  if (!await p.evaluate("document.activeElement.textContent==='Cancelar'")) throw Error('Initial modal focus');
  await p.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await p.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await wait(p, "!document.querySelector('.reals-sign-out-dialog')");
  if (!await p.evaluate("document.activeElement.textContent==='Cerrar sesión'")) throw Error('Restored trigger focus');
  await click(p, 'Cerrar sesión'); await p.evaluate('history.back()'); await wait(p, "!document.querySelector('.reals-sign-out-dialog')");
  await wait(p, "history.state.trail.at(-1)==='account'"); await click(p, 'Cerrar sesión');
  for (const width of [390, 1280]) {
    await p.call('Emulation.setDeviceMetricsOverride', { width, height: 850, deviceScaleFactor: 1, mobile: width === 390 });
    await wait(p, "!!document.querySelector('.reals-sign-out-dialog[open]')");
    if (!await p.evaluate('document.documentElement.scrollWidth<=innerWidth')) throw Error('Horizontal modal overflow');
    const shot = await p.call('Page.captureScreenshot'); await writeFile(join(directory, `sign-out-${width}.png`), Buffer.from(shot.data, 'base64'));
  }
  console.log('Modal screenshots:', directory);
  await p.evaluate("document.querySelector('.reals-sign-out-dialog .login-primary').click()"); await wait(p, "!!document.querySelector('form')");
  if (!await p.evaluate('signouts===1')) throw Error('Duplicate signout');
  results.push({ queueUI: true, dialogEscape: true, dialogBackRestoresAccount: true, signOutOnce: true });
  await p.call('Page.close'); } console.log(JSON.stringify({ sameContext: true, results }, null, 2));
} finally {
  server.closeAllConnections(); server.close(); for (const ws of sockets) ws.close(); chrome.kill();
  // Fixed generated files only; never recurse through user directories.
  for (const path of generated) await unlink(path);
}
