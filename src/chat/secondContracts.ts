import { ApiError, object } from '../auth/api';
import { str, type AudioPolicy } from './contracts';
const invalid = (): never => { throw new ApiError('invalid'); };
const bool = (v: unknown) => typeof v === 'boolean' ? v : invalid();
const date = (v: unknown) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(str(v)) && Number.isFinite(Date.parse(str(v))) ? str(v) : invalid();
const optional = (v: unknown) => v == null ? null : str(v);
const optionalDate = (v: unknown) => v == null ? null : date(v);
function member<const T extends readonly string[]>(v: unknown, values: T): T[number] { const s = str(v); return values.find(x => x === s) ?? invalid(); }
export const chatStates = ['ACTIVE','AVAILABLE','FINISHED','ABANDONED','EXPIRED','CANCELLED','CLOSED'] as const;
export const attendanceStates = ['PENDING','ON_TIME','LATE','NO_SHOW'] as const;
export type Attendance = typeof attendanceStates[number];
export interface Resolution {
  id: string; type: 'PARTNER_NO_SHOW' | 'MUTUAL_COMPLETION' | 'PARTNER_INACTIVITY';
  requesterUserId: string; responderUserId: string; referenceMessageId: string | null;
  status: 'PENDING' | 'CANCELLED' | 'COMPLETED' | 'ACCEPTED' | 'REJECTED' | 'TIMED_OUT'; createdAt: string; expiresAt: string;
}
export function audioPolicy(v: unknown): AudioPolicy | null {
  if (v == null) return null;
  if (!object(v)) return invalid();
  const number = (n: unknown) => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : invalid();
  return { enabled: bool(v.enabled), unavailableReason: optional(v.unavailableReason), maxDurationMillis: number(v.maxDurationMillis), maxFileSizeBytes: number(v.maxFileSizeBytes), remainingMessages: v.remainingMessages == null ? null : number(v.remainingMessages) };
}
function resolution(v: unknown, participants: string[]): Resolution | null {
  if (v == null) return null;
  if (!object(v) || !participants.includes(str(v.requesterUserId)) || !participants.includes(str(v.responderUserId)) || v.requesterUserId === v.responderUserId) return invalid();
  return { id: str(v.id), type: member(v.type,['PARTNER_NO_SHOW','MUTUAL_COMPLETION','PARTNER_INACTIVITY']), status: member(v.status,['PENDING','CANCELLED','COMPLETED','ACCEPTED','REJECTED','TIMED_OUT']), requesterUserId: str(v.requesterUserId), responderUserId: str(v.responderUserId), referenceMessageId: optional(v.referenceMessageId), createdAt: date(v.createdAt), expiresAt: date(v.expiresAt) };
}
export interface SecondStatus {
  connectionId: string; chatId: string | null; scheduledAt: string; onTimeUntil: string; entryClosesAt: string; absoluteExpiresAt: string; serverTime: string;
  myAttendanceStatus: Attendance; partnerAttendanceStatus: Attendance; myJoinedAt: string | null; partnerJoinedAt: string | null;
  canJoin: boolean; canClaimPartnerNoShow: boolean; activeNoShowClaim: Resolution | null; activeResolutionRequest: Resolution | null;
  chatStatus: typeof chatStates[number] | null; conversationStartedAt: string | null; readOnlyUntil: string | null; endedAt: string | null; endedReason: string | null;
  mutualCompletionEligibleAt: string | null; canRequestMutualCompletion: boolean; mutualCompletionCooldownUntil: string | null;
  inactivityClaimableAt: string | null; inactivityClosesAt: string | null; canClaimPartnerInactivity: boolean; mustRespondToPartner: boolean;
  lastMessageAt: string | null; lastMessageSenderId: string | null; audioPolicy: AudioPolicy | null;
}
export function parseSecondStatus(v: unknown, connectionId: string, participants: string[]): SecondStatus {
  if (!object(v) || v.connectionId !== connectionId) return invalid();
  const result: SecondStatus = {
    connectionId, chatId: optional(v.chatId), scheduledAt: date(v.scheduledAt), onTimeUntil: date(v.onTimeUntil), entryClosesAt: date(v.entryClosesAt), absoluteExpiresAt: date(v.absoluteExpiresAt), serverTime: date(v.serverTime),
    myAttendanceStatus: member(v.myAttendanceStatus,attendanceStates), partnerAttendanceStatus: member(v.partnerAttendanceStatus,attendanceStates), myJoinedAt: optionalDate(v.myJoinedAt), partnerJoinedAt: optionalDate(v.partnerJoinedAt),
    canJoin: bool(v.canJoin), canClaimPartnerNoShow: bool(v.canClaimPartnerNoShow), activeNoShowClaim: resolution(v.activeNoShowClaim,participants), activeResolutionRequest: resolution(v.activeResolutionRequest,participants),
    chatStatus: v.chatStatus == null ? null : member(v.chatStatus,chatStates), conversationStartedAt: optionalDate(v.conversationStartedAt), readOnlyUntil: optionalDate(v.readOnlyUntil), endedAt: optionalDate(v.endedAt), endedReason: optional(v.endedReason),
    mutualCompletionEligibleAt: optionalDate(v.mutualCompletionEligibleAt), canRequestMutualCompletion: bool(v.canRequestMutualCompletion), mutualCompletionCooldownUntil: optionalDate(v.mutualCompletionCooldownUntil),
    inactivityClaimableAt: optionalDate(v.inactivityClaimableAt), inactivityClosesAt: optionalDate(v.inactivityClosesAt), canClaimPartnerInactivity: bool(v.canClaimPartnerInactivity), mustRespondToPartner: bool(v.mustRespondToPartner), lastMessageAt: optionalDate(v.lastMessageAt), lastMessageSenderId: optional(v.lastMessageSenderId), audioPolicy: audioPolicy(v.audioPolicy),
  };
  if (result.lastMessageSenderId && !participants.includes(result.lastMessageSenderId)) return invalid();
  if (Date.parse(result.onTimeUntil) < Date.parse(result.scheduledAt) || Date.parse(result.entryClosesAt) < Date.parse(result.onTimeUntil) || Date.parse(result.absoluteExpiresAt) < Date.parse(result.entryClosesAt)) return invalid();
  return result;
}
export const joined = (s: Attendance) => s === 'ON_TIME' || s === 'LATE';
export function secondPolicy(s: SecondStatus | null, now: number) {
  const active = !!s && !!s.chatId && joined(s.myAttendanceStatus) && s.chatStatus === 'ACTIVE';
  const expired = !!s && now >= Date.parse(s.absoluteExpiresAt);
  const pending = s?.activeResolutionRequest?.status === 'PENDING' ? s.activeResolutionRequest : null;
  const claim = s?.activeNoShowClaim?.status === 'PENDING' ? s.activeNoShowClaim : null;
  const elapsedResolution = !!pending && now >= Date.parse(pending.expiresAt);
  const elapsedInactivity = !!s?.inactivityClosesAt && now >= Date.parse(s.inactivityClosesAt);
  const cutoff = !!s && joined(s.myAttendanceStatus) && !joined(s.partnerAttendanceStatus) && now >= Date.parse(s.entryClosesAt);
  const readable = !!s?.chatId && (active && !expired || !!s?.readOnlyUntil && ['FINISHED','ABANDONED','EXPIRED'].includes(s.chatStatus ?? '') && now < Date.parse(s.readOnlyUntil));
  return { active, expired, pending, claim, readable, writable: active && !expired && !elapsedResolution && !elapsedInactivity && !(claim && now >= Date.parse(claim.expiresAt)),
    canReturn: !s || !active || expired || cutoff, cutoff,
    canJoin: !!s && s.canJoin && now >= Date.parse(s.scheduledAt) && now < Date.parse(s.entryClosesAt) && !expired,
    noShow: active && !expired && !claim && !!s?.canClaimPartnerNoShow && now < Date.parse(s.entryClosesAt),
    completion: active && !expired && !pending && !!s?.canRequestMutualCompletion && !s.mutualCompletionCooldownUntil,
    inactivity: active && !expired && !pending && !!s?.canClaimPartnerInactivity && !elapsedInactivity,
  };
}
