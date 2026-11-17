// Native Chromium, real intervals, synthetic API/clock, no account data.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
const directory = await mkdtemp(join(tmpdir(), 'reals-home-availability-'));
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${directory}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const sockets = [], results = [];
const delay = ms => new Promise(r => setTimeout(r, ms));
let port;
async function page() {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl); sockets.push(ws);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); } });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params })); });
  const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  // Page.close can close its target socket before delivering the command reply.
  const close = () => Promise.race([new Promise(r => ws.addEventListener('close', r, { once: true })), call('Page.close')]);
  return { call, evaluate, close };
}
async function wait(p, expression) {
  for (let i = 0; i < 120; i++) { if (await p.evaluate(expression)) return; await delay(100); }
  throw Error('Timeout: ' + expression);
}
try {
  for (let i = 0; i < 100; i++) { try { port = Number((await readFile(join(directory, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); break; } catch { await delay(100); } }
  for (const activity of [false, true]) {
    const p = await page();
    await p.call('Page.navigate', { url: 'http://127.0.0.1:5177/tools/home-availability-fixture.html' });
    await p.call('Page.bringToFront');
    await wait(p, "!!document.querySelector('[aria-label=\"Ver Actividad\"]')");
    if (activity) await p.evaluate("document.querySelector('[aria-label=\"Ver Actividad\"]').click()");
    // First real interval remains status-only while server time is before availability.
    await delay(5300);
    const fullBefore = await p.evaluate("homeAvailability.requests.filter(r=>r.path==='/me/home').length");
    if (fullBefore !== 1) throw Error('Unexpected pre-boundary full refresh');
    await p.evaluate('homeAvailability.advance()');
    await wait(p, activity ? "!!document.querySelector('.visual-activity')" : "document.querySelector('[aria-label=\"Ver Actividad\"]').textContent.includes('1 requieren')");
    const requests = await p.evaluate("homeAvailability.requests.filter(r=>r.path.startsWith('/me/home'))");
    if (requests.filter(r => r.path === '/me/home').length !== 2) throw Error('Missing or redundant full read');
    // Real tab background and foreground, with no remount.
    const other = await page(); await other.call('Page.bringToFront');
    await wait(p, "document.visibilityState==='hidden'");
    const count = await p.evaluate('homeAvailability.requests.length'); await delay(5300);
    if (await p.evaluate('homeAvailability.requests.length') !== count) throw Error('Background polling');
    await p.call('Page.bringToFront'); await wait(p, "document.visibilityState==='visible'");
    await wait(p, `homeAvailability.requests.length>${count}`);
    results.push({ activity, fullBefore, requests, backgroundPaused: true, resumed: true });
    await other.close(); await p.close();
  }
  const hidden = await page();
  await hidden.call('Page.navigate', { url: 'http://127.0.0.1:5177/tools/home-availability-fixture.html' });
  await hidden.call('Page.bringToFront');
  await wait(hidden, "!!document.querySelector('[aria-label=\"Ver Actividad\"]')");
  const cover = await page(); await cover.call('Page.bringToFront');
  await wait(hidden, "document.visibilityState==='hidden'");
  const before = await hidden.evaluate('homeAvailability.requests.length');
  await hidden.evaluate('homeAvailability.advance()'); await delay(5300);
  if (await hidden.evaluate('homeAvailability.requests.length') !== before) throw Error('Polled during hidden transition');
  await hidden.call('Page.bringToFront');
  await wait(hidden, "document.querySelector('[aria-label=\"Ver Actividad\"]').textContent.includes('1 requieren')");
  results.push({ becameDueWhileHidden: true, discoveredOnResume: true });
  await cover.close(); await hidden.close();
  console.log(JSON.stringify({ results, scope: 'Synthetic API and server clock; real Chromium DOM, 5-second intervals and tab visibility' }, null, 2));
} finally {
  sockets.forEach(s => s.close()); chrome.kill(); await delay(500);
  const target = resolve(directory);
  if (!target.startsWith(resolve(tmpdir()) + sep) || !target.includes('reals-home-availability-')) throw Error('Unsafe temporary directory');
  await rm(target, { recursive: true, force: true, maxRetries: 5 });
}
