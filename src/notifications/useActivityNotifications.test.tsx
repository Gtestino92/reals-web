import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { controllerFixture } from '../chat/fixtures';
import { ApiError } from '../auth/api';
import { parseHome } from '../home/contracts';
import { emptyHome } from '../home/fixtures';
import { activityId, activityTypes } from './activityPolicy';
import { loadPreferences } from './activityStorage';
import { useActivityNotifications } from './useActivityNotifications';

const start = Date.parse('2026-11-22T12:00:00Z');
const iso = (ms = Date.now()) => new Date(ms).toISOString();
const visual = { type: 'VISUAL_REVIEW', matchId: 'm' };
const id = activityId(visual.type, visual.matchId);
const visibility = (state: DocumentVisibilityState) => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue(state);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
};
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
function fixture() {
  const controller = controllerFixture();
  let version = 0, marker: string | null = null, pending: unknown[] = [], next: unknown[] = [], fail = false;
  const status = () => ({ version, dirty: true, nextRefreshAt: marker, serverTime: iso() });
  const data = () => ({ version, serverTime: iso(), pendingActions: pending, nextSteps: next, passiveNotices: [] });
  const request = vi.spyOn(controller, 'request').mockImplementation(async path => {
    if (path === '/me/home/status') return status();
    if (path !== '/me/home/pending') throw Error('Unexpected endpoint');
    if (fail) throw Error('Network unavailable');
    return data();
  });
  const view = renderHook(({ admin }) => useActivityNotifications(controller, 'me', admin), { initialProps: { admin: false } });
  const mode = (mode: 'ordinary' | 'elsewhere' | 'chat') => act(() => view.result.current.setHomeMode(mode));
  const feed = (inQueue = false, items: unknown[] = [], steps: unknown[] = []) => act(() => {
    const home = emptyHome(); home.matchmaking.inQueue = inQueue; home.pendingActions = items; home.nextSteps = steps;
    view.result.current.observeHome(parseHome(home), status(), Date.now());
  });
  return { ...view, controller, mode, feed, request, data, status,
    calls: (kind: 'pending' | 'status') => request.mock.calls.filter(([path]) => path.endsWith(`/${kind}`)),
    marker: (value: string | null) => { marker = value; }, invalidate: () => version++,
    publish: (items: unknown[], steps: unknown[] = []) => { pending = items; next = steps; },
    fail: (value: boolean) => { fail = value; } };
}

beforeEach(() => {
  document.title = 'Original';
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(start);
  visibility('visible');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); vi.useRealTimers(); });

it.each([[true, 10_000], [false, 30_000]] as const)('reuses visible Home and uses the hidden cadence for queue=%s', async (queue, cadence) => {
  const t = fixture(); t.mode('ordinary'); t.feed(queue);
  t.publish([visual]); t.invalidate();
  await tick(60_000);
  expect(t.request).not.toHaveBeenCalled();
  // A fresh operational read sets the handoff cadence.
  t.feed(queue); t.invalidate();
  visibility('hidden');
  await tick(cadence - 1); expect(t.request).not.toHaveBeenCalled();
  await tick(1);
  expect(t.calls('status')).toHaveLength(1);
  expect(t.calls('pending')).toHaveLength(1);
  expect(t.result.current.unread.has(id!)).toBe(true);
  expect(document.title).toBe('(1) Reals');
  visibility('visible'); await tick(cadence * 2);
  expect(t.calls('status')).toHaveLength(1);
  t.unmount(); expect(document.title).toBe('Original');
});

it('fetches pending on an advertised boundary consumed elsewhere and falls back without repeating a dirty marker', async () => {
  const t = fixture(); t.mode('elsewhere'); t.marker(iso(start + 45_000)); t.feed();
  await tick(30_000);
  expect(t.calls('pending')).toHaveLength(0);
  t.marker(null); t.publish([visual]);
  await tick(30_000);
  expect(t.calls('pending')).toHaveLength(1);
  expect(t.result.current.unread.has(id!)).toBe(true);
  await tick(90_000);
  expect(t.calls('pending')).toHaveLength(1);
  t.publish([]); await tick(30_000);
  expect(t.calls('pending')).toHaveLength(2);
  expect(t.result.current.unread.size).toBe(0);
});

it('reconciles known second-chat boundaries, using 10 seconds near the start and during the entry window', async () => {
  const t = fixture(); t.mode('elsewhere');
  const card = { type: 'SECOND_CHAT_SCHEDULED', matchId: 'm', connectionId: 'c', requiresAction: false,
    secondChat: { availableAt: iso(start + 20_000), entryClosesAt: iso(start + 70_000), expiresAt: iso(start + 90_000),
      myAttendanceStatus: 'PENDING', durationMinutes: 1 } };
  t.feed(false, [], [card]);
  await tick(10_000); expect(t.calls('status')).toHaveLength(1); expect(t.calls('pending')).toHaveLength(0);
  t.publish([], [{ ...card, type: 'SECOND_CHAT_AVAILABLE' }]);
  await tick(10_000);
  expect(t.calls('pending')).toHaveLength(1);
  expect(t.result.current.unread.has(activityId('SECOND_CHAT_AVAILABLE', 'c', card.secondChat.availableAt)!)).toBe(true);
  await tick(10_000); expect(t.calls('status')).toHaveLength(3); expect(t.calls('pending')).toHaveLength(1);
  t.publish([]); await tick(40_000);
  expect(t.calls('pending')).toHaveLength(2);
  expect(t.result.current.unread.size).toBe(0);
});

it('shows operational availability crossing the start after status, once per appointment and only until entry closes', async () => {
  const t = fixture(); t.mode('ordinary');
  const startsAt = start + 2_000, cutoff = start + 12_000;
  const card = { type: 'SECOND_CHAT_SCHEDULED', matchId: 'm', connectionId: 'c', requiresAction: false,
    secondChat: { availableAt: iso(startsAt), entryClosesAt: iso(cutoff), expiresAt: iso(start + 90_000),
      myAttendanceStatus: 'PENDING', durationMinutes: 1 } };
  t.feed(false, [], [card]);
  const previousStatus = t.status(), receivedAt = Date.now();
  await tick(3_000);
  expect(t.result.current.unread.size).toBe(0);
  const home = emptyHome();
  home.nextSteps = [{ ...card, type: 'SECOND_CHAT_AVAILABLE' }];
  const present = () => act(() => t.result.current.observeHome(parseHome(home), previousStatus, receivedAt));
  present();
  const key = activityId('SECOND_CHAT_AVAILABLE', 'c', card.secondChat.availableAt);
  expect(t.result.current.unread).toEqual(new Set([key]));
  present(); await tick(5_000);
  expect(t.result.current.unread).toEqual(new Set([key]));
  await tick(4_000);
  expect(t.result.current.unread.size).toBe(0);
  present();
  expect(t.result.current.unread.size).toBe(0);
  expect(t.request).not.toHaveBeenCalled();
});

it('suspends for chat, administration and disabled preference and rebaselines on re-enable', async () => {
  const t = fixture(); t.mode('chat'); t.feed(); t.publish([visual]); t.invalidate();
  await tick(60_000); expect(t.request).not.toHaveBeenCalled();
  t.rerender({ admin: true }); t.mode('elsewhere');
  await tick(60_000); expect(t.request).not.toHaveBeenCalled();
  t.rerender({ admin: false }); await tick(0);
  expect(t.result.current.unread.size).toBe(1);
  act(() => activityTypes.forEach(type => t.result.current.setCategory(type, false)));
  expect(document.title).toBe('Original');
  t.request.mockClear(); await tick(60_000); expect(t.request).not.toHaveBeenCalled();
  act(() => t.result.current.setCategory('VISUAL_REVIEW', true));
  await tick(0); expect(t.calls('pending')).toHaveLength(1);
  expect(t.result.current.unread.size).toBe(0);
});

it('uses current category preferences for late and failed resume reads without changing another category or the cadence', async () => {
  const t = fixture();
  const first = { type: 'FIRST_CHAT', matchId: 'first', chatId: 'chat' };
  const firstId = activityId(first.type, first.matchId, first.chatId)!;
  t.mode('elsewhere'); t.feed(); t.feed(false, [visual, first]);
  expect(document.title).toBe('(2) Reals');
  act(() => t.result.current.setCategory('VISUAL_REVIEW', false));
  expect(t.result.current.unread).toEqual(new Set([firstId]));
  expect(document.title).toBe('(1) Reals');
  act(() => t.result.current.present(id!));
  expect(loadPreferences('me').presented).toEqual([]);

  const duringOptOut = { ...visual, matchId: 'during-opt-out' };
  t.invalidate(); t.publish([visual, first]);
  let release!: (value: unknown) => void;
  t.request.mockImplementationOnce(async () => t.status());
  t.request.mockImplementationOnce(() => new Promise(done => { release = done; }));
  await tick(29_999); expect(t.request).not.toHaveBeenCalled();
  await tick(1); expect(t.calls('pending')).toHaveLength(1);
  await tick(1);
  act(() => t.result.current.setCategory('VISUAL_REVIEW', true));
  await act(async () => release(t.data()));
  expect(loadPreferences('me').needsBaseline).toEqual(['VISUAL_REVIEW']);
  expect(t.result.current.unread).toEqual(new Set([firstId]));

  t.fail(true); t.invalidate(); t.publish([visual, first, duringOptOut]);
  await tick(30_000);
  expect(loadPreferences('me').needsBaseline).toEqual(['VISUAL_REVIEW']);
  t.fail(false);
  await tick(30_000);
  expect(loadPreferences('me').needsBaseline).toEqual([]);
  expect(t.result.current.unread).toEqual(new Set([firstId]));
  const later = { ...visual, matchId: 'new' };
  t.feed(false, [first, duringOptOut, later]);
  expect(t.result.current.unread).toEqual(new Set([firstId, activityId(later.type, later.matchId)]));
});

it('keeps preferences in memory on storage failure and rejects a stale owner changing another account', () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('Storage', 'SecurityError'); });
  const t = fixture(); t.feed();
  act(() => t.result.current.setCategory('VISUAL_REVIEW', false));
  t.feed(false, [visual]);
  expect(t.result.current.categories.VISUAL_REVIEW).toBe(false);
  expect(t.result.current.unread.size).toBe(0);
  const retiredToggle = t.result.current.setCategory;
  const next = controllerFixture();
  next.snapshot = { ...next.snapshot, account: { id: 'next', status: 'ACTIVE' } };
  const nextView = renderHook(() => useActivityNotifications(next, 'next', false));
  t.controller.snapshot = { ...t.controller.snapshot, phase: 'signingOut', account: null };
  act(() => retiredToggle('FIRST_CHAT', false));
  expect(t.result.current.categories.FIRST_CHAT).toBe(true);
  expect(nextView.result.current.categories).toEqual(Object.fromEntries(activityTypes.map(type => [type, true])));
});

it('retains unread updates on failure, recovers on resume and discards a late complementary read after an operational handoff', async () => {
  const t = fixture(); t.mode('elsewhere'); t.feed();
  t.publish([visual]); t.invalidate(); await tick(30_000);
  t.fail(true); t.invalidate(); await tick(30_000);
  expect(t.result.current.unread.has(id!)).toBe(true);
  t.fail(false); visibility('hidden'); await tick(1500);
  let resolve!: (value: unknown) => void;
  t.request.mockImplementationOnce(async () => t.status());
  t.request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  visibility('visible'); await tick(0);
  const signal = t.calls('pending').at(-1)?.[1];
  expect(signal?.aborted).toBe(false);
  t.mode('ordinary'); t.feed();
  expect(signal?.aborted).toBe(true);
  await act(async () => resolve(t.data()));
  expect(t.result.current.unread.size).toBe(0);
});

it('lets an operational or mutation reconciliation preempt a held pending reply in the same mode', async () => {
  const t = fixture(); t.mode('elsewhere'); t.feed();
  const slot = iso(start + 600_000);
  t.invalidate();
  let resolve!: (value: unknown) => void;
  t.request.mockImplementationOnce(async () => t.status()).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await tick(30_000);
  const signal = t.calls('pending').at(-1)?.[1];
  const write = new AbortController();
  const finish = t.result.current.beginHomeRead(write.signal);
  expect(signal?.aborted).toBe(true);
  // Consultation can precede the Home snapshot used by the coordinator.
  act(() => t.result.current.present(activityId('SECOND_CHAT_SCHEDULED', 'c', slot)!));
  const home = emptyHome();
  home.nextSteps = [{ type: 'SECOND_CHAT_SCHEDULED', matchId: 'm', connectionId: 'c', requiresAction: false,
    secondChat: { availableAt: slot, entryClosesAt: iso(start + 1_200_000), expiresAt: iso(start + 3_600_000),
      myAttendanceStatus: 'PENDING', durationMinutes: 50 } }];
  act(() => t.result.current.observeSchedulingHome(parseHome(home), Date.now(), Date.now()));
  finish?.();
  await act(async () => resolve({ ...t.data(), pendingActions: [visual] }));
  expect(t.result.current.unread.size).toBe(0);
});

it('honors Retry-After across an eligible resume and returns to the usual cadence', async () => {
  const t = fixture(); t.mode('elsewhere'); t.feed();
  t.request.mockRejectedValueOnce(new ApiError('backend', 429, 'RATE_LIMITED', {}, 60));
  await tick(30_000);
  visibility('hidden'); await tick(1000); visibility('visible');
  await tick(58_999); expect(t.calls('status')).toHaveLength(1);
  await tick(1); expect(t.calls('status')).toHaveLength(2);
  await tick(30_000); expect(t.calls('status')).toHaveLength(3);
});

it('rejects late results after session invalidation and aborts on coordinator disposal', async () => {
  const t = fixture(); t.mode('elsewhere'); t.feed();
  let resolve!: (value: unknown) => void;
  t.request.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await tick(30_000);
  const signal = t.calls('status').at(-1)?.[1];
  t.controller.snapshot = { ...t.controller.snapshot, phase: 'login', account: null };
  t.unmount(); expect(signal?.aborted).toBe(true);
  await act(async () => resolve(t.status()));
  expect(t.calls('pending')).toHaveLength(0);
  expect(document.title).toBe('Original');
});
