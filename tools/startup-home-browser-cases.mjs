import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

export async function measureStartupHome({ page, wait, click, requests, invalidate, reset }) {
  const baseline = process.argv.includes('--baseline');
  const directory = 'artifacts/startup-home';
  await mkdir(directory, { recursive: true });
  const results = [];
  for (const [width, height, theme] of [[390, 844, 'light'], [1440, 900, 'dark']]) {
    reset();
    const start = requests.length;
    const p = await page('tab-ownership-fixture.html?startup-home=1', async call => {
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 768 });
      await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
      await call('Page.addScriptToEvaluateOnNewDocument', { source: `
        window.visible = node => !!node?.getClientRects().length;
        window.framesSeen = [];
        requestAnimationFrame(function sample(time) {
          const root = document.querySelector('#root');
          const search = root?.querySelector('.home-search button');
          const admin = root?.querySelector('.home-admin-entry');
          const status = [...(root?.querySelectorAll('[role=status]') ?? [])].find(visible);
          const panel = [...(root?.querySelectorAll('.login-panel') ?? [])].find(visible)?.getBoundingClientRect();
          framesSeen.push({ time, search: visible(search) && !search.disabled, admin: visible(admin) && !admin.disabled,
            home: visible(root?.querySelector('.home-heading')), login: visible(root?.querySelector('.login-form')),
            skeleton: visible(root?.querySelector('.home-placeholder')), stage: status?.textContent,
            panelTop: panel ? Math.round(panel.top) : null,
            profile: visible(root?.querySelector('.profile-form')) });
          requestAnimationFrame(sample);
        });` });
    });
    await wait(p, 'framesSeen.some(f => f.stage)');
    const png = await p.call('Page.captureScreenshot', { format: 'png' });
    await writeFile(`${directory}/${baseline ? 'before' : 'after'}-${width}-${theme}.png`, Buffer.from(png.data, 'base64'));
    await wait(p, 'framesSeen.some(f => f.search && f.admin)');
    const startup = await p.evaluate(`(() => {
      const first = framesSeen.findIndex(f => f.stage), last = framesSeen.findIndex(f => f.search && f.admin);
      const cold = framesSeen.slice(first, last);
      return { stages: [...new Set(cold.map(f => f.stage).filter(Boolean))],
        positions: [...new Set(cold.map(f => f.panelTop))], ms: Math.round(framesSeen[last].time - framesSeen[first].time),
        homeFrames: cold.filter(f => f.home).length, login: cold.some(f => f.login), skeleton: cold.some(f => f.skeleton) };
    })()`);
    const startupRequests = requests.slice(start).map(r => r.path);
    if (!baseline) {
      assert.deepEqual(startup.stages, ['Preparando Reals…']);
      assert.equal(startup.positions.length, 1);
      assert.equal(startup.homeFrames, 0);
    }
    assert.equal(startup.login, false);

    const returns = [];
    for (const mode of ['read-only', 'saved', 'invalidated']) {
      const visitStart = requests.length;
      await p.evaluate("window.oldSearch = document.querySelector('.home-search button'); window.oldAdmin = document.querySelector('.home-admin-entry'); true");
      await click(p, 'Tu perfil');
      await wait(p, "visible(document.querySelector('input[name=displayName]')) && !document.querySelector('input[name=displayName]').matches(':disabled')");
      if (mode === 'saved') {
        await p.evaluate(`(() => {
          const input = document.querySelector('input[name=displayName]');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, input.value + ' actualizado');
          input.dispatchEvent(new Event('input', { bubbles: true }));
        })()`);
        await click(p, 'Guardar cambios');
        await wait(p, "[...document.querySelectorAll('.profile-save-feedback')].some(n => visible(n) && n.textContent.includes('Cambios guardados'))");
      }
      if (mode === 'invalidated') invalidate();
      const from = requests.length;
      const visit = requests.slice(visitStart, from).map(r => `${r.method} ${r.path}`);
      await p.evaluate(`window.exited = performance.now(); ([...document.querySelectorAll('button')].find(b => visible(b) && b.textContent === 'Volver a Inicio')).click()`);
      await wait(p, 'framesSeen.some(f => f.time >= exited && f.search && f.admin)');
      const evidence = await p.evaluate(`(() => {
        const frames = framesSeen.filter(f => f.time >= exited), first = key => Math.round(frames.find(f => f[key]).time - exited);
        return { searchMs: first('search'), adminMs: first('admin'), sameNodes: oldSearch === document.querySelector('.home-search button') && oldAdmin === document.querySelector('.home-admin-entry'),
          loading: frames.some(f => f.stage === 'Preparando Reals…' || f.skeleton) };
      })()`);
      const paths = requests.slice(from).map(r => r.path);
      assert(evidence.sameNodes && !evidence.loading);
      if (!baseline) assert.equal(paths.includes('/me/home'), mode === 'invalidated');
      if (mode === 'saved') assert(await p.evaluate("document.querySelector('.home-heading').textContent.includes('Fixture actualizado')"));
      returns.push({ mode, ...evidence, visit, paths });
    }
    let queueDetected;
    if (!baseline) {
      await click(p, 'Tu perfil');
      await wait(p, "visible(document.querySelector('input[name=displayName]')) && !document.querySelector('input[name=displayName]').matches(':disabled')");
      invalidate(true);
      const from = requests.length;
      await click(p, 'Volver a Inicio');
      await wait(p, "!!document.querySelector('.home-admin-entry:not(:disabled)') && document.querySelector('.home-search button')?.disabled === true");
      await click(p, 'Admin');
      await wait(p, "visible(document.querySelector('.search-screen')) && !document.querySelector('dialog[open]')");
      const paths = requests.slice(from).map(r => r.path);
      assert(paths.includes('/admin-auth/status') && !paths.some(path => path.startsWith('/admin/')));
      assert(!await p.evaluate("visible(document.querySelector('.home-search button'))"));
      queueDetected = true;
    }
    results.push({ width, theme, startup, startupRequests, returns, queueDetected });
    await p.call('Page.close');
  }
  await writeFile(`${directory}/${baseline ? 'before' : 'after'}.json`, JSON.stringify(results, null, 2));
  return results;
}
