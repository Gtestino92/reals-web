import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fixtureServer, scenario } from './second-chat-synthetic.mjs';

const { chromium, webkit } = createRequire(process.env.CONTACT_PLAYWRIGHT_ANCHOR || import.meta.url)('playwright');
const base = process.env.CHAT_TIMING_URL || 'http://127.0.0.1:5187';
const bodyDelay = Number(process.env.CHAT_HISTORY_BODY_MS || 0);
const { server, scenarios, origin } = await fixtureServer();
try {
  for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
    const browser = await launcher.launch(engine === 'chromium' ? {channel:'chrome'} : {});
    try {
      for (const first of [true, false]) {
        scenarios.set('timing', scenario());
        const page = await browser.newPage();
        await page.route('**/src/main.tsx*', route => route.fulfill({contentType:'text/javascript',body:''}));
        await page.goto(base);
        await page.evaluate(async ({first, origin, bodyDelay}) => {
          const {default:React} = await import('/node_modules/.vite/deps/react.js');
          const {default:{createRoot}} = await import('/node_modules/.vite/deps/react-dom_client.js');
          const Component = first ? (await import('/src/chat/FirstChat.tsx')).FirstChat : (await import('/src/chat/SecondChat.tsx')).SecondChat;
          const identity = {phase:'ready',account:{id:'a'}};
          const rows = [];
          window.calls = [];
          const controller = {snapshot:identity,getSnapshot:()=>identity,subscribe:()=>()=>{},request:async(path,signal,method='GET',body,access)=>{
            const call = {path,method,start:performance.now()};
            calls.push(call);
            await new Promise(resolve=>setTimeout(resolve,520));
            signal.throwIfAborted();
            let value;
            if (!first) {
              const response = await fetch(origin+'/timing/a'+path,{method,signal,...(body ? {body:JSON.stringify(body),headers:{'Content-Type':'application/json'}} : {})});
              if (!response.ok) throw Error('Fixture request failed');
              value = await response.json();
            } else if (method==='POST') {
              value = {...body,id:String(rows.length+1),senderId:'a',chatSessionId:'c',sentAt:new Date().toISOString(),messageType:'TEXT'};
              rows.push(value);
            } else if (path==='/matches/m') value={id:'m',userAId:'a',userBId:'b',state:'CHAT_ACTIVE'};
            else if (path==='/matches/m/chat') value={id:'c',matchId:'m',chatType:'FIRST_CHAT',status:'ACTIVE',partner:{userId:'b',displayName:'Fixture'},myDecision:'PENDING',partnerDecision:'PENDING',timeoutAt:new Date(Date.now()+600000).toISOString(),serverTime:new Date().toISOString()};
            else if (path.includes('/messages?')) value=rows;
            else if (path.endsWith('/exit-requests')) value=[];
            else throw Error('Unknown fixture request');
            access?.('ALLOWED');
            if (access && bodyDelay) await new Promise(resolve=>setTimeout(resolve,bodyDelay));
            signal.throwIfAborted();
            call.end=performance.now();
            return structuredClone(value);
          }};
          createRoot(document.querySelector('#root')).render(React.createElement(Component,{controller,matchId:'m',chatId:'c',connectionId:'connection',onHome:()=>{}}));
        },{first,origin,bodyDelay});
        const draft=page.getByRole('textbox',{name:'Mensaje'});
        await draft.fill('sample 0');
        for (let i=0;i<4;i++) {
          const sample=await page.evaluate(async i=>{
            const send=document.querySelector('[aria-label="Enviar mensaje"]');
            const draft=document.querySelector('textarea');
            const start=performance.now(), offset=calls.length;
            if(send.disabled) throw Error('Send disabled');
            send.click();
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(draft,'sample '+(i+1));
            draft.dispatchEvent(new Event('input',{bubbles:true}));
            let bubble;
            while(performance.now()-start<10000) {
              const now=performance.now();
              if(document.querySelectorAll('.chat-message-row.outgoing').length===i+1 && !document.querySelector('.chat-timeline [role=status]')) bubble??=now;
              if(bubble && !send.disabled && draft.value==='sample '+(i+1)) {
                const reads=calls.slice(offset), post=reads.find(c=>c.method==='POST');
                return {reconciled: reads.every(c=>c.end) ? Math.round(Math.max(...reads.map(c=>c.end))-post.end) : null,post:Math.round(post.end-start),bubble:Math.round(bubble-post.end),release:Math.round(now-post.end),total:Math.round(now-start),reads:reads.map(c=>c.method+' '+c.path)};
              }
              await new Promise(requestAnimationFrame);
            }
            throw Error('Send timeout '+document.body.innerText);
          },i);
          assert.equal(sample.reads.filter(p=>p.startsWith('POST')).length,1);
          console.log(JSON.stringify({engine,first,i,...sample}));
        }
        const idleOffset = await page.evaluate(()=>calls.length);
        await page.waitForTimeout(6000);
        console.log(JSON.stringify({engine,first,idleWindowMs:6000,backgroundReads:await page.evaluate(offset=>calls.slice(offset).map(c=>c.path),idleOffset)}));
        await page.close();
      }
    } finally {await browser.close();}
  }
} finally {server.close();}
