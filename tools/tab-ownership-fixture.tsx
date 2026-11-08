// Synthetic browser fixture; no Firebase credentials or live backend calls.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../src/App';
import { ApiClient } from '../src/auth/api';
import { TabOwnershipManager } from '../src/tabs/TabOwnershipManager';
import '../src/styles/tokens.css';
import '../src/styles/global.css';
const params = new URLSearchParams(location.search);
const origin = params.get('backend')!;
const manager = new TabOwnershipManager();
const requestLog: string[] = [];
const api = new ApiClient(async (path, options) => {
  requestLog.push(`${options?.method ?? 'GET'} ${String(path)}`);
  const response = await fetch(origin + String(path).slice(4), options);
  if (params.get('kind') === 'onboarding' && path === '/api/me/profile') {
    const profile: unknown = await response.json();
    if (typeof profile === 'object' && profile) return new Response(JSON.stringify({ ...profile, status: 'DRAFT' }));
  }
  return response;
});
Object.assign(window, { ownership: manager, fixtureApi: params.get('ownership') === 'auto' ? api : api.withOwnership(manager), signouts: 0, requestLog });
let signoutCount = 0;
const observers = new Set<(identity: null) => void>();
if (params.has('geo')) Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok: PositionCallback) => setTimeout(() => ok({ coords: { latitude: 12, longitude: -21, accuracy: 25, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}) }, timestamp: Date.now(), toJSON: () => ({}) }), 300) } });
const root = document.getElementById('root')!;
createRoot(root).render(<React.StrictMode><App {...(params.get('ownership') === 'auto' ? {} : { ownership: manager })} api={api} firebase={{ localVerification: false, service: {
  observe: next => { observers.add(next); next(params.get('kind') === 'login' ? null : { uid: params.get('uid') ?? 'fixture', emailVerified: true, getIdToken: async () => 'synthetic', reload: async () => {} }); return () => { observers.delete(next); }; },
  signIn: async () => { throw Error('Fixture'); }, signUp: async () => { throw Error('Fixture'); }, google: async () => { throw Error('Fixture'); }, verify: async () => {}, signOut: async () => { if (!params.has('signout')) throw Error('Unexpected fixture signout'); Object.assign(window, { signouts: ++signoutCount }); observers.forEach(next => next(null)); },
} }} /></React.StrictMode>);
