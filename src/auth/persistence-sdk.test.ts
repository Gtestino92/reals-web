import { configureFirebase } from './firebase';
import { afterEach, expect, it, vi } from 'vitest';
import { deleteApp, getApp, initializeApp } from 'firebase/app';
import { browserLocalPersistence, browserSessionPersistence, getAuth, initializeAuth, signOut } from 'firebase/auth';

// Exercise installed Firebase storage selection, rather than reimplementing it
// in a fake. All user/token values are synthetic; no live Firebase requests.
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); sessionStorage.clear(); });
it.each([
  ['local', false], ['session', false], ['local', true],
] as const)('restores %s without migration; clears on signout (external tab event=%s)', async (mode, externalTab) => {
  const app = initializeApp({ apiKey: 'fake-key', projectId: 'fake' }, `restore-${mode}`);
  const key = `firebase:authUser:fake-key:${app.name}`;
  const selected = mode === 'local' ? localStorage : sessionStorage;
  const other = mode === 'local' ? sessionStorage : localStorage;
  selected.setItem(key, JSON.stringify({
    uid: 'synthetic-user', emailVerified: false, isAnonymous: false,
    providerData: [], apiKey: 'fake-key', appName: app.name,
    stsTokenManager: { refreshToken: 'synthetic-refresh', accessToken: 'synthetic-access', expirationTime: Date.now() + 3600000 },
  }));
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
    users: [{ localId: 'synthetic-user', emailVerified: false, providerUserInfo: [] }],
  }), { status: 200 }));
  vi.stubGlobal('fetch', fetcher);
  try {
    const auth = initializeAuth(app, { persistence: [browserSessionPersistence, browserLocalPersistence] });
    await auth.authStateReady();
    expect(auth.currentUser?.uid).toBe('synthetic-user');
    expect(selected.getItem(key)).not.toBeNull(); expect(other.getItem(key)).toBeNull();
    if (externalTab) {
      const oldValue = localStorage.getItem(key);
      localStorage.removeItem(key);
      window.dispatchEvent(new StorageEvent('storage', { key, oldValue, newValue: null, storageArea: localStorage }));
      await vi.waitFor(() => expect(auth.currentUser).toBeNull());
    } else {
      await signOut(auth);
      expect(auth.currentUser).toBeNull();
    }
    expect(selected.getItem(key)).toBeNull(); expect(other.getItem(key)).toBeNull();
  } finally { await deleteApp(app); }
});

it('recreates service wrappers without reinitializing Auth or migrating a restored session', async () => {
  const app = initializeApp({ apiKey: 'fake-key', projectId: 'fake' });
  const key = `firebase:authUser:fake-key:${app.name}`;
  sessionStorage.setItem(key, JSON.stringify({
    uid: 'synthetic-user', emailVerified: false, isAnonymous: false, providerData: [], apiKey: 'fake-key', appName: app.name,
    stsTokenManager: { refreshToken: 'synthetic-refresh', accessToken: 'synthetic-access', expirationTime: Date.now() + 3600000 },
  }));
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
    users: [{ localId: 'synthetic-user', emailVerified: false, providerUserInfo: [] }],
  }), { status: 200 })));
  const env = { DEV: true, MODE: 'test', PROD: false, BASE_URL: '/', SSR: false, VITE_FIREBASE_API_KEY: 'fake-key', VITE_FIREBASE_AUTH_DOMAIN: 'fake.firebaseapp.com', VITE_FIREBASE_PROJECT_ID: 'fake', VITE_FIREBASE_APP_ID: 'fake-app' };
  try {
    const first = configureFirebase(env); if (!('service' in first)) throw Error('configuration');
    const auth = getAuth(); await auth.authStateReady(); const identity = auth.currentUser;
    expect(identity?.uid).toBe('synthetic-user');
    const observed = vi.fn(); const stop = first.service.observe(observed, vi.fn());
    await vi.waitFor(() => expect(observed).toHaveBeenCalledWith(identity)); stop();
    const second = configureFirebase(env); if (!('service' in second)) throw Error('configuration');
    expect(second.service).not.toBe(first.service); expect(getApp()).toBe(app); expect(getAuth()).toBe(auth); expect(auth.currentUser).toBe(identity);
    const restored = vi.fn(); const stopRestored = second.service.observe(restored, vi.fn());
    try { await vi.waitFor(() => expect(restored).toHaveBeenCalledWith(identity)); }
    finally { stopRestored(); }
    expect(sessionStorage.getItem(key)).not.toBeNull(); expect(localStorage.getItem(key)).toBeNull();
  } finally { await deleteApp(app); }
});
