import { parseOffsetTimestamp } from './offsetTimestamp';

const prefix = 'reals:calendar-opened:v1:';
const changed = 'reals:calendar-opened';
const limit = 100;
const opened = '1';
const fallback = new Set<string>();

export function calendarOpenedKey(accountId: string | null, connectionId: string, startsAt: string): string | null {
  const start = parseOffsetTimestamp(startsAt);
  return accountId && connectionId && start !== null ? prefix + JSON.stringify([start, accountId, connectionId]) : null;
}

export function calendarWasOpened(key: string | null) {
  if (!key) return false;
  if (fallback.has(key)) return true;
  try { return window.localStorage.getItem(key) === opened; }
  catch { return false; }
}

function startOf(key: string) {
  try {
    const identity: unknown = JSON.parse(key.slice(prefix.length));
    if (Array.isArray(identity) && identity.length === 3 && typeof identity[0] === 'number' &&
      Number.isSafeInteger(identity[0]) && typeof identity[1] === 'string' && identity[1] &&
      typeof identity[2] === 'string' && identity[2]) return identity[0];
  } catch { /* Ignore malformed keys. */ }
  return NaN;
}

function prune(keys: string[], now: number, remove: (key: string) => void, keep?: string) {
  const upcoming = keys.flatMap(key => {
    if (key === keep) return [];
    const start = startOf(key);
    if (start > now) return [{ key, start }];
    remove(key);
    return [];
  });
  upcoming.sort((a, b) => b.start - a.start);
  for (const { key } of upcoming.slice(keep ? limit - 1 : limit)) remove(key);
}

export function pruneCalendarOpened(now: number, keep?: string) {
  prune([...fallback], now, key => { fallback.delete(key); }, keep && fallback.has(keep) ? keep : undefined);
  try {
    const storage = window.localStorage;
    const keys = Object.keys(storage).filter(key => key.startsWith(prefix));
    const valid = keys.filter(key => {
      if (storage.getItem(key) === opened) return true;
      storage.removeItem(key);
      return false;
    });
    prune(valid, now, key => storage.removeItem(key), keep && valid.includes(keep) ? keep : undefined);
  } catch { /* Storage may be disabled or read-only. */ }
}

export function markCalendarOpened(key: string, now: number) {
  try {
    window.localStorage.setItem(key, opened);
    fallback.delete(key);
  } catch {
    fallback.add(key);
  }
  pruneCalendarOpened(now, key);
  window.dispatchEvent(new Event(changed));
}

export function subscribeCalendarOpened(notify: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && !event.key.startsWith(prefix)) return;
    try { if (event.storageArea !== window.localStorage) return; }
    catch { return; }
    notify();
  };
  window.addEventListener(changed, notify);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(changed, notify);
    window.removeEventListener('storage', onStorage);
  };
}
