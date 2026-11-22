import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Activity } from './contracts';
import { useHomeTime } from './useHomeTime';
import { secondHomeCopy, secondHomePresentation, waitingSecondChatEvent } from './secondHomePresentation';
import { GoogleCalendarAction } from '../shared/GoogleCalendarAction';
import { activityId } from '../notifications/activityPolicy';
import { usePresentedActivity } from '../notifications/usePresentedActivity';
export function SecondChatCard({ item, accountId, disabled, onOpen, onDismiss, presented, badge }: { item: Activity; accountId: string | null; disabled: boolean; onOpen: (item: Activity) => void; onDismiss: (id: string) => Promise<void>; presented?: boolean; badge?: ReactNode }) {
  const now = useHomeTime();
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  const lock = useRef(false), lifetime = useRef<AbortController | null>(null);
  useEffect(() => { lifetime.current = new AbortController(); return () => { lifetime.current?.abort(); }; },[]);
  const p = secondHomePresentation(item,now), s = item.secondChat;
  const appointment = useRef<HTMLParagraphElement>(null);
  usePresentedActivity(appointment, presented && item.type === 'SECOND_CHAT_SCHEDULED' && p?.state === 'Waiting'
    ? activityId(item.type, item.connectionId ?? '', s?.availableAt) : null, true);
  if (!p || !s) return null;
  const calendarEvent = !disabled && !busy ? waitingSecondChatEvent(item, now) : null;
  const dismiss = async () => {
    const signal = lifetime.current?.signal;
    if (!signal || lock.current || disabled) return;
    lock.current=true; setBusy(true); setError('');
    try { await onDismiss(item.connectionId ?? ''); }
    catch { if (!signal.aborted) setError('No pudimos confirmar que se ocultó. Actualizá el estado antes de reintentar.'); }
    finally { if (!signal.aborted) { lock.current=false; setBusy(false); } }
  };
  return <article className="home-card second-chat-card"><h4>{p.state === 'ReadOnly' ? 'Segundo chat en modo lectura' : p.state === 'ReadOnlyEnded' ? 'Segundo chat finalizado' : p.state === 'Expired' ? p.reason === 'entry-cutoff' ? 'Segundo chat: ventana de entrada finalizada' : 'Segundo chat: plazo alcanzado' : p.joined && p.state === 'Open' ? 'Segundo chat en curso' : p.state === 'Waiting' ? 'Segundo chat programado' : 'Segundo chat'}{badge}</h4>{item.partnerName && <p>Con {item.partnerName}</p>}
    <p ref={appointment}>{secondHomeCopy(item,now)}</p>
    <div className="second-chat-card-actions">
    {p.label && <button className="login-button login-primary" disabled={disabled || busy || !p.canOpen} onClick={() => { if (!disabled && !lock.current && secondHomePresentation(item,Date.now())?.canOpen) onOpen(item); }}>{p.label}</button>}
    {p.canProfile && <button className="login-button login-outlined" disabled={disabled || busy} onClick={() => { if (!disabled && !lock.current && secondHomePresentation(item,Date.now())?.canProfile) onOpen({...item,type:'SCHEDULING_PROFILE'}); }}>Ver perfil</button>}
    {calendarEvent && accountId && item.connectionId && <GoogleCalendarAction event={calendarEvent} accountId={accountId} connectionId={item.connectionId}/>}
    {p.canDismiss && <button className="login-button login-outlined" disabled={disabled || busy} onClick={() => void dismiss()}>Ocultar</button>}</div>{error && <p role="alert">{error}</p>}
  </article>;
}
