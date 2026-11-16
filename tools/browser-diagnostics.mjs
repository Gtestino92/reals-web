// Record categories only: never serialize console arguments, request URLs or bodies.
import { mkdirSync, writeFileSync } from 'node:fs';
const reports = [];
process.on('exit', () => {
  if (!reports.length) return;
  mkdirSync('artifacts/ux-audit', { recursive: true });
  writeFileSync(`artifacts/ux-audit/diagnostics-${process.argv[1].split(/[\\/]/).pop()}.json`, JSON.stringify(reports, null, 2));
  const totals = {};
  for (const { counts } of reports) for (const [key, value] of Object.entries(counts)) totals[key] = (totals[key] ?? 0) + value;
  console.log('Browser diagnostics:', JSON.stringify({ pages: reports.length, totals }));
});
export async function captureDiagnostics(socket, call, scenario) {
  const counts = {};
  reports.push({ scenario, counts });
  const count = name => { counts[name] = (counts[name] ?? 0) + 1; };
  socket.addEventListener('message', event => {
    const { method, params: p } = JSON.parse(event.data);
    if (method === 'Runtime.exceptionThrown') { count('uncaught-or-unhandled-rejection'); process.exitCode = 1; }
    if (method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(p.type)) count(`console-${p.type}-requires-review`);
    if (method === 'Log.entryAdded' && ['error', 'warning'].includes(p.entry.level)) {
      // Match known browser diagnostics without retaining their potentially sensitive text.
      const detail = /beforeunload|confirmation panel/.test(p.entry.text) ? 'beforeunload-no-user-gesture'
        : /passive event listener/.test(p.entry.text) ? 'passive-listener'
        : /aria-hidden/.test(p.entry.text) ? 'aria-hidden-focus'
        : /autofocus/.test(p.entry.text) ? 'autofocus'
        : /autoplay|user.*interact/.test(p.entry.text) ? 'media-user-gesture' : 'requires-review';
      count(`browser-${p.entry.source}-${p.entry.level}-${detail}`);
    }
    if (method === 'Network.loadingFailed') count(p.canceled ? 'request-canceled' : 'failed-resource-requires-review');
    if (method === 'Network.responseReceived' && p.response.status >= 400) count(`http-${p.response.status}-requires-review`);
  });
  await call('Runtime.enable'); await call('Log.enable'); await call('Network.enable');
}
