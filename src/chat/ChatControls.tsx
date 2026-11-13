import { useEffect, useRef, useState } from 'react';
import { plainText } from './contracts';
import { ChatIcon } from './ChatIcon';
type DialogAction = 'mutual' | 'cancel' | 'safety' | 'block';
export function ConfirmDialog({ kind, busy, close, confirm }: { kind: DialogAction; busy: boolean; close: () => void; confirm: (body?: unknown) => void }) {
  const ref = useRef<HTMLDialogElement>(null), [details,setDetails] = useState(''), [reason,setReason] = useState('INAPPROPRIATE_BEHAVIOR'), [block,setBlock] = useState(false);
  useEffect(() => { const d = ref.current; d?.showModal(); return () => d?.close(); }, []);
  const safety = kind === 'safety';
  return <dialog ref={ref} aria-labelledby="chat-dialog-title" onCancel={e => { if (busy) e.preventDefault(); else close(); }}>
    <h3 id="chat-dialog-title">{safety ? 'Reportar y cerrar chat' : kind === 'block' ? 'Bloquear a esta persona' : kind === 'mutual' ? 'Solicitar salida consensuada' : 'Cerrar chat'}</h3>
    <p>{safety ? 'Describí qué pasó. Este reporte cerrará el chat por seguridad y será revisado.' : kind === 'block' ? 'Se cerrará la interacción y esta persona quedará bloqueada.' : kind === 'mutual' ? 'La conversación se pausa hasta resolver la solicitud. Tanto aceptar como rechazar la salida cierran el chat.' : 'Esta decisión cierra el chat. Una salida unilateral puede afectar tu confiabilidad según las reglas del servidor.'}</p>
    {safety && <><label>Motivo<select value={reason} onChange={e => setReason(e.target.value)} disabled={busy}><option value="INAPPROPRIATE_BEHAVIOR">Comportamiento inapropiado</option><option value="HARASSMENT">Acoso</option><option value="CHILD_SAFETY_CONCERN">Seguridad de menores</option><option value="OTHER">Otro</option></select></label><label>Detalle<textarea value={details} maxLength={1000} onChange={e => setDetails(e.target.value)} disabled={busy}/></label><label><input type="checkbox" checked={block} onChange={e => setBlock(e.target.checked)} disabled={busy}/>Bloquear también a esta persona</label></>}
    <button disabled={busy} onClick={close}>Volver</button><button disabled={busy || (safety && !plainText(details.trim()))} onClick={() => confirm(safety ? { reason, details: details.trim(), blockUser: block } : undefined)}>Confirmar</button>
  </dialog>;
}
export function ChatMenu({ actions, decisionOnly }: { decisionOnly: boolean; actions: { label: string; disabled: boolean; run: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const boundary = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const previousMode=useRef(decisionOnly);
  useEffect(()=>{if(previousMode.current!==decisionOnly){previousMode.current=decisionOnly;if(open){setOpen(false);trigger.current?.focus({preventScroll:true});}}},[decisionOnly,open]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !boundary.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return <div ref={boundary} className="chat-overflow" onBlur={event => {
    // Trigger and popup share one focus boundary. Pointer focus reaches the
    // trigger before click; closing here would make that click reopen the menu.
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); close(); } }}><button ref={trigger} aria-label="Opciones del chat" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(current => !current)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}><ChatIcon name="more"/></button>
    {open && <div ref={menu} role="menu" aria-label="Decisiones y seguridad" className="chat-menu" onKeyDown={event => {
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const index = items.findIndex(item => item === document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    }}>{actions.map(action => <button role="menuitem" key={action.label} disabled={action.disabled} onClick={() => { close(); action.run(); }}>{action.label}</button>)}</div>}
  </div>;
}
