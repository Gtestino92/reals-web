import type { Message } from './contracts';

export function replyPreview(citation: NonNullable<Message['replyTo']>, me: string, partnerId: string | undefined, partnerName: string | undefined) {
  return {
    label: citation.type === 'GUIDANCE_QUESTION' ? 'Pregunta' : citation.senderId === me ? 'Vos' : citation.senderId && citation.senderId === partnerId ? partnerName || 'Tu match' : 'Respuesta',
    text: citation.messageType === 'AUDIO' ? 'Mensaje de audio' : citation.previewText || 'Contenido no disponible',
  };
}
export function ReplyQuote({ label, text }: { label: string; text: string }) {
  return <div className="chat-quote-content"><strong>{label}</strong><span>{text}</span></div>;
}
