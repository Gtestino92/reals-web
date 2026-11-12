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
async function enter() { fireEvent.click(await screen.findByRole('button', { name: 'Administración' })); }
async function verify() { fireEvent.change(await screen.findByLabelText('Código de seis dígitos'), { target: { value: '012345' } }); fireEvent.click(screen.getByRole('button', { name: 'Verificar código' })); await screen.findByText('Dato privado admin'); }
async function back() { fireEvent.click(screen.getByRole('button', { name: 'Volver a Reals' })); await screen.findByRole('button', { name: 'Administración' }); }
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); history.replaceState(null, '', '/'); });

it.each(['google.com', 'password'])('the same UID with actual provider %s gets eligibility from token context, never linked providers', async provider => {
  const h = setup(provider); await account(); await act(async () => {});
  await waitFor(() => expect(h.auth.googleContext).toHaveBeenCalled());
  if (provider === 'google.com') { await screen.findByRole('button', { name: 'Administración' }); expect(h.status).toHaveBeenCalledOnce(); }
  else { expect(screen.queryByRole('button', { name: 'Administración' })).toBeNull(); expect(h.status).not.toHaveBeenCalled(); }
  expect(h.events.some(path => path.startsWith('/api/admin/'))).toBe(false);
});
it.each([403, 503, 'malformed', 'unconfigured'])('hides the entry entirely for failed/ineligible status %s', async failure => {
  const h = setup(); h.status.mockImplementation(async () => failure === 'malformed' ? json({ configured: true }) : failure === 'unconfigured' ? json({ configured: false, grantValid: false }) : json({ code: failure === 403 ? 'ADMIN_ACCESS_DENIED' : 'ADMIN_AUTHENTICATION_UNAVAILABLE' }, typeof failure === 'number' ? failure : 503));
  await account(); await waitFor(() => expect(h.status).toHaveBeenCalled()); await act(async () => {});
  expect(screen.queryByRole('button', { name: 'Administración' })).toBeNull(); expect(location.pathname).toBe('/');
});
it('explicit Google login from an admin URL always enters ordinary Reals', async () => {
  const h = setup('google.com', true); fireEvent.click(await screen.findByRole('button', { name: 'Continuar con Google' }));
  await screen.findByRole('heading', { name: 'Inicio' }); expect(location.pathname).toBe('/');
  expect(h.events.some(path => path.includes('/admin'))).toBe(false); await account(); await screen.findByRole('button', { name: 'Administración' });
});
it.each(['suspended', 'deleted'])('never checks admin eligibility for a %s ordinary session', async kind => {
  const h = setup();
  h.fetcher.mockResolvedValueOnce(kind === 'suspended' ? json({ code: 'ACCOUNT_TEMPORARILY_BANNED' }, 403) : json({ id: 'u', status: 'DELETED', deletedAt: '2026-11-01T00:00:00Z', deletionFinalizesAt: '2026-12-01T00:00:00Z' }));
  await screen.findByRole('heading', { name: kind === 'suspended' ? 'Cuenta suspendida temporalmente' : 'Cuenta pendiente de eliminación' });
  expect(h.status).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'Administración' })).toBeNull();
});
it('switches modes, removes private data and revalidates before reusing the original grant without new TOTP', async () => {
  const h = setup(); await account(); await enter(); await verify(); await back();
  expect(screen.queryByText('Dato privado admin')).toBeNull(); expect(h.events).not.toContain('/api/admin-auth/revoke');
  let finish!: (r: Response) => void; h.status.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await enter(); await waitFor(() => expect(finish).toBeDefined()); expect(screen.queryByText('Dato privado admin')).toBeNull();
  await act(async () => finish(json({ configured: true, grantValid: true }))); await screen.findByText('Dato privado admin');
  expect(h.events.filter(p => p.endsWith('/verify'))).toHaveLength(1); expect(h.auth.reauthenticateGoogle).not.toHaveBeenCalled();
  expect(JSON.stringify(history.state)).not.toContain(grant);
});
it('Back/Forward traverses modes and reconstructs privileged data only after a fresh status check', async () => {
  const h = setup(); await account(); await enter(); await verify();
  act(() => history.back()); await screen.findByRole('button', { name: 'Administración' }); expect(location.pathname).toBe('/'); expect(screen.queryByText('Dato privado admin')).toBeNull();
  act(() => history.forward()); await screen.findByText('Dato privado admin'); expect(location.pathname).toBe('/admin');
  expect(h.events.filter(p => p.endsWith('/verify'))).toHaveLength(1); expect(h.events).not.toContain('/api/admin-auth/revoke');
});
it('expiry runs while normal Reals is visible; returning requires new authentication without opening a popup automatically', async () => {
  const h = setup(); await account(); await enter(); const input = await screen.findByLabelText('Código de seis dígitos');
  vi.useFakeTimers();
  await act(async () => { fireEvent.change(input, { target: { value: '012345' } }); fireEvent.click(screen.getByRole('button', { name: 'Verificar código' })); });
  expect(screen.getByText('Dato privado admin')).toBeVisible();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Volver a Reals' })); await vi.advanceTimersByTimeAsync(10); });
  expect(screen.queryByText('Dato privado admin')).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(900000); });
  fireEvent.click(screen.getByRole('button', { name: 'Administración' })); await act(async () => {});
  expect(screen.queryByText('Dato privado admin')).toBeNull(); expect(h.auth.reauthenticateGoogle).not.toHaveBeenCalled();
  expect(h.events.filter(p => p.endsWith('/verify'))).toHaveLength(1);
  expect(screen.getByText('Confirmá recientemente tu identidad con Google para continuar.')).toBeVisible();
});
it('explicit revocation is separate from returning to Reals and leaves Firebase signed in', async () => {
  const h = setup(); await account(); await enter(); await verify(); fireEvent.click(screen.getByRole('button', { name: 'Cerrar acceso administrativo' }));
  await screen.findByLabelText('Código de seis dígitos'); expect(h.events.filter(p => p.endsWith('/revoke'))).toHaveLength(1); expect(h.auth.signOut).not.toHaveBeenCalled();
});
it('logout from ordinary mode revokes the retained grant before Firebase logout', async () => {
  const h = setup(); await account(); await enter(); await verify(); await back(); confirmSignOut();
  await screen.findByRole('button', { name: 'Ingresar' }); expect(h.events.slice(-2)).toEqual(['/api/admin-auth/revoke', 'firebase-signout']);
});
it('full-page exit from ordinary mode still revokes the retained grant', async () => {
  const h = setup(); await account(); await enter(); await verify(); await back();
  act(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await waitFor(() => expect(h.events).toContain('/api/admin-auth/revoke'));
  expect(h.state.issued).toBe(false); expect(h.auth.signOut).not.toHaveBeenCalled();
});
it('an in-flight administrative mutation blocks mode exit and browser Back until reconciliation', async () => {
  const h = setup(); await account(); await enter(); await verify();
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
it('eligibility invalidation hides an existing entry and ignores a stale check after identity replacement', async () => {
  const h = setup(); await account(); await screen.findByRole('button', { name: 'Administración' });
  let finish!: (r: Response) => void; h.status.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  act(() => document.dispatchEvent(new Event('visibilitychange'))); await waitFor(() => expect(finish).toBeDefined());
  expect(screen.queryByRole('button', { name: 'Administración' })).toBeNull();
  h.status.mockImplementation(async () => json({ code: 'ADMIN_ACCESS_DENIED' }, 403)); act(() => h.replace('other'));
  await act(async () => finish(json({ configured: true, grantValid: false })));
  await account(); await act(async () => {}); expect(screen.queryByRole('button', { name: 'Administración' })).toBeNull();
});
it('same-UID authentication context replacement invalidates eligibility without using linked providers', async () => {
  const h = setup(); await account(); await screen.findByRole('button', { name: 'Administración' });
  vi.mocked(h.auth.googleContext!).mockResolvedValue({ provider: 'password', authTime: Date.now() });
  act(() => h.replace('same-uid')); await act(async () => {});
  expect(screen.queryByRole('button', { name: 'Administración' })).toBeNull(); expect(h.auth.signOut).not.toHaveBeenCalled();
});
it('password dialogs block entry and guarded Forward cannot bypass Account', async () => {
  const h = setup(); await account(); await enter(); await verify(); await back();
  fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña de Reals' })); expect(screen.getByRole('button', { name: 'Administración' })).toBeDisabled();
  const statuses = h.status.mock.calls.length; act(() => history.forward());
  await waitFor(() => expect(location.pathname).toBe('/'));
  expect(screen.queryByText('Dato privado admin')).toBeNull(); expect(h.status).toHaveBeenCalledTimes(statuses);
});
it('draft profile edits disable only admin switching and preserve normal account actions', async () => {
  setup('google.com', false, true); await screen.findByRole('heading', { name: 'Completá tu perfil' }); await account(true);
  await screen.findByRole('button', { name: 'Administración' });
  fireEvent.change(screen.getByLabelText('Nombre visible'), { target: { value: 'Sin guardar' } });
  expect(screen.getByRole('button', { name: 'Administración' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Intención'), { target: { value: 'FRIENDSHIP' } });
  fireEvent.change(screen.getByLabelText('Nombre visible'), { target: { value: 'Operador' } });
  expect(screen.getByRole('button', { name: 'Administración' })).toBeDisabled();
});
