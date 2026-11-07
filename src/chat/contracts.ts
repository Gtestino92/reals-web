import { ApiError, object } from '../auth/api';
const invalid = (): never => { throw new ApiError('invalid'); };
export const str = (v: unknown): string => typeof v === 'string' && v.length > 0 ? v : invalid();
const num = (v: unknown): number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : invalid();
const bool = (v: unknown): boolean => typeof v === 'boolean' ? v : invalid();
const date = (v: unknown): string => Number.isFinite(Date.parse(str(v))) ? str(v) : invalid();
const decision = (v: unknown): string => ['PENDING','APPROVED','REJECTED'].includes(str(v)) ? str(v) : invalid();
export interface Reply { type: 'MESSAGE' | 'GUIDANCE_QUESTION'; targetId: string }
export interface Message {
  id: string; chatSessionId: string; senderId: string; clientMessageId: string | null; messageType: string;
  content: string | null; sentAt: string; reactionType: 'HEART' | null;
  replyTo: (Reply & { previewText: string | null; senderId?: string | null; messageType?: string | null }) | null;
  audio: { url: string; durationMillis: number; sizeBytes: number; contentType: string } | null;
}
export interface Guidance {
  question: { id: string; instanceId: string | null; text: string }; questionOrdinal: number; maxQuestions: number;
  requiredParticipationScore: number; directQuestionReplyMultiplier: number; progressionAction: string | null;
  canRequestNext: boolean; myNextRequested: boolean; completed: boolean;
}
export interface AudioPolicy { enabled: boolean; unavailableReason: string | null; maxDurationMillis: number; maxFileSizeBytes: number; remainingMessages: number | null }
export interface Chat {
  id: string; matchId: string; status: string; partner: { userId: string; displayName: string };
  myDecision: string; partnerDecision: string; timeoutAt: string; inactivityExpiresAt: string | null;
  serverTime: string; guidance: Guidance | null; audioPolicy: AudioPolicy | null;
}
export interface Exit { id: string; requesterUserId: string; responderUserId: string; status: string; createdAt: string; type: string }
export function parseChat(v: unknown, matchId: string, chatId: string, partnerId: string): Chat {
  if (!object(v) || v.id !== chatId || v.matchId !== matchId || v.chatType !== 'FIRST_CHAT' || !object(v.partner) || v.partner.userId !== partnerId) return invalid();
  let guidance: Guidance | null = null, audioPolicy: AudioPolicy | null = null;
  if (v.guidance != null) {
    const g = v.guidance; if (!object(g) || !object(g.question)) return invalid();
    guidance = { question: { id: str(g.question.id), instanceId: g.question.instanceId == null ? null : str(g.question.instanceId), text: str(g.question.text) },
      questionOrdinal: num(g.questionOrdinal), maxQuestions: num(g.maxQuestions), requiredParticipationScore: num(g.requiredParticipationScore), directQuestionReplyMultiplier: num(g.directQuestionReplyMultiplier),
      progressionAction: g.progressionAction == null ? null : str(g.progressionAction), canRequestNext: bool(g.canRequestNext), myNextRequested: bool(g.myNextRequested), completed: bool(g.completed) };
  }
  if (v.audioPolicy != null) {
    const a = v.audioPolicy; if (!object(a)) return invalid();
    audioPolicy = { enabled: bool(a.enabled), unavailableReason: a.unavailableReason == null ? null : str(a.unavailableReason), maxDurationMillis: num(a.maxDurationMillis), maxFileSizeBytes: num(a.maxFileSizeBytes), remainingMessages: a.remainingMessages == null ? null : num(a.remainingMessages) };
  }
  return { id: chatId, matchId, status: str(v.status), partner: { userId: partnerId, displayName: str(v.partner.displayName) }, myDecision: decision(v.myDecision), partnerDecision: decision(v.partnerDecision), timeoutAt: date(v.timeoutAt), inactivityExpiresAt: v.inactivityExpiresAt == null ? null : date(v.inactivityExpiresAt), serverTime: date(v.serverTime), guidance, audioPolicy };
}
export function parseMessage(v: unknown, chatId: string, participants: string[]): Message {
  if (!object(v) || v.chatSessionId !== chatId || !participants.includes(str(v.senderId))) return invalid();
  let replyTo: Message['replyTo'] = null, audio: Message['audio'] = null;
  if (v.replyTo != null) {
    const r = v.replyTo; if (!object(r) || (r.type !== 'MESSAGE' && r.type !== 'GUIDANCE_QUESTION')) return invalid();
    const senderId = r.senderId == null ? null : str(r.senderId);
    if (senderId !== null && !participants.includes(senderId)) return invalid();
    replyTo = { type: r.type, targetId: str(r.targetId), previewText: r.previewText == null ? null : str(r.previewText), senderId, messageType: r.messageType == null ? null : str(r.messageType) };
  }
  if (v.audio != null) {
    const a = v.audio; if (!object(a)) return invalid();
    const url = str(a.url); if (!/^https?:\/\//i.test(url)) return invalid();
    audio = { url, durationMillis: num(a.durationMillis), sizeBytes: num(a.sizeBytes), contentType: str(a.contentType) };
  }
  if (v.reactionType != null && v.reactionType !== 'HEART') return invalid();
  return { id: str(v.id), chatSessionId: chatId, senderId: str(v.senderId), clientMessageId: v.clientMessageId == null ? null : str(v.clientMessageId), messageType: str(v.messageType), content: v.content == null ? null : str(v.content), sentAt: date(v.sentAt), reactionType: v.reactionType === 'HEART' ? 'HEART' : null, replyTo, audio };
}
export function parseExits(v: unknown, chatId: string, participants: string[]): Exit[] {
  if (!Array.isArray(v)) return invalid();
  return v.map(e => {
    if (!object(e) || e.chatId !== chatId || !participants.includes(str(e.requesterUserId)) || !participants.includes(str(e.responderUserId)) || e.requesterUserId === e.responderUserId) return invalid();
    return { id: str(e.id), requesterUserId: str(e.requesterUserId), responderUserId: str(e.responderUserId), status: str(e.status), createdAt: date(e.createdAt), type: str(e.type) };
  }).sort((a,b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}
export function mergeMessages(old: Message[], incoming: Message[]): Message[] {
  const map = new Map(old.map(m => [m.id,m]));
  for (const m of incoming) {
    const prev = map.get(m.id), previousReply = prev?.replyTo;
    const sameTarget = m.replyTo && previousReply?.type === m.replyTo.type && previousReply.targetId === m.replyTo.targetId;
    const replyTo = m.replyTo ? { ...m.replyTo,
      senderId: m.replyTo.senderId ?? (sameTarget ? previousReply?.senderId ?? null : null),
      messageType: m.replyTo.messageType ?? (sameTarget ? previousReply?.messageType ?? null : null),
    } : previousReply ?? null;
    map.set(m.id, { ...m, reactionType: m.reactionType ?? prev?.reactionType ?? null, replyTo });
  }
  return [...map.values()].sort((a,b) => Date.parse(a.sentAt) - Date.parse(b.sentAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
export function reactable(messages: Message[], me: string): Set<string> {
  let last = messages.length - 1; while (last >= 0 && messages[last]?.senderId === me) last--;
  let boundary = last - 1; while (boundary >= 0 && messages[boundary]?.senderId !== me) boundary--;
  return new Set(messages.slice(boundary + 1, last + 1).filter(m => !m.reactionType && ((m.messageType === 'TEXT' && !!m.content) || (m.messageType === 'AUDIO' && !!m.audio))).map(m => m.id));
}
export function reactionCursor(messages: Message[]): string | undefined {
  let runs = 1;
  for (let i = messages.length - 2; i >= 0; i--) {
    if (messages[i]?.senderId !== messages[i+1]?.senderId && ++runs > 2) return messages[i]?.id;
  }
  return undefined;
}
export function plainText(s: string): boolean { return s.trim().length > 0 && s.length <= 1000 && !/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f<>]/.test(s); }
export function policy(chat: Chat | null, exits: Exit[], now: number) {
  const active = chat?.status === 'ACTIVE';
  const decisionOnly = !!chat && (chat.myDecision === 'APPROVED' || chat.partnerDecision === 'APPROVED');
  const expired = !!chat && now >= Math.min(Date.parse(chat.timeoutAt), !decisionOnly && chat.inactivityExpiresAt ? Date.parse(chat.inactivityExpiresAt) : Infinity);
  const pending = exits.find(e => e.type === 'MUTUAL_CANCEL' && e.status === 'PENDING');
  return { ordinary: active && !expired && !pending && !decisionOnly, decide: active && !expired && !pending && chat?.myDecision === 'PENDING', safety: active, pending, decisionOnly, expired };
}
