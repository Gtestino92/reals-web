import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(process.env.CONTACT_PLAYWRIGHT_ANCHOR || import.meta.url);
const { chromium, webkit } = require('playwright');
const url = 'http://127.0.0.1:5177/tools/shared-contacts-fixture.html';
const directory = 'artifacts/shared-contacts';
await mkdir(directory, { recursive: true });
for (const [name, engine, options] of [
  ['chromium', chromium, { channel: 'chrome' }], ['webkit', webkit, {}],
]) {
  const browser = await engine.launch(options);
  try {
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
      await button('País de los números locales: Argentina').waitFor();
      assert.equal(await page.getByRole('checkbox').count(), 3);
      await press('Seleccionar todos');
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
      await press('Deseleccionar todos'); await press('Seleccionar todos'); await press('Importar contactos');
      await page.getByText('Sincronizaste 3 teléfonos.').waitFor();
      await page.goto(url + '?recovery'); await press('Cuenta'); await press('Contactos');
      await page.getByRole('status', { name: 'Cargando contactos' }).waitFor();
      await press('Acepto participar');
      assert.equal(await button('Acepto participar').getAttribute('aria-busy'), 'true');
      for (let i = 0; i < 2; i++) {
        await press('Elegir del dispositivo'); await page.getByText(/Chrome → Permisos → Contactos/).waitFor();
        await press('Volver a Cuenta'); await press('Contactos');
      }
      await press('Elegir del dispositivo'); await page.getByRole('checkbox').waitFor();
      await page.goto(url + '?unsupported'); await press('Cuenta'); await press('Contactos');
      await page.getByText(/no hay fuentes de contactos habilitadas/).waitFor(); assert.equal(await button('Acepto participar').count(), 0);
      await page.goto(url + '?chat'); const indicator = page.getByRole('button', { name: /Entre 1 y 5/ });
      await indicator.click(); await shot('chat'); await indicator.click();
      const composer = page.getByRole('textbox');
      await composer.fill('Borrador sintético');
      const element = await composer.elementHandle();
      await page.evaluate(() => window.contactsFixture.setRange(null));
      await indicator.waitFor({ state: 'detached' });
      assert.equal(await composer.inputValue(), 'Borrador sintético');
      assert.equal(await element.evaluate(node => node.isConnected), true);
      await page.evaluate(() => window.contactsFixture.setRange('ONE_TO_FIVE'));
      await indicator.waitFor();
      await composer.fill('');
      await press('Descartar indicador de contactos en común'); await page.reload();
      await page.getByRole('heading', { name: 'Alicia Ejemplo' }).waitFor(); assert.equal(await indicator.count(), 0);
      assert.deepEqual(errors, []); await page.close();
      console.log(name, variant, 'passed');
    }
  } finally { await browser.close(); }
}
