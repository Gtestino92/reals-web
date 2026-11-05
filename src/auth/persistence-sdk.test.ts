import { afterEach, expect, it, vi } from 'vitest';
import { deleteApp, initializeApp } from 'firebase/app';
import { browserLocalPersistence, browserSessionPersistence, initializeAuth, signOut } from 'firebase/auth';

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
