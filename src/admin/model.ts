import { ApiError, object } from '../auth/api';
import { parseAppeal } from '../auth/suspension';
export type Section = 'photos' | 'reports' | 'appeals' | 'diagnostics';
export type Row = Record<string, unknown>;
export const statuses = ['PENDING', 'DISMISSED', 'DISMISSED_ABUSIVE_OR_UNJUSTIFIED', 'CONFIRMED'];
export const sources = ['USER', 'ADMIN', 'SYSTEM'];
export function record(raw: unknown): Row { if (!object(raw)) throw new ApiError('invalid'); return raw; }
export function str(row: Row, key: string): string { const value = row[key]; if (typeof value !== 'string' || !value) throw new ApiError('invalid'); return value; }
export function photo(raw: unknown): Row {
  const row = record(raw); for (const key of ['photoId', 'userId', 'displayName', 'readUrl', 'validationStatus', 'moderationStatus', 'createdAt']) str(row, key);
  if (!Number.isSafeInteger(row.photoVersion) || Number(row.photoVersion) < 0 || !Number.isInteger(row.position) || typeof row.isPersonPhoto !== 'boolean' || typeof row.isFullBody !== 'boolean') throw new ApiError('invalid');
  return row;
}
export function report(raw: unknown): Row {
  const row = record(raw); str(row, 'id'); str(record(row.reported), 'userId');
  if (!statuses.includes(str(row, 'status')) || !sources.includes(str(row, 'source')) || typeof row.priorityReview !== 'boolean') throw new ApiError('invalid');
  if (row.reporter != null) str(record(row.reporter),'userId');
  return row;
}
export function appeal(raw: unknown): Row { const row = record(raw); for (const key of ['penaltyId','userId','penaltyReason','appealStatement','appealedAt','createdAt']) str(row,key); return row; }
export function diagnostics(raw: unknown): Row {
  const row = record(raw);
  for (const key of ['queueWaitingCount','queueTotalCount','activeMatchLocks','activeConnectionLocks']) if (!Number.isSafeInteger(row[key]) || Number(row[key]) < 0) throw new ApiError('invalid');
  for (const key of ['oldestQueueEntryEnteredAt','oldestActiveLockCreatedAt']) if (row[key] !== null && (typeof row[key] !== 'string' || !Number.isFinite(Date.parse(String(row[key]))))) throw new ApiError('invalid');
  return row;
}
export function list(raw: unknown, section: Section): Row[] {
  if (!Array.isArray(raw)) throw new ApiError('invalid');
  return raw.map(section === 'photos' ? photo : section === 'reports' ? report : appeal);
}
export function detail(raw: unknown): Row {
  const row = record(raw); report(row.report);
  if (typeof row.details !== 'string' || !Array.isArray(row.messages)) throw new ApiError('invalid');
  if (row.evidence != null) record(row.evidence);
  if (row.penalty != null) record(row.penalty);
  for (const message of row.messages) { const m = record(message); str(m,'id'); if (m.audio != null) str(record(m.audio),'url'); }
  return row;
}
export function plain(value: string, max: number, required = false) { return value.length <= max && (!required || !!value.trim()) && !/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f<>]/.test(value); }
export type Action = 'APPROVED' | 'REJECTED' | 'dismissal' | 'abusive-dismissal' | 'TEMPORARY_BAN' | 'PERMANENT_BAN' | 'APPROVE' | 'REJECT';
export function payload(action: Action, notes: string, reason: string, hours: string, selected: Row) {
  if (!plain(notes, 1000, action === 'APPROVE' || action === 'REJECT')) throw Error('Ingresá notas válidas (máximo 1000 caracteres, sin marcado ni controles).');
  const base = { notes: notes.trim() || null };
  if (action === 'APPROVED' || action === 'REJECTED') return { ...base, decision: action, expectedPhotoVersion: photo(selected).photoVersion };
  if (action === 'APPROVE' || action === 'REJECT') return { ...base, decision: action };
  if (action === 'TEMPORARY_BAN' || action === 'PERMANENT_BAN') {
    if (!plain(reason,255,true)) throw Error('Ingresá un motivo válido (1–255 caracteres, sin marcado ni controles).');
    if (action === 'TEMPORARY_BAN' && (!/^[0-9]+$/.test(hours) || !Number.isSafeInteger(Number(hours)) || Number(hours) <= 0)) throw Error('La duración debe ser un entero positivo en horas.');
    return { ...base, type: action, durationHours: action === 'TEMPORARY_BAN' ? Number(hours) : null, reason: reason.trim() };
  }
  return base;
}
export function decisionResult(raw: unknown, section: Section): Row {
  if (section === 'appeals') { const parsed = parseAppeal(raw); if (!['APPROVED','REJECTED'].includes(parsed.status)) throw new ApiError('invalid'); return { ...parsed }; }
  return section === 'photos' ? photo(raw) : report(raw);
}
// Only backend-provided media fields reach this function, never URLs embedded in text.
export function mediaUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  try { const url = new URL(raw); return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost','127.0.0.1'].includes(url.hostname) && import.meta.env.DEV) ? raw : null; } catch { return null; }
}
