import type { AppCheckTokenProvider } from './appCheck';
import type { TabOwnershipManager } from '../tabs/TabOwnershipManager';
import { maxRetryAfterSeconds, terminalCodes } from './errors';
import type { Identity } from './firebase';
export class ApiError extends Error {
  constructor(public readonly kind: 'network' | 'invalid' | 'authorization' | 'backend', public readonly status = 0, public readonly code = '', public readonly detail: { error?: string; message?: string; expiresAt?: string } = {}, public readonly retryAfterSeconds?: number) {
    super(kind);
  }
}
function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || !/^[0-9]+$/.test(value.trim())) return undefined;
  const seconds = Number(value.trim());
  return Number.isSafeInteger(seconds) && seconds <= maxRetryAfterSeconds ? seconds : undefined;
}
export function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) { signal.removeEventListener('abort', abort); abort(); }
  });
}
export class ApiClient {
  constructor(private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis), private readonly ownership?: TabOwnershipManager, private readonly appCheckToken?: AppCheckTokenProvider) {}
  withOwnership(ownership?: TabOwnershipManager) { return new ApiClient(this.fetcher, ownership, this.appCheckToken); }
  withAppCheck(provider?: AppCheckTokenProvider) { return new ApiClient(this.fetcher, this.ownership, provider); }
  async request(path: string, signal: AbortSignal, user?: Identity, method = 'GET', body?: unknown, expectedStatus?: number, refreshInvalidToken = true, adminGrant?: string): Promise<unknown> {
    this.ownership?.assert();
    if (this.ownership) signal = AbortSignal.any([signal, this.ownership.signal]);
    for (let attempt = 0; attempt < 2; attempt++) {
      signal.throwIfAborted();
      const headers: Record<string, string> = {};
      if (user) {
        const token = await abortable(user.getIdToken(attempt === 1), signal);
        if (!token.trim()) throw new ApiError('authorization', 401, 'INVALID_TOKEN');
        headers.Authorization = `Bearer ${token}`;
      }
      if (this.appCheckToken && path !== '/ping' && !path.startsWith('/local-dev/')) headers['X-Firebase-AppCheck'] = await abortable(this.appCheckToken(), signal);
      if (adminGrant && (path.startsWith('/admin/') || path.startsWith('/admin-auth/'))) headers['X-Reals-Admin-Grant'] = adminGrant;
      signal.throwIfAborted();
      const multipart = body instanceof FormData;
      if (body !== undefined && !multipart) headers['Content-Type'] = 'application/json';
      let response: Response;
      try { response = await this.fetcher(`/api${path}`, { method, signal, headers, ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }), credentials: 'omit', ...(method === 'GET' && /^\/matches\/[^/]+(?:\/visual-profile)?$/.test(path) ? { cache: 'no-store' as const } : {}), ...((path.startsWith('/admin/') || path.startsWith('/admin-auth/')) ? { cache: 'no-store' as const, redirect: 'error' as const } : {}) }); }
      catch { signal.throwIfAborted(); throw new ApiError('network'); }
      signal.throwIfAborted();
      if (!response.ok) {
        const retryAfter = parseRetryAfter(response.headers.get('Retry-After'));
        let raw: unknown;
        try { raw = await response.json(); } catch { signal.throwIfAborted(); throw new ApiError('invalid', response.status, '', {}, retryAfter); }
        signal.throwIfAborted();
        if (!object(raw) || typeof raw.code !== 'string') throw new ApiError('invalid', response.status, '', {}, retryAfter);
        if (response.status === 401 && raw.code === 'INVALID_TOKEN' && user && attempt === 0 && refreshInvalidToken && !path.startsWith('/admin/') && !path.startsWith('/admin-auth/')) continue;
        throw new ApiError(response.status === 401 || response.status === 403 ? 'authorization' : 'backend', response.status, raw.code, {
          ...(typeof raw.error === 'string' ? { error: raw.error } : {}),
          ...(typeof raw.message === 'string' ? { message: raw.message } : {}),
          ...(typeof raw.expiresAt === 'string' ? { expiresAt: raw.expiresAt } : {}),
        }, retryAfter);
      }
      if (expectedStatus !== undefined && response.status !== expectedStatus) throw new ApiError('invalid', response.status);
      if ((method === 'DELETE' && path === '/me' && response.status === 200) || response.status === 202 || response.status === 204) return undefined;
      try { const result: unknown = await response.json(); signal.throwIfAborted(); return result; } catch { signal.throwIfAborted(); throw new ApiError('invalid', response.status); }
    }
    throw new ApiError('invalid');
  }
}
export interface BackendUser { id: string; status: 'ACTIVE' | 'DELETED'; deletedAt?: string | null; deletionFinalizesAt?: string | null }
export interface Profile { id: string; userId: string; status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' }
export function parseUser(raw: unknown): BackendUser {
  if (!object(raw) || typeof raw.id !== 'string' || !raw.id || (raw.status !== 'ACTIVE' && raw.status !== 'DELETED')) throw new ApiError('invalid');
  const date = (value: unknown): string | null => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return null;
    // Date.parse normalizes impossible calendar dates such as February 31.
    const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
    return day.toISOString().slice(0, 10) === value.slice(0, 10) ? value : null;
  };
  return { id: raw.id, status: raw.status, ...(raw.status === 'DELETED' ? { deletedAt: date(raw.deletedAt), deletionFinalizesAt: date(raw.deletionFinalizesAt) } : {}) };
}
export function parseProfile(raw: unknown, userId: string): Profile {
  if (!object(raw) || typeof raw.id !== 'string' || !raw.id || raw.userId !== userId || (raw.status !== 'DRAFT' && raw.status !== 'ACTIVE' && raw.status !== 'INACTIVE')) throw new ApiError('invalid');
  return { id: raw.id, userId, status: raw.status };
}
export class DeletedAccountError extends ApiError {
  constructor(public readonly account: BackendUser) { super('backend', 403, 'ACCOUNT_PENDING_DELETION'); }
}
export async function bootstrap(api: ApiClient, user: Identity, signal: AbortSignal, localVerification: boolean) {
  let raw: unknown;
  try { raw = await api.request('/me', signal, user); }
  catch (error) {
    if (!(error instanceof ApiError) || error.kind === 'invalid' || terminalCodes.has(error.code) || error.code.startsWith('ACCOUNT_') || !(error.status === 404 || (error.status === 403 && error.code === 'ACCESS_DENIED'))) throw error;
    signal.throwIfAborted();
    raw = await api.request('/me/provision', signal, user, 'POST');
  }
  const account = parseUser(raw);
  if (account.status === 'DELETED') throw new DeletedAccountError(account);
  let profile: Profile | null;
  try { profile = parseProfile(await api.request('/me/profile', signal, user), account.id); }
  catch (error) { if (error instanceof ApiError && error.status === 404 && error.kind !== 'invalid' && !terminalCodes.has(error.code) && !error.code.startsWith('ACCOUNT_')) profile = null; else throw error; }
  signal.throwIfAborted();
  if (localVerification && !user.emailVerified) {
    await api.request('/me/local-dev/email-verification', signal, user, 'POST', undefined, 204);
    signal.throwIfAborted();
    await user.reload();
    signal.throwIfAborted();
    await user.getIdToken(true);
    signal.throwIfAborted();
    if (!user.emailVerified) throw new ApiError('backend', 0, 'LOCAL_VERIFICATION_FAILED');
  }
  return { account, profile };
}
