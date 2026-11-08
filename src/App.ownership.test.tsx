import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  owners.splice(0).forEach(owner => owner.stop()); vi.unstubAllGlobals(); vi.unstubAllEnvs();
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
    if (operation === 'signUp') fireEvent.click(screen.getByRole('button', { name: /Crear cuenta/ }));
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
