import { useEffect, useRef, useState } from 'react';
import type { Activity } from './contracts';
import { useHomeTime } from './useHomeTime';
import { contextualTime, secondHomeCopy, secondHomePresentation } from './secondHomePresentation';
export function SecondChatCard({ item, disabled, onOpen, onDismiss }: { item: Activity; disabled: boolean; onOpen: (item: Activity) => void; onDismiss: (id: string) => Promise<void> }) {
  const now = useHomeTime();
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  const lock = useRef(false), lifetime = useRef<AbortController | null>(null);
  useEffect(() => { lifetime.current = new AbortController(); return () => { lifetime.current?.abort(); }; },[]);
  const p = secondHomePresentation(item,now), s = item.secondChat;
  if (!p || !s) return null;
  const dismiss = async () => {
    const signal = lifetime.current?.signal;
    if (!signal || lock.current || disabled) return;
    lock.current=true; setBusy(true); setError('');
    try { await onDismiss(item.connectionId ?? ''); }
    catch { if (!signal.aborted) setError('No pudimos confirmar que se ocultó. Actualizá el estado antes de reintentar.'); }
    finally { if (!signal.aborted) { lock.current=false; setBusy(false); } }
  };
  return <article className="home-card"><h4>{p.state === 'ReadOnly' ? 'Segundo chat en modo lectura' : p.state === 'ReadOnlyEnded' ? 'Segundo chat finalizado' : p.state === 'Expired' ? p.reason === 'entry-cutoff' ? 'Segundo chat: ventana de entrada finalizada' : 'Segundo chat: plazo alcanzado' : p.joined && p.state === 'Open' ? 'Segundo chat en curso' : p.state === 'Waiting' ? 'Segundo chat programado' : 'Segundo chat'}</h4>{item.partnerName && <p>Con {item.partnerName}</p>}
    <p>{secondHomeCopy(item,now)}</p>
    {(p.state === 'Waiting' || p.state === 'Open') && <>
      {!p.joined && <p>Entrada permitida hasta <time dateTime={s.entryClosesAt}>{contextualTime(s.entryClosesAt,now)}</time>.</p>}
      <p>El chat termina <time dateTime={s.expiresAt}>{contextualTime(s.expiresAt,now)}</time>.</p>
      {p.joined && <p>{s.myAttendanceStatus === 'LATE' ? 'Llegaste tarde.' : 'Llegaste a tiempo.'}</p>}
    </>}
    {p.label && <button className="login-button login-primary" disabled={disabled || busy || !p.canOpen} onClick={() => { if (!disabled && !lock.current && secondHomePresentation(item,Date.now())?.canOpen) onOpen(item); }}>{p.label}</button>}
    {p.canProfile && <button disabled={disabled || busy} onClick={() => { if (!disabled && !lock.current && secondHomePresentation(item,Date.now())?.canProfile) onOpen({...item,type:'SCHEDULING_PROFILE'}); }}>Ver perfil</button>}
    {p.canDismiss && <button disabled={disabled || busy} onClick={() => void dismiss()}>Ocultar</button>}{error && <p role="alert">{error}</p>}
  </article>;
}
