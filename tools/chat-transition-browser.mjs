// Synthetic manual login, matchmaking and message confirmation in the real application.
import assert from 'node:assert/strict';
import { fixtureServer, scenario } from './second-chat-synthetic.mjs';
import { mkdir, readFile } from 'node:fs/promises';
const { chromium, webkit } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const before = process.argv.includes('--baseline');
const directory = 'artifacts/chat-transition';
await mkdir(directory, { recursive: true });
const recording = await readFile(new URL('../src/chat/fixtures/chrome-aac-fragmented.mp4',import.meta.url));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function inspectHeart(page) {
  const target = page.getByRole('button', { name: 'Reaccionar con corazón' });
  await page.emulateMedia({ reducedMotion:'reduce' });
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  const incoming = page.locator('.chat-message.incoming').last();
  const bubble = await incoming.boundingBox();
  const icon = await target.locator('svg').boundingBox();
  assert.equal(box.width,48); assert.equal(box.height,48);
  assert.ok(icon.x >= bubble.x + bubble.width && icon.x - bubble.x - bubble.width < 12);
  await target.click();
  const pending = page.getByRole('img', { name:'Guardando corazón' });
  await pending.waitFor();
  assert.equal(await pending.evaluate(node => getComputedStyle(node).animationName),'none');
  await page.getByRole('img', { name:'Reaccionaste con corazón' }).waitFor();
  assert.deepEqual(await incoming.boundingBox(), bubble);
}

async function checkSecond(page) {
  const { server, scenarios, origin } = await fixtureServer();
  const incoming = { id:'1',senderId:'b',chatSessionId:'c',sentAt:new Date().toISOString(),content:'Hola',messageType:'TEXT',reactionType:null };
  const received = { ...incoming, id:'2', senderId:'a', reactionType:'HEART' };
  const state = scenario({ writableAudio:true, messages:[incoming,received] });
  scenarios.set('geometry',state);
  try {
    await page.route('**/messages/1/reaction', async route => {
      await pause(400); incoming.reactionType = 'HEART';
      await route.fulfill({json:incoming,headers:{'Access-Control-Allow-Origin':'*'}});
    });
    await page.addInitScript(encoded => {
      Object.defineProperty(navigator, 'mediaDevices', { configurable:true, value:{
        getUserMedia:async () => ({getTracks:() => [{stop(){}}]}),
      } });
      window.MediaRecorder = class {
        static isTypeSupported() { return true; }
        mimeType = 'audio/mp4';
        state = 'inactive';
        start() { this.state = 'recording'; }
        stop() {
          this.state = 'inactive';
          const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
          this.ondataavailable({data:new Blob([bytes],{type:this.mimeType})});
          queueMicrotask(() => this.onstop());
        }
      };
    }, recording.toString('base64'));
    await page.goto('http://127.0.0.1:5187/tools/second-chat-fixture.html?backend='+encodeURIComponent(origin+'/geometry'));
    await page.getByRole('button', {name:'Reaccionar con corazón'}).waitFor();
    assert.equal(await page.locator('.chat-received-heart svg').count(),1);
    await inspectHeart(page);
    const gate = state.gate = {path:'/chats/c/messages'};
    await page.getByRole('textbox',{name:'Mensaje'}).fill('Mi segundo mensaje');
    await page.getByRole('button',{name:'Enviar mensaje'}).click();
    const bubble = page.locator('.chat-message.outgoing').last();
    await page.getByText('Enviando…',{exact:true}).waitFor();
    const pending = await bubble.boundingBox();
    for (let i=0; !gate.release && i<100; i++) await pause(10);
    assert.ok(gate.release);
    gate.release();
    await page.waitForFunction(()=>!document.querySelector('.chat-timeline [role=status]'));
    assert.deepEqual(await bubble.boundingBox(),pending);
    const upload = state.gate = {path:'/chats/c/audio-messages'};
    await page.getByRole('button',{name:'Grabar audio'}).click();
    await page.getByRole('button',{name:'Enviar audio'}).click();
    await page.getByText('Audio pendiente').waitFor();
    const pendingAudio = await bubble.boundingBox();
    for (let i=0; !upload.release && i<100; i++) await pause(10);
    assert.ok(upload.release); upload.release();
    await page.getByRole('button',{name:'Reproducir audio'}).waitFor();
    const confirmedAudio = await bubble.boundingBox();
    assert.deepEqual([confirmedAudio.width,confirmedAudio.height],[pendingAudio.width,pendingAudio.height]);
  } finally { server.close(); }
}

for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
  const browser = await launcher.launch(engine === 'chromium' ? { channel: 'chrome', ignoreDefaultArgs: ['--hide-scrollbars'] } : {});
  try {
    for (const [width, colorScheme] of (before ? [[360,'light'],[1280,'dark']] : [[320,'dark'],[360,'light'],[1280,'light'],[1280,'dark']])) {
      const page = await browser.newPage({ viewport: { width, height: 800 }, colorScheme });
      let matched = false;
      const messages = [{ id:'1', senderId:'them', chatSessionId:'c', messageType:'TEXT', content:'Hola',reactionType:null,replyTo:null,audio:null,clientMessageId:null, sentAt:new Date().toISOString() }];
      const reads = [];
      await page.route('**/synthetic/**', async route => {
        const path = new URL(route.request().url()).pathname.slice('/synthetic'.length);
        reads.push(path);
        await pause(160);
        const now = new Date().toISOString();
        const profile = { id:'p', userId:'me', status:'ACTIVE', displayName:'Fixture', birthDate:'1995-01-01',gender:'MALE',lookingForGenders:['FEMALE'],intention:'DATE',city:'Fixture',countryCode:'AR',bio:'Bio',preferredMinAge:18,preferredMaxAge:45,maxDistanceKm:50,authenticityVerificationStatus:'STALE' };
        const data = {
          '/me': { id:'me', status:'ACTIVE' }, '/me/profile':profile,
          '/me/legal-status':{ requirementsSatisfied:true, documents:[] }, '/legal/documents/current':{ documents:[] },
          '/me/home/status':{ version:matched ? 2 : 1, dirty:false, nextRefreshAt:null, serverTime:now },
          '/me/home':{ profileStatus:'ACTIVE', matchmaking:{inQueue:!matched,canSearch:false,blockedReason:null}, activeInteractionsSummary:{ activeInitialCount:0, activeConnectionCount:0, actionableConnectionCount:0, hasPendingSchedulingConnection:false }, pendingActions:matched ? [{type:'FIRST_CHAT',matchId:'m',chatId:'c'}] : [], nextSteps:[], passiveNotices:[] },
          '/matchmaking/queue':{ userId:'me', inQueue:!matched },
          '/matches/m':{ id:'m',userAId:'me',userBId:'them',state:'CHAT_ACTIVE' },
          '/matches/m/chat':{id:'c',matchId:'m',chatType:'FIRST_CHAT',status:'ACTIVE',partner:{userId:'them',displayName:'María'},myDecision:'PENDING',partnerDecision:'PENDING',timeoutAt:new Date(Date.now()+600000).toISOString(),serverTime:now,sharedContactRange:'ONE_TO_FIVE'},
          '/chats/c/exit-requests':[], '/chats/c/messages':messages,
        };
        let value = data[path];
        if (path === '/chats/c/messages/1/reaction') {
          await pause(400); messages[0].reactionType = 'HEART'; value = messages[0];
        }
        if (path === '/chats/c/messages' && route.request().method() === 'POST') {
          await pause(450);
          value = { ...messages[0], ...route.request().postDataJSON(), senderId:'me', reactionType:null, id:String(messages.length+1), sentAt:now };
          if (value.replyTo) value.replyTo = { ...value.replyTo, senderId:'them', messageType:'TEXT',previewText:'Hola' };
          messages.push(value);
        }
        await route.fulfill({ status:value ? 200 : 404, json:value ?? {}, headers:{'X-Reals-Counterpart-Audio-Access':'ALLOWED'} });
      });
      await page.goto('http://127.0.0.1:5187/tools/tab-ownership-fixture.html?kind=login&manual=1&backend=/synthetic');
      await page.getByText('Continuar con Google').waitFor();
      await page.evaluate(() => {
        window.samples = [];
        const backdropWidth = () => getComputedStyle(document.body, '::before').width;
        window.loginBackdropWidths = new Set([backdropWidth()]);
        const visible = node => !!node?.getClientRects().length;
        requestAnimationFrame(function sample(t) {
          window.loginBackdropWidths.add(backdropWidth());
          const all = selector => [...document.querySelectorAll(selector)].filter(visible);
          window.samples.push({ t, status:all('[role=status]').map(n=>n.textContent).join(' '), exit:all('button').some(n=>n.textContent==='Cerrar sesión'), heading:all('h2')[0]?.textContent, chrome:visible(document.querySelector('.first-chat')), ready:!!document.querySelector('.chat-composer textarea:enabled') });
          requestAnimationFrame(sample);
        });
      });
      await page.getByText('Continuar con Google').click();
      try { await page.getByRole('heading',{name:'Buscando chat'}).waitFor({timeout:12000}); }
      catch (error) { console.log(reads, await page.locator('body').innerText()); throw error; }
      if (!before && width >= 842) {
        assert.equal(await page.evaluate(() => window.loginBackdropWidths.size), 1, 'Desktop backdrop shifted during Google login');
      }
      const seal = await page.locator('.search-screen img').elementHandle();
      matched = true;
      await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
      if (!before) {
        await page.getByRole('heading',{name:'Encontramos a alguien'}).waitFor();
        assert.equal(await seal.evaluate(node=>node===document.querySelector('.search-screen img')),true);
        assert.equal(await page.getByRole('button',{name:'Cancelar búsqueda'}).count(),0);
      }
      await page.getByRole('heading',{name:'María'}).waitFor();
      await page.waitForFunction(()=>samples.some(f=>f.chrome && f.heading==='María' && f.ready));
      const prep = await page.evaluate(()=> {
        const queue = samples.findIndex(f=>f.heading==='Buscando chat');
        const end = samples.findLastIndex(f=>f.heading!=='María');
        const stages = [...new Set(samples.slice(0,queue).map(f=>f.status).filter(Boolean))];
        const work = samples.slice(queue,end+1);
        const first = work.find(f=>f.heading==='Encontramos a alguien'||f.chrome);
        const discovered = performance.getEntriesByName(location.origin+'/synthetic/me/home').at(-1).responseEnd;
        const ready = samples.find(f=>f.chrome && f.heading==='María' && f.ready);
        return { stages, discoveryToReadyMs:Math.round(ready.t-discovered), signOutFrames:samples.slice(0,queue).filter(f=>f.exit).length, homeFrames:work.filter(f=>f.heading==='Inicio').length, incompleteFrames:work.filter(f=>f.chrome).length, visiblePreparationMs:first ? Math.round(work.at(-1).t-first.t) : null };
      });
      const init = reads.filter(s=>s.startsWith('/matches/')||s.startsWith('/chats/'));
      const shot = async label => page.screenshot({path:directory+'/'+[before?'before':'after',engine,width,colorScheme,label].join('-')+'.png'});
      const header = page.locator('.chat-heading');
      const headerBefore = await header.boundingBox();
      const info = page.getByRole('button',{name:/Entre 1 y 5/});
      await info.click();
      const popup = await page.locator('.contact-indicator p').boundingBox();
      assert.ok(popup.x >= 0 && popup.x+popup.width <= width);
      assert.deepEqual(await header.boundingBox(),headerBefore);
      await shot('contacts');
      await page.keyboard.press('Escape');
      assert.ok(await info.evaluate(node=>node===document.activeElement));
      if (!before) await inspectHeart(page);
      const sizes = [];
      for (const content of ['Sí','Una conversación extensa. '.repeat(12).trim(),'Una línea\nOtra línea', 'Respuesta breve']) {
        if (content === 'Respuesta breve') {
          const quote = page.getByRole('button',{name:'Responder mensaje de María'});
          await quote.focus(); await page.keyboard.press('Enter');
        }
        await page.getByRole('textbox',{name:'Mensaje'}).fill(content);
        await page.getByRole('button',{name:'Enviar mensaje'}).click();
        await page.getByText('Enviando…',{exact:true}).first().waitFor();
        const bubble = page.locator('.chat-message.outgoing').last();
        if (!before && content === 'Respuesta breve') assert.equal(await bubble.locator('blockquote').count(), 1);
        const pending = await bubble.boundingBox();
        if (!sizes.length) await shot('pending');
        await page.waitForFunction(()=>!document.querySelector('.chat-timeline [role=status]'));
        const confirmed = await bubble.boundingBox();
        if (!sizes.length) await shot('confirmed');
        if (!before) assert.equal(pending.x,confirmed.x);
        sizes.push([pending,confirmed].map(({width,height})=>[width,height]));
      }
      console.log(JSON.stringify({engine,width,colorScheme,...prep,init,sizes}));
      if (!before) {
        assert.deepEqual(prep.stages,['Preparando Reals…']);
        assert.equal(prep.homeFrames,0); assert.equal(prep.signOutFrames,0); assert.equal(prep.incompleteFrames,0);
        assert.deepEqual(init.sort(),['/chats/c/exit-requests','/chats/c/messages','/matches/m','/matches/m/chat']);
        const dismiss = page.getByRole('button',{name:'Descartar indicador de contactos en común'});
        assert.equal((await dismiss.locator('svg').boundingBox()).width,14);
        const bounds = await page.locator('.contact-indicator').boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x+bounds.width <= width);
        const trigger = await info.boundingBox();
        const cross = await dismiss.boundingBox();
        assert.ok(cross.width >= 28 && cross.height >= 28);
        assert.ok(trigger.x+trigger.width <= cross.x+0.1);
        await dismiss.focus(); await page.keyboard.press('Enter');
        assert.ok(await page.getByRole('heading',{name:'María'}).evaluate(node=>node===document.activeElement));
        await checkSecond(page);
        for (const [pending,confirmed] of sizes) assert.deepEqual(pending,confirmed);
      }
      await page.close();
    }
  } finally { await browser.close(); }
}
