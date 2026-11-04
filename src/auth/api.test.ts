import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError, bootstrap } from './api';
import type { Identity } from './firebase';
const account = { id: 'user-1', status: 'ACTIVE' };
const profile = { id: 'profile-1', userId: 'user-1', status: 'DRAFT' };
export function identity(): Identity { return { uid: 'firebase-1', emailVerified: false, getIdToken: vi.fn().mockResolvedValue('fake-token'), reload: vi.fn().mockResolvedValue(undefined) }; }
const response = (body: unknown, status = 200) => new Response(status === 204 || status === 202 ? null : JSON.stringify(body), { status });
const failure = (status: number, code: string) => response({ code, error: 'Forbidden', message: 'private server detail', expiresAt: 'tomorrow' }, status);
function harness(...responses: Response[]) {
  const fetcher = vi.fn<typeof fetch>();
  responses.forEach(item => fetcher.mockResolvedValueOnce(item));
  return { fetcher, api: new ApiClient(fetcher), user: identity(), signal: new AbortController().signal };
}
describe('backend contracts', () => {
  it('loads active user/profile with bearer and relative URLs', async () => {
    const h = harness(response(account), response(profile));
    expect(await bootstrap(h.api, h.user, h.signal, false)).toEqual({ account, profile });
    expect(h.fetcher).toHaveBeenCalledWith('/api/me', expect.objectContaining({ headers: { Authorization: 'Bearer fake-token' }, credentials: 'omit' }));
  });
  it.each([[404, 'USER_NOT_FOUND'], [403, 'ACCESS_DENIED']])('provisions only missing user %s/%s', async (status, code) => {
    const h = harness(failure(Number(status), String(code)), response(account), failure(404, 'PROFILE_NOT_FOUND'));
    expect((await bootstrap(h.api, h.user, h.signal, false)).profile).toBeNull();
    expect(h.fetcher.mock.calls.map(call => call[0])).toEqual(['/api/me', '/api/me/provision', '/api/me/profile']);
    expect(h.fetcher.mock.calls[1]?.[1]?.method).toBe('POST');
  });
  it.each(['FORBIDDEN', 'ACCOUNT_PENDING_DELETION', 'ACCOUNT_TEMPORARILY_BANNED', 'ACCOUNT_PERMANENTLY_BANNED', 'AUTH_METHOD_NOT_ALLOWED', 'EMAIL_ALREADY_LINKED_TO_DIFFERENT_FIREBASE_USER'])('never provisions for %s', async code => {
    const h = harness(failure(403, code));
    await expect(bootstrap(h.api, h.user, h.signal, false)).rejects.toMatchObject({ code });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
  it('refreshes once only on INVALID_TOKEN including authorized mutation', async () => {
    const h = harness(failure(401, 'INVALID_TOKEN'), failure(401, 'INVALID_TOKEN'));
    await expect(h.api.request('/me/provision', h.signal, h.user, 'POST')).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
    expect(h.user.getIdToken).toHaveBeenNthCalledWith(1, false);
    expect(h.user.getIdToken).toHaveBeenNthCalledWith(2, true);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not refresh arbitrary authorization failures', async () => {
    const h = harness(failure(401, 'AUTH_METHOD_NOT_ALLOWED'));
    await expect(h.api.request('/me', h.signal, h.user)).rejects.toMatchObject({ kind: 'authorization' });
    expect(h.user.getIdToken).toHaveBeenCalledTimes(1);
  });
  it('distinguishes network, malformed JSON and domain errors', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('network')).mockResolvedValueOnce(new Response('bad')).mockResolvedValueOnce(failure(409, 'CONFLICT'));
    const api = new ApiClient(fetcher); const signal = new AbortController().signal;
    await expect(api.request('/me', signal)).rejects.toMatchObject({ kind: 'network' });
    await expect(api.request('/me', signal)).rejects.toMatchObject({ kind: 'invalid' });
    await expect(api.request('/me', signal)).rejects.toMatchObject({ kind: 'backend', detail: { expiresAt: 'tomorrow' } });
  });
  it.each([{}, { id: 'x' }, { id: 'x', status: 'UNKNOWN' }])('rejects malformed user %j', async raw => {
    const h = harness(response(raw)); await expect(bootstrap(h.api, h.user, h.signal, false)).rejects.toBeInstanceOf(ApiError);
  });
  it('rejects deleted account before loading profile', async () => {
    const h = harness(response({ ...account, status: 'DELETED' }));
    await expect(bootstrap(h.api, h.user, h.signal, false)).rejects.toMatchObject({ code: 'ACCOUNT_PENDING_DELETION' });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed/cross-account profile', async () => {
    const h = harness(response(account), response({ ...profile, userId: 'other' }));
    await expect(bootstrap(h.api, h.user, h.signal, false)).rejects.toMatchObject({ kind: 'invalid' });
  });
  it('verifies locally after profile, reloads then forces token refresh', async () => {
    const h = harness(response(account), failure(404, 'PROFILE_NOT_FOUND'), response(null, 204));
    vi.mocked(h.user.reload).mockImplementation(async () => { Object.defineProperty(h.user, 'emailVerified', { value: true, configurable: true }); });
    await bootstrap(h.api, h.user, h.signal, true);
    expect(h.fetcher.mock.calls[2]?.[0]).toBe('/api/me/local-dev/email-verification');
    expect(h.fetcher.mock.calls[2]?.[1]?.body).toBeUndefined();
    expect(h.user.reload).toHaveBeenCalledOnce();
    expect(h.user.getIdToken).toHaveBeenLastCalledWith(true);
  });
  it('local verification fails recoverably if Firebase remains unverified', async () => {
    const h = harness(response(account), response(profile), response(null, 204));
    await expect(bootstrap(h.api, h.user, h.signal, true)).rejects.toMatchObject({ code: 'LOCAL_VERIFICATION_FAILED' });
  });
  it('disabled/already verified never calls helper', async () => {
    for (const enabled of [false, true]) {
      const h = harness(response(account), response(profile)); Object.defineProperty(h.user, 'emailVerified', { value: enabled, configurable: true });
      await bootstrap(h.api, h.user, h.signal, enabled); expect(h.fetcher).toHaveBeenCalledTimes(2);
    }
  });
  it('does not fetch after cancellation while getting token', async () => {
    const h = harness(); const abort = new AbortController();
    vi.mocked(h.user.getIdToken).mockImplementation(async () => { abort.abort(); return 'token'; });
    await expect(h.api.request('/me', abort.signal, h.user)).rejects.toMatchObject({ name: 'AbortError' });
    expect(h.fetcher).not.toHaveBeenCalled();
  });
});
it.each(['ACCOUNT_DELETED', 'ACCOUNT_TEMPORARILY_BANNED', 'AUTH_METHOD_NOT_ALLOWED'])('does not mistake a 404 %s for a missing backend user', async code => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ code }), { status: 404 }));
  await expect(bootstrap(new ApiClient(fetcher), identity(), new AbortController().signal, false)).rejects.toMatchObject({ code });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('does not mistake account errors on profile for missing profile', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ id: 'u', status: 'ACTIVE' }))).mockResolvedValueOnce(new Response(JSON.stringify({ code: 'ACCOUNT_DELETED' }), { status: 404 }));
  await expect(bootstrap(new ApiClient(fetcher), identity(), new AbortController().signal, false)).rejects.toMatchObject({ code: 'ACCOUNT_DELETED' });
});
it('successful retry installs refreshed bearer only after INVALID_TOKEN', async () => {
  const user = identity(); vi.mocked(user.getIdToken).mockResolvedValueOnce('old').mockResolvedValueOnce('fresh');
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ code: 'INVALID_TOKEN' }), { status: 401 })).mockResolvedValueOnce(new Response(JSON.stringify({ id: 'u', status: 'ACTIVE' })));
  await expect(new ApiClient(fetcher).request('/me', new AbortController().signal, user)).resolves.toMatchObject({ id: 'u' });
  expect(fetcher.mock.calls[1]?.[1]?.headers).toEqual({ Authorization: 'Bearer fresh' });
});
it('reset never retries unauthorized responses', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ code: 'INVALID_TOKEN' }), { status: 401 }));
  await expect(new ApiClient(fetcher).request('/auth/password-reset', new AbortController().signal, undefined, 'POST', { email: 'fake@example.com' }, 202)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  expect(fetcher).toHaveBeenCalledOnce();
});
