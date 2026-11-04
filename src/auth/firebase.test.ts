import { beforeEach, expect, it, vi } from 'vitest';
const sdk = vi.hoisted(() => ({ initializeApp: vi.fn(() => ({})), initializeAuth: vi.fn(() => ({ currentUser: null })), onAuthStateChanged: vi.fn(), signInWithEmailAndPassword: vi.fn(), createUserWithEmailAndPassword: vi.fn(), signInWithPopup: vi.fn(), sendEmailVerification: vi.fn(), signOut: vi.fn() }));
vi.mock('firebase/app', () => ({ getApps: () => [], initializeApp: sdk.initializeApp }));
vi.mock('firebase/auth', () => ({ ...sdk, browserLocalPersistence: 'local', browserPopupRedirectResolver: 'popup', GoogleAuthProvider: class {} }));
import { configureFirebase } from './firebase';
const env = { DEV: true, MODE: 'test', PROD: false, BASE_URL: '/', SSR: false, VITE_FIREBASE_API_KEY: 'fake-key', VITE_FIREBASE_AUTH_DOMAIN: 'fake.firebaseapp.com', VITE_FIREBASE_PROJECT_ID: 'fake', VITE_FIREBASE_APP_ID: 'fake-app' };
beforeEach(() => vi.clearAllMocks());
it('initializes modular auth with SDK local persistence and popup resolver', () => {
  const setup = configureFirebase(env); expect('service' in setup).toBe(true);
  expect(sdk.initializeAuth).toHaveBeenCalledWith(expect.anything(), { persistence: 'local', popupRedirectResolver: 'popup' });
});
it('delegates email, registration, popup, observer and signout to SDK', async () => {
  const user = { uid: 'f' }; sdk.signInWithEmailAndPassword.mockResolvedValue({ user }); sdk.createUserWithEmailAndPassword.mockResolvedValue({ user }); sdk.signInWithPopup.mockResolvedValue({ user });
  const setup = configureFirebase(env); if (!('service' in setup)) throw new Error('configuration');
  expect(await setup.service.signIn('fake@example.com', 'fake')).toBe(user);
  expect(await setup.service.signUp('fake@example.com', 'fake')).toBe(user);
  const promise = setup.service.google(); expect(sdk.signInWithPopup).toHaveBeenCalledOnce(); expect(await promise).toBe(user);
  setup.service.observe(vi.fn(), vi.fn()); expect(sdk.onAuthStateChanged).toHaveBeenCalledOnce();
  await setup.service.signOut(); expect(sdk.signOut).toHaveBeenCalledOnce();
});
it('initialization failure becomes a safe configuration error', () => {
  sdk.initializeAuth.mockImplementationOnce(() => { throw new Error('private diagnostic'); });
  const setup = configureFirebase(env); expect(setup).toEqual({ error: expect.stringContaining('.env.local') }); expect(JSON.stringify(setup)).not.toContain('private diagnostic');
});
