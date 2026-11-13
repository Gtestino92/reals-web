import { VisualReview } from '../visual/VisualReview';
import { visualProfile } from '../visual/fixtures';
import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TabOwnershipManager } from './TabOwnershipManager';
import { TabGate } from './TabGate';
import { ApiClient } from '../auth/api';
import { SessionController } from '../auth/session';
import type { AuthService, Identity } from '../auth/firebase';

let channels: FakeChannel[], managers: TabOwnershipManager[];
class FakeChannel {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  constructor() { channels.push(this); }
  postMessage(data: unknown) { for (const peer of channels) if (peer !== this) queueMicrotask(() => peer.onmessage?.({ data } as MessageEvent)); }
  close() { channels = channels.filter(c => c !== this); this.onmessage = null; }
}
function locks() {
  let tail = Promise.resolve();
  return { request: vi.fn((_name: string, options: LockOptions, callback: () => Promise<void>) => {
    const result = tail.then(() => { options.signal?.throwIfAborted(); return callback(); });
    tail = result.catch(() => {}); return result;
  }) };
}
const flush = async () => { for (let i = 0; i < 60; i++) await Promise.resolve(); };
const create = () => { const m = new TabOwnershipManager(); managers.push(m); m.start(); return m; };
beforeEach(() => { channels = []; managers = []; vi.stubGlobal('isSecureContext', true); vi.stubGlobal('BroadcastChannel', FakeChannel); Object.defineProperty(navigator, 'locks', { configurable: true, value: locks() }); });
afterEach(() => { managers.forEach(m => m.stop()); vi.unstubAllGlobals(); vi.useRealTimers(); });
it('first owner, automatic takeover, explicit return; focus alone never steals', async () => {
  const a = create(); await flush(); expect(a.getSnapshot()).toBe('active');
  const old = a.signal; const b = create(); await flush();
  expect(old.aborted).toBe(true); expect(a.getSnapshot()).toBe('blocked'); expect(b.getSnapshot()).toBe('active');
  window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); await flush(); expect(b.getSnapshot()).toBe('active');
  a.request(); a.request(); await flush(); expect(a.getSnapshot()).toBe('active'); expect(b.getSnapshot()).toBe('blocked');
});
it('simultaneous startup and competing requests stay exclusive; close and reload recover', async () => {
  const tabs = [create(), create(), create()]; await flush();
  expect(tabs.filter(t => t.getSnapshot() === 'active')).toHaveLength(1);
  tabs.forEach(t => t.request()); await flush(); expect(tabs.filter(t => t.getSnapshot() === 'active')).toHaveLength(1);
  tabs.find(t => t.getSnapshot() === 'active')!.stop();
  const reloaded = create(); await flush(); expect(reloaded.getSnapshot()).toBe('active');
});
it('ignores obsolete grant messages and releases on pagehide; blocked BFCache restore does not steal', async () => {
  const a = create(); await flush(); const b = create(); await flush();
  channels[0]!.postMessage({ type: 'release', grant: 'obsolete' }); await flush(); expect(b.getSnapshot()).toBe('active');
  window.dispatchEvent(new Event('pagehide')); await flush(); expect(a.getSnapshot()).toBe('blocked'); expect(b.getSnapshot()).toBe('blocked');
  window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); await flush(); expect(a.getSnapshot()).toBe('blocked'); expect(b.getSnapshot()).toBe('active');
});
it('StrictMode cleans listeners, channels and locks', async () => {
  const manager = new TabOwnershipManager(); managers.push(manager);
  const view = render(<StrictMode><TabGate manager={manager}>{() => <p>Operational</p>}</TabGate></StrictMode>);
  await act(flush); expect(screen.getByText('Operational')).toBeVisible(); expect(channels).toHaveLength(1);
  view.unmount(); await flush(); expect(channels).toHaveLength(0);
  const next = create(); await flush(); expect(next.getSnapshot()).toBe('active');
});
it('pending feedback, keyboard button semantics, timeout and actionable retry', async () => {
  vi.useFakeTimers(); Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: () => new Promise(() => {}) } });
  const m = new TabOwnershipManager(); managers.push(m);
  render(<TabGate manager={m}>{() => <p>Operational</p>}</TabGate>);
  expect(screen.getByRole('status')).toHaveTextContent('Esperando'); expect(screen.getByRole('button')).toBeDisabled();
  act(() => vi.advanceTimersByTime(8000)); expect(screen.getByRole('alert')).toHaveTextContent('volvé a intentar');
  fireEvent.click(screen.getByRole('button', { name: 'Usar Reals acá' })); expect(screen.getByRole('button')).toBeDisabled();
});
it.each(['insecure', 'locks', 'channel'])('fails closed for unsupported %s', kind => {
  if (kind === 'insecure') vi.stubGlobal('isSecureContext', false);
  if (kind === 'channel') vi.stubGlobal('BroadcastChannel', undefined);
  if (kind === 'locks') Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  const m = create(); expect(m.getSnapshot()).toBe('unsupported'); expect(m.assert).toThrow();
});
it('channel/lock errors fail closed', async () => {
  vi.stubGlobal('BroadcastChannel', class { constructor() { throw Error(); } }); expect(create().getSnapshot()).toBe('error');
  vi.stubGlobal('BroadcastChannel', FakeChannel); Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: () => Promise.reject(Error()) } });
  const m = create(); await flush(); expect(m.getSnapshot()).toBe('error');
});
it.each(['GET', 'POST'])('aborts pending %s and rejects stale body; inactive API calls cannot start', async method => {
  const m = create(); await flush(); let resolve!: (v: unknown) => void;
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue({ ok: true, status: 200, json: () => new Promise(done => { resolve = done; }) } as Response);
  const api = new ApiClient(fetcher).withOwnership(m);
  const pending = api.request('/test', new AbortController().signal, undefined, method).catch(e => e);
  await flush(); const b = create(); await flush(); expect(b.getSnapshot()).toBe('active');
  resolve({ stale: true }); expect(await pending).toHaveProperty('name', 'AbortError');
  await expect(api.request('/test', new AbortController().signal, undefined, 'POST')).rejects.toHaveProperty('name', 'AbortError'); expect(fetcher).toHaveBeenCalledOnce();
});
it.each(['authentication', 'bootstrap'])('revokes session during %s without signout or domain cancellation', async phase => {
  const m = create(); await flush(); let observer!: (u: Identity | null) => void, finish!: (u: Identity) => void;
  const user: Identity = { uid: 'own-identity', emailVerified: true, reload: vi.fn(), getIdToken: vi.fn().mockResolvedValue('synthetic') };
  const auth: AuthService = { observe: next => { observer = next; return vi.fn(); }, signIn: vi.fn(() => new Promise<Identity>(done => { finish = done; })), signUp: vi.fn(), google: vi.fn(), verify: vi.fn(), signOut: vi.fn() };
  let complete!: (v: Response) => void;
  const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise(done => { complete = done; }));
  const controller = new SessionController(auth, new ApiClient(fetcher).withOwnership(m), false, m);
  const unsubscribe = controller.subscribe(() => {}); observer(phase === 'authentication' ? null : user);
  if (phase === 'authentication') controller.authenticate('signIn', 'test@example.test', 'synthetic');
  await flush(); const b = create(); await flush(); expect(b.getSnapshot()).toBe('active');
  if (phase === 'authentication') finish(user); else complete(new Response(JSON.stringify({ id: 'me', status: 'ACTIVE' })));
  await flush(); controller.authenticate('google'); controller.reset('test@example.test'); controller.signOut(); controller.retry();
  await expect(controller.request('/matchmaking/queue', new AbortController().signal, 'DELETE')).rejects.toHaveProperty('name', 'AbortError');
  expect(controller.snapshot.phase).toBe('checking'); expect(auth.signOut).not.toHaveBeenCalled(); expect(auth.google).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.every(([path]) => path === '/api/me')).toBe(true); unsubscribe();
});

it.each(['GET', 'POST'])('revokes a ready session during pending %s without followups or identity reset', async method => {
  const m = create(); await flush();
  const user: Identity = { uid: 'local-identity', emailVerified: true, reload: vi.fn(), getIdToken: vi.fn().mockResolvedValue('synthetic') };
  const auth: AuthService = { observe: next => { next(user); return vi.fn(); }, signIn: vi.fn(), signUp: vi.fn(), google: vi.fn(), verify: vi.fn(), signOut: vi.fn() };
  let complete!: (response: Response) => void;
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'me', status: 'ACTIVE' })))
    .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'profile', userId: 'me', status: 'ACTIVE' })))
    .mockImplementation(() => new Promise(done => { complete = done; }));
  const session = new SessionController(auth, new ApiClient(fetcher).withOwnership(m), false, m);
  const unsubscribe = session.subscribe(() => {}); await flush(); expect(session.snapshot.phase).toBe('ready');
  const result = session.request('/test', new AbortController().signal, method).catch(e => e); await flush();
  const signal = fetcher.mock.calls[2]![1]!.signal!;
  create(); await flush(); expect(signal.aborted).toBe(true);
  complete(new Response(JSON.stringify({ stale: true }))); expect(await result).toHaveProperty('name', 'AbortError');
  session.installProfile({ id: 'stale', userId: 'me', status: 'ACTIVE' }); expect(session.snapshot.profile).toBeNull();
  expect(auth.signOut).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(3);
  m.request(); await flush(); session.signOut(); session.reset('fixture@example.test'); await flush();
  expect(auth.signOut).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(3); unsubscribe();
});

it('synchronous lock and channel failures can be retried without a false owner', async () => {
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: () => { throw Error('Unavailable'); } } });
  const m = create(); expect(m.getSnapshot()).toBe('error');
  Object.defineProperty(navigator, 'locks', { configurable: true, value: locks() });
  vi.stubGlobal('BroadcastChannel', class extends FakeChannel { postMessage() { throw Error('Unavailable'); } });
  m.request(); await flush(); expect(m.getSnapshot()).toBe('error');
  vi.stubGlobal('BroadcastChannel', FakeChannel); m.request(); await flush(); expect(m.getSnapshot()).toBe('active');
});

it('Visual Review private DOM is destroyed on ownership transfer and reloaded on regain',async()=>{
 const controller=new SessionController({observe:()=>()=>{},signIn:async()=>{throw Error('unused');},signUp:async()=>{throw Error('unused');},google:async()=>{throw Error('unused');},verify:async()=>{},signOut:async()=>{}},new ApiClient(),false);
 controller.snapshot={...controller.snapshot,phase:'ready',account:{id:'me',status:'ACTIVE'},profile:{id:'p',userId:'me',status:'ACTIVE'}};
 vi.spyOn(controller,'subscribe').mockImplementation(()=>()=>{});
 const request=vi.spyOn(controller,'request').mockImplementation(async path=>path.endsWith('/visual-profile')?visualProfile():{id:'m',userAId:'me',userBId:'them',state:'VISUAL_PHASE'});
 const a=new TabOwnershipManager();managers.push(a);render(<TabGate manager={a}>{()=> <VisualReview controller={controller} matchId="m" onBack={()=>{}}/>}</TabGate>);await act(flush);const image=screen.getAllByRole('img')[0]!;
 const b=create();await act(flush);expect(a.getSnapshot()).toBe('blocked');expect(image).not.toBeInTheDocument();expect(screen.queryByRole('img')).toBeNull();
 act(()=>a.request());await act(flush);expect(b.getSnapshot()).toBe('blocked');expect(screen.getAllByRole('img')[0]).not.toBe(image);expect(request.mock.calls.filter(c=>c[0].endsWith('/visual-profile'))).toHaveLength(2);
});
