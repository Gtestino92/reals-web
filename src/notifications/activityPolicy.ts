import { ApiError, object } from '../auth/api';
import type { Activity, HomeData } from '../home/contracts';
import { parseOffsetTimestamp } from '../shared/offsetTimestamp';

const stages = ['FIRST_CHAT', 'VISUAL_REVIEW', 'SCHEDULING', 'SECOND_CHAT_SCHEDULED', 'SECOND_CHAT_AVAILABLE'];
interface Update {
  id: string;
  matchId: string;
  rank: number;
  starts: number | null;
  ends: number | null;
  entryEnds: number | null;
}

export function activityId(type: string, resource: string, detail?: string | null) {
  if (!resource || !stages.includes(type)) return null;
  if (type === 'FIRST_CHAT') return detail ? JSON.stringify([type, resource, detail]) : null;
  if (type === 'SECOND_CHAT_SCHEDULED' || type === 'SECOND_CHAT_AVAILABLE') {
    const instant = parseOffsetTimestamp(detail);
    return instant === null ? null : JSON.stringify([type, resource, instant]);
  }
  return JSON.stringify([type, resource]);
}

export function isActivityId(value: string) {
  try {
    const parts: unknown = JSON.parse(value);
    if (!Array.isArray(parts)) return false;
    const [stage, resource, detail] = parts;
    if (typeof stage !== 'string' || typeof resource !== 'string' || !resource.trim()) return false;
    if (stage === 'SECOND_CHAT_SCHEDULED' || stage === 'SECOND_CHAT_AVAILABLE') {
      return parts.length === 3 && Number.isSafeInteger(detail);
    }
    return stage === 'FIRST_CHAT' ? parts.length === 3 && typeof detail === 'string' && !!detail.trim()
      : parts.length === 2 && stages.includes(stage);
  } catch { return false; }
}

export function updateFor(item: Pick<Activity, 'type' | 'matchId' | 'connectionId' | 'chatId' | 'visualExpiresAt' | 'schedulingExpiresAt'> & {
  secondChat: Pick<NonNullable<Activity['secondChat']>, 'availableAt' | 'entryClosesAt' | 'expiresAt' | 'myAttendanceStatus'> & { chatStatus?: string | null } | null;
}): Update | null {
  const { type, matchId, connectionId, chatId, secondChat } = item;
  const rank = stages.indexOf(type);
  const id = activityId(type, rank < 2 ? matchId : connectionId ?? '', type === 'FIRST_CHAT' ? chatId : secondChat?.availableAt);
  if (!id) return null;
  if (rank < 3) return { id, matchId, rank, starts: null, ends: parseOffsetTimestamp(item.visualExpiresAt ?? item.schedulingExpiresAt), entryEnds: null };
  if (!secondChat || secondChat.myAttendanceStatus !== 'PENDING' ||
      (secondChat.chatStatus && !['ACTIVE', 'AVAILABLE'].includes(secondChat.chatStatus))) return null;
  const starts = parseOffsetTimestamp(secondChat.availableAt);
  const cutoff = parseOffsetTimestamp(secondChat.entryClosesAt);
  const expiry = parseOffsetTimestamp(secondChat.expiresAt);
  if (starts === null || cutoff === null || expiry === null || starts >= Math.min(cutoff, expiry)) return null;
  const entryEnds = Math.min(cutoff, expiry);
  return { id, matchId, rank, starts, ends: type === 'SECOND_CHAT_SCHEDULED' ? starts : entryEnds, entryEnds };
}

function group(items: (Update | null)[]) {
  const current = new Map<string, Update>();
  for (const item of items) {
    if (item && (current.get(item.matchId)?.rank ?? -1) <= item.rank) current.set(item.matchId, item);
  }
  return [...current.values()];
}

export const homeUpdates = (home: HomeData) => group([...home.pendingActions, ...home.nextSteps].map(updateFor));
const invalid = (): never => { throw new ApiError('invalid'); };
const requiredText = (value: unknown) => typeof value === 'string' && value.trim() ? value : invalid();
const optionalDate = (value: unknown) => value == null ? null : parseOffsetTimestamp(value) !== null ? requiredText(value) : invalid();

// Pending has its own contract: no partner, matchmaking summary, or materialized chat required.
export function parsePendingUpdates(value: unknown) {
  if (!object(value) || typeof value.version !== 'number' || !Number.isSafeInteger(value.version) || value.version < 0 ||
      !Array.isArray(value.pendingActions) || !Array.isArray(value.nextSteps) || !Array.isArray(value.passiveNotices) ||
      !value.passiveNotices.every(v => object(v) && typeof v.type === 'string' && v.type.trim())) return invalid();
  const serverTime = parseOffsetTimestamp(value.serverTime) ?? invalid();
  const pending = value.pendingActions.map((entry: unknown) => {
    if (!object(entry)) return invalid();
    const type = requiredText(entry.type), matchId = requiredText(entry.matchId);
    return updateFor({ type, matchId, connectionId: null, chatId: type === 'FIRST_CHAT' ? requiredText(entry.chatId) : null,
      visualExpiresAt: optionalDate(entry.visualExpiresAt), schedulingExpiresAt: null, secondChat: null });
  });
  const next = value.nextSteps.map((entry: unknown) => {
    if (!object(entry)) return invalid();
    const type = requiredText(entry.type), matchId = requiredText(entry.matchId), connectionId = requiredText(entry.connectionId);
    const chat = entry.secondChat;
    let secondChat = null;
    if (type === 'SECOND_CHAT_AVAILABLE' || type === 'SECOND_CHAT_SCHEDULED') {
      if (chat == null) return null;
      if (!object(chat)) return invalid();
      const attendance = requiredText(chat.myAttendanceStatus);
      if (!['PENDING', 'NO_SHOW', 'ON_TIME', 'LATE'].includes(attendance)) return invalid();
      const availableAt = optionalDate(chat.availableAt) ?? invalid();
      const entryClosesAt = optionalDate(chat.entryClosesAt) ?? invalid();
      const expiresAt = optionalDate(chat.expiresAt) ?? invalid();
      if (Date.parse(availableAt) >= Math.min(Date.parse(entryClosesAt), Date.parse(expiresAt))) return invalid();
      secondChat = { availableAt, entryClosesAt, expiresAt, myAttendanceStatus: attendance };
    }
    return updateFor({ type, matchId, connectionId, chatId: null, visualExpiresAt: null,
      schedulingExpiresAt: optionalDate(entry.schedulingExpiresAt), secondChat });
  });
  return { version: value.version, serverTime, updates: group([...pending, ...next]) };
}

export type ActivityUpdate = Update;
export const isCurrent = (item: Update, now: number, serverTime: number) =>
  (item.rank !== 4 || item.starts === null || item.starts <= serverTime) && (item.ends === null || now < item.ends);

export const fallbackInterval = 120_000;
export function notificationInterval({ suspended, ordinary, visible, queued, nearSecondChat }: {
  suspended: boolean; ordinary: boolean; visible: boolean; queued: boolean; nearSecondChat: boolean;
}) {
  if (suspended || (ordinary && visible)) return null;
  return (!visible && queued) || nearSecondChat ? 10_000 : 30_000;
}
