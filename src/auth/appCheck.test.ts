import { afterEach, expect, it, vi } from 'vitest';
import { initializeApp } from 'firebase/app';
const sdk = vi.hoisted(() => ({ initializeAppCheck: vi.fn(() => ({})), getToken: vi.fn() }));
vi.mock('firebase/app-check', () => ({ ...sdk, ReCaptchaEnterpriseProvider: class { constructor(public key: string) {} }, ReCaptchaV3Provider: class { constructor(public key: string) {} } }));
import { appCheckTokens, localAppCheckDebugEnabled } from './appCheck';
import { ApiClient } from './api';
const base = { DEV: false, BASE_URL: '/', MODE: 'test', PROD: true, SSR: false };
const env = { ...base, VITE_FIREBASE_APP_CHECK_PROVIDER: 'enterprise', VITE_FIREBASE_APP_CHECK_SITE_KEY: 'synthetic-site-key' };
const app = () => initializeApp({ projectId: 'synthetic' }, crypto.randomUUID());
afterEach(() => { delete self.FIREBASE_APPCHECK_DEBUG_TOKEN; vi.unstubAllGlobals(); });
it.each([
  [true, false, 'true', 'localhost', true], [true, false, 'true', '127.0.0.1', true],
  [false, true, 'true', 'localhost', false], [true, true, 'true', 'localhost', false],
  [true, false, undefined, 'localhost', false], [true, false, 'false', 'localhost', false],
  [true, false, true, 'localhost', false], [true, false, 'true', 'localhost.example.com', false],
  [true, false, 'true', '192.168.1.5', false], [true, false, 'true', '[::1]', false],
  [true, false, 'true', 'reals.example.com', false],
])('debug gate DEV=%s PROD=%s flag=%s hostname=%s yields %s', (DEV, PROD, flag, hostname, expected) => {
  expect(localAppCheckDebugEnabled({ ...base, DEV, PROD, VITE_FIREBASE_APP_CHECK_DEBUG: flag }, hostname)).toBe(expected);
});
it.each(['localhost', '127.0.0.1'])('enables official debug mode before SDK initialization on %s, without a token string', async hostname => {
  vi.stubGlobal('self', { location: { hostname } });
  sdk.getToken.mockResolvedValue({ token: 'synthetic-attestation' });
  sdk.initializeAppCheck.mockImplementationOnce(() => { expect(self.FIREBASE_APPCHECK_DEBUG_TOKEN).toBe(true); return {}; });
  const a = app(), config = { ...env, DEV: true, PROD: false, VITE_FIREBASE_APP_CHECK_DEBUG: 'true' };
  await appCheckTokens(a, config)(); await appCheckTokens(a, config)();
  expect(sdk.initializeAppCheck).toHaveBeenCalledOnce();
  expect(self.FIREBASE_APPCHECK_DEBUG_TOKEN).toBe(true);
});
it.each([
  [false, true, 'localhost'], [true, false, 'example.com'], [true, false, '192.168.1.5'],
])('never enables debug for disallowed runtime DEV=%s PROD=%s host=%s', async (DEV, PROD, hostname) => {
  vi.stubGlobal('self', { location: { hostname } });
  sdk.getToken.mockResolvedValue({ token: 'synthetic-attestation' });
  await appCheckTokens(app(), { ...env, DEV, PROD, VITE_FIREBASE_APP_CHECK_DEBUG: 'true' })();
  expect(self.FIREBASE_APPCHECK_DEBUG_TOKEN).toBeUndefined();
});
it('initializes once per app and obtains valid tokens through the SDK', async () => {
  const a = app(); sdk.getToken.mockResolvedValue({ token: 'synthetic-attestation' });
  expect(await appCheckTokens(a, env)()).toBe('synthetic-attestation'); await appCheckTokens(a, env)();
  expect(sdk.initializeAppCheck).toHaveBeenCalledOnce(); expect(sdk.initializeAppCheck.mock.calls[0]).toEqual([a, expect.objectContaining({ isTokenAutoRefreshEnabled: true })]);
});
it.each([base, { ...env, VITE_FIREBASE_APP_CHECK_SITE_KEY: '' }, { ...env, VITE_FIREBASE_APP_CHECK_PROVIDER: 'debug' }])('fails closed for missing or unsupported configuration', async config => {
  await expect(appCheckTokens(app(), config)()).rejects.toMatchObject({ code: 'APP_CHECK_NOT_CONFIGURED' });
  expect(sdk.getToken).not.toHaveBeenCalled();
});
it.each([null, { token: '' }])('maps unavailable attestation to a safe error', async result => {
  sdk.getToken.mockResolvedValue(result); await expect(appCheckTokens(app(), env)()).rejects.toMatchObject({ code: 'APP_CHECK_VERIFICATION_UNAVAILABLE' });
});
it('sends App Check on ordinary and admin requests; grants only on admin paths, never caches or replays admin-auth', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{}'));
  const token = vi.fn().mockResolvedValue('synthetic-app-check'); const api = new ApiClient(fetcher).withAppCheck(token).withOwnership();
  const user = { uid: 'u', emailVerified: true, reload: async () => {}, getIdToken: vi.fn().mockResolvedValue('synthetic-id') };
  for (const path of ['/me', '/admin-auth/status', '/admin/photos']) {
    await api.request(path, new AbortController().signal, user, 'GET', undefined, undefined, true, 'synthetic-grant');
    const options = fetcher.mock.calls.at(-1)![1];
    expect(new Headers(options?.headers).get('X-Firebase-AppCheck')).toBe('synthetic-app-check');
    expect(new Headers(options?.headers).get('X-Reals-Admin-Grant')).toBe(path === '/me' ? null : 'synthetic-grant');
    if (path !== '/me') expect(options).toMatchObject({ cache: 'no-store', redirect: 'error' });
  }
  fetcher.mockResolvedValue(new Response('{"code":"INVALID_TOKEN"}', { status: 401 }));
  await expect(api.request('/admin-auth/verify', new AbortController().signal, user, 'POST', { code: '012345' })).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  expect(fetcher).toHaveBeenCalledTimes(4);
});
it('never sends a request if App Check fails or its pending token loses ownership', async () => {
  const fetcher = vi.fn<typeof fetch>(); const tokens = vi.fn().mockRejectedValue(new Error('attestation failed'));
  const api = new ApiClient(fetcher).withAppCheck(tokens);
  await expect(api.request('/admin-auth/status', new AbortController().signal)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
  const abort = new AbortController(); tokens.mockImplementation(async () => { abort.abort(); return 'late'; });
  await expect(api.request('/admin-auth/status', abort.signal)).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled();
});
it('aborts immediately while the SDK token promise is still pending', async () => {
  const fetcher = vi.fn<typeof fetch>(); const abort = new AbortController();
  let finish!: (value: string) => void;
  const api = new ApiClient(fetcher).withAppCheck(() => new Promise(resolve => { finish = resolve; }));
  const pending = api.request('/admin-auth/status', abort.signal);
  const rejected = expect(pending).rejects.toThrow(); abort.abort(); await rejected;
  finish('obsolete-token'); await Promise.resolve(); expect(fetcher).not.toHaveBeenCalled();
});
