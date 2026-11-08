import { useEffect, useRef, useState } from 'react';
import { ApiError, object, parseProfile } from '../auth/api';
import type { SessionController } from '../auth/session';
import { parseHome, parseQueue, parseStatus } from './contracts';
import type { HomeData } from './contracts';
import { currentLocation, LocationError } from './location';
import type { LocationFailureKind } from './location';

interface Model { home: HomeData; name: string }
export type SearchPhase = 'idle' | 'locating' | 'admitting' | 'queued' | 'canceling' | 'reconciling' | 'failed';
interface State { model: Model | null; busy: boolean; blocked: boolean; error: string; searchPhase: SearchPhase; locationFailure: LocationFailureKind | null }
interface Owner { lifetime: AbortController; read: AbortController | null; location: AbortController | null; serial: number; mutation: boolean; cancelRequested: boolean; version: number | null; uncertain: boolean; reconcile: boolean }
export function useHome(controller: SessionController, active = true) {
  const [state, setState] = useState<State>({ model: null, busy: true, blocked: true, error: '', searchPhase: 'idle', locationFailure: null });
  const foreground = useRef(active); foreground.current = active;
  const owner = useRef<Owner | null>(null), latest = useRef<Model | null>(null);
  const valid = (r: Owner, serial: number) => owner.current === r && !r.lifetime.signal.aborted && r.serial === serial;
  const load = async (r: Owner, serial: number, signal: AbortSignal, queue = false) => {
    const account = controller.snapshot.account, profileId = controller.snapshot.profile?.id;
    if (!account) throw new ApiError('invalid');
    // Capture baseline before projection: a concurrent invalidation stays observable.
    const status = parseStatus(await controller.request('/me/home/status', signal));
    const rawProfile = await controller.request('/me/profile', signal);
    const profile = parseProfile(rawProfile, account.id);
    if (profile.id !== profileId || !object(rawProfile) || typeof rawProfile.displayName !== 'string' || !rawProfile.displayName.trim()) throw new ApiError('invalid');
    const queued = queue ? parseQueue(await controller.request('/matchmaking/queue', signal), account.id) : null;
    const home = parseHome(await controller.request('/me/home', signal));
    if (queued !== null && queued !== home.matchmaking.inQueue) throw new ApiError('invalid');
    if (profile.status !== home.profileStatus) throw new ApiError('invalid');
    if (valid(r, serial)) {
      const model = { home, name: rawProfile.displayName };
      r.version = status.version; r.reconcile = false; latest.current = model;
      setState(s => ({ ...s, model, blocked: r.uncertain, locationFailure: home.matchmaking.inQueue ? null : s.locationFailure,
        error: r.uncertain || (s.locationFailure && !home.matchmaking.inQueue) ? s.error : '' }));
    }
  };
  const refresh = async (poll = false) => {
    const r = owner.current;
    if (!r || r.mutation || r.lifetime.signal.aborted) return;
    if (r.read) return;
    const read = new AbortController(); r.read = read;
    const signal = AbortSignal.any([read.signal, r.lifetime.signal]), serial = ++r.serial;
    if (!poll) { r.uncertain = false; r.reconcile = true; setState(s => ({ ...s, busy: true, blocked: true, error: '', locationFailure: null })); }
    try {
      if (poll) {
        const status = parseStatus(await controller.request('/me/home/status', signal));
        if (!valid(r, serial)) return;
        if (!r.reconcile && !r.uncertain && status.version === r.version && !status.dirty && !(status.nextRefreshAt && Date.parse(status.serverTime) >= Date.parse(status.nextRefreshAt))) return;
      }
      r.reconcile = true;
      await load(r, serial, signal, !poll && r.cancelRequested);
    } catch {
      if (valid(r, serial) && !signal.aborted) { r.reconcile = true; setState(s => ({ ...s, blocked: true, locationFailure: null, error: 'No pudimos actualizar Inicio. Revisá tu conexión y presioná Actualizar.' })); }
    } finally {
      if (valid(r, serial)) {
        r.read = null;
        setState(s => ({ ...s, busy: false, searchPhase: s.blocked && s.searchPhase !== 'idle' ? 'failed' : latest.current?.home.matchmaking.inQueue ? 'queued' : s.searchPhase === 'failed' && poll ? 'failed' : 'idle' }));
      }
    }
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
    if (!r || r.mutation || state.busy || state.blocked || !model) return;
    if (cancel ? !model.home.matchmaking.inQueue : model.home.profileStatus !== 'ACTIVE' || !model.home.matchmaking.canSearch || model.home.matchmaking.inQueue) return;
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
        if (attempted || !r.cancelRequested) {
          const locationError = error instanceof LocationError ? error : new LocationError('unavailable');
          failure = attempted ? 'No pudimos confirmar la admisión a la búsqueda. Actualizá el estado antes de intentar otra vez.' : locationError.message;
          locationFailure = attempted ? null : locationError.kind;
          r.uncertain = attempted;
        }
      } finally { if (r.location === locationOwner) r.location = null; }
    }
    if (!valid(r, serial)) return;
    let cancellationHandled = false;
    const leaveQueue = async () => {
      cancellationHandled = true;
      setState(s => ({ ...s, searchPhase: 'canceling' }));
      try {
        const result = await controller.request('/matchmaking/queue', signal, 'DELETE');
        parseQueue(result, controller.snapshot.account?.id ?? '');
      } catch {
        if (!valid(r, serial)) return;
        r.uncertain = true; failure = 'No pudimos confirmar la cancelación. La búsqueda podría seguir activa. Actualizá el estado.';
      }
    };
    if (r.cancelRequested && (attempted || cancel)) await leaveQueue();
    if (!valid(r, serial)) return;
    const reconcile = async () => {
      setState(s => ({ ...s, searchPhase: r.cancelRequested ? 'canceling' : 'reconciling' }));
      try { await load(r, serial, signal, true); }
      catch { if (valid(r, serial)) { r.uncertain = true; failure = 'No pudimos confirmar el estado de la búsqueda. Presioná Actualizar antes de volver a intentar.'; } }
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
    const r: Owner = { lifetime: new AbortController(), read: null, location: null, serial: 0, mutation: false, cancelRequested: false, version: null, uncertain: false, reconcile: true };
    owner.current = r; latest.current = null;
    setState({ model: null, busy: true, blocked: true, error: '', searchPhase: 'idle', locationFailure: null });
    queueMicrotask(() => { if (!r.lifetime.signal.aborted) void refresh(); });
    const resume = () => {
      if (foreground.current && document.visibilityState === 'visible') void refresh(latest.current !== null);
      else if (!r.mutation) { r.read?.abort(); r.read = null; }
    };
    const timer = window.setInterval(() => { if (foreground.current && document.visibilityState === 'visible') void refresh(true); }, 5000);
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => { r.lifetime.abort(); r.read?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); if (owner.current === r) { owner.current = null; latest.current = null; } };
    // The authenticated/profile mount owns all callbacks and resources.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller]);
  useEffect(() => {
    const r = owner.current;
    if (!active && r && !r.mutation) {
      r.read?.abort(); r.read = null; r.serial++; r.reconcile = true;
    }
  }, [active]);
  const canRetryLocation = state.searchPhase === 'failed' && state.locationFailure !== null && !state.busy && !state.blocked &&
    state.model?.home.profileStatus === 'ACTIVE' && state.model.home.matchmaking.canSearch && !state.model.home.matchmaking.inQueue;
  return { ...state, canRetryLocation, retryLocation: () => { if (canRetryLocation) void mutate(false); }, refresh: () => void refresh(), search: () => void mutate(false), cancel: () => void mutate(true), backFromSearch: () => { if (!state.busy && !state.blocked && !latest.current?.home.matchmaking.inQueue) setState(s => ({ ...s, searchPhase: 'idle', error: '', locationFailure: null })); } };
}
