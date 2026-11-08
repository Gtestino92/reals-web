// Synthetic timing fixture. Baseline modules are generated/removed by the runner.
import React, { useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { ApiClient } from '../src/auth/api';
import { SessionController } from '../src/auth/session';
import { useHome } from '../src/home/useHome';
import { SearchingScreen } from '../src/home/SearchingScreen';
import '../src/styles/tokens.css';
import '../src/styles/global.css';
import '../src/home/home.css';
const params = new URLSearchParams(location.search), origin = params.get('backend')!;
const trace: { kind: string; start: number; end: number }[] = [];
const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
const mark = async <T,>(kind: string, task: () => Promise<T>): Promise<T> => { const start = performance.now(); try { return await task(); } finally { trace.push({ kind, start, end: performance.now() }); } };
Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: (ok: PositionCallback, fail: PositionErrorCallback, options: PositionOptions) => {
  void mark(options.enableHighAccuracy ? 'geo-high' : 'geo-coarse', async () => {
    if (options.enableHighAccuracy) { await sleep(options.timeout ?? 5000); fail({ code: 3, message: '', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }); }
    else { await sleep(300); ok({ coords: { latitude: 12, longitude: -21, accuracy: 3500, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}) }, timestamp: Date.now(), toJSON: () => ({}) }); }
  });
} } });
const identity = { uid: 'synthetic', emailVerified: true, reload: async () => {}, getIdToken: () => mark('token', async () => { await sleep(40); return 'synthetic'; }) };
const controller = new SessionController({ observe: next => { next(identity); return () => {}; }, signIn: async () => identity, signUp: async () => identity, google: async () => identity, verify: async () => {}, signOut: async () => {} }, new ApiClient((path, options) => mark(`${options?.method} ${String(path)}`, () => fetch(origin + String(path).slice(4), options))), false);
// Keep normal Vite dependency scanning independent of generated baseline files.
const baselinePath = '/tools/latency-before-home.ts';
const useModel: typeof useHome = params.has('before') ? (await import(/* @vite-ignore */ baselinePath)).useHome : useHome;
Object.assign(window, { trace, startAt: 0 });
function Probe() {
  const model = useModel(controller);
  return <><button id="search" disabled={model.busy || model.blocked} onClick={() => { trace.length = 0; Object.assign(window, { startAt: performance.now(), clickedAt: Date.now() }); model.search(); }}>Buscar chat</button>
    <SearchingScreen phase={model.searchPhase} busy={model.busy} blocked={model.blocked} error={model.error} inQueue={!!model.model?.home.matchmaking.inQueue} onCancel={model.cancel} onRefresh={model.refresh} onBack={model.backFromSearch} canRetryLocation={model.canRetryLocation} onRetryLocation={model.retryLocation} /></>;
}
function Root() { const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot); return state.phase === 'ready' ? <Probe /> : <p>Loading fixture</p>; }
createRoot(document.getElementById('root')!).render(<Root />);
