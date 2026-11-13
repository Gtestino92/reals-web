import type { Reply } from './contracts';
export interface Outgoing { clientMessageId: string; content: string | null; file: Blob | null; replyTo: Reply | null; phase: 'pending' | 'failed' | 'uncertain' }
export function messageRequest(chatId: string, o: Outgoing): { path: string; body: unknown } {
  if (o.file) {
    const body = new FormData(); body.append('file', o.file, 'recording.m4a'); body.append('clientMessageId', o.clientMessageId);
    if (o.replyTo) { body.append('replyToType', o.replyTo.type); body.append('replyToTargetId', o.replyTo.targetId); }
    return { path: `/chats/${chatId}/audio-messages`, body };
  }
  return { path: `/chats/${chatId}/messages`, body: { content: o.content, clientMessageId: o.clientMessageId, ...(o.replyTo ? { replyTo: o.replyTo } : {}) } };
}
