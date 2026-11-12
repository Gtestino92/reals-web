import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OperationalApp } from '../App';
import { ApiClient } from '../auth/api';
import type { AuthService, Identity } from '../auth/firebase';
import { confirmSignOut } from '../test/signOut';
import { diag, photo } from './fixtures';
const grant = 'B'.repeat(43);
function setup(provider = 'google.com') {
  history.replaceState(null, '', '/admin');
  let observer!: (user: Identity | null) => void;
  const user: Identity = { uid: 'admin', emailVerified: true, reload: async () => {}, getIdToken: async () => 'synthetic-id' };
  const events: string[] = [];
  let issued = false;
  const fetcher = vi.fn<typeof fetch>(async (input, options) => {
    const path = String(input); events.push(path);
    const headers = new Headers(options?.headers);
    expect(headers.get('X-Firebase-AppCheck')).toBe('synthetic-app-check');
    if (path.startsWith('/api/admin/')) expect(headers.get('X-Reals-Admin-Grant')).toBe(grant);
    const json = (data: unknown) => new Response(JSON.stringify(data));
    if (path === '/api/me') return json({ id: 'u', status: 'ACTIVE' });
    if (path === '/api/me/profile') return json({ id: 'p', userId: 'u', status: 'DRAFT' });
    if (path === '/api/admin-auth/status') return json({ configured: true, grantValid: issued && headers.get('X-Reals-Admin-Grant') === grant });
    if (path === '/api/admin-auth/verify') { expect(JSON.parse(String(options?.body))).toEqual({ code: '012345' }); issued = true; return json({ grant, expiresAt: new Date(Date.now()+900000).toISOString() }); }
    if (path === '/api/admin-auth/revoke') { expect(headers.get('X-Reals-Admin-Grant')).toBe(grant); issued = false; return new Response(null, { status: 204 }); }
    if (path.endsWith('/diagnostics/matchmaking')) return json(diag);
    if (path.endsWith('/profile-photos/review')) return json([photo]);
    return new Response('{"code":"NOT_FOUND"}', { status: 404 });
  });
  const auth: AuthService = { observe: next => { observer = next; queueMicrotask(() => next(user)); return () => {}; }, googleContext: async () => ({ provider, authTime: Date.now() }), reauthenticateGoogle: vi.fn().mockResolvedValue(undefined), signOut: vi.fn(async () => { events.push('firebase-signout'); observer(null); }), google: async () => user, signIn: async () => user, signUp: async () => user, verify: async () => {} };
  const view = render(<OperationalApp firebase={{ service: auth, localVerification: false }} api={new ApiClient(fetcher).withAppCheck(async () => 'synthetic-app-check')} />);
  return { fetcher, events, auth, view };
}
async function submit() { fireEvent.change(await screen.findByLabelText('Código de seis dígitos'), { target: { value: '012345' } }); }
afterEach(() => { history.replaceState(null, '', '/'); vi.restoreAllMocks(); vi.useRealTimers(); });
it('does not issue privileged requests before MFA; preserves numeric input/zeros and forwards verified headers', async () => {
  const h = setup(); const input = await screen.findByLabelText('Código de seis dígitos'); expect(input).toHaveAttribute('inputmode', 'numeric'); expect(input).toHaveAttribute('type', 'text');
  expect(h.events.some(path => path.startsWith('/api/admin/'))).toBe(false);
  await submit(); await screen.findByText('Lucía');
  const administrative = h.events.filter(path => path.startsWith('/api/admin'));
  expect(administrative.slice(-4)).toEqual(['/api/admin-auth/verify','/api/admin-auth/status','/api/admin/diagnostics/matchmaking','/api/admin/profile-photos/review']);
});
it.each([false, true])('attempts revocation before Firebase logout, discarding access even when revoke fails: %s', async failure => {
  const h = setup(); await submit(); await screen.findByText('Lucía');
  let finish!: (response: Response) => void;
  h.fetcher.mockImplementationOnce(async input => { h.events.push(String(input)); return new Promise(resolve => { finish = resolve; }); });
  confirmSignOut(); await waitFor(() => expect(h.events.at(-1)).toBe('/api/admin-auth/revoke'));
  expect(h.auth.signOut).not.toHaveBeenCalled(); expect(screen.queryByText('Lucía')).toBeNull();
  await act(async () => finish(new Response(failure ? '{"code":"ADMIN_AUTHENTICATION_UNAVAILABLE"}' : null, { status: failure ? 503 : 204 })));
  await screen.findByRole('button', { name: 'Ingresar' }); expect(h.auth.signOut).toHaveBeenCalledOnce();
  expect(h.events.slice(-2)).toEqual(['/api/admin-auth/revoke', 'firebase-signout']);
  if (failure) expect(screen.getByRole('alert')).toHaveTextContent('No se pudo confirmar la revocación');
});
it.each(['ADMIN_GRANT_REVOKED','ADMIN_GRANT_EXPIRED','ADMIN_MFA_REQUIRED'])('clears all privileged data and returns to TOTP after %s', async code => {
  const h = setup(); await submit(); await screen.findByText('Lucía');
  h.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ code }), { status: 403 })); act(() => document.dispatchEvent(new Event('visibilitychange')));
  await screen.findByLabelText('Código de seis dígitos'); expect(screen.queryByText('Lucía')).toBeNull(); expect(screen.queryByRole('heading', { name: 'Reals Admin' })).toBeNull();
});
it('keeps the same backoffice mounted across a minute in an unrelated tab and revalidates without new MFA', async () => {
  const h = setup(); await submit(); await screen.findByText('Luc\u00eda'); const panel = screen.getByRole('main');
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  vi.useFakeTimers();
  act(() => { window.dispatchEvent(new Event('blur')); document.dispatchEvent(new Event('visibilitychange')); vi.advanceTimersByTime(60000); });
  expect(panel).toBeInTheDocument(); expect(h.events).not.toContain('/api/admin-auth/revoke');
  vi.useRealTimers();
  visibility.mockReturnValue('visible');
  let finish!: (r: Response) => void;
  h.fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  act(() => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); });
  await waitFor(() => expect(finish).toBeDefined());
  expect(screen.getByRole('main')).toBe(panel);
  await act(async () => finish(new Response(JSON.stringify([photo]))));
  expect(screen.getByRole('main')).toBe(panel);
  expect(h.events.filter(p => p === '/api/admin-auth/verify')).toHaveLength(1);
  expect(h.events.filter(p => p === '/api/me')).toHaveLength(1);
  expect(h.auth.reauthenticateGoogle).not.toHaveBeenCalled(); expect(h.auth.signOut).not.toHaveBeenCalled();
});
it.each([false, true])('real pagehide retires access, pageshow persisted=%s requires new MFA', async persisted => {
  const h = setup(); await submit(); await screen.findByText('Luc\u00eda');
  act(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted })));
  expect(screen.queryByText('Luc\u00eda')).toBeNull();
  await waitFor(() => expect(h.events).toContain('/api/admin-auth/revoke'));
  act(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted })));
  await screen.findByLabelText('C\u00f3digo de seis d\u00edgitos');
  expect(h.auth.reauthenticateGoogle).not.toHaveBeenCalled(); expect(h.auth.signOut).not.toHaveBeenCalled();
});
it('browser Back switches to Reals without revoking retained authorization', async () => {
  const h = setup(); await submit(); await screen.findByText('Luc\u00eda');
  act(() => { history.replaceState(null, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); });
  await waitFor(() => expect(screen.queryByRole('heading', { name: 'Reals Admin' })).toBeNull());
  expect(h.events).not.toContain('/api/admin-auth/revoke');
});
it('late verification cannot reopen administration after cancel/return', async () => {
  const h = setup(); await screen.findByLabelText('Código de seis dígitos'); let finish!: (r: Response) => void;
  h.fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })); await submit();
  await waitFor(() => expect(finish).toBeDefined()); fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  await act(async () => finish(new Response(JSON.stringify({ grant, expiresAt: new Date(Date.now()+900000).toISOString() }))));
  expect(location.pathname).toBe('/'); expect(screen.queryByRole('heading', { name: 'Reals Admin' })).toBeNull(); expect(h.events.some(path => path.startsWith('/api/admin/'))).toBe(false);
});
it('password session offers safe switch guidance and return to ordinary Reals', async () => {
  const h = setup('password'); await screen.findByText(/Esta sesión no usa Google/);
  expect(h.events.some(path => path.includes('/admin'))).toBe(false);
  expect(screen.queryByLabelText('Código de seis dígitos')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' })); await waitFor(() => expect(location.pathname).toBe('/')); expect(h.auth.signOut).not.toHaveBeenCalled();
});
