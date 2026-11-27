import { ApiError, object } from '../auth/api';

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function timestamp(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)));
}
export function contactStatus(raw: unknown) {
  if (!object(raw)) throw new ApiError('invalid');
  const { mutationRevision, requiredConsentVersion, acceptedConsentVersion = null, acceptedAt = null, state, syncedAt = null, importAvailable } = raw;
  if (typeof mutationRevision !== 'string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(mutationRevision) ||
      !integer(requiredConsentVersion) || requiredConsentVersion < 1 ||
      !(acceptedConsentVersion === null || integer(acceptedConsentVersion) && acceptedConsentVersion > 0) ||
      !timestamp(acceptedAt) || !timestamp(syncedAt) || typeof importAvailable !== 'boolean' ||
      (acceptedConsentVersion === null) !== (acceptedAt === null) ||
      !(state === 'NOT_CONFIGURED' || state === 'SYNCED' || state === 'RESYNC_REQUIRED') ||
      (state !== 'NOT_CONFIGURED' && (!syncedAt || !acceptedConsentVersion))) throw new ApiError('invalid');
  return { mutationRevision, requiredConsentVersion, acceptedConsentVersion, acceptedAt, state, syncedAt, importAvailable };
}
export function importResult(raw: unknown, submitted: number) {
  if (!object(raw) || raw.submittedCount !== submitted || !integer(raw.distinctCount) || raw.distinctCount > submitted) throw new ApiError('invalid');
  const status = contactStatus(raw.status);
  if (status.state !== 'SYNCED') throw new ApiError('invalid');
  return { status, distinctCount: raw.distinctCount };
}
export type ContactStatus = ReturnType<typeof contactStatus>;
export const ownerPath = '/me/shared-contacts';
