import type { Message, Reply } from './contracts';
export interface Outgoing { clientMessageId: string; content: string | null; file: Blob | null; replyTo: Reply | null; phase: 'pending' | 'failed' | 'uncertain' }
export function confirmsOutgoing(message: Message, outgoing: Outgoing, me: string) {
  if (message.senderId !== me || message.clientMessageId !== outgoing.clientMessageId) return false;
  if (outgoing.file) return true;
  const normalized = outgoing.content?.replace(/\r\n?/g, '\n').trim();
  return !!normalized && message.messageType === 'TEXT' && !message.audio &&
    message.content?.trim() === normalized && message.replyTo?.type === outgoing.replyTo?.type &&
    message.replyTo?.targetId === outgoing.replyTo?.targetId;
}
export function messageRequest(chatId: string, o: Outgoing): { path: string; body: unknown } {
  if (o.file) {
    const body = new FormData(); body.append('file', o.file, 'recording.m4a'); body.append('clientMessageId', o.clientMessageId);
    if (o.replyTo) { body.append('replyToType', o.replyTo.type); body.append('replyToTargetId', o.replyTo.targetId); }
    return { path: `/chats/${chatId}/audio-messages`, body };
  }
  return { path: `/chats/${chatId}/messages`, body: { content: o.content, clientMessageId: o.clientMessageId, ...(o.replyTo ? { replyTo: o.replyTo } : {}) } };
}
