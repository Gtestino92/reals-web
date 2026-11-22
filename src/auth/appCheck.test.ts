import { afterEach, expect, it, vi } from 'vitest';
import { initializeApp } from 'firebase/app';
import { ReCaptchaEnterpriseProvider, ReCaptchaV3Provider } from 'firebase/app-check';
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
  await appCheckTokens(a, config)('ordinary'); await appCheckTokens(a, config)('administrative');
  expect(sdk.initializeAppCheck).toHaveBeenCalledOnce();
  expect(self.FIREBASE_APPCHECK_DEBUG_TOKEN).toBe(true);
});
it.each([
  ['dev', false, true, 'localhost'], ['prod', false, true, 'localhost'],
  ['dev', true, false, 'localhost'], ['prod', true, false, '127.0.0.1'],
  ['local', false, true, 'localhost'], ['local', true, false, 'example.com'],
  ['local', true, false, '192.168.1.5'],
])('uses Enterprise with debug disabled for %s (DEV=%s PROD=%s host=%s)', async (VITE_REALS_ENVIRONMENT, DEV, PROD, hostname) => {
  vi.stubGlobal('self', { location: { hostname }, FIREBASE_APPCHECK_DEBUG_TOKEN: 'synthetic-debug' });
  sdk.getToken.mockResolvedValue({ token: 'synthetic-attestation' });
  sdk.initializeAppCheck.mockImplementationOnce(() => { expect(self.FIREBASE_APPCHECK_DEBUG_TOKEN).toBe(false); return {}; });
  await appCheckTokens(app(), { ...env, DEV, PROD, VITE_REALS_ENVIRONMENT, VITE_FIREBASE_APP_CHECK_DEBUG: 'true' })();
  expect(sdk.initializeAppCheck).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.objectContaining({
    provider: expect.any(ReCaptchaEnterpriseProvider),
  }));
});
it.each(['dev', 'prod'])('rejects v3 under %s even on the Vite server', async VITE_REALS_ENVIRONMENT => {
  await expect(appCheckTokens(app(), { ...env, DEV: true, PROD: false, VITE_REALS_ENVIRONMENT, VITE_FIREBASE_APP_CHECK_PROVIDER: 'v3' })())
    .rejects.toMatchObject({ code: 'APP_CHECK_NOT_CONFIGURED' });
  expect(sdk.initializeAppCheck).not.toHaveBeenCalled();
});
it('retains local v3 support', async () => {
  sdk.getToken.mockResolvedValue({ token: 'synthetic-attestation' });
  await expect(appCheckTokens(app(), { ...env, DEV: true, PROD: false, VITE_REALS_ENVIRONMENT: 'local', VITE_FIREBASE_APP_CHECK_PROVIDER: 'v3' })())
    .resolves.toBe('synthetic-attestation');
  expect(sdk.initializeAppCheck).toHaveBeenCalledExactlyOnceWith(expect.anything(), expect.objectContaining({
    provider: expect.any(ReCaptchaV3Provider),
  }));
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
it.each([
  ['localhost', undefined], ['localhost', 'false'],
  ['127.0.0.1', undefined], ['127.0.0.1', 'false'],
])('sends ordinary requests on %s with debug=%s and without App Check setup', async (hostname, debug) => {
  vi.stubGlobal('self', { location: { hostname } });
  const config = { ...base, DEV: true, PROD: false, VITE_REALS_ENVIRONMENT: 'local', VITE_FIREBASE_APP_CHECK_DEBUG: debug };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{}'));
  const api = new ApiClient(fetcher).withAppCheck(appCheckTokens(app(), config)).withOwnership();
  const user = { uid: 'u', emailVerified: true, reload: async () => {}, getIdToken: vi.fn().mockResolvedValue('synthetic-id') };
  const signal = new AbortController().signal;
  await api.request('/me', signal, user);
  await api.request('/auth/password-reset', signal, undefined, 'POST', {});
  expect(fetcher.mock.calls.map(([, options]) => new Headers(options?.headers).get('X-Firebase-AppCheck'))).toEqual([null, null]);
  expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('Authorization')).toBe('Bearer synthetic-id');
  expect(user.getIdToken).toHaveBeenCalledExactlyOnceWith(false);
  for (const path of ['/admin-auth/status', '/admin-auth/verify', '/admin/photos']) {
    await expect(api.request(path, signal, user)).rejects.toMatchObject({ code: 'APP_CHECK_NOT_CONFIGURED' });
  }
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(sdk.initializeAppCheck).not.toHaveBeenCalled();
  expect(sdk.getToken).not.toHaveBeenCalled();
});

it.each(['false', 'true'])('still attests protected local requests with debug=%s', async debug => {
  vi.stubGlobal('self', { location: { hostname: 'localhost' } });
  sdk.getToken.mockResolvedValue({ token: 'synthetic-attestation' });
  const config = { ...env, DEV: true, PROD: false, VITE_REALS_ENVIRONMENT: 'local', VITE_FIREBASE_APP_CHECK_DEBUG: debug };
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{}'));
  const api = new ApiClient(fetcher).withAppCheck(appCheckTokens(app(), config));
  const signal = new AbortController().signal;
  await api.request('/me', signal);
  expect(sdk.initializeAppCheck).toHaveBeenCalledTimes(debug === 'true' ? 1 : 0);
  await api.request('/admin/photos', signal, undefined, 'GET', undefined, undefined, false, 'synthetic-grant');
  const headers = new Headers(fetcher.mock.calls[1]?.[1]?.headers);
  expect(headers.get('X-Firebase-AppCheck')).toBe('synthetic-attestation');
  expect(headers.get('X-Reals-Admin-Grant')).toBe('synthetic-grant');
  expect(sdk.initializeAppCheck).toHaveBeenCalledOnce();
  expect(self.FIREBASE_APPCHECK_DEBUG_TOKEN).toBe(debug === 'true' ? true : undefined);
  sdk.getToken.mockRejectedValueOnce(new Error('attestation unavailable'));
  await expect(api.request('/admin-auth/status', signal)).rejects.toMatchObject({ code: 'APP_CHECK_VERIFICATION_UNAVAILABLE' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each([
  ['local', true, false, 'example.com', 'false'],
  ['local', true, false, '[::1]', undefined],
  ['local', true, false, 'localhost', 'invalid'],
  ['dev', true, false, 'localhost', undefined],
  ['prod', true, false, '127.0.0.1', 'false'],
  ['dev', false, true, '127.0.0.1', 'false'],
  ['prod', false, true, 'localhost', undefined],
])('requires ordinary attestation in %s (DEV=%s PROD=%s host=%s debug=%s)', async (name, DEV, PROD, hostname, debug) => {
  vi.stubGlobal('self', { location: { hostname } });
  const config = { ...base, DEV, PROD, VITE_REALS_ENVIRONMENT: name, VITE_FIREBASE_APP_CHECK_DEBUG: debug };
  const fetcher = vi.fn<typeof fetch>();
  const signal = new AbortController().signal;
  const api = new ApiClient(fetcher);
  await expect(api.withAppCheck(appCheckTokens(app(), config)).request('/me', signal)).rejects.toMatchObject({ code: 'APP_CHECK_NOT_CONFIGURED' });
  expect(sdk.initializeAppCheck).not.toHaveBeenCalled();
  const configured = api.withAppCheck(appCheckTokens(app(), { ...env, ...config }));
  fetcher.mockResolvedValueOnce(new Response('{}'));
  sdk.getToken.mockResolvedValueOnce({ token: 'synthetic-attestation' });
  await configured.request('/me', signal);
  expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('X-Firebase-AppCheck')).toBe('synthetic-attestation');
  sdk.getToken.mockRejectedValueOnce(new Error('attestation unavailable'));
  await expect(configured.request('/me', signal)).rejects.toMatchObject({ code: 'APP_CHECK_VERIFICATION_UNAVAILABLE' });
  expect(fetcher).toHaveBeenCalledOnce();
});

it('rejects a missing attestation from a configured provider on administrative paths', async () => {
  const fetcher = vi.fn<typeof fetch>();
  const token = vi.fn().mockResolvedValue(null);
  const api = new ApiClient(fetcher).withAppCheck(token);
  await expect(api.request('/admin-auth/status', new AbortController().signal)).rejects.toMatchObject({ code: 'APP_CHECK_VERIFICATION_UNAVAILABLE' });
  expect(token).toHaveBeenCalledExactlyOnceWith('administrative');
  expect(fetcher).not.toHaveBeenCalled();
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
