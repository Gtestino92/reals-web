import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { plainText } from './contracts';
import { ChatIcon } from './ChatIcon';
type DialogAction = 'mutual' | 'safety' | 'block';

export function submitChatOnEnter(event: KeyboardEvent<HTMLTextAreaElement>, composing: boolean, canSend: boolean) {
  // Use desktop input capabilities and a concrete key code as a conservative
  // proxy for a physical keyboard.
  if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey ||
    composing || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 ||
    !['Enter','NumpadEnter'].includes(event.code) || !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;
  event.preventDefault();
  if (!event.repeat && canSend) event.currentTarget.form?.requestSubmit();
}

export function preserveTextDraftFocus(event: MouseEvent<HTMLButtonElement>, draft?: HTMLTextAreaElement | null) {
  // A tap can dispatch a compatibility mousedown. Cancel only its focus
  // transfer, leaving native click and keyboard activation intact.
  if (event.button === 0 && draft && draft.ownerDocument.activeElement === draft) event.preventDefault();
}

export function TextSendButton({ draft, disabled, className, children }: {
  draft: RefObject<HTMLTextAreaElement | null>; disabled: boolean; className?: string; children: ReactNode;
}) {
  return <button type="submit" className={className} aria-label="Enviar mensaje" disabled={disabled} onMouseDown={event => preserveTextDraftFocus(event, draft.current)}>{children}</button>;
}

export function ConfirmDialog({ kind, busy, pending = busy, disabled = false, feedback, close, confirm }: {
  kind: DialogAction; busy: boolean; pending?: boolean; disabled?: boolean; feedback?: ReactNode; close: () => void; confirm: (body?: unknown) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null), [details,setDetails] = useState(''), [reason,setReason] = useState('INAPPROPRIATE_BEHAVIOR'), [block,setBlock] = useState(false);
  useEffect(() => { const d = ref.current; d?.showModal(); return () => d?.close(); }, []);
  const safety = kind === 'safety';
  return <dialog data-mutual={kind === 'mutual' || undefined} className="chat-confirm-dialog" ref={ref} aria-labelledby="chat-dialog-title" onCancel={e => { e.preventDefault(); if (!busy) close(); }}>
    <h3 id="chat-dialog-title">{safety ? 'Reportar y cerrar chat' : kind === 'block' ? 'Bloquear a esta persona' : 'Solicitar salida consensuada'}</h3>
    <p>{safety ? 'Describí qué pasó. Este reporte cerrará el chat por seguridad y será revisado.' : kind === 'block' ? 'Se cerrará la interacción y esta persona quedará bloqueada.' : 'La conversación se pausa hasta resolver la solicitud. Tanto aceptar como rechazar la salida cierran el chat.'}</p>
    {safety && <div className="chat-confirm-fields"><label>Motivo<select value={reason} onChange={e => setReason(e.target.value)} disabled={busy}><option value="INAPPROPRIATE_BEHAVIOR">Comportamiento inapropiado</option><option value="HARASSMENT">Acoso</option><option value="CHILD_SAFETY_CONCERN">Seguridad de menores</option><option value="OTHER">Otro</option></select></label><label>Detalle<textarea value={details} maxLength={1000} onChange={e => setDetails(e.target.value)} disabled={busy}/></label><label className="chat-confirm-checkbox"><input type="checkbox" checked={block} onChange={e => setBlock(e.target.checked)} disabled={busy}/>Bloquear también a esta persona</label></div>}
    <ConfirmDialogActions busy={busy} disabled={disabled || (safety && !plainText(details.trim()))} feedback={feedback} close={close} confirm={() => confirm(safety ? { reason, details: details.trim(), blockUser: block } : undefined)} label={kind === 'mutual' && pending ? 'Solicitando salida…' : 'Confirmar'} pendingLabel={pending && kind !== 'mutual' ? safety ? 'Enviando reporte…' : kind === 'block' ? 'Bloqueando…' : 'Confirmando…' : undefined}/>
  </dialog>;
}

export function ConfirmDialogActions({ busy, disabled, feedback, close, confirm, label, pendingLabel, backLabel = 'Volver' }: {
  busy: boolean; disabled?: boolean; feedback?: ReactNode; close: () => void; confirm: () => void; label: string; pendingLabel?: string | undefined; backLabel?: string;
}) {
  return <>
    {feedback}
    <div className="chat-confirm-actions">
      <button type="button" disabled={busy} onClick={close}>{backLabel}</button>
      <button type="button" className="chat-confirm-primary" aria-live="polite" aria-busy={busy} disabled={busy || disabled} onClick={confirm}>{label}</button>
    </div>
    {pendingLabel && <p role="status">{pendingLabel}</p>}
  </>;
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
    }}>{actions.map(action => <button role="menuitem" onMouseDown={event => { if (event.button === 0) event.preventDefault(); }} key={action.label} disabled={action.disabled} onClick={() => { close(); action.run(); }}>{action.label}</button>)}</div>}
  </div>;
}
