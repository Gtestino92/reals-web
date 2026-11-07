import type { HomeData } from './contracts';

// Account/profile mount owns this set. Only conclusive chat results add IDs;
// a successful authoritative Home snapshot retires IDs it no longer advertises.
export function reconcileHiddenFirstChats(home: HomeData, hidden: Set<string>, knownClosed: ReadonlySet<string> = hidden) {
  const advertised = new Set([...home.pendingActions, ...home.nextSteps]
    .filter(item => item.type === 'FIRST_CHAT').map(item => item.matchId));
  for (const id of hidden) if (!advertised.has(id)) hidden.delete(id);
  for (const id of knownClosed) if (advertised.has(id)) hidden.add(id);
}

export function visibleHome(home: HomeData, hidden: ReadonlySet<string>): HomeData {
  const removed = new Set([...home.pendingActions, ...home.nextSteps]
    .filter(item => item.type === 'FIRST_CHAT' && hidden.has(item.matchId)).map(item => item.matchId));
  const visible = (item: HomeData['pendingActions'][number]) => item.type !== 'FIRST_CHAT' || !hidden.has(item.matchId);
  return { ...home, pendingActions: home.pendingActions.filter(visible), nextSteps: home.nextSteps.filter(visible),
    summary: { ...home.summary, activeInitialCount: Math.max(0, home.summary.activeInitialCount - removed.size) } };
}
