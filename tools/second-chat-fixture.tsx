import React, { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Home } from '../src/home/Home';
import { SessionController } from '../src/auth/session';
import { ApiClient, ApiError } from '../src/auth/api';
import '../src/styles/tokens.css';
import '../src/styles/global.css';
const params = new URLSearchParams(location.search), me = params.get('user') ?? 'a', backend = params.get('backend') ?? '';
const controller = new SessionController({ observe: () => () => {}, signIn: async () => { throw Error(); }, signUp: async () => { throw Error(); }, google: async () => { throw Error(); }, verify: async () => {}, signOut: async () => {} }, new ApiClient(), false);
controller.snapshot = { ...controller.snapshot, phase: 'ready', account: { id: me, status: 'ACTIVE' }, profile: { id: 'profile', userId: me, status: 'ACTIVE' } };
const listeners = new Set<() => void>();
controller.subscribe = fn => { listeners.add(fn); return () => { listeners.delete(fn); }; };
controller.request = async (path, signal, method = 'GET', body) => {
  const form = body instanceof FormData;
  const response = await fetch(`${backend}/${me}${path}`, { signal, method, ...(form ? {} : { headers: { 'Content-Type': 'application/json' } }), ...(body ? { body: form ? body : JSON.stringify(body) } : {}) });
  if (!response.ok) throw new ApiError('backend', response.status);
  return response.json();
};
Object.assign(window, { fixture: {
  invalidate: () => { controller.snapshot = { ...controller.snapshot, phase: 'signingOut', account: null, authContextVersion: 10 }; listeners.forEach(fn => fn()); },
  replace: () => { controller.snapshot = { ...controller.snapshot, account: { id: 'replacement', status: 'ACTIVE' }, authContextVersion: 11 }; listeners.forEach(fn => fn()); },
} });
function Fixture() {
  const identity = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return identity.phase === 'ready' ? <Home key={`${identity.account?.id}/${identity.authContextVersion}`} controller={controller}/> : <p>Sesión finalizada</p>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture/></React.StrictMode>);
