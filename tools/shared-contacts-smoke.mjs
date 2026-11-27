import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(process.env.CONTACT_PLAYWRIGHT_ANCHOR || import.meta.url);
const { chromium, webkit } = require('playwright');
const url = 'http://127.0.0.1:5177/tools/shared-contacts-fixture.html';
const directory = 'artifacts/shared-contacts';
await mkdir(directory, { recursive: true });
async function checkRegionHistory(browser) {
  const failures = [];
  for (const scenario of ['invitation', 'forward', 'revision', 'session']) {
    const page = await browser.newPage();
    try {
      await page.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
      const button = name => page.getByRole('button', { name, exact: true });
      await page.goto(url);
      const entry = scenario === 'invitation' ? ['Importar mis contactos'] : ['Cuenta', 'Contactos'];
      for (const name of [...entry, 'Acepto participar', 'Elegir del dispositivo']) await button(name).click();
      const before = await page.evaluate(() => ({ state: history.state, length: history.length }));
      const region = page.getByRole('button', { name: /País de los números locales/ });
      const excluded = page.getByRole('checkbox', { name: /12025550100/ });
      if (scenario === 'invitation') await excluded.uncheck();
      await region.click();
      if (scenario === 'invitation') {
        assert.deepEqual(before.state.trail, ['home', 'contacts']);
        await page.goBack();
        await page.getByRole('dialog').waitFor({ state: 'detached' });
        assert.deepEqual(await page.evaluate(() => ({ state: history.state, length: history.length })), before);
        assert.equal(await excluded.isChecked(), false);
        assert.equal(await page.getByRole('checkbox', { checked: true }).count(), 2);
        assert.equal(await region.evaluate(b => b === document.activeElement), true);
        await page.goBack();
        await button('Cuenta').waitFor();
      } else if (scenario === 'session') {
        await page.evaluate(() => window.contactsFixture.endSession());
        await page.getByText('Preparando sesión sintética…').waitFor();
        await page.evaluate(() => window.contactsFixture.restartSession());
        await button('Cuenta').waitFor();
        assert.equal(await page.evaluate(() => history.length), before.length, scenario);
        await page.goBack();
        await button('Cuenta').waitFor();
        assert.equal(await page.getByRole('checkbox').count(), 0);
      } else {
        if (scenario === 'forward') {
          await page.keyboard.press('Escape');
          await page.getByRole('dialog').waitFor({ state: 'detached' });
          await page.goForward();
          assert.equal(await page.getByRole('checkbox').count(), 4);
          await page.getByRole('button', { name: /País de los números locales/ }).click();
          await page.goBack();
          await page.getByRole('dialog').waitFor({ state: 'detached' });
          assert.equal(await page.getByRole('button', { name: /País de los números locales/ }).evaluate(b => b === document.activeElement), true);
        } else {
          await page.evaluate(() => {
            window.contactsFixture.invalidate();
            window.dispatchEvent(new Event('pageshow'));
          });
          await page.getByText(/El estado de tus contactos cambió/).waitFor();
        }
        assert.deepEqual(await page.evaluate(() => ({ state: history.state, length: history.length })), before, scenario);
        await button('Volver a Cuenta').click();
        await button('Contactos').waitFor();
        await page.goForward();
        await button('Elegir del dispositivo').waitFor();
        assert.equal(await page.getByRole('checkbox').count(), 0);
      }
      assert.equal(await page.getByRole('dialog').count(), 0);
    } catch (error) { failures.push(error); } finally { await page.close(); }
  }
  if (failures.length) throw new AggregateError(failures, 'Country selector history regressions');
}
async function checkPickerTransitions(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
    await page.addInitScript(() => {
      const picker = { calls: 0 };
      window.syntheticPicker = picker;
      Object.defineProperty(navigator, 'contacts', { value: {
        getProperties: async () => ['name', 'tel'],
        select: () => new Promise((resolve, reject) => {
          picker.calls++;
          picker.finish = outcome => {
            if (outcome === 'cancel') reject(new DOMException('', 'AbortError'));
            else resolve(outcome === 'empty' ? [] : [{ name: ['Ejemplo'], tel: ['+12025550100'] }]);
          };
        }),
      } });
    });
    await page.goto(url + '?transitions');
    const button = name => page.getByRole('button', { name, exact: true });
    for (const name of ['Cuenta', 'Contactos', 'Acepto participar']) await button(name).click();
    const trigger = button('Elegir del dispositivo');
    const controls = page.locator('.contacts button, .contacts [role=status]');
    const layout = () => controls.evaluateAll(nodes => nodes.map(node => {
      const { x, y, width, height } = node.getBoundingClientRect();
      return [node.textContent, x, y, width, height];
    }));
    await trigger.scrollIntoViewIfNeeded();
    const before = await layout();
    for (const outcome of ['empty', 'cancel', 'selected']) {
      await trigger.click();
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await page.waitForLoadState('networkidle');
      assert.deepEqual(await layout(), before);
      assert.equal(await trigger.isDisabled(), true);
      await page.evaluate(outcome => {
        const trigger = [...document.querySelectorAll('.contacts button')].find(b => b.textContent === 'Elegir del dispositivo');
        const root = document.querySelector('.contacts');
        if (outcome === 'selected') {
          window.managementFlash = false;
          new MutationObserver(() => {
            if (trigger.isConnected && !trigger.disabled) window.managementFlash = true;
          }).observe(root, { childList: true, subtree: true, attributes: true });
        }
        window.syntheticPicker.finish(outcome);
      }, outcome);
      if (outcome === 'selected') {
        await page.getByRole('heading', { name: 'Revisá tus contactos' }).waitFor();
        assert.equal(await trigger.count(), 0);
        assert.equal(await page.evaluate(() => window.managementFlash), false);
      } else {
        await page.waitForFunction(() => [...document.querySelectorAll('.contacts button')].some(b => b.textContent === 'Elegir del dispositivo' && !b.disabled));
        assert.deepEqual(await layout(), before);
      }
    }
    assert.equal(await page.evaluate(() => window.syntheticPicker.calls), 3);
  } finally { await page.close(); }
}
for (const [name, engine, options] of [
  ['chromium', chromium, { channel: 'chrome' }], ['webkit', webkit, {}],
]) {
  const browser = await engine.launch(options);
  try {
    if (process.argv.includes('--picker-transitions')) {
      await checkPickerTransitions(browser);
      console.log(name, 'picker transitions passed');
      continue;
    }
    if (process.argv.includes('--region-history')) {
      await checkRegionHistory(browser);
      console.log(name, 'region history passed');
      continue;
    }
    for (const mobile of [true, false]) {
      const variant = mobile ? 'mobile-light' : 'desktop-dark';
      const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }, colorScheme: mobile ? 'light' : 'dark' });
      const errors = [];
      page.on('pageerror', () => errors.push('pageerror'));
      await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
      const button = text => page.getByRole('button', { name: text, exact: true });
      const press = text => button(text).click({ timeout: 7000 });
      const shot = label => page.screenshot({ path: directory + '/' + name + '-' + variant + '-' + label + '.png' });
      await page.goto(url);
      await button('Descartar invitación').scrollIntoViewIfNeeded(); await shot('invitation'); await press('Descartar invitación');
      await page.goto(url);
      await button('Cuenta').waitFor();
      assert.equal(await button('Descartar invitación').count(), 0);
      await press('Cuenta'); await press('Contactos');
      await press('Acepto participar'); await press('Elegir del dispositivo');
      const region = page.getByRole('button', { name: /País de los números locales Argentina/ });
      await region.click();
      if (mobile) assert.deepEqual(await page.getByRole('dialog').boundingBox(), { x: 0, y: 0, width: 390, height: 844 });
      await shot('country');
      await page.getByRole('searchbox').fill('Brasil');
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      assert.equal(await region.evaluate(b => b === document.activeElement), true);
      await region.click(); await page.goBack(); await page.getByRole('dialog').waitFor({ state: 'detached' });
      assert.equal(await page.getByRole('checkbox').count(), 4);
      await page.getByRole('checkbox').nth(1).uncheck();
      await shot('selection'); await press('Importar contactos');
      await page.getByText('Sincronizaste 2 teléfonos.').waitFor();
      await press('Elegir del dispositivo'); await page.evaluate(() => window.contactsFixture.invalidate());
      await press('Actualizar contactos'); await page.getByText(/El estado de tus contactos cambió/).waitFor();
      await press('Elegir del dispositivo'); await press('Actualizar contactos');
      await page.getByText('Sincronizaste 3 teléfonos.').waitFor();
      page.once('dialog', dialog => dialog.accept()); await press('Deshabilitar contactos en común');
      await button('Acepto participar').waitFor(); await press('Volver a Cuenta');
      assert.equal(await button('Contactos').evaluate(b => b === document.activeElement), true);
      await page.goForward(); await button('Acepto participar').waitFor();
      await page.goto(url + '?google'); await press('Cuenta'); await press('Contactos'); await press('Acepto participar');
      await press('Preparar Google Contacts'); await press('Elegir cuenta de Google');
      assert.equal(await page.getByRole('checkbox').first().isChecked(), true);
      await page.getByRole('checkbox').first().click(); await page.getByRole('checkbox').first().click(); await press('Importar contactos');
      await page.getByText('Sincronizaste 3 teléfonos.').waitFor();
      await page.goto(url + '?recovery'); await press('Cuenta'); await press('Contactos');
      await page.getByRole('status', { name: 'Cargando contactos' }).waitFor();
      await press('Acepto participar');
      assert.equal(await button('Acepto participar').getAttribute('aria-busy'), 'true');
      for (let i = 0; i < 2; i++) {
        await press('Elegir del dispositivo'); await page.getByText(/Chrome → Permisos → Contactos/).waitFor();
        await press('Volver a Cuenta'); await press('Contactos');
      }
      await press('Elegir del dispositivo'); await page.getByRole('checkbox').first().waitFor();
      await page.goto(url + '?unsupported'); await press('Cuenta'); await press('Contactos');
      await page.getByText(/no hay fuentes de contactos habilitadas/).waitFor(); assert.equal(await button('Acepto participar').count(), 0);
      await page.goto(url + (mobile ? '?chat&long' : '?chat')); const indicator = page.getByRole('button', { name: /Entre 1 y 5/ });
      await shot('chat');
      if (mobile) {
        await page.setViewportSize({ width: 320, height: 700 }); await page.emulateMedia({ colorScheme: 'dark' });
        await page.getByRole('heading', { name: /Alicia/ }).evaluate(h => { h.style.fontSize = '200%'; });
        await shot('narrow-dark-chat');
      }
      const composer = page.getByRole('textbox');
      await composer.fill('Borrador sintético');
      const element = await composer.elementHandle();
      const timeline = page.locator('.chat-timeline');
      const position = () => timeline.evaluate(el => [el.getBoundingClientRect().top, el.scrollTop]);
      const before = await position();
      await indicator.click(); await shot('explanation');
      assert.deepEqual(await position(), before);
      await page.keyboard.press('Escape'); assert.deepEqual(await position(), before);
      await indicator.click();
      await page.evaluate(() => window.contactsFixture.setRange(null));
      await indicator.waitFor({ state: 'detached' });
      assert.equal(await page.getByText(/Ambas personas eligieron/).count(), 0);
      assert.equal(await composer.inputValue(), 'Borrador sintético');
      assert.equal(await element.evaluate(node => node.isConnected), true);
      await page.evaluate(() => window.contactsFixture.setRange('ONE_TO_FIVE'));
      await indicator.waitFor();
      await composer.fill('');
      await press('Descartar indicador de contactos en común'); await page.reload();
      await page.getByRole('heading', { name: /Alicia/ }).waitFor(); assert.equal(await indicator.count(), 0);
      assert.deepEqual(errors, []); await page.close();
      console.log(name, variant, 'passed');
    }
  } finally { await browser.close(); }
}
