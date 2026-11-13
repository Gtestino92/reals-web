import type { Activity } from './contracts';
export function secondHomePresentation(item: Activity, now = Date.now()) {
  const s = item.secondChat;
  if (!s || !item.type.startsWith('SECOND_CHAT_')) return null;
  const terminal = item.type === 'SECOND_CHAT_EXPIRED' || now >= Date.parse(s.expiresAt);
  const retained = item.type === 'SECOND_CHAT_READ_ONLY';
  const readOnly = retained && !!s.chatId && ['EXPIRED','FINISHED','ABANDONED'].includes(s.chatStatus ?? '') && !!s.readOnlyUntil && now < Date.parse(s.readOnlyUntil);
  const waiting = !terminal && now < Date.parse(s.availableAt);
  const canOpen = !!item.connectionId && (retained ? readOnly : !terminal && !waiting);
  return { state: retained ? readOnly ? 'ReadOnly' : 'ReadOnlyEnded' : terminal ? 'Expired' : waiting ? 'Waiting' : 'Open', canOpen,
    canProfile: !retained && !terminal, canDismiss: !!item.connectionId && (retained || terminal || s.chatStatus === 'EXPIRED'),
    label: retained ? readOnly ? 'Ver segundo chat' : null : terminal ? null : waiting ? `Disponible a las ${new Date(s.availableAt).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}` : 'Entrar al segundo chat',
  };
}
