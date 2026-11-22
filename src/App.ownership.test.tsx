import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TabOwnershipManager } from './tabs/TabOwnershipManager';
const sdk = vi.hoisted(() => ({
  app: {}, apps: [] as object[], auth: { currentUser: null },
  initializeApp: vi.fn(), initializeAuth: vi.fn(), onAuthStateChanged: vi.fn(),
  setPersistence: vi.fn(), signInWithEmailAndPassword: vi.fn(), createUserWithEmailAndPassword: vi.fn(), signInWithPopup: vi.fn(),
}));
vi.mock('firebase/app', () => ({ getApps: () => sdk.apps, initializeApp: sdk.initializeApp }));
vi.mock('firebase/auth', () => ({
  ...sdk, browserSessionPersistence: 'session', browserLocalPersistence: 'local', browserPopupRedirectResolver: 'popup', GoogleAuthProvider: class {},
  sendEmailVerification: vi.fn(), signOut: vi.fn(), EmailAuthProvider: { credential: vi.fn() }, reauthenticateWithCredential: vi.fn(), updatePassword: vi.fn(),
}));
import { App } from './App';
import { ApiClient } from './auth/api';
import type { AuthService, Identity } from './auth/firebase';
import { emptyHome } from './home/fixtures';
import { loadPreferences, storageKey } from './notifications/activityStorage';
const owners: TabOwnershipManager[] = [];
const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
function mount() {
  const ownership = new TabOwnershipManager(); owners.push(ownership);
  return { ownership, view: render(<StrictMode><App ownership={ownership} /></StrictMode>) };
}
beforeEach(() => {
  vi.clearAllMocks(); sdk.apps = [];
  sdk.initializeApp.mockImplementation(() => { sdk.apps.push(sdk.app); return sdk.app; });
  sdk.initializeAuth.mockReturnValue(sdk.auth);
  sdk.onAuthStateChanged.mockImplementation((_auth, next: (user: null) => void) => {
    let active = true; queueMicrotask(() => { if (active) next(null); }); return () => { active = false; };
  });
  sdk.setPersistence.mockResolvedValue(undefined);
  for (const op of [sdk.signInWithEmailAndPassword, sdk.createUserWithEmailAndPassword, sdk.signInWithPopup]) op.mockImplementation(() => new Promise(() => {}));
  for (const name of ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID']) vi.stubEnv(name, 'synthetic-fixture');
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('BroadcastChannel', class { postMessage() {} close() {} });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: (_name: string, options: LockOptions, callback: () => Promise<void>) => Promise.resolve().then(() => { options.signal?.throwIfAborted(); return callback(); }) } });
});
afterEach(() => {
  owners.splice(0).forEach(owner => owner.stop()); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers();
  if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks);
  else Reflect.deleteProperty(navigator, 'locks');
});
it.each(['google', 'signIn', 'signUp'] as const)('remount binds %s to the new manager while retaining the Firebase singleton and persistence policy', async operation => {
  const first = mount(); await screen.findByRole('button', { name: 'Ingresar' });
  first.view.unmount(); expect(first.ownership.signal.aborted).toBe(true);
  const second = mount(); await screen.findByRole('button', { name: 'Ingresar' });
  expect(second.ownership).not.toBe(first.ownership); expect(second.ownership.getSnapshot()).toBe('active');
  expect(sdk.initializeApp).toHaveBeenCalledOnce();
  expect(sdk.initializeAuth.mock.calls.every(([app]) => app === sdk.app)).toBe(true);
  expect(sdk.initializeAuth).toHaveBeenCalledWith(sdk.app, { persistence: ['session', 'local'], popupRedirectResolver: 'popup' });
  const persistenceCalls = sdk.setPersistence.mock.calls.length;
  if (operation === 'google') {
    fireEvent.click(screen.getByRole('button', { name: 'Continuar con Google' }));
    // Popup must open in the click stack, without awaiting persistence again.
    expect(sdk.signInWithPopup).toHaveBeenCalledOnce(); expect(sdk.setPersistence).toHaveBeenCalledTimes(persistenceCalls);
  } else {
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'fixture@example.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'synthetic' } });
    if (operation === 'signUp') fireEvent.click(screen.getByRole('radio', { name: 'Crear cuenta' }));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: operation === 'signUp' ? 'Crear cuenta' : 'Ingresar' }));
    await waitFor(() => expect(operation === 'signIn' ? sdk.signInWithEmailAndPassword : sdk.createUserWithEmailAndPassword).toHaveBeenCalledOnce());
    expect(sdk.setPersistence).toHaveBeenLastCalledWith(sdk.auth, 'local');
  }
  second.view.unmount();
});

it('loopback Vite development renders two operational logins without browser lock APIs', async () => {
  vi.stubEnv('DEV', true); vi.stubEnv('VITE_ENFORCE_TAB_OWNERSHIP', 'false');
  vi.stubGlobal('isSecureContext', false); Reflect.deleteProperty(navigator, 'locks');
  render(<><App /><App /></>);
  await waitFor(() => expect(screen.getAllByRole('button', { name: 'Ingresar' })).toHaveLength(2));
  expect(screen.queryByRole('button', { name: 'Usar Reals acá' })).toBeNull();
});
it('local opt-in fails closed when required ownership APIs are unavailable', async () => {
  vi.stubEnv('DEV', true); vi.stubEnv('VITE_ENFORCE_TAB_OWNERSHIP', 'true');
  vi.stubGlobal('isSecureContext', false);
  render(<App />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Web Locks'); expect(sdk.onAuthStateChanged).not.toHaveBeenCalled();
});

it('retires pending activity reads on ownership transfer and isolates the next authenticated account', async () => {
  document.title = 'Original';
  const ownership = new TabOwnershipManager(); owners.push(ownership);
  let grant = '', release = () => {};
  vi.stubGlobal('BroadcastChannel', class {
    onmessage?: (event: MessageEvent) => void;
    postMessage(message: { type: string; grant?: string }) {
      if (message.type === 'owner' && message.grant) {
        grant = message.grant;
        release = () => this.onmessage?.(new MessageEvent('message', { data: { type: 'release', grant } }));
      }
    }
    close() {}
  });
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  let account = 'owner-a', version = 0, hold = false;
  let complete: ((value: Response) => void) | undefined;
  const request = vi.fn<typeof fetch>().mockImplementation(async path => {
    const serverTime = new Date().toISOString();
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
    switch (path) {
      case '/api/me': return json({ id: account, status: 'ACTIVE' });
      case '/api/me/profile': return json({ id: `profile-${account}`, userId: account, displayName: account, status: 'ACTIVE' });
      case '/api/me/home/status': return json({ version, dirty: false, nextRefreshAt: null, serverTime });
      case '/api/me/home': return json(emptyHome());
      case '/api/me/home/pending':
        return hold ? new Promise<Response>(resolve => { complete = resolve; }) :
          json({ version, serverTime, pendingActions: [{ type: 'VISUAL_REVIEW', matchId: 'a' }], nextSteps: [], passiveNotices: [] });
      case '/api/reference/affinity-questions': return json({ catalogVersion: 'empty', categories: [], questions: [] });
      case '/api/me/profile/affinity-answers': return json({ answers: [] });
      default: throw new Error('Unexpected endpoint');
    }
  });
  const identity = (): Identity => ({ uid: account, emailVerified: true, getIdToken: vi.fn().mockResolvedValue('test'), reload: vi.fn() });
  const auth: AuthService = { observe: vi.fn(next => { next(identity()); return vi.fn(); }), signIn: vi.fn(),
    signUp: vi.fn(), google: vi.fn(), verify: vi.fn(), signOut: vi.fn() };
  const view = render(<App ownership={ownership} firebase={{ service: auth, localVerification: false }} api={new ApiClient(request)}/>);
  try {
    await screen.findByText('Hola, owner-a');
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    visibility.mockReturnValue('hidden'); version++;
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(30_000); });
    expect(document.title).toBe('(1) Reals');
    hold = true; version++;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    const signal = request.mock.calls.filter(([path]) => path === '/api/me/home/pending').at(-1)?.[1]?.signal;
    expect(complete).toBeDefined();
    expect(signal?.aborted).toBe(false);
    act(release);
    expect(signal?.aborted).toBe(true);
    expect(document.title).toBe('Original');
    expect(screen.getByRole('button', { name: 'Usar Reals acá' })).toBeVisible();
    const count = request.mock.calls.length;
    await act(async () => {
      complete?.(new Response(JSON.stringify({ version, serverTime: new Date().toISOString(), pendingActions: [], nextSteps: [], passiveNotices: [] })));
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(request.mock.calls).toHaveLength(count);
    expect(loadPreferences('owner-a').records).toEqual([['["VISUAL_REVIEW","a"]', false]]);
    vi.useRealTimers();
    account = 'owner-b'; visibility.mockReturnValue('visible');
    fireEvent.click(screen.getByRole('button', { name: 'Usar Reals acá' }));
    expect(await screen.findByText('Hola, owner-b')).toBeVisible();
    expect(document.title).toBe('Reals');
    expect(loadPreferences('owner-b').records).toEqual([]);
  } finally {
    view.unmount();
    localStorage.removeItem(storageKey('owner-a')); localStorage.removeItem(storageKey('owner-b'));
  }
});
