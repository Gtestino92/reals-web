import { PendingLegalSearch } from '../legal/searchGate';
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError, object, parseProfile } from '../auth/api';
import type { SessionController } from '../auth/session';
import { parseHome, parseQueue, parseStatus } from './contracts';
import type { HomeData } from './contracts';
import { currentLocation, LocationError } from './location';
import type { LocationFailureKind } from './location';

interface Model { home: HomeData; name: string }
interface ProfileSample { status: HomeData['profileStatus']; name: string }
export type SearchPhase = 'idle' | 'locating' | 'admitting' | 'queued' | 'canceling' | 'reconciling' | 'failed';
type QueueCheck = boolean | 'confirmed-leave';
type ReturnRead = false | 'ordinary' | 'mandatory';
interface State { model: Model | null; busy: boolean; blocked: boolean; error: string; returning: ReturnRead; adminRevision: number; searchPhase: SearchPhase; locationFailure: LocationFailureKind | null }
interface Owner { lifetime: AbortController; read: AbortController | null; location: AbortController | null; serial: number; mutation: boolean; cancelRequested: boolean; version: number | null; uncertain: boolean; reconcile: boolean; foregroundVerified: boolean; refreshBoundaries: Set<number>; consumedBoundaries: Set<number> }
type HomeStatus = ReturnType<typeof parseStatus>;
interface StatusSample { status: HomeStatus; receivedAt: number; serverTime: number }
interface HomeObserver {
  beginHomeRead: (signal: AbortSignal) => (() => void) | undefined;
  observeHome: (home: HomeData, status: HomeStatus, statusReceivedAt: number) => void;
}
export function useHome(controller: SessionController, active = true, observer?: HomeObserver | null, retainOnReturn = false) {
  const notificationObserver = useRef(observer);
  notificationObserver.current = observer;
  const openPendingLegal = useContext(PendingLegalSearch);
  const [state, setState] = useState<State>({ model: null, busy: true, blocked: true, returning: false, adminRevision: 0, error: '', searchPhase: 'idle', locationFailure: null });
  const foreground = useRef(active); foreground.current = active;
  const owner = useRef<Owner | null>(null), latest = useRef<Model | null>(null);
  const valid = (r: Owner, serial: number) => owner.current === r && !r.lifetime.signal.aborted && r.serial === serial;
  const readStatus = async (r: Owner, serial: number, signal: AbortSignal): Promise<StatusSample> => {
    const status = parseStatus(await controller.request('/me/home/status', signal));
    signal.throwIfAborted();
    const boundary = status.nextRefreshAt ? Date.parse(status.nextRefreshAt) : null;
    // Another device can consume or replace the shared marker before our snapshot catches up.
    if (valid(r, serial) && boundary !== null && !r.consumedBoundaries.has(boundary)) r.refreshBoundaries.add(boundary);
    return { status, receivedAt: Date.now(), serverTime: Date.parse(status.serverTime) };
  };
  const readProfile = async (signal: AbortSignal): Promise<ProfileSample> => {
    const account = controller.snapshot.account, profileId = controller.snapshot.profile?.id;
    if (!account) throw new ApiError('invalid');
    const raw = await controller.request('/me/profile', signal);
    signal.throwIfAborted();
    const profile = parseProfile(raw, account.id);
    if (profile.id !== profileId || !object(raw) || typeof raw.displayName !== 'string' || !raw.displayName.trim()) throw new ApiError('invalid');
    return { status: profile.status, name: raw.displayName };
  };
  const load = async (r: Owner, serial: number, signal: AbortSignal, queue: QueueCheck = false, sample?: StatusSample, profileRead?: Promise<ProfileSample>) => {
    const finish = notificationObserver.current?.beginHomeRead(signal);
    try { return await loadSnapshot(r, serial, signal, queue, sample, profileRead); }
    finally { finish?.(); }
  };
  const loadSnapshot = async (r: Owner, serial: number, signal: AbortSignal, queue: QueueCheck, sample?: StatusSample, profileRead?: Promise<ProfileSample>) => {
    const account = controller.snapshot.account;
    if (!account) throw new ApiError('invalid');
    // Capture baseline before projection: a concurrent invalidation stays observable.
    const { status, receivedAt, serverTime } = sample ?? await readStatus(r, serial, signal);
    signal.throwIfAborted();
    const [profile, rawQueue, rawHome] = await Promise.all([
      profileRead ?? readProfile(signal),
      queue === true ? controller.request('/matchmaking/queue', signal) : Promise.resolve(null),
      controller.request('/me/home', signal),
    ]);
    signal.throwIfAborted();
    const home = parseHome(rawHome);
    // Re-entry can win after DELETE. Verify membership before exposing that surface.
    const queued = queue === true ? parseQueue(rawQueue, account.id)
      : queue === 'confirmed-leave' && home.matchmaking.inQueue
        ? parseQueue(await controller.request('/matchmaking/queue', signal), account.id) : null;
    signal.throwIfAborted();
    if (queued !== null && queued !== home.matchmaking.inQueue) throw new ApiError('invalid');
    if (profile.status !== home.profileStatus) throw new ApiError('invalid');
    if (valid(r, serial)) {
      const model = { home, name: profile.name };
      r.version = status.version; r.reconcile = false; latest.current = model;
      for (const boundary of r.refreshBoundaries) {
        if (boundary <= serverTime) {
          r.refreshBoundaries.delete(boundary);
          r.consumedBoundaries.add(boundary);
        }
      }
      r.foregroundVerified = document.visibilityState === 'visible';
      setState(s => ({ ...s, model, blocked: r.uncertain, locationFailure: home.matchmaking.inQueue ? null : s.locationFailure,
        error: r.uncertain || (s.locationFailure && !home.matchmaking.inQueue) ? s.error : '' }));
      notificationObserver.current?.observeHome(home, status, receivedAt);
      return home;
    }
    return null;
  };
  const refresh = async (poll = false, returning: ReturnRead = false): Promise<HomeData | null> => {
    const r = owner.current;
    if (!r || r.mutation || r.lifetime.signal.aborted) return null;
    if (r.read) return null;
    const read = new AbortController(); r.read = read;
    const signal = AbortSignal.any([read.signal, r.lifetime.signal]), serial = ++r.serial;
    if (returning) setState(s => ({ ...s, returning }));
    else if (!poll) { r.uncertain = false; r.reconcile = true; setState(s => ({ ...s, busy: true, blocked: true, error: '', locationFailure: null })); }
    const invalidateAdminReturn = () => setState(s => s.returning === 'ordinary'
      ? { ...s, returning: 'mandatory', adminRevision: s.adminRevision + 1 }
      : s);
    const reconcile = async (profileRead?: Promise<ProfileSample>) => {
      const sample = poll || returning ? await readStatus(r, serial, signal) : undefined;
      if (sample) {
        signal.throwIfAborted();
        if (!valid(r, serial)) return null;
        const { status, serverTime } = sample;
        const due = [...r.refreshBoundaries].some(boundary => boundary <= serverTime);
        const retained = latest.current;
        const statusCurrent = !r.reconcile && !r.uncertain && status.version === r.version && !status.dirty && !due;
        if (returning === 'ordinary' && !statusCurrent) invalidateAdminReturn();
        // Full Home embeds partner display names, which can change without a Home
        // version bump. Our own display name is covered by the independent read.
        if (retained && statusCurrent &&
            (!returning || (!retained.home.pendingActions.length && !retained.home.nextSteps.length))) {
          const profile = profileRead && await profileRead;
          signal.throwIfAborted();
          if (!valid(r, serial)) return null;
          if (!profile || profile.status === retained.home.profileStatus) {
            if (profile && retained.name !== profile.name) {
              const model = { ...retained, name: profile.name };
              latest.current = model;
              setState(s => ({ ...s, model }));
            }
            r.foregroundVerified = document.visibilityState === 'visible';
            return retained.home;
          }
        }
      }
      r.reconcile = true;
      return load(r, serial, signal, !poll && r.cancelRequested, sample, profileRead);
    };
    try {
      if (!returning) return await reconcile();
      const profileRead = readProfile(signal).then(profile => {
        if (returning === 'ordinary' && valid(r, serial) && !signal.aborted && profile.status !== latest.current?.home.profileStatus) {
          invalidateAdminReturn();
        }
        return profile;
      });
      const [, result] = await Promise.all([profileRead, reconcile(profileRead)]);
      return result;
    } catch {
      if (valid(r, serial) && !signal.aborted) { r.reconcile = true; setState(s => ({ ...s, blocked: true, locationFailure: null, error: 'No pudimos actualizar Inicio. Revisá tu conexión y usá Reintentar.' })); }
      return null;
    } finally {
      read.abort();
      if (valid(r, serial)) {
        r.read = null;
        setState(s => ({ ...s, busy: false, returning: false, searchPhase: s.blocked && s.searchPhase !== 'idle' ? 'failed' : latest.current?.home.matchmaking.inQueue ? 'queued' : s.searchPhase === 'failed' && poll ? 'failed' : 'idle' }));
      }
    }
  };
  const refreshOnReturn = (invalidated = false) => {
    if (invalidated && owner.current) owner.current.reconcile = true;
    const retained = latest.current?.home;
    const safe = retained?.profileStatus === 'ACTIVE' && controller.snapshot.profile?.status === 'ACTIVE' &&
      !retained.matchmaking.inQueue && !state.busy && !state.blocked && state.searchPhase === 'idle' && !owner.current?.uncertain;
    const mode = owner.current?.reconcile ? 'mandatory' : 'ordinary';
    void refresh(false, safe ? mode : false);
  };
  const reconcileHome = async () => {
    const r=owner.current;
    if(!r||r.mutation||r.lifetime.signal.aborted)return null;
    r.read?.abort();r.read=null;r.reconcile=true;
    return refresh();
  };
  const dismissSecondChat = async (connectionId: string) => {
    const r = owner.current;
    if (!r || r.mutation || state.busy || state.returning || state.blocked || r.lifetime.signal.aborted) return;
    r.mutation = true; r.read?.abort(); r.read = null;
    const serial = ++r.serial, signal = r.lifetime.signal;
    setState(s => ({ ...s, busy: true, error: '' }));
    let failure = '';
    try {
      const value = await controller.request(`/connections/${connectionId}/second-chat-dismissal`,signal,'POST');
      if (!object(value) || value.dismissed !== true) throw new ApiError('invalid');
    } catch { failure = 'No pudimos confirmar la acci\u00f3n. Actualizamos Inicio antes de permitir otro intento.'; }
    try { r.reconcile = true; await load(r,serial,signal); }
    catch { r.uncertain = true; failure = 'No pudimos actualizar Inicio. Revis\u00e1 tu conexi\u00f3n y us\u00e1 Reintentar.'; }
    finally { if (valid(r,serial)) { r.mutation = false; setState(s => ({ ...s, busy: false, blocked: r.uncertain, error: failure })); } }
  };
  const mutate = async (cancel: boolean) => {
    const r = owner.current, model = latest.current;
    if (cancel && r?.mutation) {
      if (!r.cancelRequested) {
        r.cancelRequested = true; r.location?.abort();
        setState(s => ({ ...s, searchPhase: 'canceling' }));
      }
      return;
    }
    if (!r || r.mutation || state.busy || state.returning || state.blocked || !model) return;
    if (cancel ? !model.home.matchmaking.inQueue : model.home.profileStatus !== 'ACTIVE' || !model.home.matchmaking.canSearch || model.home.matchmaking.inQueue) return;
    if (!cancel && openPendingLegal()) return;
    r.mutation = true; r.cancelRequested = cancel; r.read?.abort(); r.read = null;
    const serial = ++r.serial, signal = r.lifetime.signal;
    setState(s => ({ ...s, busy: true, error: '', locationFailure: null, searchPhase: cancel ? 'canceling' : 'locating' }));
    let failure = '', attempted = false;
    let locationFailure: LocationFailureKind | null = null;
    if (!cancel) {
      const locationOwner = new AbortController(); r.location = locationOwner;
      try {
        const allowCached = !['invalid', 'inaccurate', 'stale'].includes(state.locationFailure ?? '');
        const location = await currentLocation(AbortSignal.any([signal, locationOwner.signal]), allowCached);
        signal.throwIfAborted();
        if (!r.cancelRequested) {
          attempted = true; setState(s => ({ ...s, searchPhase: 'admitting' }));
          // Do not abort this write on local cancellation: DELETE must follow its settlement.
          const result = await controller.request('/matchmaking/queue', signal, 'POST', location);
          parseQueue(result, controller.snapshot.account?.id ?? '');
        }
      } catch (error) {
        if (!valid(r, serial)) return;
        const legallyRejected = error instanceof ApiError && error.status === 409 && error.code === 'LEGAL_ACTION_REQUIRED';
        if (!legallyRejected && (attempted || !r.cancelRequested)) {
          const locationError = error instanceof LocationError ? error : new LocationError('unavailable');
          failure = attempted ? 'No pudimos confirmar la admisión a la búsqueda. Actualizá el estado antes de intentar otra vez.' : locationError.message;
          locationFailure = attempted ? null : locationError.kind;
          r.uncertain = attempted;
        }
      } finally { if (r.location === locationOwner) r.location = null; }
    }
    if (!valid(r, serial)) return;
    const expectedAccount = controller.snapshot.account?.id;
    let cancellationHandled = false;
    const leaveQueue = async () => {
      cancellationHandled = true;
      setState(s => ({ ...s, searchPhase: 'canceling' }));
      try {
        const result = await controller.request('/matchmaking/queue', signal, 'DELETE');
        if (!expectedAccount || parseQueue(result, expectedAccount)) throw new ApiError('invalid');
      } catch {
        if (!valid(r, serial)) return;
        r.uncertain = true; failure = 'No pudimos confirmar la cancelación. La búsqueda podría seguir activa. Actualizá el estado.';
      }
    };
    let baseline: PromiseSettledResult<StatusSample> | undefined;
    if (cancel) {
      // Settle both lanes even if status fails. No read failure may release the write owner.
      [, baseline] = await Promise.allSettled([leaveQueue(), readStatus(r, serial, signal)]);
    } else if (r.cancelRequested && attempted) await leaveQueue();
    if (!valid(r, serial)) return;
    const reconcile = async () => {
      setState(s => ({ ...s, searchPhase: r.cancelRequested ? 'canceling' : 'reconciling' }));
      try {
        if (cancel && !r.uncertain && baseline) {
          if (baseline.status === 'rejected') throw baseline.reason;
          await load(r, serial, signal, 'confirmed-leave', baseline.value);
        } else await load(r, serial, signal, true);
      }
      catch { if (valid(r, serial)) { r.uncertain = true; failure = 'No pudimos confirmar el estado de la búsqueda. Consultá el estado antes de volver a intentar.'; } }
    };
    try {
      if (attempted || r.cancelRequested) await reconcile();
      // Cancellation may arrive while the admission result is being reconciled.
      // Handle it in this same lane rather than losing the intent or racing POST.
      if (r.cancelRequested && attempted && !cancellationHandled && valid(r, serial)) {
        await leaveQueue();
        if (!valid(r, serial)) return;
        await reconcile();
      }
    }
    finally {
      if (valid(r, serial)) {
        r.mutation = false;
        setState(s => ({ ...s, busy: false, blocked: r.uncertain, error: failure, locationFailure, searchPhase: failure ? 'failed' : latest.current?.home.matchmaking.inQueue ? 'queued' : 'idle' }));
      }
    }
  };
  useEffect(() => {
    const r: Owner = { lifetime: new AbortController(), read: null, location: null, serial: 0, mutation: false, cancelRequested: false, version: null, uncertain: false, reconcile: true, foregroundVerified: false, refreshBoundaries: new Set(), consumedBoundaries: new Set() };
    owner.current = r; latest.current = null;
    setState({ model: null, busy: true, blocked: true, returning: false, adminRevision: 0, error: '', searchPhase: 'idle', locationFailure: null });
    queueMicrotask(() => { if (!r.lifetime.signal.aborted) void refresh(); });
    const resume = () => {
      if (foreground.current && document.visibilityState === 'visible') void refresh(latest.current !== null);
      else {
        // A retained snapshot may keep rendering, but it cannot auto-open a chat on return.
        r.foregroundVerified = false;
        if (!r.mutation && r.read) {
          r.reconcile = true;
          r.read.abort(); r.read = null;
          setState(s => s.returning ? { ...s, blocked: true } : s);
        }
      }
    };
    const timer = window.setInterval(() => { if (foreground.current && document.visibilityState === 'visible') void refresh(true); }, 5000);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => { r.lifetime.abort(); r.read?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); if (owner.current === r) { owner.current = null; latest.current = null; } };
    // The authenticated/profile mount owns all callbacks and resources.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller]);
  useLayoutEffect(() => {
    const r = owner.current;
    if (!active && r && !r.mutation) {
      r.read?.abort(); r.read = null; r.serial++; r.foregroundVerified = false;
      if (!retainOnReturn) r.reconcile = true;
      setState(s => s.returning ? { ...s, returning: false } : s);
    }
  }, [active, retainOnReturn]);
  const canRetryLocation = state.searchPhase === 'failed' && state.locationFailure !== null && !state.busy && !state.blocked &&
    state.model?.home.profileStatus === 'ACTIVE' && state.model.home.matchmaking.canSearch && !state.model.home.matchmaking.inQueue;
  return { ...state, canAutoOpen: () => owner.current?.foregroundVerified === true, refreshOnReturn, reconcileHome, dismissSecondChat, canRetryLocation, retryLocation: () => { if (canRetryLocation) void mutate(false); }, refresh: () => void refresh(), search: () => void mutate(false), cancel: () => void mutate(true), backFromSearch: () => { if (!state.busy && !state.blocked && !latest.current?.home.matchmaking.inQueue) setState(s => ({ ...s, searchPhase: 'idle', error: '', locationFailure: null })); } };
}
