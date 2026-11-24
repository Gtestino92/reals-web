// Start Vite on port 5174. The fixture uses a simulated account and API.
import assert from 'node:assert/strict';
import { withIdentityChrome } from './identity-chrome.mjs';

await withIdentityChrome(async ({ call, evaluate }) => {
  const wait = async expression => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error('Timed out waiting for ' + expression);
  };
  for (const [width, scheme] of [[390, 'dark'], [1280, 'light']]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width < 600 });
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    await call('Page.navigate', { url: 'http://127.0.0.1:5174/tools/ux-audit-fixture.html' });
    await wait("document.querySelector('#login-email:not(:disabled)')");
    for (const [selector, value] of [['#login-email', 'synthetic@example.invalid'], ['#login-password', 'synthetic-only']]) {
      await evaluate(`document.querySelector('${selector}').focus()`);
      await call('Input.insertText', { text: value });
    }
    const click = async label => {
      const query = `[...document.querySelectorAll('button:not(:disabled)')].find(b => b.getClientRects().length && (b.textContent === ${JSON.stringify(label)} || b.ariaLabel === ${JSON.stringify(label)}))`;
      await wait(query);
      await evaluate(`(${query}).click()`);
    };
    await click('Ingresar');
    await wait("document.activeElement.textContent === 'Antes de continuar'");
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    assert.equal(await evaluate("document.querySelector('.legal-requirements a').rel.includes('noopener')"), true);
    await click('Eliminar cuenta'); await click('Cancelar');
    await click('Ahora no');
    await wait("document.querySelector('.profile-form')");
    assert.equal(await evaluate('auditFixture.writes.length'), 0);
    await click('Cuenta'); await click('Documentos vigentes');
    await wait("document.querySelector('dialog.legal-overlay:modal .legal-requirements a')");
    assert.equal(await evaluate('auditFixture.writes.length'), 0);
    await click('Confirmar lectura');
    await wait("document.querySelector('.legal-overlay .legal-completed')?.textContent.includes('Lectura confirmada')");
    assert.equal(await evaluate("document.querySelector('.legal-requirements').innerText.includes('Confirmar lectura')"), false);
    assert.deepEqual(await evaluate('auditFixture.writes'), [{ path: '/me/legal-document-actions', method: 'POST' }]);
    await evaluate('history.back()');
    await wait("!document.querySelector('dialog.legal-overlay')");
    console.log(width, scheme, 'defer, voluntary completion, deletion cancellation and Back passed');
  }
});
