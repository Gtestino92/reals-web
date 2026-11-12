import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OperationalApp } from '../App';
import { ApiClient } from '../auth/api';
import type { AuthService, Identity } from '../auth/firebase';
import { emptyHome, homeStatus } from '../home/fixtures';
import { defaults } from '../onboarding/contracts';
import { confirmSignOut } from '../test/signOut';
import { diag, photo } from './fixtures';

const grant = 'M'.repeat(43);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function setup(provider = 'google.com', login = false, draft = false) {
  history.replaceState(null, '', login ? '/admin' : '/');
  let observer!: (identity: Identity | null) => void;
  const user: Identity = { uid: 'same-uid', emailVerified: true, reload: async () => {}, getIdToken: async () => 'synthetic-id', providerData: ['google.com', 'password'].map(providerId => ({ providerId, uid: 'same-uid', email: null, displayName: null, photoURL: null, phoneNumber: null })) };
  const state = { issued: false, authTime: Date.now(), uid: user.uid };
  const events: string[] = [];
  const status = vi.fn<(_options?: RequestInit) => Promise<Response>>(async options => json({ configured: true, grantValid: state.issued && new Headers(options?.headers).get('X-Reals-Admin-Grant') === grant }));
  const profile = { ...defaults, id: 'p', userId: 'u', status: draft ? 'DRAFT' : 'ACTIVE', displayName: 'Operador', city: 'Ciudad', countryCode: 'AR', birthDate: '1990-01-01', authenticityVerificationStatus: 'STALE' };
  const fetcher = vi.fn<typeof fetch>(async (input, options) => {
    const path = String(input); events.push(path);
    if (path.startsWith('/api/admin/')) expect(new Headers(options?.headers).get('X-Reals-Admin-Grant')).toBe(grant);
    switch (path) {
      case '/api/me': return json({ id: 'u', status: 'ACTIVE' });
      case '/api/me/profile': return json(profile);
      case '/api/me/home': return json(emptyHome());
      case '/api/me/home/status': return json(homeStatus());
      case '/api/matchmaking/queue': return json({ userId: 'u', inQueue: false });
      case '/api/reference/affinity-questions': return json({ catalogVersion: 'empty', categories: [], questions: [] });
      case '/api/me/profile/affinity-answers': return json({ answers: [] });
      case '/api/me/legal-status': return json({ requirementsSatisfied: true, documents: [] });
      case '/api/legal/documents/current': return json({ documents: [] });
      case '/api/reference/countries': return json([{ code: 'AR', displayName: 'Argentina' }]);
      case '/api/me/profile/photos': return json([]);
      case '/api/admin-auth/status': return status(options);
      case '/api/admin-auth/verify': state.issued = true; return json({ grant, expiresAt: new Date(Date.now() + 900000).toISOString() });
      case '/api/admin-auth/revoke': state.issued = false; return new Response(null, { status: 204 });
      case '/api/admin/diagnostics/matchmaking': return json(diag);
      case '/api/admin/profile-photos/review': return json([{ ...photo, displayName: 'Dato privado admin' }]);
      case '/api/me/notification-preferences': return json({ activityEnabled: true, remindersEnabled: false, availabilityEnabled: true });
      default: return json({ code: 'NOT_FOUND' }, 404);
    }
  });
  const auth: AuthService = {
    observe: vi.fn(next => { observer = next; queueMicrotask(() => next(login ? null : user)); return () => {}; }),
    googleContext: vi.fn(async () => ({ provider, authTime: state.authTime })),
    reauthenticateGoogle: vi.fn(async () => { state.authTime = Date.now(); }),
    signIn: vi.fn(async () => user), signUp: vi.fn(async () => user), google: vi.fn(async () => user), verify: async () => {},
    signOut: vi.fn(async () => { events.push('firebase-signout'); observer(null); }),
  };
  const app = <OperationalApp firebase={{ service: auth, localVerification: false }} api={new ApiClient(fetcher)} />;
  const view = render(<StrictMode>{app}</StrictMode>);
  return { view, status, events, fetcher, auth, state, replace: (uid: string) => { state.uid = uid; observer({ ...user, uid }); }, app };
}
async function account(draft = false) { fireEvent.click(await screen.findByRole('button', { name: 'Cuenta' })); if (!draft) await screen.findByRole('heading', { name: 'Cuenta' }); }
async function enter() { const entry = await screen.findByRole('button', { name: 'Admin' }); await waitFor(() => expect(entry).toBeEnabled()); entry.focus(); fireEvent.click(entry); }
async function verify() { fireEvent.change(await screen.findByLabelText('Código de seis dígitos'), { target: { value: '012345' } }); await screen.findByText('Dato privado admin'); }
async function back() { fireEvent.click(screen.getByRole('button', { name: 'Volver a Reals' })); await screen.findByRole('button', { name: 'Admin' }); }
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); history.replaceState(null, '', '/'); });

it.each(['google.com', 'password'])('the same UID with actual provider %s gets eligibility from token context, never linked providers', async provider => {
  const h = setup(provider); await screen.findByRole('heading', { name: 'Inicio' }); await act(async () => {});
  await waitFor(() => expect(h.auth.googleContext).toHaveBeenCalled());
  if (provider === 'google.com') { await screen.findByRole('button', { name: 'Admin' }); expect(h.status).toHaveBeenCalledOnce(); }
  else { expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull(); expect(h.status).not.toHaveBeenCalled(); }
  expect(h.events.some(path => path.startsWith('/api/admin/'))).toBe(false);
});
it.each([403, 503, 'malformed', 'unconfigured'])('hides the entry entirely for failed/ineligible status %s', async failure => {
  const h = setup(); h.status.mockImplementation(async () => failure === 'malformed' ? json({ configured: true }) : failure === 'unconfigured' ? json({ configured: false, grantValid: false }) : json({ code: failure === 403 ? 'ADMIN_ACCESS_DENIED' : 'ADMIN_AUTHENTICATION_UNAVAILABLE' }, typeof failure === 'number' ? failure : 503));
  await screen.findByRole('heading', { name: 'Inicio' }); await waitFor(() => expect(h.status).toHaveBeenCalled()); await act(async () => {});
  expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull(); expect(location.pathname).toBe('/');
});
it('explicit Google login from an admin URL always enters ordinary Reals', async () => {
  const h = setup('google.com', true); fireEvent.click(await screen.findByRole('button', { name: 'Continuar con Google' }));
  await screen.findByRole('heading', { name: 'Inicio' }); expect(location.pathname).toBe('/');
  expect(h.events.some(path => path.startsWith('/api/admin/'))).toBe(false); await screen.findByRole('button', { name: 'Admin' });
});
it.each(['suspended', 'deleted'])('never checks admin eligibility for a %s ordinary session', async kind => {
  const h = setup();
  h.fetcher.mockResolvedValueOnce(kind === 'suspended' ? json({ code: 'ACCOUNT_TEMPORARILY_BANNED' }, 403) : json({ id: 'u', status: 'DELETED', deletedAt: '2026-11-01T00:00:00Z', deletionFinalizesAt: '2026-12-01T00:00:00Z' }));
  await screen.findByRole('heading', { name: kind === 'suspended' ? 'Cuenta suspendida temporalmente' : 'Cuenta pendiente de eliminación' });
  expect(h.status).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull();
});
it('switches modes, removes private data and revalidates before reusing the original grant without new TOTP', async () => {
  const h = setup(); await screen.findByRole('heading', { name: 'Inicio' }); await enter(); await verify(); await back();
  expect(screen.queryByText('Dato privado admin')).toBeNull(); expect(h.events).not.toContain('/api/admin-auth/revoke');
  let finish!: (r: Response) => void; h.status.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await enter(); await waitFor(() => expect(finish).toBeDefined()); expect(screen.queryByText('Dato privado admin')).toBeNull();
  await act(async () => finish(json({ configured: true, grantValid: true }))); await screen.findByText('Dato privado admin');
  expect(h.events.filter(p => p.endsWith('/verify'))).toHaveLength(1); expect(h.auth.reauthenticateGoogle).not.toHaveBeenCalled();
  expect(JSON.stringify(history.state)).not.toContain(grant);
});
it('Back/Forward traverses modes and reconstructs privileged data only after a fresh status check', async () => {
  const h = setup(); await screen.findByRole('heading', { name: 'Inicio' }); await enter(); await verify();
  act(() => history.back()); await screen.findByRole('button', { name: 'Admin' }); expect(location.pathname).toBe('/'); expect(screen.queryByText('Dato privado admin')).toBeNull();
  act(() => history.forward()); await screen.findByText('Dato privado admin'); expect(location.pathname).toBe('/admin');
  expect(h.events.filter(p => p.endsWith('/verify'))).toHaveLength(1); expect(h.events).not.toContain('/api/admin-auth/revoke');
});
it('expiry runs while normal Reals is visible; returning requires new authentication without opening a popup automatically', async () => {
  const h = setup(); await screen.findByRole('heading', { name: 'Inicio' }); await enter(); const input = await screen.findByLabelText('Código de seis dígitos');
  vi.useFakeTimers();
  await act(async () => { fireEvent.change(input, { target: { value: '012345' } }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(screen.getByText('Dato privado admin')).toBeVisible();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Volver a Reals' })); await vi.advanceTimersByTimeAsync(10); });
  expect(screen.queryByText('Dato privado admin')).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(900000); });
  fireEvent.click(screen.getByRole('button', { name: 'Admin' })); await act(async () => {});
  expect(screen.queryByText('Dato privado admin')).toBeNull(); expect(h.auth.reauthenticateGoogle).not.toHaveBeenCalled();
  expect(h.events.filter(p => p.endsWith('/verify'))).toHaveLength(1);
  expect(screen.getByText('Confirmá recientemente tu identidad con Google para continuar.')).toBeVisible();
});
it('explicit revocation is separate from returning to Reals and leaves Firebase signed in', async () => {
  const h = setup(); await screen.findByRole('heading', { name: 'Inicio' }); await enter(); await verify(); fireEvent.click(screen.getByRole('button', { name: 'Cerrar acceso administrativo' }));
  await screen.findByLabelText('Código de seis dígitos'); expect(h.events.filter(p => p.endsWith('/revoke'))).toHaveLength(1); expect(h.auth.signOut).not.toHaveBeenCalled();
});
it('logout from ordinary mode revokes the retained grant before Firebase logout', async () => {
  const h = setup(); await screen.findByRole('heading', { name: 'Inicio' }); await enter(); await verify(); await back(); await account(); confirmSignOut();
  await screen.findByRole('button', { name: 'Ingresar' }); expect(h.events.slice(-2)).toEqual(['/api/admin-auth/revoke', 'firebase-signout']);
});
it('full-page exit from ordinary mode still revokes the retained grant', async () => {
  const h = setup(); await screen.findByRole('heading', { name: 'Inicio' }); await enter(); await verify(); await back();
  act(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await waitFor(() => expect(h.events).toContain('/api/admin-auth/revoke'));
  expect(h.state.issued).toBe(false); expect(h.auth.signOut).not.toHaveBeenCalled();
});
it('an in-flight administrative mutation blocks mode exit and browser Back until reconciliation', async () => {
  const h = setup(); await screen.findByRole('heading', { name: 'Inicio' }); await enter(); await verify();
  fireEvent.click(screen.getByRole('button', { name: /Dato privado admin/ })); fireEvent.click(screen.getByRole('button', { name: 'Aprobar fotografía' }));
  let finish!: (r: Response) => void; h.fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar decisión' })); await waitFor(() => expect(finish).toBeDefined());
  expect(screen.getByRole('button', { name: 'Volver a Reals' })).toBeDisabled();
  const restored = vi.fn(); window.addEventListener('popstate', restored);
  try { act(() => history.back()); await waitFor(() => expect(restored).toHaveBeenCalledTimes(2)); }
  finally { window.removeEventListener('popstate', restored); }
  expect(location.pathname).toBe('/admin');
  await act(async () => finish(json({ ...photo, moderationStatus: 'APPROVED' })));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Volver a Reals' })).toBeEnabled());
});
it('a settled eligibility hint survives ordinary visibility without another status request', async () => {
  const h = setup(); const button = await screen.findByRole('button', { name: 'Admin' });
  const count = h.status.mock.calls.length;
  act(() => document.dispatchEvent(new Event('visibilitychange'))); await act(async () => {});
  expect(screen.getByRole('button', { name: 'Admin' })).toBe(button); expect(h.status).toHaveBeenCalledTimes(count);
});
it('same-UID authentication context replacement invalidates eligibility without using linked providers', async () => {
  const h = setup(); await screen.findByRole('heading', { name: 'Inicio' }); await screen.findByRole('button', { name: 'Admin' });
  vi.mocked(h.auth.googleContext!).mockResolvedValue({ provider: 'password', authTime: Date.now() });
  act(() => h.replace('same-uid')); await act(async () => {});
  expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull(); expect(h.auth.signOut).not.toHaveBeenCalled();
});
it('a repeated Firebase observation of the same token context preserves the confirmed header without another status request', async () => {
  const h = setup(); const entry = await screen.findByRole('button', { name: 'Admin' });
  const seen: boolean[] = [], observer = new MutationObserver(() => seen.push(entry.isConnected));
  observer.observe(document.body, { childList: true, subtree: true });
  act(() => h.replace('same-uid')); await act(async () => {}); observer.disconnect();
  expect(screen.getByRole('button', { name: 'Admin' })).toBe(entry); expect(seen.every(Boolean)).toBe(true);
  expect(h.status).toHaveBeenCalledOnce(); expect(h.auth.signOut).not.toHaveBeenCalled();
});
it('Account never duplicates the administrative header control', async () => {
  setup(); await screen.findByRole('button', { name: 'Admin' }); await account();
  expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull();
});

it('verifies eligibility immediately after bootstrap, independently of a delayed Home projection', async () => {
  const h = setup(), base = h.fetcher.getMockImplementation()!;
  let finish!: (response: Response) => void;
  h.fetcher.mockImplementation((path, options) => path === '/api/me/home' ? new Promise(resolve => { finish = resolve; }) : base(path, options));
  const entry = await screen.findByRole('button', { name: 'Admin' });
  expect(entry.closest('header')).toHaveClass('home-heading');
  expect(entry).toBeDisabled(); // The existing pending-operation guard still applies.
  expect(h.status).toHaveBeenCalledOnce();
  await waitFor(() => expect(finish).toBeDefined());
  await act(async () => finish(json(emptyHome())));
  await waitFor(() => expect(entry).toBeEnabled());
  expect(screen.getByRole('button', { name: 'Admin' })).toBe(entry);
  expect(screen.queryByRole('button', { name: 'Actualizar' })).toBeNull();
});

it('does not flash an unverified entry and rejects late eligibility after identity replacement', async () => {
  const h = setup(); let finish!: (response: Response) => void;
  h.status.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await waitFor(() => expect(finish).toBeDefined());
  expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull();
  h.status.mockResolvedValue(json({ code: 'ADMIN_ACCESS_DENIED' }, 403));
  act(() => h.replace('ordinary'));
  await waitFor(() => expect(h.status).toHaveBeenCalledTimes(2));
  await act(async () => finish(json({ configured: true, grantValid: false })));
  expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull();
});

it('recovers a transient eligibility failure at a later online boundary without polling', async () => {
  const h = setup(); h.status.mockRejectedValueOnce(new TypeError('offline'));
  await screen.findByRole('heading', { name: 'Inicio' }); await act(async () => {});
  expect(h.status).toHaveBeenCalledOnce(); expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull();
  vi.useFakeTimers();
  await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
  expect(h.status).toHaveBeenCalledOnce();
  await act(async () => window.dispatchEvent(new Event('online')));
  expect(screen.getByRole('button', { name: 'Admin' })).toBeVisible(); expect(h.status).toHaveBeenCalledTimes(2);
});

it('opens a modal over the same Home and restores focus on cancel without changing route or Firebase', async () => {
  const h = setup(); await enter();
  const home = document.querySelector('.home'), entry = screen.getByRole('button', { name: 'Admin' });
  const modal = await screen.findByRole('dialog', { name: 'Verificación administrativa' });
  expect(location.pathname).toBe('/'); expect(modal.querySelectorAll('.admin-otp-slots span')).toHaveLength(6);
  expect(screen.getByLabelText('Código de seis dígitos')).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(screen.queryByRole('dialog')).toBeNull(); expect(document.querySelector('.home')).toBe(home);
  expect(entry).toBeEnabled(); await waitFor(() => expect(entry).toHaveFocus()); expect(h.auth.signOut).not.toHaveBeenCalled();
  expect(h.events).not.toContain('/api/admin-auth/revoke');
});

it('pastes leading-zero OTP once even with duplicate change/paste events and pending rerenders', async () => {
  const h = setup(); await enter(); const input = await screen.findByLabelText('Código de seis dígitos');
  const base = h.fetcher.getMockImplementation()!; let finish!: (response: Response) => void;
  h.fetcher.mockImplementation((path, options) => path === '/api/admin-auth/verify' ? new Promise(resolve => { finish = resolve; }) : base(path, options));
  fireEvent.change(input, { target: { value: '01234' } });
  expect(document.querySelector('.admin-otp-slots')).toHaveTextContent('01234');
  expect(h.events).not.toContain('/api/admin-auth/verify');
  fireEvent.paste(input, { clipboardData: { getData: () => '012345' } });
  fireEvent.change(input, { target: { value: '012345' } });
  fireEvent.paste(input, { clipboardData: { getData: () => '012345' } });
  await waitFor(() => expect(finish).toBeDefined()); expect(input).toBeDisabled(); expect(input).toHaveValue('012345');
  const writes = h.fetcher.mock.calls.filter(([path]) => path === '/api/admin-auth/verify');
  expect(writes).toHaveLength(1); expect(JSON.parse(String(writes[0]?.[1]?.body))).toEqual({ code: '012345' });
  h.state.issued = true;
  await act(async () => finish(json({ grant, expiresAt: new Date(Date.now() + 900000).toISOString() })));
  await screen.findByText('Dato privado admin'); expect(screen.queryByRole('dialog')).toBeNull();
});

it('shows the active empty slot and preserves pending digits until backend-confirmed success feedback', async () => {
  const h = setup(); await enter(); const input = await screen.findByLabelText('Código de seis dígitos');
  fireEvent.change(input, { target: { value: '012' } });
  expect(document.querySelectorAll('.admin-otp-slot-active')).toHaveLength(1);
  expect(document.querySelector('.admin-otp-slot-active')).toHaveAttribute('data-slot', '3');
  let finish!: (response: Response) => void;
  h.status.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  vi.useFakeTimers();
  await act(async () => fireEvent.change(input, { target: { value: '012345' } }));
  expect(finish).toBeDefined(); expect(input).toBeDisabled(); expect(input).toHaveValue('012345');
  expect(document.querySelector('.admin-otp-field')).toHaveAttribute('data-feedback', 'pending');
  expect(document.querySelector('.admin-otp-caret')).toBeNull();
  expect(screen.queryByText('Acceso verificado')).toBeNull(); expect(screen.queryByText('Dato privado admin')).toBeNull();
  await act(async () => finish(json({ configured: true, grantValid: true })));
  expect(screen.getByText('Acceso verificado')).toBeVisible(); expect(input).toHaveValue('');
  expect(document.querySelector('.admin-otp-field')).toHaveAttribute('data-feedback', 'success');
  expect(h.events.some(path => path.startsWith('/api/admin/'))).toBe(false);
  await act(async () => { await vi.advanceTimersByTimeAsync(399); }); expect(screen.queryByText('Dato privado admin')).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(screen.getByText('Dato privado admin')).toBeVisible();
  expect(h.events.filter(path => path.endsWith('/verify'))).toHaveLength(1);
});

it.each(['cancel', 'identity', 'pagehide', 'unmount'])('interrupts confirmed success feedback on %s without stale privileged navigation', async action => {
  const h = setup(); await enter(); const input = await screen.findByLabelText('Código de seis dígitos');
  vi.useFakeTimers(); await act(async () => fireEvent.change(input, { target: { value: '012345' } }));
  expect(screen.getByText('Acceso verificado')).toBeVisible();
  await act(async () => {
    if (action === 'cancel') fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    if (action === 'identity') h.replace('new-identity');
    if (action === 'pagehide') window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    if (action === 'unmount') h.view.unmount();
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(screen.queryByText('Dato privado admin')).toBeNull();
  expect(h.events.some(path => path.startsWith('/api/admin/'))).toBe(false);
});

it('expiry during success feedback cancels navigation and never extends the issued deadline', async () => {
  const h = setup(); await enter(); const input = await screen.findByLabelText('Código de seis dígitos');
  const base = h.fetcher.getMockImplementation()!;
  h.fetcher.mockImplementation((path, options) => {
    if (path !== '/api/admin-auth/verify') return base(path, options);
    h.state.issued = true;
    return Promise.resolve(json({ grant, expiresAt: new Date(Date.now() + 200).toISOString() }));
  });
  vi.useFakeTimers(); await act(async () => fireEvent.change(input, { target: { value: '012345' } }));
  expect(screen.getByText('Acceso verificado')).toBeVisible();
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(screen.queryByText('Acceso verificado')).toBeNull(); expect(screen.queryByText('Dato privado admin')).toBeNull();
  expect(screen.getByLabelText('Código de seis dígitos')).toHaveValue('');
  expect(h.events.some(path => path.startsWith('/api/admin/'))).toBe(false);
});

it.each(['ADMIN_MFA_INVALID_CODE', 'ADMIN_MFA_RATE_LIMITED'])('clears a failed OTP, respects cooldown and never retries %s', async code => {
  const h = setup(); await enter(); const input = await screen.findByLabelText('Código de seis dígitos');
  const base = h.fetcher.getMockImplementation()!;
  h.fetcher.mockImplementation((path, options) => path === '/api/admin-auth/verify' ? Promise.resolve(new Response(JSON.stringify({ code }), { status: code === 'ADMIN_MFA_RATE_LIMITED' ? 429 : 400, headers: { 'Retry-After': '2' } })) : base(path, options));
  vi.useFakeTimers(); await act(async () => fireEvent.change(input, { target: { value: '012345' } })); expect(screen.getByRole('alert')).toBeVisible();
  expect(input).toHaveValue(''); expect(input).toBeDisabled();
  await act(async () => { await vi.advanceTimersByTimeAsync(2100); });
  expect(input).toBeEnabled(); expect(h.fetcher.mock.calls.filter(([path]) => path === '/api/admin-auth/verify')).toHaveLength(1);
  expect(h.events.some(path => path.startsWith('/api/admin/'))).toBe(false);
});

it('Google confirmation remains a synchronous explicit action in the modal', async () => {
  const h = setup(); h.state.authTime = Date.now() - 300001;
  await enter(); await screen.findByRole('dialog'); expect(h.auth.reauthenticateGoogle).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar identidad con Google' }));
  expect(h.auth.reauthenticateGoogle).toHaveBeenCalledOnce();
  await screen.findByLabelText('Código de seis dígitos');
  expect(h.events.filter(path => path.endsWith('/verify'))).toHaveLength(0);
});

it('cancelling a failed revalidation retains the original grant for a later confirmed return', async () => {
  const h = setup(); await enter(); await verify(); await back();
  h.status.mockResolvedValueOnce(json({ code: 'ADMIN_AUTHENTICATION_UNAVAILABLE' }, 503));
  await enter(); await screen.findByRole('dialog'); await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(h.events).not.toContain('/api/admin-auth/revoke'); expect(screen.queryByText('Dato privado admin')).toBeNull();
  await enter(); await screen.findByText('Dato privado admin');
  expect(h.events.filter(path => path.endsWith('/verify'))).toHaveLength(1); expect(h.auth.reauthenticateGoogle).not.toHaveBeenCalled();
});

it('clears an unfinished code on page exit and checks state again after bfcache restoration', async () => {
  const h = setup(); await enter(); const input = await screen.findByLabelText('Código de seis dígitos');
  fireEvent.change(input, { target: { value: '012' } });
  act(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  act(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  const restored = await screen.findByLabelText('Código de seis dígitos'); expect(restored).toHaveValue('');
  expect(h.events.filter(path => path.endsWith('/verify'))).toHaveLength(0); expect(h.auth.reauthenticateGoogle).not.toHaveBeenCalled();
});

it('keeps the session-owned entry available during draft setup while protecting unsaved forms', async () => {
  const h = setup('google.com', false, true);
  const entry = await screen.findByRole('button', { name: 'Admin' });
  await screen.findByRole('heading', { name: 'Completá tu perfil' });
  fireEvent.click(screen.getByText('Datos del perfil', { selector: 'summary' }));
  fireEvent.change(screen.getByLabelText('Ciudad'), { target: { value: 'Borrador sin guardar' } });
  fireEvent.click(entry); await act(async () => {});
  expect(screen.queryByRole('dialog')).toBeNull(); expect(location.pathname).toBe('/');
  expect(h.events.some(path => path.endsWith('/verify'))).toBe(false); expect(screen.getByLabelText('Ciudad')).toHaveValue('Borrador sin guardar');
});
it('navigation during a pending entry check cancels the obsolete challenge without interrupting Account', async () => {
  const h = setup(); await screen.findByRole('button', { name: 'Admin' });
  let finish!: (response: Response) => void; h.status.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await enter(); await waitFor(() => expect(finish).toBeDefined()); await account();
  await act(async () => finish(json({ configured: true, grantValid: false })));
  expect(screen.getByRole('heading', { name: 'Cuenta' })).toBeVisible(); expect(screen.queryByRole('dialog')).toBeNull();
  expect(location.pathname).toBe('/'); expect(h.events).not.toContain('/api/admin-auth/revoke');
});

it('a late eligibility response sent without a grant cannot retire a subsequently verified grant', async () => {
  const h = setup(); let finish!: (response: Response) => void;
  h.status.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await waitFor(() => { expect(finish).toBeDefined(); expect(document.querySelector('.home')).toHaveAttribute('aria-busy', 'false'); });
  act(() => { history.pushState({ ...history.state, trail: ['home', 'admin'] }, '', '/admin'); window.dispatchEvent(new PopStateEvent('popstate', { state: history.state })); });
  await verify();
  await act(async () => finish(json({ configured: true, grantValid: false })));
  expect(screen.getByText('Dato privado admin')).toBeVisible(); expect(h.events.filter(path => path.endsWith('/verify'))).toHaveLength(1);
});

it('a confirmed denial clears the cached eligibility and visibility cannot resurrect it', async () => {
  const h = setup(); await enter(); await verify(); await back();
  h.status.mockResolvedValue(json({ code: 'ADMIN_ACCESS_DENIED' }, 403));
  await enter(); await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  act(() => document.dispatchEvent(new Event('visibilitychange'))); await act(async () => {});
  expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull();
  act(() => h.replace('same-uid')); await act(async () => {});
  expect(screen.queryByRole('button', { name: 'Admin' })).toBeNull(); expect(h.auth.signOut).not.toHaveBeenCalled();
});
