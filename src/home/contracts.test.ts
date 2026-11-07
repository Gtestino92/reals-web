import { expect, it } from 'vitest';
import { parseHome, parseQueue, parseStatus } from './contracts';
import { emptyHome, homeStatus } from './fixtures';
it.each([null, {}, [], { ...emptyHome(), profileStatus: 'UNKNOWN' }, { ...emptyHome(), matchmaking: {} }, { ...emptyHome(), pendingActions: [{}] }, { ...emptyHome(), passiveNotices: [null] }, { ...emptyHome(), nextSteps: null }, { ...emptyHome(), activeInteractionsSummary: {} }])('rejects malformed Home %j', raw => { expect(() => parseHome(raw)).toThrow(); });
it('preserves unknown interaction types and identifiers', () => {
  const home = emptyHome(); home.pendingActions = [{ type: 'FUTURE', matchId: 'm', chatId: null }];
  expect(parseHome(home).pendingActions[0]).toMatchObject({ type: 'FUTURE', matchId: 'm' });
});
it('validates status markers and queue identity', () => {
  expect(parseStatus(homeStatus()).version).toBe(1);
  expect(() => parseStatus({ ...homeStatus(), nextRefreshAt: 'bad' })).toThrow();
  expect(() => parseQueue({ userId: 'other', inQueue: true }, 'u')).toThrow();
  expect(() => parseQueue({ userId: 'u', inQueue: 'false' }, 'u')).toThrow();
});
