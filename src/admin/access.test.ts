import { afterEach, expect, it, vi } from 'vitest';
import { AdminAccess } from './access';
import { ApiError } from '../auth/api';
const grant = 'A'.repeat(43);
function setup() {
  const request = vi.fn<(_path: string, _signal: AbortSignal, _method?: string, _body?: unknown) => Promise<unknown>>().mockResolvedValue({ configured: true, grantValid: false });
  const context = vi.fn().mockImplementation(async () => ({ provider: 'google.com', authTime: Date.now() }));
  const google = vi.fn().mockResolvedValue(undefined);
  const access = new AdminAccess(request, context, google);
  return { request, context, google, access };
}
async function allowed() {
  const h = setup(); await h.access.check();
  h.request.mockResolvedValueOnce({ grant, expiresAt: new Date(Date.now() + 60000).toISOString() }).mockResolvedValueOnce({ configured: true, grantValid: true });
  await h.access.verify('012345'); return h;
}
afterEach(() => vi.useRealTimers());
it('requires status, preserves leading zeros, confirms grant before permitting access and keeps it out of snapshots', async () => {
  const h = await allowed();
  expect(h.request.mock.calls.map(c => c[0])).toEqual(['/admin-auth/status', '/admin-auth/verify', '/admin-auth/status']);
  expect(h.request.mock.calls[1]?.slice(2)).toEqual(['POST', { code: '012345' }]);
  expect(h.access.getSnapshot().phase).toBe('allowed'); expect(h.access.token()).toBe(grant);
  expect(JSON.stringify(h.access.getSnapshot())).not.toContain(grant); h.access.clear();
});
it.each(['password', null])('password/unknown token provider %s requires explicit logout and Google sign-in', async provider => {
  const h = setup(); h.context.mockResolvedValue({ provider, authTime: Date.now() }); await h.access.check();
  expect(h.access.getSnapshot().phase).toBe('switch'); await h.access.verify('012345'); h.access.reauthenticate();
  expect(h.request).not.toHaveBeenCalled(); expect(h.google).not.toHaveBeenCalled();
});
it.each([300000, 301000, -1000, NaN])('auth age %s requires Google reauthentication', async age => {
  const h = setup(); h.context.mockResolvedValue({ provider: 'google.com', authTime: Date.now() - age }); await h.access.check();
  expect(h.access.getSnapshot().phase).toBe('google'); await h.access.verify('012345'); expect(h.request).toHaveBeenCalledOnce();
});
it('freshness is checked again before issuance and opening the popup is synchronous', async () => {
  const h = setup(); await h.access.check(); h.context.mockResolvedValue({ provider: 'google.com', authTime: 0 });
  await h.access.verify('012345'); expect(h.request).toHaveBeenCalledOnce();
  h.access.reauthenticate(); expect(h.google).toHaveBeenCalledOnce(); h.access.clear();
});
it.each(['', '12345', '1234567', 'abcdef'])('malformed input %j never reaches verification', async code => {
  const h = setup(); await h.access.check(); await h.access.verify(code); expect(h.request).toHaveBeenCalledOnce();
});
it.each(['ADMIN_MFA_INVALID_CODE', 'ADMIN_MFA_RATE_LIMITED', 'RATE_LIMIT_EXCEEDED', 'ADMIN_ACCESS_DENIED', 'ADMIN_MFA_NOT_CONFIGURED', 'ADMIN_AUTHENTICATION_UNAVAILABLE', 'INVALID_APP_CHECK_TOKEN', 'MISSING_APP_CHECK_TOKEN', 'APP_CHECK_VERIFICATION_UNAVAILABLE', 'INVALID_TOKEN'])('handles %s without retrying verification or exposing backend text', async code => {
  const h = setup(); await h.access.check(); h.request.mockRejectedValueOnce(new ApiError('backend', 400, code, { message: 'private detail' })); await h.access.verify('012345');
  expect(h.request).toHaveBeenCalledTimes(2); expect(h.access.token()).toBeUndefined(); expect(h.access.getSnapshot().message).not.toContain('private detail'); expect(h.access.getSnapshot().message).not.toBe('');
});
it('honors Retry-After across deliberate status refresh/reauthentication and excludes simultaneous verifies', async () => {
  vi.useFakeTimers(); const h = setup(); await h.access.check();
  h.request.mockRejectedValueOnce(new ApiError('backend', 429, 'ADMIN_MFA_RATE_LIMITED', {}, 30));
  const first = h.access.verify('012345'); await h.access.verify('012345'); await first;
  await h.access.check(); await h.access.verify('012345'); expect(h.request).toHaveBeenCalledTimes(3);
  vi.advanceTimersByTime(30000); h.request.mockRejectedValueOnce(new ApiError('network')); await h.access.verify('012345'); expect(h.request).toHaveBeenCalledTimes(4);
});
it.each([{ configured: false, grantValid: false }, {}, { configured: true, grantValid: 'yes' }])('fails closed on unconfigured or malformed status %j', async raw => {
  const h = setup(); h.request.mockResolvedValue(raw); await h.access.check(); expect(h.access.getSnapshot().phase).toBe('error');
});
it.each([{}, { grant, expiresAt: 'bad' }, { grant: 'bad', expiresAt: '2030-01-01T00:00:00Z' }, { grant, expiresAt: '2020-01-01T00:00:00Z' }])('rejects malformed/expired verification %j', async raw => {
  const h = setup(); await h.access.check(); h.request.mockResolvedValueOnce(raw); await h.access.verify('012345'); expect(h.access.token()).toBeUndefined(); expect(h.access.getSnapshot().phase).toBe('error');
});
it('invalid server-confirmation never grants authority', async () => {
  const h = setup(); await h.access.check(); h.request.mockResolvedValueOnce({ grant, expiresAt: new Date(Date.now()+60000).toISOString() }).mockResolvedValueOnce({ configured: true, grantValid: false });
  await h.access.verify('012345'); expect(h.access.token()).toBeUndefined(); expect(h.access.getSnapshot().phase).toBe('totp');
});
it.each(['ADMIN_GRANT_EXPIRED','ADMIN_GRANT_REVOKED','ADMIN_MFA_REQUIRED'])('retires access on %s', async code => {
  const h = await allowed(); h.access.fail(new ApiError('authorization', 403, code)); expect(h.access.token()).toBeUndefined(); expect(h.access.getSnapshot().phase).toBe('totp');
});
it('expires at the absolute boundary without sliding renewal', async () => {
  vi.useFakeTimers(); const h = await allowed(); vi.advanceTimersByTime(59999); expect(h.access.token()).toBe(grant); vi.advanceTimersByTime(1); expect(h.access.token()).toBeUndefined(); expect(h.access.getSnapshot().phase).toBe('totp');
});
it('removes the grant when the same identity now has a password token context', async () => {
  const h = await allowed(); h.context.mockResolvedValue({ provider: 'password', authTime: Date.now() });
  await h.access.check(); expect(h.access.token()).toBeUndefined(); expect(h.access.getSnapshot().phase).toBe('switch');
});
it('a valid grant survives revalidation even when Google auth age exceeds five minutes; expiry stays absolute', async () => {
  vi.useFakeTimers(); const h = await allowed();
  h.context.mockResolvedValue({ provider: 'google.com', authTime: Date.now() - 600000 });
  h.request.mockResolvedValue({ configured: true, grantValid: true });
  vi.advanceTimersByTime(30000); await h.access.check();
  expect(h.access.getSnapshot().phase).toBe('allowed'); expect(h.google).not.toHaveBeenCalled();
  vi.advanceTimersByTime(30000); expect(h.access.token()).toBeUndefined();
});
it.each([new ApiError('network'), new ApiError('backend', 503, 'ADMIN_AUTHENTICATION_UNAVAILABLE'), new ApiError('backend', 429, 'RATE_LIMIT_EXCEEDED', {}, 5)])('transient revalidation blocks UI but retains the unexpired grant for a deliberate status retry', async error => {
  vi.useFakeTimers(); const h = await allowed(); h.request.mockRejectedValueOnce(error); await h.access.check();
  expect(h.access.getSnapshot().phase).toBe('error'); expect(h.access.token()).toBe(grant);
  h.request.mockResolvedValueOnce({ configured: true, grantValid: true });
  if (error.retryAfterSeconds) {
    const count = h.request.mock.calls.length; await h.access.check(); expect(h.request).toHaveBeenCalledTimes(count);
    vi.advanceTimersByTime(error.retryAfterSeconds * 1000);
  }
  await h.access.check();
  expect(h.access.getSnapshot().phase).toBe('allowed'); expect(h.access.token()).toBe(grant);
  expect(h.request.mock.calls.filter(c => c[0].endsWith('/verify'))).toHaveLength(1); h.access.clear();
});
it('cancels and rejects late verify responses after ownership/route/identity retirement', async () => {
  const h = setup(); await h.access.check(); let finish!: (v: unknown) => void;
  h.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = h.access.verify('012345'); await Promise.resolve(); const signal = h.request.mock.calls.at(-1)![1]; h.access.clear();
  finish({ grant, expiresAt: new Date(Date.now()+60000).toISOString() }); await pending;
  expect(signal.aborted).toBe(true); expect(h.access.token()).toBeUndefined(); expect(h.access.getSnapshot().phase).toBe('checking');
});
