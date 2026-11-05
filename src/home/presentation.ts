import type { Activity, HomeData } from './contracts';

export const activityGroups = ['Requiere tu acción', 'En curso', 'Próximamente', 'Recientes', 'Otros'] as const;
function group(item: Activity): typeof activityGroups[number] {
  switch (item.type) {
    case 'FIRST_CHAT': return 'En curso';
    case 'VISUAL_REVIEW': return 'Requiere tu acción';
    case 'SCHEDULING': return item.requiresAction ? 'Requiere tu acción' : 'En curso';
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
  const groups = activityGroups.map(title => ({ title, items: items.filter(item => group(item) === title).sort((a, b) => event(a) - event(b)) })).filter(section => section.items.length > 0);
  const priorities = items.filter(item => {
    if (item.type === 'FIRST_CHAT' || item.type === 'SECOND_CHAT_AVAILABLE' || (item.type === 'SECOND_CHAT_SCHEDULED' && item.secondChat?.chatStatus === 'ACTIVE')) return true;
    if (item.type === 'VISUAL_REVIEW') {
      const start = timestamp(item.visualStartedAt), end = timestamp(item.visualExpiresAt);
      return start !== null && end !== null && end > start && now < end && (end - now) / (end - start) <= 0.10;
    }
    const available = timestamp(item.secondChat?.availableAt);
    return item.type === 'SECOND_CHAT_SCHEDULED' && available !== null && available > now && available - now <= 15 * 60000;
  }).sort((a, b) => a.type === 'FIRST_CHAT' && b.type !== 'FIRST_CHAT' ? -1 : b.type === 'FIRST_CHAT' && a.type !== 'FIRST_CHAT' ? 1 : event(a) - event(b)).slice(0, 2);
  const hasActivity = items.length > 0 || home.passiveNotices.length > 0 || home.summary.hasPendingSchedulingConnection || home.summary.activeInitialCount > 0 || home.summary.activeConnectionCount > 0 || home.summary.actionableConnectionCount > 0;
  const required = items.filter(item => item.type === 'VISUAL_REVIEW' || item.requiresAction).length;
  return { groups, priorities, hasActivity, required };
}
