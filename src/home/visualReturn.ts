import type { HomeData } from './contracts';
import { visibleHome } from './hiddenFirstChats';
import { activityPresentation } from './presentation';
export function visualHomeProjection(home: HomeData, completed: ReadonlySet<string>, closedChats: ReadonlySet<string>) {
  const base=visibleHome(home,closedChats);
  // Backend activeInitialCount counts pendingActions. Subtract only advertised
  // visual entries whose confirmed outcome is already suppressed in this owner.
  const removed=new Set(base.pendingActions.filter(item=>item.type==='VISUAL_REVIEW'&&completed.has(item.matchId)).map(item=>item.matchId));
  return {...base,pendingActions:base.pendingActions.filter(item=>item.type!=='VISUAL_REVIEW'||!completed.has(item.matchId)),summary:{...base.summary,activeInitialCount:Math.max(0,base.summary.activeInitialCount-removed.size)}};
}
export function visualReturnTarget(home: HomeData, completed: ReadonlySet<string>, closedChats: ReadonlySet<string>) {
  return activityPresentation(visualHomeProjection(home,completed,closedChats)).hasActivity?'activity':'home';
}
