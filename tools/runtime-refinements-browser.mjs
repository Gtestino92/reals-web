import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Local synthetic backend: real HTTP, controlled latency, no real account data.
let inQueue = false, delay = 0;
const requests = [];
const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  requests.push({ path: req.url, method: req.method, receivedAt: Date.now() });
  await new Promise(r => setTimeout(r, delay));
  let value;
  if (req.url === '/me') value = { id: 'me', status: 'ACTIVE' };
  if (req.url === '/me/profile') value = { id: 'p', userId: 'me', status: 'ACTIVE', displayName: 'Fixture' };
  if (req.url === '/me/home/status') value = { version: 1, dirty: false, nextRefreshAt: null, serverTime: new Date().toISOString() };
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
const generated = ['tools/latency-before-location.ts', 'tools/latency-before-home.ts'];
await writeFile(generated[0], execFileSync('git', ['show', 'a6864fe:src/home/location.ts'], { encoding: 'utf8' }), 'utf8');
await writeFile(generated[1], execFileSync('git', ['show', 'a6864fe:src/home/useHome.ts'], { encoding: 'utf8' }).replaceAll('../auth/', '../src/auth/').replaceAll("'./contracts'", "'../src/home/contracts'").replaceAll("'./location'", "'./latency-before-location'"), 'utf8');
const directory = await mkdtemp(join(tmpdir(), 'reals-runtime-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${directory}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const sockets = [];
try {
  let port;
  for (let i = 0; i < 60; i++) { try { port = (await readFile(join(directory, 'DevToolsActivePort'), 'utf8')).split('\n')[0].trim(); break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  const page = async path => {
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl); sockets.push(ws);
    await new Promise(r => ws.addEventListener('open', r, { once: true }));
    let id = 0; const pending = new Map();
    ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); } });
    const call = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params })); });
    const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
    await call('Page.enable'); await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 850, deviceScaleFactor: 1, mobile: true });
    await call('Page.navigate', { url: `http://127.0.0.1:5174/tools/${path}&backend=${encodeURIComponent(origin)}` });
    return { call, evaluate };
  };
  const wait = async (p, expression) => { for (let i = 0; i < 150; i++) { if (await p.evaluate(expression)) return; await new Promise(r => setTimeout(r, 100)); } throw Error('Timeout ' + expression + ' ' + await p.evaluate('document.body.innerText')); };
  const click = async (p, text) => p.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>(b.getAttribute('aria-label')===${JSON.stringify(text)}||b.textContent===${JSON.stringify(text)})&&!b.closest('[hidden]'))?.click()`);
  const results = [];
  if (process.argv.includes('--opt-in')) {
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
    await wait(p, `!!document.querySelector('[aria-label="Búsqueda confirmada"]')`);
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
  await click(p, 'Buscar chat'); await wait(p, "document.body.innerText.includes('Obteniendo ubicación')");
  await wait(p, `!!document.querySelector('[aria-label="Búsqueda confirmada"]')`);
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
  await unlink('tools/latency-before-location.ts'); await unlink('tools/latency-before-home.ts');
}
