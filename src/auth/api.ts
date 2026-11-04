import { terminalCodes } from './errors';
import type { Identity } from './firebase';
export class ApiError extends Error {
  constructor(public readonly kind: 'network' | 'invalid' | 'authorization' | 'backend', public readonly status = 0, public readonly code = '', public readonly detail: { error?: string; message?: string; expiresAt?: string } = {}) {
    super(kind);
  }
}
export function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
export class ApiClient {
  constructor(private readonly fetcher: typeof fetch = globalThis.fetch.bind(globalThis)) {}
  async request(path: string, signal: AbortSignal, user?: Identity, method = 'GET', body?: unknown, expectedStatus?: number): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt++) {
      signal.throwIfAborted();
      const headers: Record<string, string> = {};
      if (user) {
        const token = await user.getIdToken(attempt === 1);
        if (!token.trim()) throw new ApiError('authorization', 401, 'INVALID_TOKEN');
        headers.Authorization = `Bearer ${token}`;
      }
      signal.throwIfAborted();
      const multipart = body instanceof FormData;
      if (body !== undefined && !multipart) headers['Content-Type'] = 'application/json';
      let response: Response;
      try { response = await this.fetcher(`/api${path}`, { method, signal, headers, ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }), credentials: 'omit' }); }
      catch { signal.throwIfAborted(); throw new ApiError('network'); }
      signal.throwIfAborted();
      if (!response.ok) {
        let raw: unknown;
        try { raw = await response.json(); } catch { throw new ApiError('invalid', response.status); }
        if (!object(raw) || typeof raw.code !== 'string') throw new ApiError('invalid', response.status);
        if (response.status === 401 && raw.code === 'INVALID_TOKEN' && user && attempt === 0) continue;
        throw new ApiError(response.status === 401 || response.status === 403 ? 'authorization' : 'backend', response.status, raw.code, {
          ...(typeof raw.error === 'string' ? { error: raw.error } : {}),
          ...(typeof raw.message === 'string' ? { message: raw.message } : {}),
          ...(typeof raw.expiresAt === 'string' ? { expiresAt: raw.expiresAt } : {}),
        });
      }
      if (expectedStatus !== undefined && response.status !== expectedStatus) throw new ApiError('invalid', response.status);
      if (response.status === 202 || response.status === 204) return undefined;
      try { return await response.json(); } catch { throw new ApiError('invalid', response.status); }
    }
    throw new ApiError('invalid');
  }
}
export interface BackendUser { id: string; status: 'ACTIVE' | 'DELETED' }
export interface Profile { id: string; userId: string; status: 'DRAFT' | 'ACTIVE' | 'INACTIVE' }
export function parseUser(raw: unknown): BackendUser {
  if (!object(raw) || typeof raw.id !== 'string' || !raw.id || (raw.status !== 'ACTIVE' && raw.status !== 'DELETED')) throw new ApiError('invalid');
  return { id: raw.id, status: raw.status };
}
export function parseProfile(raw: unknown, userId: string): Profile {
  if (!object(raw) || typeof raw.id !== 'string' || !raw.id || raw.userId !== userId || (raw.status !== 'DRAFT' && raw.status !== 'ACTIVE' && raw.status !== 'INACTIVE')) throw new ApiError('invalid');
  return { id: raw.id, userId, status: raw.status };
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
  if (account.status === 'DELETED') throw new ApiError('backend', 403, 'ACCOUNT_PENDING_DELETION');
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
