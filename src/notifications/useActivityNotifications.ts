import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../auth/api';
import type { SessionController } from '../auth/session';
import { parseStatus, type HomeData } from '../home/contracts';
import { fallbackInterval, homeUpdates, isCurrent, notificationInterval, parsePendingUpdates, type ActivityType, type ActivityUpdate } from './activityPolicy';
import { acknowledge, freshPreferences, hasEnabledActivity, loadPreferences, reconcilePreferences, savePreferences, setActivityPreference, type ActivityPreferences } from './activityStorage';
import { useTabIndicators } from './tabIndicators';

type HomeMode = 'ordinary' | 'elsewhere' | 'chat';
type HomeStatus = ReturnType<typeof parseStatus>;
interface Projection { version: number | null; serverTime: number; at: number; updates: ActivityUpdate[] }
const empty = new Set<string>();
const nearWindow = 5 * 60_000;

export function useActivityNotifications(controller: SessionController, accountId: string | undefined, administrative: boolean) {
  const profileId = controller.getSnapshot().profile?.id;
  const [saved, setSaved] = useState(() => accountId ? loadPreferences(accountId) : freshPreferences(false));
  const [persistenceFailed, setPersistenceFailed] = useState(false);
  const preferences = useRef(saved);
  const enabled = hasEnabledActivity(saved);
  const enabledAt = useRef<Partial<Record<ActivityType, number>>>({});
  const [mode, setHomeMode] = useState<HomeMode | null>(null);
  const [projection, setProjection] = useState<Projection | null>(null);
  const [clockRevision, redraw] = useState(0);
  const metadata = useRef({
    projection: null as Projection | null, checkedAt: null as number | null, advertised: null as number | null,
    offset: 0, recovery: false, queued: false, retryAt: 0,
  });
  const activeRead = useRef<AbortController | null>(null);
  const operationalReads = useRef(new Set<AbortSignal>());
  const wake = useRef<(() => void) | null>(null);
  const alive = useRef(false);
  useLayoutEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const ownsSession = useCallback(() => {
    const session = controller.getSnapshot();
    return alive.current && !!accountId && session.phase === 'ready' && session.account?.id === accountId && session.profile?.id === profileId;
  }, [controller, accountId, profileId]);
  const save = useCallback((next: ActivityPreferences) => {
    if (!accountId || !ownsSession() || next === preferences.current) return;
    const previous = preferences.current;
    preferences.current = next;
    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      setPersistenceFailed(!savePreferences(accountId, next));
      setSaved(next);
    }
  }, [accountId, ownsSession]);
  const setCategory = useCallback((type: ActivityType, checked: boolean) => {
    if (!ownsSession()) return;
    const current = preferences.current, next = setActivityPreference(current, type, checked);
    if (next === current) return;
    if (checked) enabledAt.current[type] = Date.now();
    else delete enabledAt.current[type];
    if (!hasEnabledActivity(next)) {
      activeRead.current?.abort();
      metadata.current.projection = null;
      metadata.current.advertised = null;
      metadata.current.checkedAt = null;
      metadata.current.recovery = false;
      setProjection(null);
    }
    save(next);
  }, [ownsSession, save]);
  const present = useCallback((id: string) => {
    if (ownsSession() && document.visibilityState === 'visible') {
      save(acknowledge(preferences.current, id, Date.now()));
    }
  }, [ownsSession, save]);
  const install = useCallback((next: Projection, startedAt: number) => {
    if (!ownsSession() || !hasEnabledActivity(preferences.current)) return;
    const m = metadata.current;
    m.projection = next;
    m.recovery = false;
    if (m.advertised !== null && m.advertised <= next.serverTime) m.advertised = null;
    // A cached or in-flight pre-enable projection cannot finalize a category baseline.
    save(reconcilePreferences(preferences.current, next.updates, next.at, type =>
      startedAt >= (enabledAt.current[type] ?? -Infinity)));
    setProjection(next);
    wake.current?.();
  }, [ownsSession, save]);
  const beginHomeRead = useCallback((signal: AbortSignal) => {
    if (!ownsSession() || !hasEnabledActivity(preferences.current) || signal.aborted) return undefined;
    operationalReads.current.add(signal);
    activeRead.current?.abort();
    const finish = () => {
      signal.removeEventListener('abort', finish);
      operationalReads.current.delete(signal);
      wake.current?.();
    };
    signal.addEventListener('abort', finish, { once: true });
    return finish;
  }, [ownsSession]);
  const observeHome = useCallback((home: HomeData, status: HomeStatus, statusReceivedAt: number) => {
    if (!ownsSession()) return;
    const m = metadata.current;
    m.queued = home.matchmaking.inQueue;
    if (!hasEnabledActivity(preferences.current)) return;
    const at = Date.now(), serverTime = Date.parse(status.serverTime);
    activeRead.current?.abort();
    m.checkedAt = at;
    m.offset = serverTime - statusReceivedAt;
    const advertised = status.nextRefreshAt ? Date.parse(status.nextRefreshAt) : null;
    if (advertised !== null && advertised > serverTime) m.advertised = Math.min(m.advertised ?? Infinity, advertised);
    install({ version: status.version, serverTime, at, updates: homeUpdates(home) }, statusReceivedAt);
  }, [install, ownsSession]);
  const observeSchedulingHome = useCallback((home: HomeData, startedAt: number, serverTime: number) => {
    if (!ownsSession() || !hasEnabledActivity(preferences.current)) return;
    const m = metadata.current;
    const previous = m.projection;
    if (previous && previous.at > startedAt) return;
    activeRead.current?.abort();
    m.offset = serverTime - startedAt;
    // The existing scheduling read has no Home version. Keep the last
    // version so a later status read can still detect an invalidation.
    install({ version: previous?.version ?? null, serverTime, at: Date.now(), updates: homeUpdates(home) }, startedAt);
  }, [install, ownsSession]);

  useLayoutEffect(() => {
    if (!enabled || administrative || !mode || mode === 'chat' || !accountId) return;
    const m = metadata.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let live = true, pageActive = true, visible = document.visibilityState === 'visible';
    let read: AbortController | null = null;
    const interval = () => {
      const now = Date.now() + m.offset;
      const nearSecondChat = m.projection?.updates.some(item =>
        item.starts !== null && item.entryEnds !== null && now >= item.starts - nearWindow && now < item.entryEnds) ?? false;
      return notificationInterval({ suspended: !pageActive, ordinary: mode === 'ordinary', visible, queued: m.queued, nearSecondChat });
    };
    const schedule = (resume = false) => {
      clearTimeout(timer);
      const every = interval();
      if (!live || !ownsSession() || every === null || read || operationalReads.current.size) return;
      const now = Date.now(), since = m.checkedAt === null ? Infinity : now - m.checkedAt;
      const delay = Math.max(m.retryAt - now, resume && since >= 1000 ? 0 : Math.max(0, every - since));
      const nearAt = Math.min(...(m.projection?.updates.flatMap(item =>
        item.starts !== null && item.starts - nearWindow > now + m.offset ? [item.starts - nearWindow - m.offset] : []) ?? []));
      timer = setTimeout(() => {
        if (Date.now() >= nearAt && delay > nearAt - now) schedule();
        else void poll();
      }, Math.min(delay, nearAt - now));
    };
    const poll = async () => {
      if (!live || !ownsSession() || !hasEnabledActivity(preferences.current) || interval() === null || read || operationalReads.current.size) return;
      const request = new AbortController();
      read = request; activeRead.current = request;
      const startedAt = Date.now();
      m.checkedAt = startedAt;
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]);
      const current = () => live && read === request && !signal.aborted && ownsSession() && hasEnabledActivity(preferences.current);
      let fetchingPending = false;
      try {
        const status = parseStatus(await controller.request('/me/home/status', signal));
        if (!current()) return;
        const serverTime = Date.parse(status.serverTime);
        m.offset = serverTime - Date.now();
        const previous = m.projection, advertised = status.nextRefreshAt ? Date.parse(status.nextRefreshAt) : null;
        const crossed = (time: number | null) => time !== null && previous !== null && time > previous.serverTime && time <= serverTime;
        const due = crossed(m.advertised) || crossed(advertised) ||
          previous?.updates.some(item => crossed(item.starts) || crossed(item.ends) || crossed(item.entryEnds));
        if (advertised !== null && (!previous || advertised > previous.serverTime)) m.advertised = Math.min(m.advertised ?? Infinity, advertised);
        // A persistent dirty bit has no new information after a pending projection.
        if (!previous || m.recovery || status.version !== previous.version || due || Date.now() - previous.at >= fallbackInterval) {
          fetchingPending = true;
          const next = parsePendingUpdates(await controller.request('/me/home/pending', signal));
          if (!current()) return;
          const at = Date.now();
          if (next.version < status.version) { m.recovery = true; return; }
          m.offset = next.serverTime - at;
          install({ ...next, at }, startedAt);
        }
      } catch (error) {
        // Keep the last valid projection and retry only on the normal cadence.
        if (live && !request.signal.aborted && ownsSession()) {
          if (fetchingPending) m.recovery = true;
          if (error instanceof ApiError && error.retryAfterSeconds) m.retryAt = Date.now() + error.retryAfterSeconds * 1000;
        }
      } finally {
        if (read === request) read = null;
        if (activeRead.current === request) activeRead.current = null;
        if (live) {
          if (m.projection?.updates.some(item => item.ends !== null)) redraw(value => value + 1);
          schedule();
        }
      }
    };
    const retire = () => {
      clearTimeout(timer);
      read?.abort();
      if (activeRead.current === read) activeRead.current = null;
      read = null;
    };
    const visibility = () => {
      const next = document.visibilityState === 'visible';
      if (next === visible) return;
      visible = next;
      redraw(value => value + 1);
      if (interval() === null) retire();
      else if (!visible && m.checkedAt === null && m.projection === null) {
        // Let a currently loading operational Home supply the initial baseline.
        m.checkedAt = Date.now();
        schedule();
      } else schedule(visible);
    };
    const resume = () => { pageActive = true; visibility(); redraw(value => value + 1); schedule(visible); };
    const pause = () => { pageActive = false; retire(); };
    wake.current = schedule;
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('online', resume);
    window.addEventListener('pageshow', resume);
    window.addEventListener('pagehide', pause);
    // A hidden mount gets the usual cadence, while a fresh enable on a
    // visible management screen can establish its baseline immediately.
    if (!visible && m.checkedAt === null) m.checkedAt = Date.now();
    schedule();
    return () => {
      live = false; retire(); wake.current = null;
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('online', resume);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('pagehide', pause);
    };
  }, [accountId, administrative, controller, enabled, install, mode, ownsSession]);

  const now = useMemo(() => Date.now() + metadata.current.offset, [clockRevision, projection]);
  const nextBoundary = Math.min(...(projection?.updates.flatMap(({ ends }) => ends !== null && ends > now ? [ends] : []) ?? []));
  useLayoutEffect(() => {
    if (!enabled || administrative || !Number.isFinite(nextBoundary)) return;
    const timer = setTimeout(() => redraw(value => value + 1), Math.max(0, Math.min(2_147_483_647, nextBoundary - Date.now() - metadata.current.offset)));
    return () => clearTimeout(timer);
  }, [administrative, nextBoundary, enabled, projection, clockRevision]);
  const unread = useMemo(() => {
    if (!enabled || administrative || !projection) return empty;
    const unseen = new Set(saved.records?.filter(([, seen]) => !seen).map(([id]) => id));
    return new Set(projection.updates.filter(item => saved.categories[item.type] && unseen.has(item.id) && isCurrent(item, now)).map(item => item.id));
  }, [administrative, enabled, now, projection, saved]);
  useTabIndicators(enabled && !administrative ? unread.size : null);
  return useMemo(() => ({ enabled, categories: saved.categories, persistenceFailed, setCategory, unread, present, beginHomeRead, observeHome, observeSchedulingHome, setHomeMode }),
    [enabled, saved.categories, persistenceFailed, setCategory, unread, present, beginHomeRead, observeHome, observeSchedulingHome]);
}

export const ActivityNotifications = createContext<ReturnType<typeof useActivityNotifications> | null>(null);
export const useActivityNotificationContext = () => useContext(ActivityNotifications);
