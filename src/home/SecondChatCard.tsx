import { useEffect, useRef, useState } from 'react';
import type { Activity } from './contracts';
import { secondHomePresentation } from './secondHomePresentation';
export function SecondChatCard({ item, disabled, onOpen, onDismiss }: { item: Activity; disabled: boolean; onOpen: (item: Activity) => void; onDismiss: (id: string) => Promise<void> }) {
  const [now,setNow] = useState(Date.now()), [busy,setBusy] = useState(false), [error,setError] = useState('');
  const lock = useRef(false), lifetime = useRef<AbortController | null>(null);
  useEffect(() => { lifetime.current = new AbortController(); const timer = setInterval(() => setNow(Date.now()),1000); return () => { lifetime.current?.abort(); clearInterval(timer); }; },[]);
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
  return <article className="home-card"><h4>{p.state === 'ReadOnly' ? 'Segundo chat en modo lectura' : p.state === 'Expired' ? 'Segundo chat: ventana finalizada' : 'Segundo chat'}</h4>{item.partnerName && <p>Con {item.partnerName}</p>}
    <p>Inicio: <time dateTime={s.availableAt}>{new Date(s.availableAt).toLocaleString('es-AR',{dateStyle:'medium',timeStyle:'short'})}</time></p><p>Duración: {s.durationMinutes} minutos. Hasta {new Date(s.expiresAt).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}.</p>
    {p.state === 'ReadOnlyEnded' && <p>El período de solo lectura terminó.</p>}{p.state === 'Expired' && <p>La ventana para entrar terminó.</p>}
    {p.label && <button className="login-button login-primary" disabled={disabled || busy || !p.canOpen} onClick={() => onOpen(item)}>{p.label}</button>}
    {p.canProfile && <button disabled={disabled || busy} onClick={() => onOpen({...item,type:'SCHEDULING_PROFILE'})}>Ver perfil</button>}
    {p.canDismiss && <button disabled={disabled || busy} onClick={() => void dismiss()}>Ocultar</button>}{error && <p role="alert">{error}</p>}
  </article>;
}
