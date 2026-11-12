import { confirmSignOut } from './test/signOut';
import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { OperationalApp as App } from './App';
import { ApiClient } from './auth/api';
import type { AuthService, Identity } from './auth/firebase';
import { configureFirebase, localVerificationEnabled } from './auth/firebase';
import { SessionController } from './auth/session';
// Stage B tests isolate authentication; Stage C exercises the real surface separately.
vi.mock('./onboarding/Onboarding', () => ({ Onboarding: ({ controller }: { controller: SessionController }) => <p>{controller.snapshot.profile ? `Perfil existente: ${controller.snapshot.profile.status}` : 'Sin perfil: falta completar el registro.'}</p> }));
let observer: (user: Identity | null) => void;
let user: Identity;
let auth: AuthService;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
const json = (body: unknown, status = 200) => new Response(status === 202 || status === 204 ? null : JSON.stringify(body), { status });
const ready = () => fetcher.mockResolvedValueOnce(json({ id: 'u', status: 'ACTIVE' })).mockResolvedValueOnce(json({ code: 'PROFILE_NOT_FOUND' }, 404));
const limited = (retry: string | null, code = 'ACCOUNT_PROVISIONING_LIMIT_EXCEEDED') => new Response(JSON.stringify({ code, error: 'Too Many Requests', message: 'private diagnostic, never display' }), { status: 429, headers: retry === null ? {} : { 'Retry-After': retry } });
function mount(strict = false, local = false) {
  const app = <App firebase={{ service: auth, localVerification: local }} api={new ApiClient(fetcher)} />;
  render(strict ? <StrictMode>{app}</StrictMode> : app);
}
function login() { act(() => observer(null)); }
function credentials() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: ' test@example.com ' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
}
it.each(['password', 'google'])('keeps the login DOM through %s authentication and a slow backend bootstrap', async provider => {
  let finish!: (response: Response) => void;
  fetcher.mockImplementation(path => path === '/api/me' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(json({ code: 'PROFILE_NOT_FOUND' }, 404)));
  mount(true); login(); credentials();
  const panel = document.querySelector('.login-panel'), email = screen.getByLabelText('Email');
  fireEvent.click(screen.getByRole('button', { name: provider === 'google' ? 'Continuar con Google' : 'Ingresar' }));
  await waitFor(() => expect(finish).toBeDefined());
  expect(document.querySelector('.login-panel')).toBe(panel); expect(screen.getByLabelText('Email')).toBe(email);
  expect(email).toBeDisabled(); expect(screen.getByRole('status')).toHaveTextContent('Preparando tu sesión de forma segura…');
  expect(screen.queryByText('Preparando Reals…')).toBeNull(); expect(screen.queryByText('Sin perfil: falta completar el registro.')).toBeNull();
  await act(async () => finish(json({ id: 'u', status: 'ACTIVE' })));
  await screen.findByText('Sin perfil: falta completar el registro.');
});

it('keeps the restored-session shell until bootstrap resolves and shows an actionable failure', async () => {
  let fail!: (reason: Error) => void;
  fetcher.mockImplementation(() => new Promise((_resolve, reject) => { fail = reject; }));
  mount(true); const panel = document.querySelector('.login-panel'), email = screen.getByLabelText('Email');
  act(() => observer(user)); await waitFor(() => expect(fail).toBeDefined());
  expect(document.querySelector('.login-panel')).toBe(panel); expect(screen.getByLabelText('Email')).toBe(email);
  expect(email).toBeDisabled(); expect(screen.queryByText('Sin perfil: falta completar el registro.')).toBeNull();
  await act(async () => fail(new TypeError('offline')));
  expect(screen.getByRole('alert')).toBeVisible(); expect(screen.getByRole('button', { name: 'Reintentar' })).toBeEnabled();
});
beforeEach(() => {
  user = { uid: 'f', emailVerified: false, getIdToken: vi.fn().mockResolvedValue('test-token'), reload: vi.fn().mockResolvedValue(undefined) };
  auth = { observe: vi.fn(next => { observer = next; return vi.fn(); }), signIn: vi.fn().mockResolvedValue(user), signUp: vi.fn().mockResolvedValue(user), google: vi.fn().mockResolvedValue(user), verify: vi.fn().mockResolvedValue(undefined), signOut: vi.fn().mockResolvedValue(undefined) };
  fetcher = vi.fn<typeof fetch>();
});
it('missing configuration is actionable and never starts auth', () => {
  const config = configureFirebase({ DEV: true, MODE: 'test', PROD: false, BASE_URL: '/', SSR: false });
  render(<App firebase={config} />);
  expect(screen.getByRole('alert')).toHaveTextContent('.env.local'); expect(auth.observe).not.toHaveBeenCalled();
});
it('local flag requires dev, opt in and loopback', () => {
  expect(localVerificationEnabled(true, 'true', '127.0.0.1')).toBe(true);
  expect(localVerificationEnabled(false, 'true', '127.0.0.1')).toBe(false);
  expect(localVerificationEnabled(true, 'true', 'example.com')).toBe(false);
  expect(localVerificationEnabled(true, undefined, 'localhost')).toBe(false);
});
it('validates empty credentials without invoking Firebase', () => {
  mount(); login(); fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Ingresá email y contraseña'); expect(auth.signIn).not.toHaveBeenCalled();
});
it('signs in, suppresses duplicate submits and auth-observer bootstrap overlap', async () => {
  ready(); mount(); login(); credentials();
  vi.mocked(auth.signIn).mockImplementation(async () => { observer(user); return user; });
  fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
  fireEvent.submit(screen.getByRole('form'));
  await screen.findByText('Sin perfil: falta completar el registro.');
  expect(auth.signIn).toHaveBeenCalledExactlyOnceWith('test@example.com', 'password', false); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('maps sign-in failure with safe Spanish message', async () => {
  vi.mocked(auth.signIn).mockRejectedValue({ code: 'auth/invalid-credential', message: 'secret' });
  mount(); login(); credentials(); fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Revisá el email y la contraseña');
  expect(screen.getByRole('button', { name: 'Ingresar' })).toBeEnabled();
});
it('registration sends verification email when local helper disabled', async () => {
  ready(); mount(); login(); credentials(); fireEvent.click(screen.getByRole('button', { name: '¿No tenés cuenta? Crear cuenta' })); fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
  await screen.findByText('Te enviamos un email para verificar tu cuenta.'); expect(auth.verify).toHaveBeenCalledWith(user);
});
it('verification email failure preserves session and can retry', async () => {
  vi.mocked(auth.verify).mockRejectedValueOnce(new Error()).mockResolvedValue(undefined);
  ready(); mount(); login(); credentials(); fireEvent.click(screen.getByRole('button', { name: '¿No tenés cuenta? Crear cuenta' })); fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
  await screen.findByRole('alert'); expect(auth.signOut).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' })); await screen.findByText('Sin perfil: falta completar el registro.');
  expect(auth.verify).toHaveBeenCalledTimes(2);
});
it('local registration skips standard email and completes helper refresh', async () => {
  ready(); fetcher.mockResolvedValueOnce(json(null, 204));
  vi.mocked(user.reload).mockImplementation(async () => { Object.defineProperty(user, 'emailVerified', { value: true, configurable: true }); });
  mount(false, true); login(); credentials(); fireEvent.click(screen.getByRole('button', { name: '¿No tenés cuenta? Crear cuenta' })); fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
  await screen.findByText('Sin perfil: falta completar el registro.'); expect(auth.verify).not.toHaveBeenCalled(); expect(user.getIdToken).toHaveBeenLastCalledWith(true);
});
it('opens Google directly on click and completes bootstrap', async () => {
  ready(); mount(); login(); fireEvent.click(screen.getByRole('button', { name: 'Continuar con Google' }));
  expect(auth.google).toHaveBeenCalledOnce(); await screen.findByText('Sin perfil: falta completar el registro.');
});
it.each(['auth/popup-closed-by-user', 'auth/popup-blocked', 'auth/unauthorized-domain', 'auth/account-exists-with-different-credential', 'auth/operation-not-allowed'])('handles Google %s and releases loading', async code => {
  vi.mocked(auth.google).mockRejectedValue({ code }); mount(); login(); fireEvent.click(screen.getByRole('button', { name: 'Continuar con Google' }));
  await screen.findByRole('alert'); expect(screen.getByRole('button', { name: 'Continuar con Google' })).toBeEnabled(); expect(fetcher).not.toHaveBeenCalled();
});
it('restores existing session exactly once under StrictMode', async () => {
  ready(); vi.mocked(auth.observe).mockImplementation(next => { observer = next; next(user); return vi.fn(); });
  mount(true); await screen.findByText('Sin perfil: falta completar el registro.'); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('sign out cancels pending fetch and rejects its late response', async () => {
  let resolve: (value: Response) => void = () => {};
  fetcher.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  mount(); act(() => observer(user)); await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  const signal = fetcher.mock.calls[0]?.[1]?.signal;
  confirmSignOut(); await screen.findByRole('button', { name: 'Ingresar' });
  expect(signal?.aborted).toBe(true); await act(async () => resolve(json({ id: 'u', status: 'ACTIVE' })));
  expect(screen.getByRole('button', { name: 'Ingresar' })).toBeVisible(); expect(fetcher).toHaveBeenCalledOnce();
});
it('transient backend failure preserves Firebase and retry recovers existing profile', async () => {
  fetcher.mockRejectedValueOnce(new TypeError()).mockResolvedValueOnce(json({ id: 'u', status: 'ACTIVE' })).mockResolvedValueOnce(json({ id: 'p', userId: 'u', status: 'ACTIVE' }));
  mount(); act(() => observer(user)); await screen.findByRole('alert'); expect(auth.signOut).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' })); await screen.findByRole('heading', { name: 'Inicio' });
});
it.each([null, '120', 'malformed'])('restores Firebase under StrictMode and keeps provisioning quota recoverable (%s)', async retry => {
  fetcher.mockResolvedValueOnce(json({ code: 'USER_NOT_FOUND' }, 404)).mockResolvedValueOnce(limited(retry));
  vi.mocked(auth.observe).mockImplementation(next => { observer = next; next(user); return vi.fn(); });
  mount(true); const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Los nuevos registros desde esta conexión están temporalmente limitados.');
  if (retry === '120') expect(alert).toHaveTextContent('aproximadamente 2 minutos'); else expect(alert).not.toHaveTextContent('aproximadamente');
  expect(alert).not.toHaveTextContent('private diagnostic'); expect(auth.signOut).not.toHaveBeenCalled();
  expect(screen.queryByText('Sin perfil: falta completar el registro.')).toBeNull(); expect(screen.queryByRole('heading', { name: 'Inicio' })).toBeNull();
  expect(fetcher.mock.calls.map(([path]) => path)).toEqual(['/api/me', '/api/me/provision']);
  act(() => { observer(user); observer(user); }); expect(fetcher).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'Reintentar' })).toBeEnabled(); expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeEnabled();
  if (retry === null) { confirmSignOut(); await screen.findByRole('button', { name: 'Ingresar' }); expect(auth.signOut).toHaveBeenCalledOnce(); }
});
it('retains a newly registered Firebase identity when backend provisioning is rate limited', async () => {
  fetcher.mockResolvedValueOnce(json({ code: 'USER_NOT_FOUND' }, 404)).mockResolvedValueOnce(limited('3600'));
  mount(); login(); credentials(); fireEvent.click(screen.getByRole('button', { name: '¿No tenés cuenta? Crear cuenta' })); fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
  const alert = await screen.findByRole('alert'); expect(alert).toHaveTextContent('aproximadamente 1 hora');
  expect(auth.signUp).toHaveBeenCalledOnce(); expect(auth.verify).toHaveBeenCalledWith(user); expect(auth.signOut).not.toHaveBeenCalled();
  expect(screen.queryByText('Sin perfil: falta completar el registro.')).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', { name: 'Reintentar' })).toBeEnabled();
});
it('manually retries provisioning with the same identity and never polls the quota', async () => {
  fetcher.mockResolvedValueOnce(json({ code: 'USER_NOT_FOUND' }, 404)).mockResolvedValueOnce(limited('60'));
  mount(); act(() => observer(user)); await screen.findByRole('alert');
  vi.useFakeTimers();
  try { await act(async () => { await vi.advanceTimersByTimeAsync(86400000); }); expect(fetcher).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0); }
  finally { vi.useRealTimers(); }
  fetcher.mockResolvedValueOnce(json({ code: 'USER_NOT_FOUND' }, 404)).mockResolvedValueOnce(json({ id: 'u', status: 'ACTIVE' }, 201)).mockResolvedValueOnce(json({ code: 'PROFILE_NOT_FOUND' }, 404));
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' })); await screen.findByText('Sin perfil: falta completar el registro.');
  expect(fetcher.mock.calls.map(([path]) => path)).toEqual(['/api/me', '/api/me/provision', '/api/me', '/api/me/provision', '/api/me/profile']);
  expect(auth.signOut).not.toHaveBeenCalled(); expect(auth.signIn).not.toHaveBeenCalled(); expect(user.getIdToken).not.toHaveBeenCalledWith(true);
});
it('keeps the backend snapshot empty and recoverable on provisioning 429 despite the ACCOUNT_ prefix', async () => {
  fetcher.mockResolvedValueOnce(json({ code: 'USER_NOT_FOUND' }, 404)).mockResolvedValueOnce(limited('604800'));
  const controller = new SessionController(auth, new ApiClient(fetcher), false), dispose = controller.subscribe(() => {});
  try {
    act(() => observer(user)); await waitFor(() => expect(controller.getSnapshot().phase).toBe('recoverable'));
    expect(controller.getSnapshot()).toMatchObject({ account: null, profile: null, operation: null, resetAt: null });
    expect(controller.getSnapshot().error?.message).toContain('aproximadamente 7 días'); expect(auth.signOut).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(2);
  } finally { dispose(); }
});
it.each(['RATE_LIMIT_EXCEEDED', 'ACCOUNT_PROVISIONING_LIMIT_EXCEEDED'])('ready-session 429 %s never invalidates auth or retries bootstrap', async code => {
  ready(); const controller = new SessionController(auth, new ApiClient(fetcher), false), dispose = controller.subscribe(() => {});
  try {
    act(() => observer(user)); await waitFor(() => expect(controller.getSnapshot().phase).toBe('ready'));
    const before = controller.getSnapshot(), retry = vi.spyOn(controller, 'retry');
    fetcher.mockResolvedValueOnce(limited('60', code));
    await expect(controller.request('/me/provision', new AbortController().signal, 'POST')).rejects.toMatchObject({ status: 429, code, retryAfterSeconds: 60 });
    expect(controller.getSnapshot()).toBe(before); expect(retry).not.toHaveBeenCalled(); expect(auth.signOut).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(3);
  } finally { dispose(); }
});
it.each(['signout', 'replacement'])('rejects a late provisioning quota response after %s', async scenario => {
  let resolve!: (value: Response) => void;
  fetcher.mockResolvedValueOnce(json({ code: 'USER_NOT_FOUND' }, 404)).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  mount(); act(() => observer(user)); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  const signal = fetcher.mock.calls[1]?.[1]?.signal;
  if (scenario === 'signout') { confirmSignOut(); await screen.findByRole('button', { name: 'Ingresar' }); }
  else { ready(); act(() => observer({ ...user, uid: 'replacement' })); await screen.findByText('Sin perfil: falta completar el registro.'); }
  await act(async () => resolve(limited('120'))); expect(signal?.aborted).toBe(true); expect(screen.queryByText(/Los nuevos registros/)).toBeNull();
  expect(auth.signOut).toHaveBeenCalledTimes(scenario === 'signout' ? 1 : 0);
});
it('Retry dispatches another backend request using receiver-sensitive default fetch', async () => {
  fetcher.mockRejectedValueOnce(new TypeError('Connection failed'));
  ready();
  const nativeFetch = vi.fn(function (this: unknown, ...args: Parameters<typeof fetch>) {
    if (this !== globalThis) throw new TypeError('Illegal invocation');
    return fetcher(...args);
  });
  vi.stubGlobal('fetch', nativeFetch);
  try {
    render(<App firebase={{ service: auth, localVerification: false }} />);
    act(() => observer(user));
    await screen.findByRole('alert');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(auth.signOut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await screen.findByText('Sin perfil: falta completar el registro.');
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/api/me', '/api/me', '/api/me/profile']);
  } finally {
    vi.unstubAllGlobals();
  }
});
it.each(['AUTH_METHOD_NOT_ALLOWED', 'EMAIL_ALREADY_LINKED_TO_DIFFERENT_FIREBASE_USER', 'INVALID_TOKEN'])('terminal %s clears Firebase and returns login', async code => {
  fetcher.mockImplementation(async () => json({ code }, 401)); mount(); act(() => observer(user));
  await screen.findByRole('button', { name: 'Ingresar' }); expect(auth.signOut).toHaveBeenCalledOnce(); expect(screen.getByRole('alert')).toBeVisible();
});
it.each(['ACCOUNT_PENDING_DELETION', 'ACCOUNT_TEMPORARILY_BANNED', 'ACCOUNT_PERMANENTLY_BANNED'])('restricted %s never renders ready', async code => {
  fetcher.mockResolvedValueOnce(json({ code }, 403)); mount(); act(() => observer(user)); if (code === 'ACCOUNT_TEMPORARILY_BANNED') await screen.findByRole('heading', { name: 'Cuenta suspendida temporalmente' }); else await screen.findByRole('alert');
  expect(screen.queryByText('Firebase autenticado. Sesión del backend lista.')).not.toBeInTheDocument(); expect(fetcher).toHaveBeenCalledTimes(code === 'ACCOUNT_PERMANENTLY_BANNED' ? 2 : 1);
});
it('password reset validates, sends unauthenticated trimmed email and applies cooldown only on 202', async () => {
  fetcher.mockResolvedValueOnce(json(null, 202)); mount(); login(); fireEvent.click(screen.getByRole('button', { name: 'Olvidé mi contraseña' }));
  expect(fetcher).not.toHaveBeenCalled(); credentials(); fireEvent.click(screen.getByRole('button', { name: 'Olvidé mi contraseña' }));
  await screen.findByText('Si el email está registrado, te enviamos instrucciones para recuperar el acceso.');
  expect(fetcher).toHaveBeenCalledWith('/api/auth/password-reset', expect.objectContaining({ body: JSON.stringify({ email: 'test@example.com' }), headers: { 'Content-Type': 'application/json' } }));
  expect(screen.getByRole('button', { name: /Reenviar en/ })).toBeDisabled();
});
it('failed reset does not claim delivery or start cooldown', async () => {
  fetcher.mockRejectedValueOnce(new Error()); mount(); login(); credentials(); fireEvent.click(screen.getByRole('button', { name: 'Olvidé mi contraseña' }));
  await screen.findByRole('alert'); expect(screen.queryByText(/Si el email está registrado/)).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: 'Olvidé mi contraseña' })).toBeEnabled();
});
it.each([null, '90', 'malformed', '9999999999999999999999'])('password-reset 429 stays neutral without starting success cooldown (%s)', async retry => {
  fetcher.mockResolvedValueOnce(limited(retry, 'RATE_LIMIT_EXCEEDED')); mount(); login(); credentials(); fireEvent.click(screen.getByRole('button', { name: 'Olvidé mi contraseña' }));
  const alert = await screen.findByRole('alert'); expect(alert).toHaveTextContent('Por ahora no se puede solicitar otra recuperación de acceso.');
  if (retry === '90') expect(alert).toHaveTextContent('aproximadamente 2 minutos'); else expect(alert).not.toHaveTextContent('aproximadamente');
  expect(alert).not.toHaveTextContent('private diagnostic'); expect(screen.queryByText(/Si el email está registrado/)).toBeNull(); expect(screen.queryByRole('button', { name: /Reenviar en/ })).toBeNull();
  expect(screen.getByRole('button', { name: 'Olvidé mi contraseña' })).toBeEnabled(); expect(fetcher).toHaveBeenCalledOnce(); expect(auth.signOut).not.toHaveBeenCalled(); expect(user.getIdToken).not.toHaveBeenCalled();
});
it('an explicit recovery request after a 429 still accepts generic 202 and the normal cooldown', async () => {
  fetcher.mockResolvedValueOnce(limited('60', 'RATE_LIMIT_EXCEEDED')).mockResolvedValueOnce(json(null, 202));
  mount(); login(); credentials(); fireEvent.click(screen.getByRole('button', { name: 'Olvidé mi contraseña' })); await screen.findByRole('alert'); expect(fetcher).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Olvidé mi contraseña' })); await screen.findByText('Si el email está registrado, te enviamos instrucciones para recuperar el acceso.');
  expect(screen.getByRole('button', { name: /Reenviar en/ })).toBeDisabled(); expect(fetcher).toHaveBeenCalledTimes(2);
});
it('identity replacement aborts previous bootstrap and installs only the new session', async () => {
  let resolve: (value: Response) => void = () => {};
  fetcher.mockImplementationOnce(() => new Promise(done => { resolve = done; })); ready();
  mount(); act(() => observer(user)); await waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  const other = { ...user, uid: 'other' }; act(() => observer(other)); await screen.findByText('Sin perfil: falta completar el registro.');
  await act(async () => resolve(json({ id: 'previous', status: 'ACTIVE' })));
  expect(fetcher).toHaveBeenCalledTimes(3); expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
});
it('external signout during sign-in invalidates late completion', async () => {
  let resolve: (value: Identity) => void = () => {};
  vi.mocked(auth.signIn).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  mount(); login(); credentials(); fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
  act(() => observer(null)); await act(async () => resolve(user));
  expect(screen.getByRole('button', { name: 'Ingresar' })).toBeVisible(); expect(fetcher).not.toHaveBeenCalled();
});
it('registration failure belongs to signup and releases controls', async () => {
  vi.mocked(auth.signUp).mockRejectedValueOnce({ code: 'auth/email-already-in-use' });
  mount(); login(); credentials(); fireEvent.click(screen.getByRole('button', { name: '¿No tenés cuenta? Crear cuenta' })); fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Ya existe una cuenta'); expect(screen.getByRole('button', { name: 'Crear cuenta' })).toBeEnabled();
});
it('signout failure removes ready state and allows another signout attempt', async () => {
  ready(); vi.mocked(auth.signOut).mockRejectedValueOnce(new Error()).mockResolvedValue(undefined);
  mount(); act(() => observer(user)); await screen.findByText('Sin perfil: falta completar el registro.'); confirmSignOut();
  await screen.findByRole('alert'); confirmSignOut(); await screen.findByRole('button', { name: 'Ingresar' }); expect(auth.signOut).toHaveBeenCalledTimes(2);
});
it('StrictMode missing-user restoration provisions once even with repeated observer events', async () => {
  fetcher.mockResolvedValueOnce(json({ code: 'ACCESS_DENIED' }, 403)).mockResolvedValueOnce(json({ id: 'u', status: 'ACTIVE' })).mockResolvedValueOnce(json({ code: 'PROFILE_NOT_FOUND' }, 404));
  vi.mocked(auth.observe).mockImplementation(next => { observer = next; next(user); return vi.fn(); });
  mount(true); act(() => { observer(user); observer(user); });
  await screen.findByText('Sin perfil: falta completar el registro.'); expect(fetcher.mock.calls.filter(call => call[0] === '/api/me/provision')).toHaveLength(1);
});
it('blocks repeated Google attempts while popup is pending', async () => {
  vi.mocked(auth.google).mockImplementation(() => new Promise(() => {})); mount(); login();
  fireEvent.click(screen.getByRole('button', { name: 'Continuar con Google' })); fireEvent.click(screen.getByRole('button', { name: 'Conectando con Google...' }));
  expect(auth.google).toHaveBeenCalledOnce();
});
it('unmount aborts in-flight HTTP and late completion cannot start another request', async () => {
  let resolve: (value: Response) => void = () => {};
  fetcher.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const mounted = render(<App firebase={{ service: auth, localVerification: false }} api={new ApiClient(fetcher)} />);
  act(() => observer(user)); await waitFor(() => expect(fetcher).toHaveBeenCalledOnce()); mounted.unmount();
  expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  await act(async () => resolve(json({ id: 'u', status: 'ACTIVE' }))); expect(fetcher).toHaveBeenCalledOnce();
});

it.each([false, true])('passes checkbox preference through App/controller to both email operations (%s)', async keepSignedIn => {
  ready(); mount(); login(); credentials();
  expect(screen.getByRole('checkbox', { name: 'Mantener sesión iniciada' })).not.toBeChecked();
  if (keepSignedIn) fireEvent.click(screen.getByRole('checkbox'));
  vi.mocked(auth.signIn).mockRejectedValueOnce({ code: 'auth/invalid-credential' });
  fireEvent.click(screen.getByRole('button', { name: 'Ingresar' })); await screen.findByRole('alert');
  expect(auth.signIn).toHaveBeenCalledExactlyOnceWith('test@example.com', 'password', keepSignedIn);
  fireEvent.click(screen.getByRole('button', { name: '¿No tenés cuenta? Crear cuenta' }));
  fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
  await screen.findByText('Sin perfil: falta completar el registro.');
  expect(auth.signUp).toHaveBeenCalledExactlyOnceWith('test@example.com', 'password', keepSignedIn);
});
it('persistence failure uses safe authentication error and allows retry without bootstrap', async () => {
  vi.mocked(auth.signIn).mockRejectedValueOnce({ code: 'auth/persistence-unavailable', message: 'private diagnostic' });
  mount(); login(); credentials(); fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
  const error = await screen.findByRole('alert');
  expect(error).toHaveTextContent('No pudimos configurar la duración de la sesión');
  expect(error).not.toHaveTextContent('private diagnostic'); expect(fetcher).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Ingresar' })).toBeEnabled();
});
