import { secondHomePresentation } from './secondHomePresentation';
import type { Activity, HomeData } from './contracts';

export const activityGroups = ['Requiere tu acción', 'En curso', 'Próximamente', 'Recientes', 'Otros'] as const;
function group(item: Activity, now: number): typeof activityGroups[number] {
  const p = secondHomePresentation(item,now);
  if (p) return p.state === 'Open' ? 'En curso' : p.state === 'Waiting' ? 'Próximamente' : 'Recientes';
  switch (item.type) {
    case 'FIRST_CHAT': return 'En curso';
    case 'VISUAL_REVIEW': return 'Requiere tu acción';
    case 'SCHEDULING': return item.requiresAction ? 'Requiere tu acción' : 'Otros';
    case 'SECOND_CHAT_AVAILABLE': return 'En curso';
    case 'SECOND_CHAT_SCHEDULED': return item.secondChat?.chatStatus === 'ACTIVE' ? 'En curso' : 'Próximamente';
    case 'SECOND_CHAT_EXPIRED': case 'SECOND_CHAT_READ_ONLY': return 'Recientes';
    default: return 'Otros';
  }
}
function timestamp(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value); return Number.isFinite(time) ? time : null;
}
function event(item: Activity) {
  return timestamp(item.visualExpiresAt ?? item.schedulingExpiresAt ?? item.secondChat?.availableAt) ?? Infinity;
}
export function activityPresentation(home: HomeData, now = Date.now()) {
  const items = [...home.pendingActions, ...home.nextSteps];
  const groups = activityGroups.map(title => ({ title, items: items.filter(item => group(item,now) === title).sort((a, b) => event(a) - event(b)) })).filter(section => section.items.length > 0);
  const candidates = items.map((item,index) => ({ item, sourceIndex: index < home.pendingActions.length ? index : index-home.pendingActions.length, kind: priorityKind(item,now) }))
    .filter(candidate => candidate.kind !== null)
    .sort((a,b) => priorityEvent(a.item,now)-priorityEvent(b.item,now) || a.sourceIndex-b.sourceIndex || (a.kind === 'visual' ? 0 : a.kind === 'open' ? 1 : 2)-(b.kind === 'visual' ? 0 : b.kind === 'open' ? 1 : 2));
  const priorities = candidates.slice(0,2).map(candidate => candidate.item);
  const hasActivity = items.length > 0 || home.passiveNotices.length > 0 || home.summary.hasPendingSchedulingConnection || home.summary.activeInitialCount > 0 || home.summary.activeConnectionCount > 0 || home.summary.actionableConnectionCount > 0;
  const required = items.filter(item => item.type === 'VISUAL_REVIEW' || item.requiresAction).length;
  return { groups, priorities, priorityOverflow: Math.max(0,candidates.length-2), hasActivity, required };
}

export function priorityKind(item: Activity, now: number): 'visual' | 'open' | 'soon' | null {
  if (item.type === 'VISUAL_REVIEW') {
    const start = timestamp(item.visualStartedAt), end = timestamp(item.visualExpiresAt);
    return start !== null && end !== null && end > start && now < end && (end-now)/(end-start) <= 0.10 ? 'visual' : null;
  }
  const p = secondHomePresentation(item,now), available = timestamp(item.secondChat?.availableAt);
  if (p?.state === 'Open') return 'open';
  return p?.state === 'Waiting' && available !== null && available > now && available-now <= 15*60000 ? 'soon' : null;
}
function priorityEvent(item: Activity, now: number) {
  return timestamp(item.type === 'VISUAL_REVIEW' ? item.visualExpiresAt : priorityKind(item,now) === 'soon' ? item.secondChat?.availableAt : item.secondChat?.expiresAt) ?? Infinity;
}
