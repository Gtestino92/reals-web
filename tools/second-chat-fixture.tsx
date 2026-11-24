import { TabGate } from '../src/tabs/TabGate';
import type { TabOwnershipManager } from '../src/tabs/TabOwnershipManager';
﻿import React, { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { Home } from '../src/home/Home';
import { SessionController } from '../src/auth/session';
import { ApiClient, ApiError, historyAudioAccess } from '../src/auth/api';
import '../src/styles/tokens.css';
import '../src/styles/global.css';
const params = new URLSearchParams(location.search), me = params.get('user') ?? 'a', backend = params.get('backend') ?? '';
// Persist only synthetic authentication coordinates, never conversation data.
sessionStorage.setItem('second-fixture-session',location.href);
let ownership: TabOwnershipManager | undefined;
const controller = new SessionController({ observe: () => () => {}, signIn: async () => { throw Error(); }, signUp: async () => { throw Error(); }, google: async () => { throw Error(); }, verify: async () => {}, signOut: async () => {} }, new ApiClient(), false);
controller.snapshot = { ...controller.snapshot, phase: 'ready', account: { id: me, status: 'ACTIVE' }, profile: { id: 'profile', userId: me, status: 'ACTIVE' } };
const listeners = new Set<() => void>();
controller.subscribe = fn => { listeners.add(fn); return () => { listeners.delete(fn); }; };
controller.request = async (path, signal, method = 'GET', body, access) => {
  const owner=ownership;owner?.assert();if(owner)signal=AbortSignal.any([signal,owner.signal]);
  const form = body instanceof FormData;
  const response = await fetch(`${backend}/${controller.snapshot.account?.id ?? me}${path}`, { signal, method, ...(form ? {} : { headers: { 'Content-Type': 'application/json' } }), ...(body ? { body: form ? body : JSON.stringify(body) } : {}) });
  if (!response.ok) { const error:unknown=await response.json();throw new ApiError('backend',response.status,typeof error==='object'&&error!==null&&'code' in error&&typeof error.code==='string'?error.code:''); }
  access?.(historyAudioAccess(response.headers));
  return response.json();
};
Object.assign(window, { fixture: {
  documentId: crypto.randomUUID(),
  setTime: (time: number) => { Date.now = () => time; document.dispatchEvent(new Event('visibilitychange')); },
  notifyAuth: () => { controller.snapshot = { ...controller.snapshot, authContextVersion: (controller.snapshot.authContextVersion ?? 0) + 1 }; listeners.forEach(fn => fn()); },
  invalidate: () => { controller.snapshot = { ...controller.snapshot, phase: 'signingOut', account: null, authContextVersion: 10 }; listeners.forEach(fn => fn()); },
  replace: () => { const next=new URL(sessionStorage.getItem('second-fixture-session')!);next.searchParams.set('user','replacement');sessionStorage.setItem('second-fixture-session',next.href);controller.snapshot = { ...controller.snapshot, account: { id: 'replacement', status: 'ACTIVE' }, authContextVersion: 11 }; listeners.forEach(fn => fn()); },
} });
function Fixture() {
  const identity = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  return identity.phase === 'ready' ? <Home key={`${identity.account?.id}/${identity.authContextVersion}`} controller={controller}/> : <p>Sesión finalizada</p>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode>{params.get('ownership')==='1'?<TabGate>{manager=>{ownership=manager;return <Fixture/>;}}</TabGate>:<Fixture/>}</React.StrictMode>);
