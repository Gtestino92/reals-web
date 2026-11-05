import { useEffect, useRef, useState } from 'react';
import { ApiError, object, parseProfile } from '../auth/api';
import type { SessionController } from '../auth/session';
import { parseHome, parseQueue, parseStatus } from './contracts';
import type { HomeData } from './contracts';
import { currentLocation } from './location';

interface Model { home: HomeData; name: string }
export type SearchPhase = 'idle' | 'locating' | 'admitting' | 'queued' | 'canceling' | 'reconciling' | 'failed';
interface State { model: Model | null; busy: boolean; blocked: boolean; error: string; searchPhase: SearchPhase }
interface Owner { lifetime: AbortController; read: AbortController | null; location: AbortController | null; serial: number; mutation: boolean; cancelRequested: boolean; version: number | null; uncertain: boolean }
export function useHome(controller: SessionController) {
  const [state, setState] = useState<State>({ model: null, busy: true, blocked: true, error: '', searchPhase: 'idle' });
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
      r.version = status.version; latest.current = model;
      setState(s => ({ ...s, model, blocked: r.uncertain, error: r.uncertain ? s.error : '' }));
    }
  };
  const refresh = async (poll = false) => {
    const r = owner.current;
    if (!r || r.mutation || r.lifetime.signal.aborted) return;
    if (poll && r.read) return;
    r.read?.abort();
    const read = new AbortController(); r.read = read;
    const signal = AbortSignal.any([read.signal, r.lifetime.signal]), serial = ++r.serial;
    if (!poll) { r.uncertain = false; setState(s => ({ ...s, busy: true, blocked: true, error: '' })); }
    try {
      if (poll) {
        const status = parseStatus(await controller.request('/me/home/status', signal));
        if (!valid(r, serial)) return;
        if (status.version === r.version && !status.dirty && !(status.nextRefreshAt && Date.parse(status.serverTime) >= Date.parse(status.nextRefreshAt))) return;
      }
      await load(r, serial, signal, !poll && r.cancelRequested);
    } catch {
      if (valid(r, serial) && !signal.aborted) setState(s => ({ ...s, blocked: true, error: 'No pudimos actualizar Inicio. Revisá tu conexión y presioná Actualizar.' }));
    } finally {
      if (valid(r, serial)) {
        r.read = null;
        setState(s => ({ ...s, busy: false, searchPhase: s.blocked && s.searchPhase !== 'idle' ? 'failed' : s.searchPhase === 'failed' && poll ? 'failed' : latest.current?.home.matchmaking.inQueue ? 'queued' : 'idle' }));
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
    setState(s => ({ ...s, busy: true, error: '', searchPhase: cancel ? 'canceling' : 'locating' }));
    let failure = '', attempted = false;
    if (!cancel) {
      const locationOwner = new AbortController(); r.location = locationOwner;
      try {
        const location = await currentLocation(AbortSignal.any([signal, locationOwner.signal]));
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
          failure = attempted ? 'No pudimos confirmar la admisión. Actualizá el estado antes de intentar otra vez.' : error instanceof Error ? error.message : 'No pudimos obtener tu ubicación. Volvé a intentar.';
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
      setState(s => ({ ...s, searchPhase: 'reconciling' }));
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
        setState(s => ({ ...s, busy: false, blocked: r.uncertain, error: failure, searchPhase: failure ? 'failed' : latest.current?.home.matchmaking.inQueue ? 'queued' : 'idle' }));
      }
    }
  };
  useEffect(() => {
    const r: Owner = { lifetime: new AbortController(), read: null, location: null, serial: 0, mutation: false, cancelRequested: false, version: null, uncertain: false };
    owner.current = r; latest.current = null;
    setState({ model: null, busy: true, blocked: true, error: '', searchPhase: 'idle' });
    queueMicrotask(() => { if (!r.lifetime.signal.aborted) void refresh(); });
    const resume = () => {
      if (document.visibilityState === 'visible') void refresh();
      else if (!r.mutation) { r.read?.abort(); r.read = null; }
    };
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(true); }, 5000);
    document.addEventListener('visibilitychange', resume);
    return () => { r.lifetime.abort(); r.read?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', resume); if (owner.current === r) { owner.current = null; latest.current = null; } };
    // The authenticated/profile mount owns all callbacks and resources.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller]);
  return { ...state, refresh: () => void refresh(), search: () => void mutate(false), cancel: () => void mutate(true), backFromSearch: () => { if (!state.busy && !state.blocked && !latest.current?.home.matchmaking.inQueue) setState(s => ({ ...s, searchPhase: 'idle', error: '' })); } };
}
