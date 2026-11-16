import type { Activity } from './contracts';

export type SecondHomeState = 'Waiting' | 'Open' | 'ReadOnly' | 'ReadOnlyEnded' | 'Expired' | 'Unavailable';
export interface SecondHomePresentation {
  state: SecondHomeState; canOpen: boolean; canProfile: boolean; canDismiss: boolean;
  label: string | null; joined: boolean; reason: 'entry-cutoff' | 'absolute-expiry' | 'terminal' | null;
}
export function secondHomePresentation(item: Activity, now = Date.now()): SecondHomePresentation | null {
  const s = item.secondChat;
  if (!s || !item.type.startsWith('SECOND_CHAT_')) return null;
  const joined = s.myAttendanceStatus === 'ON_TIME' || s.myAttendanceStatus === 'LATE';
  const needsEntry = s.myAttendanceStatus === 'PENDING' || s.myAttendanceStatus === 'NO_SHOW';
  const terminalStatus = ['FINISHED','ABANDONED','EXPIRED','CANCELLED','CLOSED'].includes(s.chatStatus ?? '');
  const liveStatus = s.chatStatus === null || s.chatStatus === 'AVAILABLE' || s.chatStatus === 'ACTIVE';
  const retained = item.type === 'SECOND_CHAT_READ_ONLY';
  const readOnly = retained && !!s.chatId && ['EXPIRED','FINISHED','ABANDONED'].includes(s.chatStatus ?? '') && !!s.readOnlyUntil && now < Date.parse(s.readOnlyUntil);
  const entryClosed = needsEntry && now >= Date.parse(s.entryClosesAt);
  const absoluteExpired = now >= Date.parse(s.expiresAt);
  const expired = item.type === 'SECOND_CHAT_EXPIRED' || entryClosed || absoluteExpired;
  const joinedActive = joined && !!s.chatId && s.chatStatus === 'ACTIVE';
  const waiting = !expired && !terminalStatus && !joinedActive && now < Date.parse(s.availableAt);
  const state: SecondHomeState = retained ? readOnly ? 'ReadOnly' : 'ReadOnlyEnded'
    : expired ? 'Expired' : terminalStatus || !liveStatus || (!needsEntry && !joinedActive) ? 'Unavailable' : waiting ? 'Waiting' : 'Open';
  const identified = !!item.connectionId?.trim() && !!item.matchId.trim();
  return {
    state, joined, reason: retained ? null : item.type === 'SECOND_CHAT_EXPIRED' ? 'entry-cutoff' : terminalStatus ? 'terminal' : entryClosed ? 'entry-cutoff' : absoluteExpired ? 'absolute-expiry' : null,
    canOpen: identified && (state === 'ReadOnly' || state === 'Open'),
    canProfile: !retained && (state === 'Waiting' || state === 'Open'),
    canDismiss: !!item.connectionId?.trim() && (retained || expired || terminalStatus),
    label: state === 'ReadOnly' ? 'Ver segundo chat' : state === 'Open' ? 'Entrar al segundo chat' : state === 'Waiting' ? `Disponible a las ${backendTime(s.availableAt)}` : null,
  };
}
export const backendTime = (time: string) => new Date(time).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit',hour12:false});
export function contextualTime(time: string, now: number): string {
  const date = new Date(time), today = new Date(now), tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate()+1);
  const sameDay = (other: Date) => date.getFullYear() === other.getFullYear() && date.getMonth() === other.getMonth() && date.getDate() === other.getDate();
  if (sameDay(today)) return `Hoy, ${backendTime(time)}`;
  if (sameDay(tomorrow)) return `Mañana, ${backendTime(time)}`;
  const parts = new Intl.DateTimeFormat('es-AR',{weekday:'long',day:'numeric',month:'long',...(date.getFullYear() !== today.getFullYear() ? {year:'numeric' as const} : {})}).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === type)?.value ?? '';
  const day = `${part('weekday')} ${part('day')} de ${part('month')}${part('year') ? ` de ${part('year')}` : ''}`;
  return `${day.charAt(0).toLocaleUpperCase('es-AR')}${day.slice(1)}, ${backendTime(time)}`;
}
export function secondHomeCopy(item: Activity, now: number) {
  const p = secondHomePresentation(item,now), s = item.secondChat;
  if (!p || !s) return '';
  if (p.state === 'ReadOnlyEnded') return 'El período de solo lectura terminó.';
  if (p.state === 'ReadOnly') return s.readOnlyUntil ? `Disponible solo para lectura hasta ${contextualTime(s.readOnlyUntil,now)}.` : 'Disponible solo para lectura.';
  if (p.reason === 'terminal') return 'Este segundo chat ya no está disponible.';
  if (p.reason === 'entry-cutoff') return 'La ventana para entrar terminó.';
  if (p.reason === 'absolute-expiry') return 'Terminó el tiempo máximo del segundo chat. Actualizando el estado.';
  if (p.state === 'Unavailable') return 'No se puede entrar en este momento. Actualizá el estado.';
  const minutes = s.durationMinutes, duration = minutes % 60 === 0 ? `${minutes/60} ${minutes === 60 ? 'hora' : 'horas'}` : `${minutes} minutos`;
  return `${p.state === 'Waiting' ? 'Programado para' : 'Disponible desde'} ${contextualTime(s.availableAt,now)}. Duración máxima: ${duration}.`;
}
