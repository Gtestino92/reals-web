// Synthetic contract fixtures; no user data.
export const emptyHome = () => ({
  profileStatus: 'ACTIVE', matchmaking: { inQueue: false, canSearch: true, blockedReason: null },
  activeInteractionsSummary: { activeInitialCount: 0, activeConnectionCount: 0, actionableConnectionCount: 0, hasPendingSchedulingConnection: false },
  pendingActions: [] as unknown[], nextSteps: [] as unknown[], passiveNotices: [] as unknown[],
});
export const homeStatus = () => ({ version: 1, dirty: false, nextRefreshAt: null, serverTime: '2026-11-05T12:00:00Z' });
