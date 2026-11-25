import { ApiError, object } from '../auth/api';
import { parseOffsetTimestamp } from '../shared/offsetTimestamp';

const invalid = (): never => { throw new ApiError('invalid'); };
const text = (v: unknown): string => typeof v === 'string' && v.trim() ? v : invalid();
const integer = (v: unknown): number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : invalid();
export function timestamp(v: unknown): string {
  if (typeof v !== 'string' || parseOffsetTimestamp(v) === null) return invalid();
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

export function parseSchedulingSnapshot(raw: unknown, id: string, matchId: string, me: string) {
  if (!object(raw)) return invalid();
  const connection = parseConnection(raw.connection, id, matchId, me);
  const serverTime = timestamp(raw.serverTime);
  const proposals = parseProposals(raw.proposals, id, [connection.userAId, connection.userBId]);
  if (connection.state === 'SCHEDULING_PENDING') {
    if (raw.negotiation !== null || raw.availability !== null || proposals.length) return invalid();
    return { connection, negotiation: null, proposals, availability: null, serverTime };
  }
  const negotiation = parseNegotiation(raw.negotiation, id);
  const availability = parseAvailability(raw.availability);
  const allowedStates: Record<string, string[]> = {
    PENDING: ['SCHEDULING_PHASE', 'CLOSED'],
    CONFIRMED: ['SECOND_CHAT_SCHEDULED', 'SECOND_CHAT_AVAILABLE', 'SECOND_CHAT', 'CLOSED'],
    FAILED: ['CLOSED'],
  };
  if (!Object.hasOwn(allowedStates, negotiation.status) || !allowedStates[negotiation.status]?.includes(connection.state) ||
      negotiation.schedulingExpiresAt !== connection.schedulingExpiresAt || availability.serverTime !== serverTime ||
      proposals.some(proposal => proposal.roundNumber > negotiation.roundNumber)) return invalid();
  return { connection, negotiation, proposals, availability, serverTime };
}
