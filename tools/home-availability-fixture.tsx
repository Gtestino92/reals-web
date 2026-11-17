// Synthetic identities and API only. Never connect this harness to a real account.
import { createRoot } from 'react-dom/client';
import { Home } from '../src/home/Home';
import { ApiClient } from '../src/auth/api';
import { SessionController } from '../src/auth/session';
import { emptyHome } from '../src/home/fixtures';
import '../src/styles/tokens.css';
import '../src/styles/global.css';
import '../src/auth/login.css';

const availableAt = Date.now() + 10000;
let now = availableAt - 10000, marker: string | null = new Date(availableAt).toISOString();
const requests: { path: string; time: number; due: boolean; pending?: number }[] = [];
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
const api = new ApiClient(async path => {
  const p = String(path).replace(/^\/api/, '');
  const diagnostic = { path: p, time: performance.now(), due: marker !== null && now >= availableAt };
  requests.push(diagnostic);
  if (p === '/me/home/status') return json({ version: 1, dirty: false, nextRefreshAt: marker, serverTime: new Date(now).toISOString() });
  if (p === '/me/profile') return json({ id: 'p', userId: 'me', status: 'ACTIVE', displayName: 'Synthetic' });
  if (p === '/me/home') {
    const home = emptyHome();
    home.nextSteps = [{ type: 'SCHEDULING', connectionId: 'existing', matchId: 'existing', requiresAction: false }];
    home.activeInteractionsSummary.activeConnectionCount = 1;
    if (now >= availableAt) { home.pendingActions = [{ type: 'VISUAL_REVIEW', matchId: 'synthetic', visualStartedAt: new Date(availableAt).toISOString(), visualExpiresAt: new Date(availableAt + 3600000).toISOString() }]; marker = null; }
    home.activeInteractionsSummary.activeInitialCount = home.pendingActions.length;
    Object.assign(diagnostic, { pending: home.pendingActions.length });
    return json(home);
  }
  if (p === '/reference/affinity-questions') return json({ catalogVersion: 'synthetic', categories: [], questions: [] });
  if (p === '/me/profile/affinity-answers') return json({ answers: [] });
  throw Error('Unexpected synthetic endpoint');
});
const identity = { uid: 'synthetic', emailVerified: true, getIdToken: async () => 'synthetic', reload: async () => {} };
const controller = new SessionController({ observe: () => () => {}, signIn: async () => identity, signUp: async () => identity, google: async () => identity, verify: async () => {}, signOut: async () => {} }, api, false);
// This controller uses no Firebase observer, token, persistence or real API.
controller.snapshot = { ...controller.snapshot, phase: 'ready', account: { id: 'me', status: 'ACTIVE' }, profile: { id: 'p', userId: 'me', status: 'ACTIVE' } };
// ApiClient requests need a synthetic auth context; use the same parsing path with
// a fixture-only token supplier rather than establishing a production session.
controller.request = (path, signal, method = 'GET', body) => api.request(path, signal, identity, method, body);
Object.assign(window, { homeAvailability: { requests, advance: () => { now = availableAt + 1; } } });
createRoot(document.getElementById('root')!).render(<Home controller={controller}/>);
