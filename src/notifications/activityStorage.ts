import { object } from '../auth/api';
import { isActivityId } from './activityPolicy';
import type { ActivityUpdate } from './activityPolicy';

type RecordEntry = [id: string, seen: boolean];
type Receipt = [id: string, time: number];
export interface ActivityPreferences {
  enabled: boolean;
  // Null distinguishes a fresh baseline from a previously reconciled empty list.
  records: RecordEntry[] | null;
  presented: Receipt[];
}
const limit = 100;
const maxIdLength = 300;
const receiptLifetime = 24 * 60 * 60_000;
export const freshPreferences = (enabled = true): ActivityPreferences => ({ enabled, records: null, presented: [] });
export const storageKey = (accountId: string) => `reals:web-notifications:v1:${accountId}`;

const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= maxIdLength;
const storedId = (id: unknown): id is string => validId(id) && isActivityId(id);
export function loadPreferences(accountId: string): ActivityPreferences {
  try {
    const raw = window.localStorage.getItem(storageKey(accountId));
    const data: unknown = raw && raw.length <= 70_000 ? JSON.parse(raw) : null;
    if (!object(data) || typeof data.enabled !== 'boolean') return freshPreferences();
    if (!data.enabled) return freshPreferences(false);
    if (!Array.isArray(data.records) || data.records.length > limit ||
        !data.records.every((v): v is RecordEntry => Array.isArray(v) && v.length === 2 && storedId(v[0]) && typeof v[1] === 'boolean') ||
        !Array.isArray(data.presented) || data.presented.length > limit ||
        !data.presented.every((v): v is Receipt => Array.isArray(v) && v.length === 2 && storedId(v[0]) && typeof v[1] === 'number' && Number.isFinite(v[1]))) return freshPreferences();
    return { enabled: true, records: data.records, presented: data.presented };
  } catch {
    return freshPreferences();
  }
}

export function savePreferences(accountId: string, data: ActivityPreferences) {
  try { window.localStorage.setItem(storageKey(accountId), JSON.stringify(data)); }
  catch { /* The owning coordinator continues with its in-memory copy. */ }
}

export function reconcilePreferences(data: ActivityPreferences, updates: ActivityUpdate[], now: number): ActivityPreferences {
  const known = new Map(data.records ?? []);
  const receipts = new Map(data.presented.filter(([, time]) => now - time < receiptLifetime));
  const records: RecordEntry[] = updates.filter(({ id }) => validId(id)).slice(0, limit).map(({ id }) => {
    const seen = receipts.delete(id) || (known.get(id) ?? data.records === null);
    return [id, seen];
  });
  return { ...data, records, presented: [...receipts] };
}

export function acknowledge(data: ActivityPreferences, id: string, now: number): ActivityPreferences {
  if (!validId(id)) return data;
  const records = data.records;
  const entry = records?.find(record => record[0] === id);
  if (entry && records) return entry[1] ? data : { ...data, records: records.map(record => record === entry ? [id, true] : record) };
  if (data.presented.some(receipt => receipt[0] === id)) return data;
  const receipt: Receipt = [id, now];
  return { ...data, presented: [...data.presented.filter(([, time]) => now - time < receiptLifetime), receipt].slice(-limit) };
}
