// Synthetic identities only. Exercises the real session, legal and onboarding UI.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { OperationalApp } from '../src/App';
import { ApiClient } from '../src/auth/api';
import { defaults } from '../src/onboarding/contracts';
import { emptyHome, homeStatus } from '../src/home/fixtures';
import '../src/styles/tokens.css';
import '../src/styles/global.css';
let observer;
let current = null, profile = null, satisfied = false, hold = false, photos = [];
const writes = [], releases = [];
const identity = { uid: 'synthetic', emailVerified: true, getIdToken: async () => 'synthetic-only', reload: async () => {} };
const initial = { ...defaults, displayName: 'Prueba', birthDate: '1995-01-01', city: 'Córdoba', countryCode: 'AR', id: 'p', userId: 'u', status: 'DRAFT', authenticityVerificationStatus: 'STALE' };
const doc = () => ({ type: 'PRIVACY_NOTICE', version: 'v1', requiredAction: 'ACKNOWLEDGED', satisfied, url: `${location.origin}/tools/ux-audit-fixture.html?document=privacy` });
const auth = { observe: next => { observer = next; next(current); return () => { observer = null; }; }, signIn: async () => { current = identity; observer?.(current); return current; }, signUp: async () => { current = identity; observer?.(current); return current; }, google: async () => { current = identity; observer?.(current); return current; }, verify: async () => {}, signOut: async () => { current = null; observer?.(null); } };
const fetcher = async (input, options) => {
  const path = String(input).replace('/api', ''), method = options?.method ?? 'GET';
  if (method !== 'GET') { writes.push({ path, method }); if (hold) await new Promise(resolve => releases.push(resolve)); }
  options?.signal?.throwIfAborted();
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  if (path === '/me') return json({ id: 'u', status: 'ACTIVE' });
  if (path === '/reference/countries') return json([{ code: 'AR', displayName: 'Argentina' }]);
  if (path === '/me/legal-status') return json({ requirementsSatisfied: satisfied, documents: [doc()] });
  if (path === '/legal/documents/current') return json({ documents: [doc()] });
  if (path === '/me/legal-document-actions') { satisfied = true; return json({}); }
  if (path === '/me/profile' && method !== 'GET') { profile = { ...initial, ...profile, ...JSON.parse(options.body) }; return json(profile, method === 'POST' ? 201 : 200); }
  if (path === '/me/profile') return profile ? json(profile) : json({ code: 'PROFILE_NOT_FOUND' }, 404);
  if (path === '/me/profile/photos') {
    if (method === 'POST') photos.push({ id: 'photo', position: 1, url: `${location.origin}/src/assets/reals-seal.png`, validationStatus: 'PENDING', moderationStatus: 'PENDING', isPersonPhoto: false, isFullBody: false });
    return json(photos, method === 'POST' ? 201 : 200);
  }
  if (path === '/me/profile/activation') { profile = { ...profile, status: 'ACTIVE' }; return json(profile); }
  if (path === '/me/home/status') return json(homeStatus());
  if (path === '/me/home') return json({ ...emptyHome(), profileStatus: profile?.status ?? null });
  if (path === '/matchmaking/queue') return json({ userId: 'u', inQueue: false });
  if (path === '/reference/affinity-questions') return json({ version: 1, questions: [] });
  throw Error('Unexpected synthetic endpoint');
};
const root = createRoot(document.getElementById('root'));
window.auditFixture = { writes, hold: value => { hold = value; }, release: () => { hold = false; releases.splice(0).forEach(resolve => resolve()); } };
root.render(<React.StrictMode><OperationalApp firebase={{ service: auth, localVerification: false }} api={new ApiClient(fetcher)} /></React.StrictMode>);
