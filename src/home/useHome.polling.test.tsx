import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Home } from './Home';
import { useHome } from './useHome';
import { controllerFixture } from '../chat/fixtures';
import { emptyHome } from './fixtures';

const available = Date.parse('2026-11-16T12:00:10Z');
const iso = (time: number) => new Date(time).toISOString();
function fixture(initialMarker: string | null = iso(available), withConnection = true, queued = false) {
  const controller = controllerFixture();
  let serverTime = available - 10000, version = 1, dirty = false;
  let marker = initialMarker, fail = '', hold = '';
  let displayName = 'Synthetic', profileStatus: 'ACTIVE' | 'DRAFT' = 'ACTIVE';
  const releases: (() => void)[] = [];
  const request = vi.spyOn(controller, 'request').mockImplementation(async (path, _signal, method) => {
    // Capture at request time; delayed replies deliberately ignore abort.
    let value: unknown;
    if (path === '/me/home/status') value = { version, dirty, nextRefreshAt: marker, serverTime: iso(serverTime) };
    else if (path === '/me/profile') value = { id: 'p', userId: 'me', status: profileStatus, displayName };
    else if (path === '/matchmaking/queue') {
      if (method === 'DELETE') queued = false;
      value = { userId: 'me', inQueue: queued };
    } else if (path === '/me/home') {
      const home = emptyHome();
      // A real, unrelated connection keeps Activity reachable before the review
      // appears. Initial-action counts must still equal advertised actions.
      home.profileStatus = profileStatus;
      home.matchmaking.inQueue = queued;
      if (withConnection) {
        home.nextSteps = [{ type: 'SCHEDULING', connectionId: 'existing', matchId: 'existing', requiresAction: false }];
        home.activeInteractionsSummary.activeConnectionCount = 1;
      }
      if (serverTime >= available) {
        home.pendingActions = [{ type: 'VISUAL_REVIEW', matchId: 'synthetic', visualStartedAt: iso(available), visualExpiresAt: iso(available + 3600000) }];
        marker = null;
      }
      home.activeInteractionsSummary.activeInitialCount = home.pendingActions.length;
      dirty = false;
      value = home;
    } else if (path === '/reference/affinity-questions') value = { catalogVersion: 'synthetic', categories: [], questions: [] };
    else if (path === '/me/profile/affinity-answers') value = { answers: [] };
    else throw Error(`Unexpected synthetic path: ${path}`);
    if (path === hold) await new Promise<void>(resolve => releases.push(resolve));
    if (path === fail) throw Error('Synthetic network failure');
    return value;
  });
  return { controller, request, releases, count: (path: string) => request.mock.calls.filter(c => c[0] === path).length,
    time: (time: number) => { serverTime = time; }, invalidate: () => { version++; dirty = true; },
    marker: (value: string | null) => { marker = value; }, fail: (path = '') => { fail = path; }, hold: (path = '') => { hold = path; },
    dirty: () => { dirty = true; }, rename: (value: string) => { displayName = value; }, moveToDraft: () => { profileStatus = 'DRAFT'; } };
}
const settle = async () => { await act(async () => { for (let i = 0; i < 25; i++) await Promise.resolve(); }); };
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); };
function visibility(value: DocumentVisibilityState) {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(value);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
}
beforeEach(() => { vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] }); vi.setSystemTime(available - 10000); vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible'); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it.each([available - 1, available, available + 1])('uses server time at boundary %s with unchanged version and dirty', async time => {
  const f = fixture(), { result } = renderHook(() => useHome(f.controller)); await settle();
  expect(result.current.model?.home.pendingActions).toHaveLength(0);
  expect(result.current.model?.home.summary.activeInitialCount).toBe(0);
  f.time(time); await tick();
  expect(f.count('/me/home')).toBe(time < available ? 1 : 2);
  expect(result.current.model?.home.pendingActions).toHaveLength(time < available ? 0 : 1);
  expect(result.current.model?.home.summary.activeInitialCount).toBe(time < available ? 0 : 1);
  await tick(); expect(f.count('/me/home')).toBe(time < available ? 1 : 2);
});

it.each([false, true])('updates mounted Home presentation with Activity open=%s', async activity => {
  const f = fixture(); render(<Home controller={f.controller}/>); await settle();
  if (activity) fireEvent.click(screen.getByRole('button', { name: 'Ver Actividad' }));
  expect(screen.queryByText('Descubrí el perfil')).toBeNull();
  f.time(available + 1); await tick();
  if (activity) expect(screen.getByText('Descubrí el perfil')).toBeVisible();
  else expect(screen.getByRole('button', { name: 'Ver Actividad' })).toHaveTextContent('1 requieren tu acción');
  expect(f.count('/me/home')).toBe(2);
});

it('pauses hidden polling and discovers a due review immediately on foreground', async () => {
  const f = fixture(), { result } = renderHook(() => useHome(f.controller)); await settle();
  const statuses = f.count('/me/home/status'); visibility('hidden'); f.time(available + 1); await tick();
  expect(f.count('/me/home/status')).toBe(statuses);
  visibility('visible'); await settle();
  expect(result.current.model?.home.pendingActions).toHaveLength(1);
});

it.each(['/me/home/status', '/me/home'])('recovers from network failure on %s', async path => {
  const f = fixture(), { result } = renderHook(() => useHome(f.controller)); await settle();
  f.time(available + 1); f.fail(path); await tick();
  expect(result.current.blocked).toBe(true); expect(result.current.error).not.toBe('');
  f.fail(); await tick();
  expect(result.current.blocked).toBe(false); expect(result.current.error).toBe('');
  expect(result.current.model?.home.pendingActions).toHaveLength(1);
});

it('refreshes on version invalidation even without a due marker', async () => {
  const f = fixture(), { result } = renderHook(() => useHome(f.controller)); await settle();
  f.marker(null); f.time(available + 1); f.invalidate(); await tick();
  expect(result.current.model?.home.pendingActions).toHaveLength(1);
});

it('distinguishes an unannounced direct database edit from normal scheduling', async () => {
  const f = fixture(null), { result } = renderHook(() => useHome(f.controller)); await settle();
  f.marker(null); f.time(available + 1); await tick(); await tick();
  expect(f.count('/me/home')).toBe(1); expect(result.current.model?.home.pendingActions).toHaveLength(0);
  act(() => result.current.refresh()); await settle();
  expect(result.current.model?.home.pendingActions).toHaveLength(1);
});

it.each([null, iso(available + 60_000)])('reconciles a previously advertised boundary when another device replaces it with %s', async marker => {
  const f = fixture(null), { result } = renderHook(() => useHome(f.controller)); await settle();
  f.marker(iso(available)); f.time(available - 1); await tick();
  expect(f.count('/me/home')).toBe(1);
  f.marker(marker); f.time(available); await tick();
  expect(result.current.model?.home.pendingActions[0]?.type).toBe('VISUAL_REVIEW');
  expect(f.count('/me/home')).toBe(2);
  // A consumed marker can still be returned by status and must not reload Home.
  f.marker(iso(available)); await tick(); await tick();
  expect(f.count('/me/home')).toBe(2);
  expect(f.count('/me/home/status')).toBe(5);
  if (marker) {
    f.marker(null); f.time(Date.parse(marker)); await tick(); await tick();
    expect(f.count('/me/home')).toBe(3);
  }
});

it('serializes concurrent manual refresh, online and interval reads', async () => {
  const f = fixture(), { result } = renderHook(() => useHome(f.controller)); await settle();
  f.time(available + 1); f.hold('/me/home'); act(() => result.current.refresh()); await settle();
  act(() => { result.current.refresh(); window.dispatchEvent(new Event('online')); }); await tick();
  expect(f.count('/me/home')).toBe(2);
  f.hold(); await act(async () => f.releases.shift()?.()); await settle();
  expect(result.current.model?.home.pendingActions).toHaveLength(1); expect(result.current.busy).toBe(false);
});

it('rejects aborted pre-transition data after a newer foreground read', async () => {
  const f = fixture(), { result } = renderHook(() => useHome(f.controller)); await settle();
  f.hold('/me/home'); act(() => result.current.refresh()); await settle();
  visibility('hidden'); f.time(available + 1); f.hold(); visibility('visible'); await settle();
  expect(result.current.model?.home.pendingActions).toHaveLength(1);
  await act(async () => f.releases.shift()?.()); await settle();
  expect(result.current.model?.home.pendingActions).toHaveLength(1); expect(result.current.busy).toBe(false);
});

it('rejects responses belonging to a replaced controller', async () => {
  const old = fixture(), next = fixture(); old.hold('/me/home');
  const { result, rerender } = renderHook(({ controller }) => useHome(controller), { initialProps: { controller: old.controller } }); await settle();
  next.time(available + 1); rerender({ controller: next.controller }); await settle();
  await act(async () => old.releases.shift()?.()); await settle();
  expect(result.current.model?.home.pendingActions).toHaveLength(1);
});

it.each(['clean', 'name edit', 'dirty', 'version', 'due', 'profile status', 'interaction', 'uncertain'] as const)(
  'revalidates a retained Home on a %s return', async mode => {
    const f = fixture(iso(available), mode === 'interaction');
    const { result, rerender } = renderHook(({ active }) => useHome(f.controller, active, null, !active), { initialProps: { active: true } });
    await settle();
    const retained = result.current.model?.home;
    rerender({ active: false });
    if (mode === 'name edit') f.rename('Actualizado');
    if (mode === 'dirty') f.dirty();
    if (mode === 'version') f.invalidate();
    if (mode === 'due') f.time(available);
    if (mode === 'profile status') f.moveToDraft();
    rerender({ active: true });
    act(() => { result.current.refreshOnReturn(mode === 'uncertain'); }); await settle();
    const reusable = mode === 'clean' || mode === 'name edit';
    expect(f.count('/me/home/status')).toBe(2);
    expect(f.count('/me/profile')).toBe(2);
    expect(f.count('/me/home')).toBe(reusable ? 1 : 2);
    expect(result.current.model?.home === retained).toBe(reusable);
    expect(result.current.model?.name).toBe(mode === 'name edit' ? 'Actualizado' : 'Synthetic');
    expect(result.current.model?.home.profileStatus).toBe(mode === 'profile status' ? 'DRAFT' : 'ACTIVE');
    expect(result.current.returning).toBe(false);
  },
);

it('discards an obsolete return read after leaving again and fails closed on a fresh return failure', async () => {
  const f = fixture(null, false);
  const { result, rerender } = renderHook(({ active }) => useHome(f.controller, active, null, !active), { initialProps: { active: true } });
  await settle();
  rerender({ active: false }); rerender({ active: true });
  f.rename('Obsoleto'); f.hold('/me/profile');
  act(() => { result.current.refreshOnReturn(); }); await settle();
  expect(result.current.returning).toBe('ordinary');
  const oldSignal = f.request.mock.calls.filter(call => call[0] === '/me/profile').at(-1)?.[1];
  rerender({ active: false });
  expect(oldSignal?.aborted).toBe(true);
  f.rename('Vigente'); f.hold(); f.fail('/me/home/status');
  rerender({ active: true });
  act(() => { result.current.refreshOnReturn(); }); await settle();
  expect(result.current.model?.name).toBe('Synthetic');
  expect(result.current.blocked).toBe(true);
  expect(result.current.error).toMatch(/Reintentar/);
  await act(async () => f.releases.shift()?.()); await settle();
  expect(result.current.model?.name).toBe('Synthetic');
  f.fail(); act(() => { result.current.refresh(); }); await settle();
  expect(result.current.model?.name).toBe('Vigente');
  expect(result.current.blocked).toBe(false);
});

it.each(['version', 'boundary'])('retains the cancellation baseline across a concurrent %s change', async change => {
  const f = fixture(iso(available), false, true);
  const { result } = renderHook(() => useHome(f.controller)); await settle();
  f.hold('/me/home');
  act(() => result.current.cancel()); await settle();
  expect(result.current.busy).toBe(true);
  if (change === 'version') f.invalidate();
  else { f.time(available); f.marker(null); }
  f.hold(); f.releases.shift()!(); await settle();
  expect(result.current.blocked).toBe(false);
  await tick(); expect(f.count('/me/home')).toBe(3);
  await tick(); expect(f.count('/me/home')).toBe(3);
});

it.each(['/me/home/status', '/me/profile', '/me/home'])('blocks on failed cancellation read %s until explicit recovery', async path => {
  const f = fixture(null, false, true);
  const { result } = renderHook(() => useHome(f.controller)); await settle();
  f.fail(path); act(() => result.current.cancel()); await settle();
  expect(result.current.blocked).toBe(true);
  f.fail(); await tick(); expect(result.current.blocked).toBe(true);
  act(() => result.current.refresh()); await settle();
  expect(result.current.blocked).toBe(false);
  expect(f.request.mock.calls.filter(call => call[2] === 'DELETE')).toHaveLength(1);
});
it.each(['hidden', 'replacement', 'profile change'])('guards a delayed cancellation projection across %s', async transition => {
  const f = fixture(null, false, true), replacement = fixture(null, false);
  const { result, rerender } = renderHook(({ controller }) => useHome(controller), { initialProps: { controller: f.controller } });
  await settle();
  f.hold('/me/home/status');
  act(() => result.current.cancel()); await settle();
  if (transition === 'replacement') rerender({ controller: replacement.controller });
  if (transition === 'hidden') visibility('hidden');
  if (transition === 'profile change') f.moveToDraft();
  f.hold(); f.releases.shift()!(); await settle();
  if (transition === 'replacement') {
    expect(f.count('/me/home')).toBe(1);
    expect(replacement.count('/me/home')).toBe(1);
  } else if (transition === 'hidden') {
    expect(result.current.canAutoOpen()).toBe(false);
    visibility('visible'); await settle(); expect(result.current.canAutoOpen()).toBe(true);
  } else expect(result.current.model?.home.profileStatus).toBe('DRAFT');
});
