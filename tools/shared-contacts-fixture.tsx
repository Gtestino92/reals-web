import { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiClient, object } from '../src/auth/api';
import { SessionController } from '../src/auth/session';
import { Home } from '../src/home/Home';
import { FirstChat } from '../src/chat/FirstChat';
import { emptyHome, homeStatus } from '../src/home/fixtures';
import { providers } from '../src/contacts/providers';
import '../src/styles/tokens.css';
import '../src/styles/global.css';
import '../src/auth/login.css';

const options = new URLSearchParams(location.search);
const rows = [
  { name: 'Alicia Ejemplo', number: '+12025550100' },
  { name: 'Alicia Ejemplo', number: '+12025550101' },
  { name: 'Bruno Ejemplo', number: '2025550102' },
];
delete providers.google;
delete providers.picker;
if (options.has('google')) providers.google = async () => async () => rows;
else if (!options.has('unsupported')) providers.picker = async () => async () => rows;
let status = { mutationRevision: crypto.randomUUID(), requiredConsentVersion: 1, acceptedConsentVersion: null as number | null,
  acceptedAt: null as string | null, syncedAt: null as string | null, state: 'NOT_CONFIGURED', importAvailable: true };
let range: string | null = 'ONE_TO_FIVE';
Object.assign(window, { contactsFixture: {
  invalidate() { status.mutationRevision = crypto.randomUUID(); },
  setRange(next: string | null) { range = next; window.dispatchEvent(new Event('online')); },
} });
const api = new ApiClient(async (url, init) => {
  const path = new URL(String(url), location.origin).pathname.replace(/^\/api/, '');
  const method = init?.method ?? 'GET';
  const json = Response.json;
  if (path === '/me') return json({ id: 'me', status: 'ACTIVE' });
  if (path === '/me/home') return json(emptyHome());
  if (path === '/me/home/status') return json(homeStatus());
  if (path === '/me/profile') return json({ id: 'p', userId: 'me', status: 'ACTIVE', displayName: 'Ejemplo' });
  if (path === '/reference/affinity-questions') return json({ catalogVersion: 'synthetic', categories: [], questions: [] });
  if (path === '/me/profile/affinity-answers') return json({ answers: [] });
  if (path === '/matches/m') return json({ id: 'm', userAId: 'me', userBId: 'them', state: 'CHAT_ACTIVE' });
  if (path === '/matches/m/chat') return json({ id: 'c', matchId: 'm', chatType: 'FIRST_CHAT', status: 'ACTIVE', partner: { userId: 'them', displayName: 'Alicia Ejemplo' },
    myDecision: 'PENDING', partnerDecision: 'PENDING', timeoutAt: new Date(Date.now()+600000), serverTime: new Date(), sharedContactRange: range,
    guidance: { question: { id: 'q', instanceId: 'q1', text: '¿Qué te gusta hacer en tu tiempo libre?' }, questionOrdinal: 1, maxQuestions: 3,
      requiredParticipationScore: 100, directQuestionReplyMultiplier: 2, progressionAction: 'NEXT_QUESTION', canRequestNext: false, myNextRequested: false, completed: false } });
  if (path === '/chats/c/messages' || path === '/chats/c/exit-requests') return json(path.endsWith('/messages') ? [{
    id: 'msg1', chatSessionId: 'c', senderId: 'them', sentAt: new Date().toISOString(), messageType: 'TEXT', content: '¡Hola! A mí me gusta caminar.',
  }] : [], { headers: { 'X-Reals-Counterpart-Audio-Access': 'ALLOWED' } });
  if (path === '/me/shared-contacts') return json(status);
  if (!path.startsWith('/me/shared-contacts/')) throw Error('Unexpected synthetic route');
  if (method === 'PUT' && new Headers(init?.headers).get('X-Contact-Revision') !== status.mutationRevision)
    return json({ code: 'CONTACT_MUTATION_STALE' }, { status: 409 });
  status.mutationRevision = crypto.randomUUID();
  if (method === 'DELETE') {
    if (path.endsWith('/consent')) Object.assign(status, { acceptedConsentVersion: null, acceptedAt: null });
    Object.assign(status, { syncedAt: null, state: 'NOT_CONFIGURED' });
    return new Response(null, { status: 204 });
  }
  if (path.endsWith('/consent')) { Object.assign(status, { acceptedConsentVersion: 1, acceptedAt: new Date().toISOString() }); return json(status); }
  const body: unknown = JSON.parse(String(init?.body));
  if (!object(body) || !Array.isArray(body.numbers) || Object.keys(body).some(k => !['numbers', 'defaultRegion'].includes(k))) throw Error('Unexpected synthetic selection');
  Object.assign(status, { syncedAt: new Date().toISOString(), state: 'SYNCED' });
  return json({ status, submittedCount: body.numbers.length, distinctCount: new Set(body.numbers).size });
});
const identity = { uid: 'synthetic', emailVerified: true, getIdToken: async () => 'synthetic', reload: async () => {} };
const controller = new SessionController({ observe: next => { next(identity); return () => {}; }, signIn: async () => identity, signUp: async () => identity, google: async () => identity, verify: async () => {}, signOut: async () => {} }, api, false);
const chat = options.has('chat');
function Fixture() {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  if (state.phase !== 'ready') return <p>Preparando sesión sintética…</p>;
  return <main className={chat ? 'chat-page' : 'login-page'}><section className={chat ? 'chat-shell' : 'login-panel'}>
  {chat ? <FirstChat controller={controller} chatId="c" matchId="m" onHome={() => {}}/> : <Home controller={controller}/>}
</section></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
