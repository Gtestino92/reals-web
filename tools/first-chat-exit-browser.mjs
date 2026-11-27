import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
const { chromium, webkit } = createRequire(process.env.CONTACT_PLAYWRIGHT_ANCHOR || import.meta.url)('playwright');
const before = process.argv.includes('--before');
const output = 'docs/evidence/first-chat-exit';
await mkdir(output, { recursive: true });
for (const [engine, launcher] of Object.entries({ chromium, webkit })) {
  const browser = await launcher.launch(engine === 'chromium' ? { channel: 'chrome' } : {});
  try {
    for (const requester of [true, false]) {
      const page = await browser.newPage({ viewport: requester ? {width:390,height:844} : {width:1280,height:900}, colorScheme: requester ? 'light' : 'dark' });
      await page.route('**/src/main.tsx*', route => route.fulfill({contentType:'text/javascript',body:''}));
      await page.goto('http://127.0.0.1:5187');
      await page.evaluate(async ({ requester, before }) => {
        const { default: React } = await import('/node_modules/.vite/deps/react.js');
        const { default: {createRoot} } = await import('/node_modules/.vite/deps/react-dom_client.js');
        const { FirstChat } = await import('/src/chat/FirstChat.tsx');
        await import('/src/styles/tokens.css');
        await import('/src/styles/global.css');
        const root = createRoot(document.querySelector('#root'));
        let closed = false;
        const timeoutAt = new Date(Date.now()+55000).toISOString();
        const request = {id:'ee3a4831-5103-4d2b-a0a7-1a8dd0a64aa8',chatId:'c',requesterUserId:requester?'me':'them',responderUserId:requester?'them':'me',type:'MUTUAL_CANCEL',status:'PENDING',createdAt:new Date().toISOString()};
        let pending = before || !requester;
        const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
        const snapshot = { phase:'ready',account:{id:'me'} };
        const controller = {snapshot,getSnapshot:()=>snapshot,request:async(path,signal,method='GET',body,access)=>{
          if (path==='/matches/m') return {id:'m',userAId:'me',userBId:'them',state:closed?'CHAT_REJECTED':'CHAT_ACTIVE'};
          if (path==='/matches/m/chat') return {id:'c',matchId:'m',chatType:'FIRST_CHAT',status:'ACTIVE',partner:{userId:'them',displayName:'María'},myDecision:'PENDING',partnerDecision:'PENDING',timeoutAt,serverTime:new Date().toISOString()};
          if (path.includes('/messages?')) {access?.('ALLOWED'); if (requester && pending && !before) await delay(900); return [{id:'1',chatSessionId:'c',senderId:'them',messageType:'TEXT',content:'¡Hola! ¿Cómo estás?',sentAt:new Date().toISOString()}];}
          if (path.endsWith('/exit-requests')) {
            if (method==='POST') { await delay(500); request.createdAt=new Date().toISOString(); pending=true; return request; }
            return pending?[request]:[];
          }
          if (/\/(acceptance|timeout)$/.test(path)) { await delay(500); closed=true; return {chat:{id:'c',matchId:'m',chatType:'FIRST_CHAT',status:'CANCELLED'},exitRequest:{...request,status:path.endsWith('/timeout')?'TIMED_OUT':'ACCEPTED'}}; }
          throw Error('Unexpected fixture request');
        }};
        root.render(React.createElement(FirstChat,{controller,matchId:'m',chatId:'c',onHome:()=>root.render(React.createElement('h1',null,'Inicio'))}));
      },{requester,before});
      if (!before && requester) {
        await page.getByRole('button',{name:'Opciones del chat'}).click();
        await page.getByRole('menuitem',{name:'Salida consensuada'}).click();
        await page.getByRole('button',{name:'Confirmar'}).click();
        await page.getByText('Solicitando salida…').waitFor();
      }
      await page.getByRole('heading',{name:before?'Salida consensuada pendiente':'Conversación pausada'}).waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:output+'/'+(before?'before':'after')+'-'+engine+'-'+(requester?'mobile-light':'desktop-dark')+'.png'});
      if (!before) {
        assert.equal(await page.getByRole('textbox',{name:'Mensaje'}).count(),0);
        if (!requester) { await page.getByRole('button',{name:'Aceptar salida'}).click(); await page.getByText('Aceptando…').waitFor(); }
        await page.getByRole('heading',{name:'Inicio'}).waitFor({timeout:30000});
      }
      await page.close();
    }
    if (!before) await checkHomeReturn(browser);
  } finally { await browser.close(); }
}

async function checkHomeReturn(browser) {
  const page = await browser.newPage({viewport:{width:390,height:844}});
  let absolute, matchReads = 0;
  await page.route('**/synthetic/**', async route => {
    const path = new URL(route.request().url()).pathname.slice('/synthetic'.length);
    const now = new Date().toISOString();
    const profile = {id:'p',userId:'me',status:'ACTIVE',displayName:'Fixture',birthDate:'1995-01-01',gender:'MALE',lookingForGenders:['FEMALE'],intention:'DATE',city:'Fixture',countryCode:'AR',bio:'Bio',preferredMinAge:18,preferredMaxAge:45,maxDistanceKm:50,authenticityVerificationStatus:'STALE'};
    if (path === '/matches/m/chat') absolute ??= new Date(Date.now()+4500).toISOString();
    if (path === '/matches/m') matchReads++;
    const data = {
      '/me':{id:'me',status:'ACTIVE'}, '/me/profile':profile,
      '/me/legal-status':{requirementsSatisfied:true,documents:[]}, '/legal/documents/current':{documents:[]},
      '/me/home/status':{version:1,dirty:false,nextRefreshAt:null,serverTime:now},
      '/me/home':{profileStatus:'ACTIVE',matchmaking:{inQueue:false,canSearch:false,blockedReason:null},activeInteractionsSummary:{activeInitialCount:1,activeConnectionCount:0,actionableConnectionCount:0,hasPendingSchedulingConnection:false},pendingActions:[{type:'FIRST_CHAT',matchId:'m',chatId:'c'}],nextSteps:[],passiveNotices:[]},
      '/matchmaking/queue':{userId:'me',inQueue:false},
      '/matches/m':{id:'m',userAId:'me',userBId:'them',state:'CHAT_ACTIVE'},
      '/matches/m/chat':{id:'c',matchId:'m',chatType:'FIRST_CHAT',status:'ACTIVE',partner:{userId:'them',displayName:'María'},myDecision:'PENDING',partnerDecision:'PENDING',timeoutAt:absolute,serverTime:now},
      '/chats/c/exit-requests':[], '/chats/c/messages':[],
    };
    const value = data[path];
    await route.fulfill({status:value?200:404,json:value??{},headers:{'X-Reals-Counterpart-Audio-Access':'ALLOWED'}});
  });
  await page.goto('http://127.0.0.1:5187/tools/tab-ownership-fixture.html?kind=login&manual=1&backend=/synthetic');
  await page.getByText('Continuar con Google').click();
  await page.getByRole('textbox',{name:'Mensaje'}).fill('Borrador');
  await page.getByText('El plazo del chat terminó.').waitFor();
  assert.equal(await page.getByRole('region',{name:'Primer chat'}).count(),0);
  const reads = matchReads;
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await page.getByText('El plazo del chat terminó.').waitFor();
  assert.equal(matchReads,reads);
  await page.close();
}
