import type { ReactNode } from 'react';
import type { Outgoing } from './messageRequest';
import { ReplyQuote } from './ReplyQuote';

export function OutgoingMessage({ message, continuation, quote, children }: {
  message: Outgoing; continuation: boolean; quote: { label: string; text: string } | null; children: ReactNode;
}) {
  const pending = message.phase === 'pending';
  return <li className={`chat-message-row outgoing${continuation ? ' chat-message-continuation' : ''}`}>
    <div className="reply-swipe"><article className="chat-message outgoing">
      {quote && <blockquote className="chat-quote"><ReplyQuote {...quote}/></blockquote>}
      {message.file ? <div className="chat-playback chat-audio-pending">Audio pendiente</div> : <p>{message.content}</p>}
      <span className="chat-delivery" role="status">{pending ? 'Enviando…' : message.phase === 'uncertain' ? 'Sin confirmar' : 'Falló el envío'}</span>
      {children}
    </article></div>
  </li>;
}
