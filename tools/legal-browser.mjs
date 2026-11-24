// Start Vite on port 5174. The fixture uses a simulated account and API.
import assert from 'node:assert/strict';
import { withIdentityChrome } from './identity-chrome.mjs';

const fixture = 'http://127.0.0.1:5174/tools/ux-audit-fixture.html?active';
async function checkReader({ call, evaluate }, standalone = false) {
  const wait = async expression => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error('Timed out waiting for ' + expression);
  };
  const layouts = standalone ? [[390, 'dark', 'privacy']] : [
    [390, 'dark', 'terms'], [390, 'light', 'privacy'], [390, 'light', 'community-guidelines'],
    [1280, 'dark', 'privacy'], [1280, 'light', 'terms'], [1280, 'dark', 'community-guidelines'],
  ];
  for (const [width, scheme, category] of layouts) {
    const action = category === 'privacy' ? 'Confirmar lectura' : 'Aceptar';
    await call('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width < 600 });
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    await call('Page.navigate', { url: fixture + `&document=${category}` });
    await wait("document.querySelector('#login-email:not(:disabled)')");
    if (standalone) assert.equal(await evaluate("matchMedia('(display-mode: standalone)').matches"), true);
    for (const [selector, value] of [['#login-email', 'synthetic@example.invalid'], ['#login-password', 'synthetic-only']]) {
      await evaluate(`document.querySelector('${selector}').focus()`);
      await call('Input.insertText', { text: value });
    }
    const click = async label => {
      const query = `[...document.querySelectorAll('button:not(:disabled)')].find(b => b.getClientRects().length && (b.textContent === ${JSON.stringify(label)} || b.ariaLabel === ${JSON.stringify(label)}))`;
      await wait(query);
      await evaluate(`(${query}).focus(); (${query}).click()`);
    };
    await click('Ingresar');
    await wait("document.activeElement.textContent === 'Antes de continuar'");
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    // Hold one public read so the actual loading layout can be measured.
    await evaluate(`(() => {
      const fetch = window.fetch;
      const held = new Promise(resolve => {
        window.releaseDocument = () => { window.fetch = fetch; resolve(); };
      });
      window.fetch = async (url, init) => {
        if (String(url).startsWith('https://reals-web.pages.dev/legal/')) {
          await held;
          init.signal.throwIfAborted();
        }
        return fetch(url, init);
      };
    })()`);
    await click('Leer documento');
    await wait("window.releaseDocument && document.querySelector('.legal-reader-body [role=status]')");
    const geometry = `['.legal-reader', '.legal-reader footer'].map(selector => {
      const { top, bottom, width } = document.querySelector(selector).getBoundingClientRect();
      return [top, bottom, width];
    })`;
    const loading = await evaluate(geometry);
    assert.equal(await evaluate("document.querySelector('.legal-reader .login-primary').disabled"), true);
    await evaluate('releaseDocument()');
    await wait("document.querySelector('.legal-reader-body').innerText.includes('Sin validez legal')");
    assert.deepEqual(await evaluate(geometry), loading, 'Reader and actions must stay in place when the document arrives');
    assert.equal(await evaluate(`(() => {
      const body = document.querySelector('.legal-reader-body');
      const action = document.querySelector('.legal-reader .login-primary');
      return body.scrollTop === 0 && body.scrollHeight > body.clientHeight && body.scrollWidth <= body.clientWidth &&
        ['h2', 'h3', 'ol li', 'ul li', 'strong'].every(tag => body.querySelector(tag)) &&
        !action.disabled && action.getBoundingClientRect().bottom <= innerHeight;
    })()`), true);
    assert.equal(await evaluate("document.querySelector('.legal-reader a').rel.includes('noopener')"), true);
    const previousScroll = await evaluate('scrollY');
    await call('Emulation.setDeviceMetricsOverride', { width, height: 256, deviceScaleFactor: 1, mobile: width < 600 });
    assert.equal(await evaluate(`(() => {
      const body = document.querySelector('.legal-reader-body');
      body.scrollTop = body.scrollHeight;
      const footer = document.querySelector('.legal-reader footer').getBoundingClientRect();
      return body.scrollTop > 0 && footer.bottom <= innerHeight && footer.top >= 0;
    })()`), true);
    await call('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width < 600 });
    await evaluate("history.back()");
    await wait("!document.querySelector('.legal-reader')");

    assert.equal(await evaluate('document.activeElement.textContent'), 'Leer documento');
    assert.equal(await evaluate('scrollY'), previousScroll);
    await click('Eliminar cuenta'); await click('Cancelar');
    await click('Ahora no');
    await wait("document.querySelector('.home-search-ready:not(:disabled)')");
    await evaluate("window.searchButton = document.querySelector('.home-search-ready'); window.geoCalls = 0; navigator.geolocation.getCurrentPosition = () => { window.geoCalls++; }");
    await click('Buscar chat');
    await wait("document.querySelector('dialog.legal-overlay:modal article')");
    assert.equal(await evaluate('searchButton.isConnected && geoCalls === 0'), true);
    await click('Leer documento');
    await wait("document.querySelector('.legal-reader-body').innerText.includes('Sin validez legal')");
    await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', windowsVirtualKeyCode: 27 });
    await call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', windowsVirtualKeyCode: 27 });
    await wait("!document.querySelector('.legal-reader') && document.querySelector('.legal-overlay:modal')");
    assert.equal(await evaluate('document.activeElement.textContent'), 'Leer documento');
    await click('Ahora no');
    assert.equal(await evaluate('auditFixture.writes.length'), 0);
    await click('Cuenta'); await click('Documentos vigentes');
    await wait("document.querySelector('dialog.legal-overlay:modal .legal-requirements article')");
    assert.equal(await evaluate('auditFixture.writes.length'), 0);
    await click('Leer documento');
    await click(action);
    await wait("document.querySelector('.legal-overlay .legal-completed')");
    assert.equal(await evaluate("document.querySelector('.legal-completed').textContent.includes('Pendiente')"), false);
    assert.deepEqual(await evaluate('auditFixture.writes'), [{ path: '/me/legal-document-actions', method: 'POST' }]);
    await click('Leer documento');
    await wait("document.querySelector('.legal-reader-body').innerText.includes('Sin validez legal')");
    assert.equal(await evaluate("!!document.querySelector('.legal-reader footer .login-primary')"), false);
    await click('Cerrar');
    await wait("!document.querySelector('.legal-reader')");
    await evaluate('history.back()');
    await wait("!document.querySelector('dialog.legal-overlay')");
    console.log(category, width, scheme, standalone ? 'standalone' : 'browser', 'defer, voluntary completion, deletion cancellation and Back passed');
  }
}
await withIdentityChrome(checkReader);
await withIdentityChrome(chrome => checkReader(chrome, true), { appUrl: fixture });
