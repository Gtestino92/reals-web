import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import AdminGate from './AdminGate';
import { SessionController } from '../auth/session';
import { ApiClient } from '../auth/api';
import type { AuthService, Identity } from '../auth/firebase';
import { TabOwnershipManager } from '../tabs/TabOwnershipManager';
import { diag, photo } from './fixtures';

const token = 'C'.repeat(43);
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).reverse().forEach(fn => fn()); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function setup(owner?: TabOwnershipManager) {
  let observer!: (user: Identity | null) => void;
  const user: Identity = { uid: 'admin', emailVerified: true, getIdToken: async () => 'synthetic-id', reload: async () => {} };
  const auth: AuthService = { observe: vi.fn(next => { observer = next; queueMicrotask(() => next(user)); return () => {}; }), googleContext: async () => ({ provider: 'google.com', authTime: Date.now() }), reauthenticateGoogle: vi.fn().mockResolvedValue(undefined), google: async () => user, signIn: async () => user, signUp: async () => user, signOut: vi.fn().mockResolvedValue(undefined), verify: async () => {} };
  const fetcher = vi.fn<typeof fetch>(async (input, options) => {
    const path = String(input), json = (body: unknown) => new Response(JSON.stringify(body));
    if (path === '/api/me') return json({ id: 'u', status: 'ACTIVE' });
    if (path === '/api/me/profile') return json({ id: 'p', userId: 'u', status: 'DRAFT' });
    if (path === '/api/admin-auth/status') return json({ configured: true, grantValid: new Headers(options?.headers).get('X-Reals-Admin-Grant') === token });
    if (path === '/api/admin-auth/verify') return json({ grant: token, expiresAt: new Date(Date.now() + 900000).toISOString() });
    if (path === '/api/admin-auth/revoke') return new Response(null, { status: 204 });
    if (path.endsWith('/diagnostics/matchmaking')) return json(diag);
    if (path.endsWith('/profile-photos/review')) return json([photo]);
    return new Response('{"code":"NOT_FOUND"}', { status: 404 });
  });
  const session = new SessionController(auth, new ApiClient(fetcher, owner), false, owner);
  // A surviving operational session, independent of the visual gate's mount lease.
  const stop = session.subscribe(() => {}); cleanups.push(stop);
  await waitFor(() => expect(session.getSnapshot().phase).toBe('ready'));
  const view = render(<StrictMode><AdminGate key="first" controller={session} /></StrictMode>);
  cleanups.push(view.unmount);
  fireEvent.change(await screen.findByLabelText('Código de seis dígitos'), { target: { value: '012345' } });
  fireEvent.click(screen.getByRole('button', { name: 'Verificar código' }));
  await screen.findByText('Lucía');
  return { session, view, fetcher, auth, user, stop, replace: (next: Identity | null) => observer(next) };
}
it('gate remount and StrictMode effect replay retain the same session-scoped grant without a second verify', async () => {
  const h = await setup();
  const row = screen.getByText('Lucía'); h.view.rerender(<StrictMode><AdminGate key="first" controller={h.session} /></StrictMode>);
  expect(screen.getByText('Lucía')).toBe(row);
  h.view.rerender(<StrictMode><AdminGate key="second" controller={h.session} /></StrictMode>);
  await screen.findByText('Lucía');
  expect(h.session.admin.token()).toBe(token); expect(h.auth.observe).toHaveBeenCalledOnce();
  expect(h.fetcher.mock.calls.filter(([p]) => String(p).endsWith('/verify'))).toHaveLength(1);
  expect(h.fetcher.mock.calls.filter(([p]) => String(p).endsWith('/revoke'))).toHaveLength(0);
  expect(h.auth.reauthenticateGoogle).not.toHaveBeenCalled();
});
it('an ordinary same-UID Firebase observer update preserves the owner and grant', async () => {
  const h = await setup(); const row = screen.getByText('Lucía');
  act(() => h.replace({ ...h.user }));
  expect(h.session.admin.token()).toBe(token); expect(screen.getByText('Lucía')).toBe(row);
  expect(h.auth.observe).toHaveBeenCalledOnce();
});
it('a new operational session cannot recover a previous session grant even with the same Firebase identity', async () => {
  const h = await setup(); act(() => { h.view.unmount(); h.stop(); });
  expect(h.session.admin.token()).toBeUndefined();
  const replacement = new SessionController(h.auth, new ApiClient(h.fetcher), false);
  cleanups.push(replacement.subscribe(() => {}));
  await waitFor(() => expect(replacement.getSnapshot().phase).toBe('ready'));
  const view = render(<AdminGate controller={replacement} />); cleanups.push(view.unmount);
  await screen.findByLabelText('Código de seis dígitos');
  expect(replacement.admin.token()).toBeUndefined();
  expect(h.fetcher.mock.calls.filter(([p]) => String(p).endsWith('/verify'))).toHaveLength(1);
  const options = h.fetcher.mock.calls.filter(([p]) => String(p).endsWith('/status')).at(-1)?.[1];
  expect(new Headers(options?.headers).has('X-Reals-Admin-Grant')).toBe(false);
});
it('remount and status confirmation never extend the original absolute expiration', async () => {
  const h = await setup(), now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 899000);
  await act(async () => { h.view.rerender(<AdminGate key="second" controller={h.session} />); });
  expect(h.session.admin.token()).toBe(token);
  act(() => { clock.mockReturnValue(now + 900001); expect(h.session.admin.token()).toBeUndefined(); });
  expect(screen.queryByText('Lucía')).toBeNull();
});
it('expired grants cannot be restored by a delayed status success', async () => {
  const h = await setup(); let finish!: (response: Response) => void;
  h.fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let pending!: Promise<void>;
  act(() => { pending = h.session.admin.check(); });
  await waitFor(() => expect(finish).toBeDefined());
  const now = Date.now(); vi.spyOn(Date, 'now').mockReturnValue(now + 900001);
  await act(async () => { finish(new Response('{"configured":true,"grantValid":true}')); await pending; });
  expect(h.session.admin.token()).toBeUndefined(); expect(screen.queryByText('Lucía')).toBeNull();
});
it.each(['replacement', 'signout'])('identity %s clears grant and ignores a late resume response', async kind => {
  const h = await setup(); let finish!: (r: Response) => void;
  h.fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  let pending!: Promise<void>; act(() => { pending = h.session.admin.check(); });
  await waitFor(() => expect(finish).toBeDefined());
  act(() => h.replace(kind === 'signout' ? null : { ...h.user, uid: 'other' }));
  await act(async () => { finish(new Response('{"configured":true,"grantValid":true}')); await pending; });
  expect(h.session.admin.token()).toBeUndefined(); expect(screen.queryByText('Lucía')).toBeNull();
});
it('transfer of the real ownership lease retires the grant; reacquiring cannot reuse it', async () => {
  const channels: FakeChannel[] = [];
  class FakeChannel {
    onmessage: ((event: MessageEvent) => void) | null = null;
    constructor() { channels.push(this); }
    postMessage(data: unknown) { channels.filter(c => c !== this).forEach(c => queueMicrotask(() => c.onmessage?.({ data } as MessageEvent))); }
    close() { this.onmessage = null; }
  }
  let tail = Promise.resolve();
  const previous = Object.getOwnPropertyDescriptor(navigator, 'locks');
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: (_name: string, options: LockOptions, callback: () => Promise<void>) => { const result = tail.then(() => { options.signal?.throwIfAborted(); return callback(); }); tail = result.catch(() => {}); return result; } } });
  cleanups.push(() => { if (previous) Object.defineProperty(navigator, 'locks', previous); else Reflect.deleteProperty(navigator, 'locks'); });
  vi.stubGlobal('isSecureContext', true); vi.stubGlobal('BroadcastChannel', FakeChannel);
  const first = new TabOwnershipManager(), second = new TabOwnershipManager();
  cleanups.push(first.stop, second.stop); first.start();
  await waitFor(() => expect(first.getSnapshot()).toBe('active'));
  const h = await setup(first), lease = first.signal;
  act(() => { h.view.unmount(); h.session.setAdminView(false); });
  expect(h.session.admin.token()).toBe(token);
  act(() => second.start());
  await waitFor(() => expect(second.getSnapshot()).toBe('active'));
  expect(lease.aborted).toBe(true); expect(h.session.admin.token()).toBeUndefined(); expect(screen.queryByText('Lucía')).toBeNull();
  act(() => first.request()); await waitFor(() => expect(first.getSnapshot()).toBe('active'));
  expect(h.session.admin.token()).toBeUndefined(); expect(h.auth.reauthenticateGoogle).not.toHaveBeenCalled();
});
it('normal mode retains the grant but blocks privileged calls and rejects results from an earlier admin visit', async () => {
  const h = await setup(); let finish!: (r: Response) => void;
  h.fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const old = h.session.request('/admin/diagnostics/matchmaking', new AbortController().signal);
  const obsolete = expect(old).rejects.toMatchObject({ name: 'AbortError' });
  await waitFor(() => expect(finish).toBeDefined());
  act(() => { h.view.unmount(); h.session.setAdminView(false); });
  expect(h.session.admin.token()).toBe(token);
  await expect(h.session.request('/admin/diagnostics/matchmaking', new AbortController().signal)).rejects.toMatchObject({ code: 'ADMIN_MFA_REQUIRED' });
  h.session.setAdminView(true); await act(async () => { await h.session.admin.check(); });
  finish(new Response(JSON.stringify(diag))); await obsolete;
  expect(h.session.admin.token()).toBe(token);
});
