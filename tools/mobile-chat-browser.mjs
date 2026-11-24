import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { withIdentityChrome } from './identity-chrome.mjs';
import { fixtureServer, iso, scenario } from './second-chat-synthetic.mjs';

const base = process.argv.find(arg => arg.startsWith('--url='))?.slice(6) ?? 'http://127.0.0.1:5187';
const baseline = process.argv.includes('--baseline');
const focusBaseline = process.argv.includes('--focus-baseline');
const directory = 'artifacts/mobile-chat';
const draft = 'Estoy escribiendo un borrador que debería conservarse. '.repeat(17).trim();
const question = '¿Qué aprendiste de la última conversación que te hizo cambiar de opinión?';
const now = Date.now();
const messages = Array.from({ length: 48 }, (_, index) => ({
  id: String(index + 1), chatSessionId: 'c', senderId: Math.floor(index / 3) % 2 ? 'a' : 'b',
  messageType: 'TEXT', content: 'Mensaje de prueba ' + (index + 1),
  sentAt: iso(now - (48 - index) * 1000), clientMessageId: null, replyTo: null, reactionType: null, audio: null,
}));
const incoming = { ...messages[0], id: '49', sentAt: iso(now), content: 'Mensaje nuevo durante la lectura' };
const { server, scenarios, origin } = await fixtureServer();
const second = scenario({ now, writableAudio: true });
scenarios.set('mobile', second);
await mkdir(directory, { recursive: true });

try {
  await withIdentityChrome(async ({ call, evaluate }) => {
    await call('Page.enable');
    // Use the app's HTML shell and viewport meta, with a synthetic entry point.
    // Block the production entry module before it can initialize authentication.
    await call('Network.enable');
    await call('Network.setBlockedURLs', { urls: [base + '/src/main.tsx*'] });
    const metrics = (width, height) => call('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: width < 768,
    });
    const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))))');
    async function until(expression) {
      for (let i = 0; i < 60; i++) {
        if (await evaluate(expression)) return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw Error('Fixture did not become ready: ' + expression);
    }
    const inspect = () => evaluate(`(() => {
      const root = document.querySelector('.first-chat'), list = root.querySelector('ol');
      const form = root.querySelector('form'), input = form.querySelector('textarea');
      const heading = root.querySelector('h2'), guidance = root.querySelector('.chat-guidance');
      const advance = guidance?.querySelector('button');
      const send = form.querySelector('button[aria-label="Enviar mensaje"], button:not([type])');
      const mic = form.querySelector('[aria-label="Grabar audio"]');
      const box = element => element?.getBoundingClientRect().toJSON();
      const scrollRange = element => element.scrollHeight - element.clientHeight;
      const gap = i => list.children[i].getBoundingClientRect().top - list.children[i - 1].getBoundingClientRect().bottom;
      return {
        viewport: visualViewport.height, pageScroll: scrollRange(document.documentElement), rootScroll: scrollRange(root),
        chromeScroll: scrollRange(root.querySelector('.chat-chrome')), composerScroll: scrollRange(form),
        list: box(list), heading: box(heading), guidance: box(guidance), advance: box(advance), form: box(form), send: box(send), mic: box(mic), input: box(input),
        inputScroll: scrollRange(input), listScroll: scrollRange(list), scrollTop: list.scrollTop,
        focused: document.activeElement === input, draft: input.value, sameSenderGap: gap(1), newSenderGap: gap(3),
        menu: box(root.querySelector('[aria-label="Opciones del chat"]')),
        approval: box(root.querySelector('.chat-approve')),
      };
    })()`);
    async function capture(chat, width, variant) {
      const { data } = await call('Page.captureScreenshot', { format: 'png' });
      await writeFile(`${directory}/${baseline ? 'before' : 'after'}-${chat}-${width}-${variant}.png`, Buffer.from(data, 'base64'));
    }
    const setDraft = value => evaluate(`(() => {
      const input = document.querySelector('.chat-composer textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`);
    async function tap(rect) {
      const point = { x: Math.round((rect.left + rect.right) / 2), y: Math.round((rect.top + rect.bottom) / 2) };
      await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    }
    const focusState = () => evaluate(`({
      same: trackedInput === document.querySelector('.chat-composer textarea'),
      active: document.activeElement === trackedInput ? 'draft' : document.activeElement?.tagName,
      events: [...draftFocusEvents],
      count: textSends.length, viewport: visualViewport.height, draft: trackedInput.value,
    })`);
    async function checkSends(chat, width, height) {
      await evaluate(`(() => {
        window.trackedInput = document.querySelector('.chat-composer textarea');
        window.draftFocusEvents = [];
        for (const type of ['focus', 'blur']) trackedInput.addEventListener(type, () => draftFocusEvents.push(type));
        trackedInput.focus();
      })()`);
      await metrics(width, 320);
      await settle();
      for (let i = 1; i <= (focusBaseline ? 1 : 4); i++) {
        const text = 'Prueba de envío ' + i;
        await setDraft(text);
        await until("!!document.querySelector('.chat-composer button[aria-label=\"Enviar mensaje\"]:enabled')");
        await settle();
        const before = await focusState();
        const { send } = await inspect();
        assert.ok(await evaluate(`document.elementFromPoint(${(send.left + send.right) / 2}, ${(send.top + send.bottom) / 2})
          ?.closest('button')?.getAttribute('aria-label') === 'Enviar mensaje'`), JSON.stringify(send));
        await tap(send);
        await until(`textSends.length === ${i}`);
        const pending = await focusState();
        if (i === 4) {
          await evaluate('trackedInput.blur()');
          await metrics(width, height);
          await settle();
        }
        await evaluate('releaseTextSend()');
        await until(`trackedInput.value === '' && [...document.querySelectorAll('.chat-message-row')].some(row => row.textContent.includes(${JSON.stringify(text)}))`);
        const confirmed = await focusState();
        console.log(JSON.stringify({ chat, width, send: i, before, pending, confirmed }));
        if (focusBaseline) continue;
        const { events: pendingEvents, ...pendingState } = pending;
        const { events: confirmedEvents, ...confirmedState } = confirmed;
        assert.deepEqual(pendingState, { same: true, active: 'draft', count: i, viewport: 320, draft: text });
        assert.ok(!pendingEvents.includes('blur') && pendingEvents.length <= 1);
        assert.deepEqual(confirmedState, i === 4
          ? { same: true, active: 'BODY', count: i, viewport: height, draft: '' }
          : { same: true, active: 'draft', count: i, viewport: 320, draft: '' });
        assert.deepEqual(confirmedEvents, i === 4 ? [...pendingEvents, 'blur'] : pendingEvents);
      }
    }

    for (const check of focusBaseline ? ['send'] : baseline ? ['layout'] : ['layout', 'send']) for (const chat of ['first', 'second']) {
      for (const [width, height, scheme] of [[360, 780, 'light'], [430, 900, 'dark'], [1280, 800, 'light']]) {
        if (focusBaseline && width !== 360) continue;
        second.messages = [...messages];
        await metrics(width, height);
        await call('Emulation.setTouchEmulationEnabled', { enabled: width < 768 });
        await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
        const url = base + '/?layout=' + check + '-' + chat + '-' + width;
        await call('Page.navigate', { url });
        await until(`location.href === ${JSON.stringify(url)} && document.title === 'Reals'`);
        await evaluate(`(async () => {
          await import('/src/styles/tokens.css');
          await import('/src/styles/global.css');
          const { default: React } = await import('/node_modules/.vite/deps/react.js');
          const { default: { createRoot } } = await import('/node_modules/.vite/deps/react-dom_client.js');
          const { FirstChat } = await import('/src/chat/FirstChat.tsx');
          const { SecondChat } = await import('/src/chat/SecondChat.tsx');
          const first = ${JSON.stringify(chat === 'first')};
          const messages = ${JSON.stringify(messages)};
          window.appendFixtureMessage = () => messages.push(${JSON.stringify(incoming)});
          window.fixturePartner = 'María';
          window.textSends = [];
          const identity = { phase: 'ready', account: { id: 'a' } };
          const controller = { snapshot: identity, getSnapshot: () => identity, subscribe: () => () => {}, request: async (path, signal, method = 'GET', body, access) => {
            const textSend = method === 'POST' && path === '/chats/c/messages';
            if (textSend) {
              textSends.push(body);
              await new Promise(resolve => { window.releaseTextSend = resolve; });
              signal.throwIfAborted();
            }
            if (!first) {
              const response = await fetch(${JSON.stringify(origin + '/mobile/a')} + path, {
                signal, method, ...(body ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
              });
              if (!response.ok) throw Error('Unexpected fixture response');
              access?.(response.headers.get('X-Reals-Counterpart-Audio-Access'));
              return response.json();
            }
            if (textSend) {
              const message = { ...messages[0], ...body, id: String(messages.length + 1), senderId: 'a',
                sentAt: new Date().toISOString(), replyTo: null };
              messages.push(message);
              return structuredClone(message);
            }
            signal.throwIfAborted();
            if (path === '/matches/m') return { id: 'm', userAId: 'a', userBId: 'b', state: 'CHAT_ACTIVE' };
            if (path === '/matches/m/chat') return {
              id: 'c', matchId: 'm', chatType: 'FIRST_CHAT', status: 'ACTIVE',
              partner: { userId: 'b', displayName: window.fixturePartner }, myDecision: 'PENDING', partnerDecision: 'PENDING',
              timeoutAt: new Date(Date.now() + 600000).toISOString(), inactivityExpiresAt: new Date(Date.now() + 300000).toISOString(),
              serverTime: new Date().toISOString(), guidance: {
                question: { id: 'q', instanceId: 'q1', text: ${JSON.stringify(question)} },
                questionOrdinal: 1, maxQuestions: 3, requiredParticipationScore: 100, directQuestionReplyMultiplier: 2,
                progressionAction: 'NEXT_QUESTION', canRequestNext: true, myNextRequested: false, completed: false,
              }, audioPolicy: { enabled: true, unavailableReason: null, maxDurationMillis: 60000, maxFileSizeBytes: 1000000, remainingMessages: 1 },
            };
            if (path.endsWith('exit-requests')) return [];
            if (path.includes('/messages?')) { access?.('ALLOWED'); return structuredClone(messages); }
            throw Error('Unexpected fixture endpoint');
          }};
          const root = createRoot(document.querySelector('#root'));
          window.unmountChatFixture = () => root.unmount();
          root.render(React.createElement('main', { className: 'chat-page' },
            React.createElement('section', { className: 'chat-shell' },
              React.createElement(first ? FirstChat : SecondChat, {
                controller, matchId: 'm', chatId: 'c', connectionId: 'connection', partnerName: 'María', onHome: () => {},
              }))));
        })()`);
        await until("document.querySelectorAll('.chat-timeline li').length === 48 && !!document.querySelector('textarea')");
        await settle();
        const normal = await inspect();
        if (check === 'send') {
          if (width >= 768) {
            await setDraft('Envío con teclado');
            await settle();
            await evaluate("document.querySelector('[aria-label=\"Enviar mensaje\"]').focus()");
            assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"), 'Enviar mensaje');
            await call('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', text: ' ', windowsVirtualKeyCode: 32 });
            await call('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 });
            await until('textSends.length === 1');
            await evaluate('releaseTextSend()');
            await until("document.querySelector('.chat-composer textarea').value === ''");
            assert.equal(await evaluate("document.activeElement === document.querySelector('.chat-composer textarea')"), false);
          } else await checkSends(chat, width, height);
          if (chat === 'first' && width < 768 && !focusBaseline) {
            const longName = 'María del Carmen Fernández de la Cruz ' + 'Larguísimo'.repeat(4);
            await evaluate(`window.fixturePartner = ${JSON.stringify(longName)};
              document.documentElement.style.fontSize = '200%'; window.dispatchEvent(new Event('online'));`);
            await until(`document.querySelector('.chat-heading h2').textContent === ${JSON.stringify(longName)}`);
            await metrics(320, height);
            await settle();
            const largeNormal = await inspect();
            await metrics(320, 400);
            await settle();
            const largeCompact = await inspect();
            assert.equal(largeNormal.menu.right, largeCompact.menu.right);
            assert.equal(largeCompact.pageScroll, 0);
            assert.ok(largeCompact.heading.right <= largeCompact.approval.left);
            assert.ok(largeCompact.approval.right <= largeCompact.menu.left);
            await tap(largeCompact.menu);
            await until("!!document.querySelector('[role=menu]')");
            const popup = await evaluate("document.querySelector('[role=menu]').getBoundingClientRect().toJSON()");
            assert.ok(popup.left >= 0 && popup.bottom <= 400 && popup.right === largeCompact.menu.right);
            await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'End', code: 'End' });
            assert.equal(await evaluate('document.activeElement.textContent'), 'Bloquear');
            await call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
            assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"), 'Opciones del chat');
            await capture(chat, width, 'large-font-header');
          }
          if (focusBaseline) console.log(JSON.stringify({ chat, normalMenuRight: normal.menu.right, compactMenuRight: (await inspect()).menu.right }));
          await evaluate('window.unmountChatFixture()');
          continue;
        }
        await capture(chat, width, 'normal');
        await evaluate("document.querySelector('.chat-composer textarea').focus()");
        await setDraft(draft);
        if (width < 768) await metrics(width, 320);
        await settle();
        const following = await inspect();
        await capture(chat, width, 'draft');
        await evaluate("document.querySelector('ol').scrollTop = 240");
        await settle();
        const reading = await inspect();
        if (width < 768) await metrics(width, 290);
        await settle();
        const resized = await inspect();
        await metrics(width, height);
        await settle();
        const restored = await inspect();
        console.log(JSON.stringify({
          chat, width, scheme, timeline: [following.list.height, resized.list.height], scrollers: [resized.rootScroll, resized.chromeScroll, resized.composerScroll],
          draftHeight: resized.input.height, viewport: resized.viewport, reading: [reading.scrollTop, resized.scrollTop, restored.scrollTop],
        }));
        if (baseline) {
          await evaluate('window.unmountChatFixture()');
          continue;
        }
        for (const layout of [following, resized, restored]) {
          assert.equal(layout.pageScroll, 0);
          assert.equal(layout.rootScroll, 0);
          assert.equal(layout.chromeScroll, 0);
          assert.equal(layout.composerScroll, 0);
          assert.ok(layout.list.height >= 60 && layout.listScroll > 0);
          assert.ok(layout.form.bottom <= layout.viewport + 1);
          assert.ok(layout.heading.top >= 0 && layout.heading.bottom <= layout.list.top);
          if (chat === 'first') {
            assert.ok(layout.guidance.top >= 0 && layout.guidance.bottom <= layout.list.top);
            assert.ok(layout.advance.top >= layout.guidance.top && layout.advance.bottom <= layout.list.top);
          }
          assert.ok(layout.send.bottom <= layout.viewport + 1 && layout.mic.bottom <= layout.viewport + 1);
          assert.equal(layout.draft, draft);
          assert.ok(layout.focused && layout.inputScroll > 0);
          if (width < 768) assert.ok(layout.input.height <= 91);
          assert.ok(layout.sameSenderGap < layout.newSenderGap);
        }
        assert.ok(Math.abs(following.listScroll - following.scrollTop) <= 1, 'Following should stay at bottom');
        assert.equal(resized.scrollTop, reading.scrollTop);
        assert.equal(restored.scrollTop, reading.scrollTop);
        if (width < 768) {
          for (const layout of [following, resized, restored]) assert.equal(layout.menu.right, normal.menu.right);
          if (chat === 'first') assert.ok(following.approval.right <= following.menu.left);
          await metrics(width, 320);
          await settle();
          const beforeIncoming = await inspect();
          if (chat === 'second') second.messages.push(incoming);
          else await evaluate('window.appendFixtureMessage()');
          await evaluate("window.dispatchEvent(new Event('online'))");
          await until("document.querySelector('.chat-new-messages')?.textContent === 'Ver mensajes nuevos'");
          const afterIncoming = await inspect();
          assert.equal(afterIncoming.scrollTop, beforeIncoming.scrollTop);
          // The second-chat fixture withdraws the inactivity action when its
          // latest sender changes. The new-message cue itself takes no space.
          if (chat === 'first') assert.equal(afterIncoming.list.height, beforeIncoming.list.height);
          else assert.ok(afterIncoming.list.height > beforeIncoming.list.height);
          assert.equal(afterIncoming.draft, draft);
          if (chat === 'first') assert.deepEqual(afterIncoming.guidance, beforeIncoming.guidance);
          await evaluate("document.querySelector('.chat-new-messages').click()");
          await until("!document.querySelector('.chat-new-messages')");
          const jumped = await inspect();
          assert.ok(Math.abs(jumped.listScroll - jumped.scrollTop) <= 1);

          if (chat === 'first') {
            const { x, y } = await evaluate(`(() => {
              const question = document.querySelector('.chat-guidance-copy').getBoundingClientRect();
              return { x: Math.floor(question.left + 18), y: Math.floor(question.top + question.height / 2) };
            })()`);
            await call('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
            await call('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + 72, y }] });
            await call('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
            await until("!!document.querySelector('.chat-reply-preview')");
            await settle();
            const replied = await inspect();
            assert.equal(replied.rootScroll, 0, JSON.stringify({ form: replied.form, list: replied.list, input: replied.input, guide: replied.guidance }));
            assert.ok(replied.focused && replied.send.bottom <= replied.viewport);
            assert.equal(replied.draft, draft);
            await evaluate("document.querySelector('[aria-label=\"Quitar respuesta\"]').click()");
          }

          await metrics(width, 185);
          await settle();
          const extreme = await inspect();
          assert.equal(extreme.pageScroll, 0);
          assert.ok(extreme.list.height >= 60 && extreme.rootScroll > 0);
          assert.equal(extreme.chromeScroll, 0);
          await evaluate("document.querySelector('.first-chat').scrollTop = 1000");
          assert.ok((await inspect()).send.bottom <= 185);
        }
        await evaluate('window.unmountChatFixture()');
      }
    }
  });
} finally {
  server.close();
}
