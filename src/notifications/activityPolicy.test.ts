import { afterEach, expect, it, vi } from 'vitest';
import { activityId, isCurrent, parsePendingUpdates } from './activityPolicy';
import { acknowledge, freshPreferences, loadPreferences, reconcilePreferences, savePreferences, storageKey } from './activityStorage';

const at = '2026-11-22T12:00:00Z';
const now = Date.parse(at);
const secondChat = { availableAt: at, entryClosesAt: '2026-11-22T12:20:00Z',
  expiresAt: '2026-11-22T13:00:00Z', myAttendanceStatus: 'PENDING' };
const first = { type: 'FIRST_CHAT', matchId: 'first', chatId: 'chat' };
const visual = { type: 'VISUAL_REVIEW', matchId: 'visual' };
const scheduling = { type: 'SCHEDULING', matchId: 'schedule', connectionId: 'negotiation' };
const confirmed = { type: 'SECOND_CHAT_SCHEDULED', matchId: 'confirmed', connectionId: 'confirmation',
  secondChat: { ...secondChat, availableAt: '2026-11-22T12:10:00Z' } };
const available = { type: 'SECOND_CHAT_AVAILABLE', matchId: 'available', connectionId: 'entry', secondChat };
const snapshot = (pendingActions: unknown[] = [], nextSteps: unknown[] = []) =>
  parsePendingUpdates({ version: 5, serverTime: at, pendingActions, nextSteps, passiveNotices: [] }).updates;

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

it('detects five stable stages from lightweight data, including entry without a chat ID', () => {
  const updates = snapshot([first, visual], [scheduling, confirmed, available]);
  expect(updates.map(v => JSON.parse(v.id))).toEqual([
    ['FIRST_CHAT', 'first', 'chat'], ['VISUAL_REVIEW', 'visual'], ['SCHEDULING', 'negotiation'],
    ['SECOND_CHAT_SCHEDULED', 'confirmation', now + 600_000], ['SECOND_CHAT_AVAILABLE', 'entry', now],
  ]);
  expect(snapshot([], [{ ...available, secondChat: { ...secondChat, availableAt: '2026-11-22T09:00:00-03:00' } }])[0]?.id).toBe(updates.at(-1)?.id);
  for (const attendance of ['NO_SHOW', 'ON_TIME', 'LATE']) {
    expect(snapshot([], [{ ...available, secondChat: { ...secondChat, myAttendanceStatus: attendance } }])).toEqual([]);
  }
  expect(isCurrent(updates[4]!, now + 20 * 60_000)).toBe(false);
});

it('baselines, groups replacements, quietly invalidates, and drops unsupported stages', () => {
  const base = reconcilePreferences(freshPreferences(), snapshot([first]), now);
  expect(base.records).toEqual([[activityId('FIRST_CHAT', 'first', 'chat'), true]]);
  const next = snapshot([first, { ...visual, matchId: 'first' }],
    ['SCHEDULING_PROPOSALS_RECEIVED', 'MATCHMAKING_AVAILABLE', 'SECOND_CHAT_EXPIRED', 'SECOND_CHAT_READ_ONLY'].map(type => ({ ...scheduling, type })));
  const changed = reconcilePreferences(base, next, now);
  expect(changed.records).toEqual([[activityId('VISUAL_REVIEW', 'first'), false]]);
  expect(reconcilePreferences(changed, next, now)).toEqual(changed);
  expect(reconcilePreferences(changed, snapshot(), now).records).toEqual([]);
});

it('retains persisted current unread updates across reload and remembers consultation ahead of Home', () => {
  const appointment = activityId(confirmed.type, confirmed.connectionId, confirmed.secondChat.availableAt)!;
  const baseline = reconcilePreferences(freshPreferences(), [], now);
  const consulted = acknowledge(baseline, appointment, now);
  savePreferences('account', consulted);
  const reloaded = reconcilePreferences(loadPreferences('account'), snapshot([visual], [confirmed]), now);
  expect(reloaded.records).toEqual([[activityId(visual.type, visual.matchId), false], [appointment, true]]);
  expect(reloaded.presented).toEqual([]);
  savePreferences('account', reloaded);
  expect(reconcilePreferences(loadPreferences('account'), snapshot([visual]), now).records).toEqual([[activityId(visual.type, visual.matchId), false]]);
  expect(loadPreferences('another account')).toEqual(freshPreferences());
});

it('ignores invalid persistence, preserves disabled state and works in memory on a quota failure', () => {
  localStorage.setItem(storageKey('account'), '{');
  expect(loadPreferences('account')).toEqual(freshPreferences());
  localStorage.setItem(storageKey('account'), JSON.stringify({ enabled: true, records: [['id', 'seen']], presented: [] }));
  expect(loadPreferences('account')).toEqual(freshPreferences());
  savePreferences('account', freshPreferences(false));
  expect(loadPreferences('account')).toEqual(freshPreferences(false));
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota', 'QuotaExceededError'); });
  const memory = reconcilePreferences(freshPreferences(), snapshot([visual]), now);
  expect(() => savePreferences('account', memory)).not.toThrow();
  expect(reconcilePreferences(memory, snapshot([visual, first]), now).records?.[1]?.[1]).toBe(false);
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('Storage', 'SecurityError'); });
  expect(loadPreferences('account')).toEqual(freshPreferences());
});

it('rejects malformed pending payloads instead of projecting them as empty', () => {
  expect(() => snapshot([{ ...first, chatId: null }])).toThrow();
  expect(() => snapshot([], [{ ...available, secondChat: { ...secondChat, availableAt: 'invalid' } }])).toThrow();
});
