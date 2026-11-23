// Start local Vite on 5174. Uses the real account flow and a synthetic API.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { withIdentityChrome } from './identity-chrome.mjs';

const base = 'http://127.0.0.1:5174';
const directory = 'artifacts/notification-settings';
const legacyKey = 'reals:web-notifications:v1:u';
const key = 'reals:web-notifications:v2:u';
const labels = [
  'Primer chat disponible', 'Revisión visual disponible', 'Coordinación disponible',
  'Horario del segundo chat confirmado', 'Entrada al segundo chat disponible',
];
await mkdir(directory, { recursive: true });

await withIdentityChrome(async ({ call, evaluate }) => {
  await call('Page.enable');
  await call('Network.enable');
  // Use the actual HTML and icon links with the synthetic app entry below.
  await call('Network.setBlockedURLs', { urls: [base + '/src/main.tsx*'] });
  const wait = async (condition, label) => {
    for (let i = 0; i < 100; i++) {
      try { if (await evaluate(condition)) return; }
      catch (error) {
        if (!/Inspected target navigated|Execution context was destroyed|Cannot find context/.test(error.message)) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 40));
    }
    throw Error(label);
  };
  const press = async (key, code, windowsVirtualKeyCode) => {
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, ...(key === ' ' ? { text: ' ' } : {}) });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
  };
  const button = async name => {
    const find = `[...document.querySelectorAll('button')].find(b => b.getClientRects().length && !b.disabled &&
      (b.getAttribute('aria-label') || b.textContent) === ${JSON.stringify(name)})`;
    await wait(`!!(${find})`, name);
    await evaluate(`(${find}).click()`);
  };
  const mount = () => evaluate(`(async () => {
    await import('/src/styles/tokens.css');
    await import('/src/styles/global.css');
    const { default: React } = await import('/node_modules/.vite/deps/react.js');
    const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js');
    const { OperationalApp } = await import('/src/App.tsx');
    const { ApiClient } = await import('/src/auth/api.ts');
    const { emptyHome } = await import('/src/home/fixtures.ts');
    const requests = [];
    const home = emptyHome();
    home.pendingActions = [{ type: 'VISUAL_REVIEW', matchId: 'visual', partner: { displayName: 'Ana' } }];
    home.nextSteps = [{ type: 'SCHEDULING', matchId: 'schedule', connectionId: 'connection', requiresAction: true }];
    const fetcher = async (path, options) => {
      requests.push([path, options?.method]);
      const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
      switch (path) {
        case '/api/me': return json({ id: 'u', status: 'ACTIVE' });
        case '/api/me/profile': return json({ id: 'p', userId: 'u', status: 'ACTIVE', displayName: 'Lucía' });
        case '/api/me/home': return json(home);
        case '/api/me/home/status': return json({ version: 1, dirty: false, nextRefreshAt: null, serverTime: new Date().toISOString() });
        case '/api/reference/affinity-questions': return json({ catalogVersion: 'empty', categories: [], questions: [] });
        case '/api/me/profile/affinity-answers': return json({ answers: [] });
        default: throw Error('Unexpected synthetic endpoint: ' + path);
      }
    };
    const identity = { uid: 'synthetic', emailVerified: true, getIdToken: async () => 'synthetic', reload: async () => {} };
    const service = { observe: next => { next(identity); return () => {}; }, signOut: async () => {} };
    const root = createRoot(document.querySelector('#root'));
    window.notificationFixture = { requests, unmount: () => root.unmount() };
    root.render(React.createElement(OperationalApp, {
      firebase: { service, localVerification: false }, api: new ApiClient(fetcher),
    }));
  })()`);
  const switches = () => evaluate("[...document.querySelectorAll('.account-notifications [role=switch]')].map(input => input.checked)");
  const open = async () => {
    await button('Cuenta'); await button('Notificaciones');
    await wait("document.querySelectorAll('.account-notifications [role=switch]').length === 5", 'five Web switches');
  };
  const screenshot = async name => {
    const { data } = await call('Page.captureScreenshot', { format: 'png' });
    await writeFile(`${directory}/${name}.png`, Buffer.from(data, 'base64'));
  };
  const assertNoAndroidRequests = async () => assert.equal(await evaluate(
    "notificationFixture.requests.filter(([path]) => path.endsWith('/me/notification-preferences')).length"), 0);

  for (const width of [320, 390, 1440]) for (const theme of ['light', 'dark']) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: width < 768 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 768 });
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
    const url = `${base}/?notification-fixture=${width}-${theme}`;
    await call('Page.navigate', { url });
    await wait(`location.href === ${JSON.stringify(url)} && document.readyState === 'complete'`, 'document ready');
    await evaluate(`localStorage.removeItem(${JSON.stringify(key)});
      localStorage.setItem(${JSON.stringify(legacyKey)}, JSON.stringify({ enabled: true, records: [], presented: [] }))`);
    await mount();
    await open();
    assert.deepEqual(await switches(), [true, true, true, true, true]);
    assert.equal(await evaluate("document.querySelector('.notification-platform-selector')"), null);
    const ax = await call('Accessibility.getFullAXTree');
    const nodes = ax.nodes.filter(node => node.role?.value === 'switch');
    assert.deepEqual(nodes.map(node => node.name.value), labels);
    assert.ok(nodes.every(node => node.description?.value));
    assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth &&
      [...document.querySelectorAll('.notification-row')].every(row => {
        const copy = row.querySelector('.notification-copy').getBoundingClientRect();
        const input = row.querySelector('input').getBoundingClientRect();
        return row.getBoundingClientRect().height >= 72 && copy.right <= input.left;
      })`));
    await wait(`document.title === '(2) Reals' && document.querySelector('link[sizes="32x32"]').href.startsWith('data:image/png;')`, 'two unread and a favicon badge');
    const oldIcon = await evaluate(`document.querySelector('link[sizes="32x32"]').href`);

    for (let i = 0; i < 3; i++) await press('Tab', 'Tab', 9);
    assert.ok(await evaluate("document.activeElement.matches('[role=switch]:focus-visible') && document.activeElement.labels[0].textContent.includes('Revisión visual')"));
    await press(' ', 'Space', 32);
    await wait("document.title === '(1) Reals'", 'category filtered title');
    await wait(`document.querySelector('link[sizes="32x32"]').href !== ${JSON.stringify(oldIcon)}`, 'category filtered favicon');
    assert.deepEqual(await switches(), [true, false, true, true, true]);
    await screenshot(`web-${width}-${theme}`);
    await button('Volver a Cuenta');
    await wait("document.activeElement?.textContent === 'Notificaciones'", 'explicit Back restores focus');
    await evaluate('history.forward()');
    await wait("!!document.querySelector('.account-notifications')", 'Forward restores settings');
    await evaluate('history.back()');
    await wait("document.activeElement?.textContent === 'Notificaciones'", 'browser Back restores focus');
    await assertNoAndroidRequests();

    await call('Page.reload');
    await wait("document.readyState === 'complete' && !window.notificationFixture", 'full reload');
    await mount();
    await wait("!!document.querySelector('.home')", 'authenticated after reload');
    if (await evaluate("!!document.querySelector('.account-notifications')?.getClientRects().length")) await button('Volver a Cuenta');
    if (await evaluate("!!document.querySelector('.home-account')?.getClientRects().length")) await button('Volver a Inicio');
    await open();
    assert.deepEqual(await switches(), [true, false, true, true, true]);
    await assertNoAndroidRequests();
    console.log(`PASS ${width}px ${theme}`);
  }
});
