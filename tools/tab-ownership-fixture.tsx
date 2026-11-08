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
}).withOwnership(manager);
Object.assign(window, { ownership: manager, fixtureApi: api, signouts: 0, requestLog });
const root = document.getElementById('root')!;
createRoot(root).render(<React.StrictMode><App ownership={manager} api={api} firebase={{ localVerification: false, service: {
  observe: next => { next(params.get('kind') === 'login' ? null : { uid: params.get('uid') ?? 'fixture', emailVerified: true, getIdToken: async () => 'synthetic', reload: async () => {} }); return () => {}; },
  signIn: async () => { throw Error('Fixture'); }, signUp: async () => { throw Error('Fixture'); }, google: async () => { throw Error('Fixture'); }, verify: async () => {}, signOut: async () => { throw Error('Unexpected fixture signout'); },
} }} /></React.StrictMode>);
