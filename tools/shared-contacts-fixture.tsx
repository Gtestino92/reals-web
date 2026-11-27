import { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiClient, object } from '../src/auth/api';
import { SessionController } from '../src/auth/session';
import { Home } from '../src/home/Home';
import { FirstChat } from '../src/chat/FirstChat';
import { emptyHome, homeStatus } from '../src/home/fixtures';
import { preparePicker, providers } from '../src/contacts/providers';
import '../src/styles/tokens.css';
import '../src/styles/global.css';
import '../src/auth/login.css';

const options = new URLSearchParams(location.search);
const rows = [
  { name: 'Alicia Ejemplo', number: '+12025550100' },
  { name: 'Alicia Ejemplo', number: '+12025550101' },
  { name: 'Bruno Ejemplo', number: '011 15-2345-6789' },
  { name: 'Otro alias', number: '+5491123456789' },
];
delete providers.google;
delete providers.picker;
if (options.has('additions')) {
  Object.defineProperty(navigator, 'contacts', { configurable: true, value: {
    getProperties: async () => ['name', 'tel'],
    select: () => {
      if (!navigator.userActivation.isActive) throw new Error('Synthetic picker requires user activation');
      return Promise.resolve(rows.map(row => ({ name: [row.name], tel: [row.number] })));
    },
  } });
  providers.picker = preparePicker;
} else if (options.has('recovery')) {
  let attempts = 0;
  Object.defineProperty(navigator, 'contacts', { configurable: true, value: {
    getProperties: async () => ['name', 'tel'],
    select: async () => {
      if (++attempts <= 2) throw new TypeError('Unable to open a contact selector');
      return [{ name: ['Ejemplo'], tel: ['+12025550100'] }];
    },
  } });
  providers.picker = preparePicker;
} else if (options.has('transitions')) providers.picker = preparePicker;
else if (options.has('google')) providers.google = async () => async () => rows;
else if (!options.has('unsupported')) providers.picker = async () => async () => rows;
let status = { mutationRevision: crypto.randomUUID(), requiredConsentVersion: 1, acceptedConsentVersion: null as number | null,
  acceptedAt: null as string | null, syncedAt: null as string | null, state: 'NOT_CONFIGURED', importAvailable: true };
let synchronized = new Set<string>();
function ownerStatus() {
  return { ...status, totalDistinctCount: status.state === 'RESYNC_REQUIRED' ? null : synchronized.size };
}
let range: string | null = 'ONE_TO_FIVE';
Object.assign(window, { contactsFixture: {
  requireReplacement() { status.state = 'RESYNC_REQUIRED'; },
  invalidate() { status.mutationRevision = crypto.randomUUID(); },
  endSession() { notifyIdentity(null); },
  restartSession() { notifyIdentity(identity); },
  setRange(next: string | null) { range = next; window.dispatchEvent(new Event('online')); },
} });
const api = new ApiClient(async (url, init) => {
  const path = new URL(String(url), location.origin).pathname.replace(/^\/api/, '');
  const method = init?.method ?? 'GET';
  const json = Response.json;
  if (path === '/me') return json({ id: 'me', status: 'ACTIVE' });
  if (path === '/me/home') return json(emptyHome());
  if (path === '/me/home/status') return json(homeStatus());
  if (path === '/me/profile') return json({ id: 'p', userId: 'me', status: 'ACTIVE', displayName: 'Ejemplo', countryCode: 'AR' });
  if (path === '/reference/affinity-questions') return json({ catalogVersion: 'synthetic', categories: [], questions: [] });
  if (path === '/me/profile/affinity-answers') return json({ answers: [] });
  if (path === '/matches/m') return json({ id: 'm', userAId: 'me', userBId: 'them', state: 'CHAT_ACTIVE' });
  if (path === '/matches/m/chat') return json({ id: 'c', matchId: 'm', chatType: 'FIRST_CHAT', status: 'ACTIVE', partner: { userId: 'them', displayName: options.has('long') ? 'Alicia del Valle Ejemplo Ficticio' : 'Alicia Ejemplo' },
    myDecision: 'PENDING', partnerDecision: 'PENDING', timeoutAt: new Date(Date.now()+600000), serverTime: new Date(), sharedContactRange: range,
    guidance: { question: { id: 'q', instanceId: 'q1', text: '¿Qué te gusta hacer en tu tiempo libre?' }, questionOrdinal: 1, maxQuestions: 3,
      requiredParticipationScore: 100, directQuestionReplyMultiplier: 2, progressionAction: 'NEXT_QUESTION', canRequestNext: false, myNextRequested: false, completed: false } });
  if (path === '/chats/c/messages' || path === '/chats/c/exit-requests') return json(path.endsWith('/messages') ? [{
    id: 'msg1', chatSessionId: 'c', senderId: 'them', sentAt: new Date().toISOString(), messageType: 'TEXT', content: '¡Hola! A mí me gusta caminar.',
  }] : [], { headers: { 'X-Reals-Counterpart-Audio-Access': 'ALLOWED' } });
  if (options.has('recovery') && path.startsWith('/me/shared-contacts')) await new Promise(resolve => setTimeout(resolve, 800));
  if (path === '/me/shared-contacts') return json(ownerStatus());
  if (!path.startsWith('/me/shared-contacts/')) throw Error('Unexpected synthetic route');
  if (method === 'PUT' && new Headers(init?.headers).get('X-Contact-Revision') !== status.mutationRevision)
    return json({ code: 'CONTACT_MUTATION_STALE' }, { status: 409 });
  if (method === 'DELETE') {
    synchronized.clear();
    status.mutationRevision = crypto.randomUUID();
    if (path.endsWith('/consent')) Object.assign(status, { acceptedConsentVersion: null, acceptedAt: null });
    Object.assign(status, { syncedAt: null, state: 'NOT_CONFIGURED' });
    return new Response(null, { status: 204 });
  }
  if (path.endsWith('/consent')) { Object.assign(status, { mutationRevision: crypto.randomUUID(), acceptedConsentVersion: 1, acceptedAt: new Date().toISOString() }); return json(ownerStatus()); }
  const body: unknown = JSON.parse(String(init?.body));
  if (!object(body) || !Array.isArray(body.numbers) || Object.keys(body).some(k => !['numbers', 'defaultRegion'].includes(k))) throw Error('Unexpected synthetic selection');
  const numbers = new Set<string>();
  for (const number of body.numbers) {
    if (typeof number !== 'string') throw Error('Unexpected synthetic number');
    numbers.add(number);
  }
  const submittedCount = body.numbers.length;
  if (path.endsWith('/selection/additions')) {
    if (status.state !== 'SYNCED') return json({ code: 'CONTACT_FULL_REPLACEMENT_REQUIRED' }, { status: 409 });
    const before = synchronized.size;
    for (const number of numbers) synchronized.add(number);
    const addedDistinctCount = synchronized.size - before;
    if (addedDistinctCount) Object.assign(status, { mutationRevision: crypto.randomUUID(), syncedAt: new Date().toISOString() });
    return json({ status: ownerStatus(), submittedCount, addedDistinctCount, totalDistinctCount: synchronized.size });
  }
  if (!path.endsWith('/selection')) throw Error('Unexpected synthetic operation');
  synchronized = numbers;
  Object.assign(status, { mutationRevision: crypto.randomUUID(), syncedAt: new Date().toISOString(), state: 'SYNCED' });
  return json({ status: ownerStatus(), submittedCount, distinctCount: synchronized.size });
});
const identity = { uid: 'synthetic', emailVerified: true, getIdToken: async () => 'synthetic', reload: async () => {} };
let notifyIdentity: (user: typeof identity | null) => void;
const controller = new SessionController({ observe: next => { notifyIdentity = next; next(identity); return () => {}; }, signIn: async () => identity, signUp: async () => identity, google: async () => identity, verify: async () => {}, signOut: async () => {} }, api, false);
const chat = options.has('chat');
function Fixture() {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  if (state.phase !== 'ready') return <p>Preparando sesión sintética…</p>;
  return <main className={chat ? 'chat-page' : 'login-page'}><section className={chat ? 'chat-shell' : 'login-panel'}>
  {chat ? <FirstChat controller={controller} chatId="c" matchId="m" onHome={() => {}}/> : <Home controller={controller}/>}
</section></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
