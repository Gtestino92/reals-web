import { ApiError, object } from '../auth/api';

const invalid = (): never => { throw new ApiError('invalid'); };
const text = (v: unknown): string => typeof v === 'string' && v.trim() ? v : invalid();
const integer = (v: unknown): number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : invalid();
export function timestamp(v: unknown): string {
  if (typeof v !== 'string') return invalid();
  const match = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.\d+)?)?(?:Z|([+-])(\d\d):(\d\d))$/.exec(v);
  if (!match || !Number.isFinite(Date.parse(v))) return invalid();
  const [, year, month, day, hour, minute, second, , offsetHour, offsetMinute] = match;
  const calendar = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (calendar.toISOString().slice(0, 10) !== `${year}-${month}-${day}` || Number(hour)>23 || Number(minute)>59 || Number(second ?? 0)>59 || Number(offsetHour ?? 0)>23 || Number(offsetMinute ?? 0)>59) return invalid();
  return v;
}
const nullableDate = (v: unknown) => v === null ? null : timestamp(v);
export interface Connection { id: string; matchId: string; userAId: string; userBId: string; state: string; schedulingExpiresAt: string; createdAt: string; updatedAt: string }
export interface Negotiation { id: string; connectionId: string; roundNumber: number; status: string; confirmedDateTime: string | null; schedulingExpiresAt: string; createdAt: string; updatedAt: string }
export interface Proposal { id: string; connectionId: string; userId: string; roundNumber: number; preferenceOrder: number; proposedDateTime: string; status: 'PENDING' | 'ACCEPTED' | 'REJECTED'; createdAt: string }
export interface Availability { conflictWindowMinutes: number; serverTime: string; unavailableWindows: { startsAt: string; endsAt: string }[] }
export function parseConnection(v: unknown, id: string, matchId: string, me: string): Connection {
  if (!object(v) || v.id !== id || v.matchId !== matchId || (v.userAId !== me && v.userBId !== me) || v.userAId === v.userBId) return invalid();
  return { id, matchId, userAId: text(v.userAId), userBId: text(v.userBId), state: text(v.state), schedulingExpiresAt: timestamp(v.schedulingExpiresAt), createdAt: timestamp(v.createdAt), updatedAt: timestamp(v.updatedAt) };
}
export function parseNegotiation(v: unknown, connectionId: string): Negotiation {
  if (!object(v) || v.connectionId !== connectionId) return invalid();
  const result = { id: text(v.id), connectionId, roundNumber: integer(v.roundNumber), status: text(v.status), confirmedDateTime: nullableDate(v.confirmedDateTime), schedulingExpiresAt: timestamp(v.schedulingExpiresAt), createdAt: timestamp(v.createdAt), updatedAt: timestamp(v.updatedAt) };
  if (result.status === 'CONFIRMED' && !result.confirmedDateTime) return invalid();
  return result;
}
export function parseProposals(v: unknown, connectionId: string, participants: string[]): Proposal[] {
  if (!Array.isArray(v)) return invalid();
  const ids = new Set<string>();
  return v.map(row => {
    if (!object(row) || row.connectionId !== connectionId || !participants.includes(String(row.userId)) || !['PENDING', 'ACCEPTED', 'REJECTED'].includes(String(row.status))) return invalid();
    const id = text(row.id); if (ids.has(id)) return invalid(); ids.add(id);
    return { id, connectionId, userId: text(row.userId), roundNumber: integer(row.roundNumber), preferenceOrder: integer(row.preferenceOrder), proposedDateTime: timestamp(row.proposedDateTime), status: row.status === 'PENDING' ? 'PENDING' : row.status === 'ACCEPTED' ? 'ACCEPTED' : 'REJECTED', createdAt: timestamp(row.createdAt) };
  });
}
export function parseAvailability(v: unknown): Availability {
  if (!object(v) || typeof v.conflictWindowMinutes !== 'number' || !Number.isSafeInteger(v.conflictWindowMinutes) || v.conflictWindowMinutes < 0 || !Array.isArray(v.unavailableWindows)) return invalid();
  return { conflictWindowMinutes: v.conflictWindowMinutes, serverTime: timestamp(v.serverTime), unavailableWindows: v.unavailableWindows.map(w => {
    if (!object(w)) return invalid();
    const startsAt = timestamp(w.startsAt), endsAt = timestamp(w.endsAt);
    if (Date.parse(startsAt) > Date.parse(endsAt)) return invalid();
    return { startsAt, endsAt };
  }) };
}
