import { ApiError, object } from '../auth/api';

const invalid = (): never => { throw new ApiError('invalid'); };
const text = (v: unknown): string => typeof v === 'string' && v.trim() ? v : invalid();
const bool = (v: unknown): boolean => typeof v === 'boolean' ? v : invalid();
const count = (v: unknown): number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : invalid();
const date = (v: unknown): string | null => v === null || v === undefined ? null : typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v)) ? v : invalid();
const optionalText = (v: unknown): string | null => v == null ? null : text(v);
export interface Activity {
  type: string; matchId: string; connectionId: string | null; chatId: string | null;
  partnerName: string | null; requiresAction: boolean;
  visualStartedAt: string | null; visualExpiresAt: string | null;
  createdAt: string | null; schedulingExpiresAt: string | null;
  secondChat: Record<string, unknown> | null;
}
export interface HomeData {
  profileStatus: 'ACTIVE' | 'DRAFT' | 'INACTIVE' | null;
  matchmaking: { inQueue: boolean; canSearch: boolean; blockedReason: { code: string; message: string; nextAvailableAt: string | null } | null };
  summary: { activeInitialCount: number; activeConnectionCount: number; actionableConnectionCount: number; hasPendingSchedulingConnection: boolean };
  pendingActions: Activity[]; nextSteps: Activity[]; passiveNotices: string[];
}
function activities(raw: unknown, next: boolean): Activity[] {
  if (!Array.isArray(raw)) return invalid();
  return raw.map(v => {
    if (!object(v)) return invalid();
    const partner = v.partner;
    if (partner != null && !object(partner)) return invalid();
    const second = v.secondChat;
    if (second != null && !object(second)) return invalid();
    if (object(second)) {
      for (const key of ['availableAt','entryClosesAt','expiresAt','readOnlyUntil']) date(second[key]);
      if (!date(second.availableAt) || !date(second.entryClosesAt) || !date(second.expiresAt)) return invalid();
      optionalText(second.chatId);
      count(second.durationMinutes); text(second.myAttendanceStatus);
      optionalText(second.chatType); optionalText(second.chatStatus);
      if (second.partner != null && (!object(second.partner) || typeof second.partner.displayName !== 'string')) return invalid();
    }
    const type = text(v.type), chatId = optionalText(v.chatId);
    if (!next && type === 'FIRST_CHAT' && !chatId) return invalid();
    return { type, matchId: text(v.matchId), connectionId: next ? text(v.connectionId) : null,
      chatId, partnerName: object(partner) ? text(partner.displayName) : null,
      requiresAction: next ? bool(v.requiresAction) : true,
      visualStartedAt: date(v.visualStartedAt), visualExpiresAt: date(v.visualExpiresAt),
      createdAt: date(v.createdAt), schedulingExpiresAt: date(v.schedulingExpiresAt), secondChat: object(second) ? { ...second } : null };
  });
}
export function parseHome(raw: unknown): HomeData {
  if (!object(raw) || !object(raw.matchmaking) || !object(raw.activeInteractionsSummary) || !Array.isArray(raw.passiveNotices)) return invalid();
  const status = raw.profileStatus;
  if (status !== null && status !== 'ACTIVE' && status !== 'DRAFT' && status !== 'INACTIVE') return invalid();
  const m = raw.matchmaking, s = raw.activeInteractionsSummary, b = m.blockedReason;
  if (b !== null && !object(b)) return invalid();
  return { profileStatus: status, matchmaking: { inQueue: bool(m.inQueue), canSearch: bool(m.canSearch), blockedReason: object(b) ? { code: text(b.code), message: text(b.message), nextAvailableAt: date(b.nextAvailableAt) } : null },
    summary: { activeInitialCount: count(s.activeInitialCount), activeConnectionCount: count(s.activeConnectionCount), actionableConnectionCount: count(s.actionableConnectionCount), hasPendingSchedulingConnection: bool(s.hasPendingSchedulingConnection) },
    pendingActions: activities(raw.pendingActions, false), nextSteps: activities(raw.nextSteps, true),
    passiveNotices: raw.passiveNotices.map(v => object(v) ? text(v.type) : invalid()) };
}
export function parseStatus(raw: unknown) {
  if (!object(raw)) return invalid();
  const serverTime = date(raw.serverTime);
  if (!serverTime || raw.nextRefreshAt === undefined) return invalid();
  return { version: count(raw.version), dirty: bool(raw.dirty), nextRefreshAt: date(raw.nextRefreshAt), serverTime };
}
export function parseQueue(raw: unknown, userId: string) {
  if (!object(raw) || raw.userId !== userId) return invalid();
  return bool(raw.inQueue);
}
