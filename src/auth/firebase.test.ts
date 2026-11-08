import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Identity } from './firebase';
const sdk = vi.hoisted(() => ({
  auth: { currentUser: null as Identity | null },
  initializeApp: vi.fn(() => ({})), initializeAuth: vi.fn(), onAuthStateChanged: vi.fn(),
  setPersistence: vi.fn<(_auth: unknown, persistence: string) => Promise<void>>(), signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(), signInWithPopup: vi.fn(), sendEmailVerification: vi.fn(), signOut: vi.fn(),
  reauthenticateWithCredential: vi.fn(), updatePassword: vi.fn(), EmailAuthProvider: { credential: vi.fn() },
}));
vi.mock('firebase/app', () => ({ getApps: () => [], initializeApp: sdk.initializeApp }));
vi.mock('firebase/auth', () => ({ ...sdk, browserLocalPersistence: 'local', browserSessionPersistence: 'session', browserPopupRedirectResolver: 'popup', GoogleAuthProvider: class {} }));
import { configureFirebase } from './firebase';
const env = { DEV: true, MODE: 'test', PROD: false, BASE_URL: '/', SSR: false, VITE_FIREBASE_API_KEY: 'fake-key', VITE_FIREBASE_AUTH_DOMAIN: 'fake.firebaseapp.com', VITE_FIREBASE_PROJECT_ID: 'fake', VITE_FIREBASE_APP_ID: 'fake-app' };
const user: Identity = { uid: 'f', emailVerified: false, getIdToken: vi.fn(), reload: vi.fn() };
let observer: (user: Identity | null) => void;
const next = vi.fn();
const failure = vi.fn();
const unsubscribe = vi.fn();
function service() {
  const setup = configureFirebase(env);
  if (!('service' in setup)) throw new Error('configuration');
  return setup.service;
}
const flush = async () => { await new Promise<void>(resolve => queueMicrotask(resolve)); await Promise.resolve(); };
it('uses correctly encoded Spanish when the password access method is unavailable', async () => {
  await expect(service().changePassword!(user, 'current-secret', 'next-secret')).rejects.toThrow('Método de acceso no disponible.');
  expect(sdk.reauthenticateWithCredential).not.toHaveBeenCalled();
});
it('reauthenticates before updating password and refreshes the token', async () => {
  const identity = { ...user, email: 'fixture@example.com', providerData: [{ providerId: 'password', uid: 'f', displayName: null, email: null, phoneNumber: null, photoURL: null }] };
  sdk.auth.currentUser = identity;
  sdk.EmailAuthProvider.credential.mockReturnValue({ providerId: 'password' });
  await service().changePassword!(identity, 'current-secret', 'next-secret');
  expect(sdk.reauthenticateWithCredential).toHaveBeenCalledExactlyOnceWith(identity, { providerId: 'password' });
  expect(sdk.updatePassword).toHaveBeenCalledExactlyOnceWith(identity, 'next-secret');
  expect(user.getIdToken).toHaveBeenCalledWith(true);
});
it.each(['failure', 'identity-switch'])('never updates password after reauthentication %s', async scenario => {
  const identity = { ...user, email: 'fixture@example.com', providerData: [{ providerId: 'password', uid: 'f', displayName: null, email: null, phoneNumber: null, photoURL: null }] };
  sdk.auth.currentUser = identity;
  if (scenario === 'failure') sdk.reauthenticateWithCredential.mockRejectedValueOnce(new Error('credential rejected'));
  else sdk.reauthenticateWithCredential.mockImplementationOnce(async () => { sdk.auth.currentUser = { ...user, uid: 'different' }; });
  await expect(service().changePassword!(identity, 'current-secret', 'next-secret')).rejects.toThrow();
  expect(sdk.updatePassword).not.toHaveBeenCalled();
});
beforeEach(() => {
  vi.resetAllMocks(); sdk.auth.currentUser = null;
  sdk.initializeAuth.mockReturnValue(sdk.auth);
  sdk.setPersistence.mockResolvedValue(undefined);
  sdk.onAuthStateChanged.mockImplementation((_auth, callback) => { observer = callback; return unsubscribe; });
  for (const method of [sdk.signInWithEmailAndPassword, sdk.createUserWithEmailAndPassword, sdk.signInWithPopup]) method.mockResolvedValue({ user });
});
afterEach(() => vi.restoreAllMocks());
it('initializes with session first and local restoration support, without changing existing persistence', () => {
  service();
  expect(sdk.initializeAuth).toHaveBeenCalledWith(expect.anything(), { persistence: ['session', 'local'], popupRedirectResolver: 'popup' });
  expect(sdk.setPersistence).not.toHaveBeenCalled();
});
it.each([false, true])('awaits selected persistence before email sign-in and signup (keepSignedIn=%s)', async keepSignedIn => {
  const auth = service();
  for (const [operation, sdkOperation] of [[auth.signIn, sdk.signInWithEmailAndPassword], [auth.signUp, sdk.createUserWithEmailAndPassword]] as const) {
    let resolve!: () => void;
    sdk.setPersistence.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
    const pending = operation('fake@example.com', 'fake-password', keepSignedIn);
    expect(sdk.setPersistence).toHaveBeenLastCalledWith(sdk.auth, keepSignedIn ? 'local' : 'session');
    expect(sdkOperation).not.toHaveBeenCalled();
    resolve(); expect(await pending).toBe(user);
    expect(sdkOperation).toHaveBeenCalledExactlyOnceWith(sdk.auth, 'fake@example.com', 'fake-password');
  }
});
it.each(['signIn', 'signUp'] as const)('persistence failure prevents %s with no local fallback', async operation => {
  const auth = service(); sdk.setPersistence.mockRejectedValueOnce(new Error('private diagnostic'));
  await expect(auth[operation]('fake@example.com', 'fake-password', false)).rejects.toMatchObject({ code: 'auth/persistence-unavailable' });
  expect(sdk.signInWithEmailAndPassword).not.toHaveBeenCalled(); expect(sdk.createUserWithEmailAndPassword).not.toHaveBeenCalled();
  expect(sdk.setPersistence.mock.calls.every(call => call[1] === 'session')).toBe(true);
});
it('prepares anonymous session before publishing login and opens Google synchronously without new awaits', async () => {
  const auth = service(); auth.observe(next, failure);
  let resolve!: () => void;
  sdk.setPersistence.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
  observer(null); expect(next).not.toHaveBeenCalled();
  resolve(); await flush(); expect(next).toHaveBeenCalledExactlyOnceWith(null);
  const calls = sdk.setPersistence.mock.calls.length;
  const pending = auth.google();
  expect(sdk.signInWithPopup).toHaveBeenCalledOnce();
  expect(sdk.setPersistence).toHaveBeenCalledTimes(calls);
  expect(await pending).toBe(user);
});
it('fails closed when anonymous persistence preparation fails, including Google', async () => {
  const auth = service(); auth.observe(next, failure);
  sdk.setPersistence.mockRejectedValueOnce(new Error('private diagnostic'));
  observer(null); await flush();
  expect(next).not.toHaveBeenCalled(); expect(failure).toHaveBeenCalledWith(expect.objectContaining({ code: 'auth/persistence-unavailable' }));
  await expect(auth.google()).rejects.toMatchObject({ code: 'auth/persistence-unavailable' });
  expect(sdk.signInWithPopup).not.toHaveBeenCalled();
});
it.each(['signIn', 'signUp'] as const)('resets failed %s local persistence before a subsequent session-only Google click', async operation => {
  const auth = service(); auth.observe(next, failure); observer(null); await flush();
  const sdkOperation = operation === 'signIn' ? sdk.signInWithEmailAndPassword : sdk.createUserWithEmailAndPassword;
  sdkOperation.mockRejectedValueOnce({ code: 'auth/invalid-credential' });
  await expect(auth[operation]('fake@example.com', 'fake-password', true)).rejects.toMatchObject({ code: 'auth/invalid-credential' });
  expect(sdk.setPersistence.mock.calls.slice(-2).map(call => call[1])).toEqual(['local', 'session']);
  const pending = auth.google(); expect(sdk.signInWithPopup).toHaveBeenCalledOnce(); await pending;
});
it('blocks Google if restoring session persistence after a failed local login also fails', async () => {
  const auth = service();
  sdk.signInWithEmailAndPassword.mockRejectedValueOnce({ code: 'auth/invalid-credential' });
  sdk.setPersistence.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(auth.signIn('fake@example.com', 'fake-password', true)).rejects.toMatchObject({ code: 'auth/persistence-unavailable' });
  await expect(auth.google()).rejects.toMatchObject({ code: 'auth/persistence-unavailable' });
  expect(sdk.signInWithPopup).not.toHaveBeenCalled();
});
it('restores authenticated observers without setPersistence or credential authentication', () => {
  const auth = service(); auth.observe(next, failure); sdk.auth.currentUser = user; observer(user);
  expect(next).toHaveBeenCalledExactlyOnceWith(user); expect(sdk.setPersistence).not.toHaveBeenCalled();
  expect(sdk.signInWithEmailAndPassword).not.toHaveBeenCalled(); expect(sdk.signInWithPopup).not.toHaveBeenCalled();
});
it('drops obsolete anonymous preparation on another-tab identity replacement and unsubscription', async () => {
  const auth = service(); const stop = auth.observe(next, failure);
  let resolve!: () => void;
  sdk.setPersistence.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
  observer(null); sdk.auth.currentUser = user; observer(user); resolve(); await flush();
  expect(next).toHaveBeenCalledExactlyOnceWith(user);
  await expect(auth.google()).rejects.toMatchObject({ code: 'auth/persistence-unavailable' });
  sdk.auth.currentUser = null;
  observer(null); stop(); await flush();
  expect(next).toHaveBeenCalledTimes(1); expect(unsubscribe).toHaveBeenCalledOnce();
});
it('does not start stale credential work after unmount while persistence is pending', async () => {
  const auth = service(); const stop = auth.observe(next, failure);
  let resolve!: () => void;
  sdk.setPersistence.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
  const pending = auth.signIn('fake@example.com', 'fake-password', false); stop(); resolve();
  await expect(pending).rejects.toMatchObject({ code: 'auth/persistence-unavailable' });
  expect(sdk.signInWithEmailAndPassword).not.toHaveBeenCalled();
});
it('delegates sign-out and prepares anonymous session on SDK signout notification', async () => {
  const auth = service(); auth.observe(next, failure); sdk.auth.currentUser = user; observer(user);
  await auth.signOut(); expect(sdk.signOut).toHaveBeenCalledExactlyOnceWith(sdk.auth);
  sdk.auth.currentUser = null; observer(null); await flush(); expect(next).toHaveBeenLastCalledWith(null);
  expect(sdk.setPersistence).toHaveBeenLastCalledWith(sdk.auth, 'session');
});
it('application auth never writes credentials or tokens to custom browser storage', async () => {
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  const auth = service(); auth.observe(next, failure); observer(null); await flush();
  await auth.google();
  await auth.signIn('fake@example.com', 'fake-password', false);
  await auth.signUp('fake@example.com', 'fake-password', true);
  await auth.signOut();
  expect(storage).not.toHaveBeenCalled();
});
it('waits for session preparation on signout before permitting another Google click', async () => {
  const auth = service(); sdk.auth.currentUser = user;
  sdk.signOut.mockImplementationOnce(async () => { sdk.auth.currentUser = null; });
  let resolve!: () => void;
  sdk.setPersistence.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
  const pending = auth.signOut(); await flush();
  await expect(auth.google()).rejects.toMatchObject({ code: 'auth/persistence-unavailable' });
  expect(sdk.signInWithPopup).not.toHaveBeenCalled();
  resolve(); await pending;
  const popup = auth.google(); expect(sdk.signInWithPopup).toHaveBeenCalledOnce(); await popup;
});
it('reports signout persistence preparation failure and blocks Google', async () => {
  const auth = service(); sdk.setPersistence.mockRejectedValueOnce(new Error('private diagnostic'));
  await expect(auth.signOut()).rejects.toMatchObject({ code: 'auth/persistence-unavailable' });
  await expect(auth.google()).rejects.toMatchObject({ code: 'auth/persistence-unavailable' });
  expect(sdk.signInWithPopup).not.toHaveBeenCalled();
});
it('initialization failure becomes a safe configuration error', () => {
  sdk.initializeAuth.mockImplementationOnce(() => { throw new Error('private diagnostic'); });
  const setup = configureFirebase(env); expect(setup).toEqual({ error: expect.stringContaining('.env.local') }); expect(JSON.stringify(setup)).not.toContain('private diagnostic');
});
