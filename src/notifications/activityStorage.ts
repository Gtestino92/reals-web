import { object } from '../auth/api';
import { activityTypeForId, activityTypes, type ActivityType, type ActivityUpdate } from './activityPolicy';

type RecordEntry = [id: string, seen: boolean];
type Receipt = [id: string, time: number];
export interface ActivityPreferences {
  categories: Readonly<Record<ActivityType, boolean>>;
  needsBaseline: ActivityType[];
  // Null distinguishes a fresh baseline from a previously reconciled empty list.
  records: RecordEntry[] | null;
  presented: Receipt[];
}
const limit = 100;
const maxIdLength = 300;
const receiptLifetime = 24 * 60 * 60_000;
const categories = (enabled: boolean, stored?: Record<string, unknown>): ActivityPreferences['categories'] => ({
  FIRST_CHAT: typeof stored?.FIRST_CHAT === 'boolean' ? stored.FIRST_CHAT : enabled,
  VISUAL_REVIEW: typeof stored?.VISUAL_REVIEW === 'boolean' ? stored.VISUAL_REVIEW : enabled,
  SCHEDULING: typeof stored?.SCHEDULING === 'boolean' ? stored.SCHEDULING : enabled,
  SECOND_CHAT_SCHEDULED: typeof stored?.SECOND_CHAT_SCHEDULED === 'boolean' ? stored.SECOND_CHAT_SCHEDULED : enabled,
  SECOND_CHAT_AVAILABLE: typeof stored?.SECOND_CHAT_AVAILABLE === 'boolean' ? stored.SECOND_CHAT_AVAILABLE : enabled,
});
export const freshPreferences = (enabled = true): ActivityPreferences => ({ categories: categories(enabled), needsBaseline: [], records: null, presented: [] });
export const storageKey = (accountId: string) => `reals:web-notifications:v2:${accountId}`;
export const hasEnabledActivity = (data: ActivityPreferences) => activityTypes.some(type => data.categories[type]);

const validId = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= maxIdLength;
const readStored = (key: string) => {
  const raw = window.localStorage.getItem(key);
  try {
    const data: unknown = raw && raw.length <= 70_000 ? JSON.parse(raw) : null;
    return object(data) ? data : null;
  } catch { return null; }
};
export function loadPreferences(accountId: string): ActivityPreferences {
  try {
    const current = readStored(storageKey(accountId));
    const storedCategories = object(current?.categories) ? current.categories : undefined;
    const legacy = storedCategories && activityTypes.every(type => typeof storedCategories[type] === 'boolean')
      ? null : readStored(`reals:web-notifications:v1:${accountId}`);
    const data = storedCategories ? current : typeof legacy?.enabled === 'boolean' ? legacy : null;
    if (!data) return freshPreferences();
    if (!storedCategories && legacy?.enabled === false) return freshPreferences(false);
    const flags = categories(legacy?.enabled !== false, storedCategories);
    const pending: unknown[] = Array.isArray(data.needsBaseline) ? data.needsBaseline : [];
    const needsBaseline = activityTypes.filter(type => flags[type] && pending.includes(type));
    const storedId = (id: unknown): id is string => validId(id) && activityTypeForId(id) !== null;
    const enabledEntry = ([id]: RecordEntry | Receipt) => {
      const type = activityTypeForId(id);
      return type !== null && flags[type];
    };
    const records = Array.isArray(data.records) && data.records.length <= limit &&
      data.records.every((v): v is RecordEntry => Array.isArray(v) && v.length === 2 && storedId(v[0]) && typeof v[1] === 'boolean')
      ? data.records.filter(enabledEntry)
      : null;
    const presented = Array.isArray(data.presented) && data.presented.length <= limit
      ? data.presented.filter((v): v is Receipt => Array.isArray(v) && v.length === 2 && storedId(v[0]) && Number.isFinite(v[1])).filter(enabledEntry)
      : [];
    return { categories: flags, records, presented, needsBaseline };
  } catch {
    return freshPreferences();
  }
}

export function savePreferences(accountId: string, data: ActivityPreferences) {
  try {
    window.localStorage.setItem(storageKey(accountId), JSON.stringify(data));
    return true;
  } catch { return false; }
}

export function setActivityPreference(data: ActivityPreferences, type: ActivityType, enabled: boolean): ActivityPreferences {
  if (data.categories[type] === enabled) return data;
  const belongsToOtherCategories = ([id]: RecordEntry | Receipt) => activityTypeForId(id) !== type;
  return {
    categories: { ...data.categories, [type]: enabled },
    needsBaseline: enabled ? [...data.needsBaseline, type] : data.needsBaseline.filter(value => value !== type),
    records: data.records?.filter(belongsToOtherCategories) ?? null,
    presented: data.presented.filter(belongsToOtherCategories),
  };
}

export function reconcilePreferences(data: ActivityPreferences, updates: ActivityUpdate[], now: number, mayBaseline: (type: ActivityType) => boolean = () => true): ActivityPreferences {
  const known = new Map(data.records ?? []);
  const receipts = new Map(data.presented.filter(([, time]) => now - time < receiptLifetime));
  const needsBaseline = data.needsBaseline.filter(type => !mayBaseline(type));
  const records: RecordEntry[] = updates
    .filter(({ id, type }) => data.categories[type] && !needsBaseline.includes(type) && validId(id))
    .slice(0, limit).map(({ id, type }) => [
      id, receipts.delete(id) || data.needsBaseline.includes(type) || (known.get(id) ?? data.records === null),
    ]);
  return { ...data, records, presented: [...receipts], needsBaseline };
}

export function acknowledge(data: ActivityPreferences, id: string, now: number): ActivityPreferences {
  const type = validId(id) ? activityTypeForId(id) : null;
  if (!type || !data.categories[type]) return data;
  const records = data.records;
  const entry = records?.find(record => record[0] === id);
  if (entry && records) return entry[1] ? data : { ...data, records: records.map(record => record === entry ? [id, true] : record) };
  if (data.presented.some(receipt => receipt[0] === id)) return data;
  const receipt: Receipt = [id, now];
  return { ...data, presented: [...data.presented.filter(([, time]) => now - time < receiptLifetime), receipt].slice(-limit) };
}
