import { useId, useLayoutEffect, useRef, useState } from 'react';
import './sign-out.css';

export function SignOutButton({ onConfirm, disabled = false, onOpenChange }: { onConfirm: () => void; disabled?: boolean; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false), [submitted, setSubmitted] = useState(false);
  const claimed = useRef(false), busy = useRef(disabled), notify = useRef(onOpenChange);
  busy.current = disabled; notify.current = onOpenChange;
  const trigger = useRef<HTMLButtonElement>(null), dialog = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null);
  const title = useId(), description = useId();
  useLayoutEffect(() => { if (!disabled) { claimed.current = false; setSubmitted(false); } }, [disabled]);
  useLayoutEffect(() => {
    if (!open) return;
    const node = dialog.current;
    node?.showModal(); cancel.current?.focus();
    const back = () => { if (!busy.current) { setOpen(false); notify.current?.(false); } };
    window.addEventListener('popstate', back);
    return () => { window.removeEventListener('popstate', back); node?.close(); notify.current?.(false); if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true }); };
  }, [open]);
  const dismiss = () => { if (!disabled) { setOpen(false); notify.current?.(false); } };
  return <>
    <button type="button" ref={trigger} className="login-button login-outlined" disabled={disabled || submitted} onClick={() => { if (claimed.current) return; notify.current?.(true); setOpen(true); }}>Cerrar sesión</button>
    {open && <dialog ref={dialog} className="reals-sign-out-dialog" aria-labelledby={title} aria-describedby={description} onCancel={event => { event.preventDefault(); dismiss(); }}>
      <h2 id={title}>Cerrar sesión</h2><p id={description}>Vas a cerrar tu sesión en este dispositivo.</p>
      <div className="sign-out-actions"><button type="button" ref={cancel} className="login-button login-outlined" disabled={disabled} onClick={dismiss}>Cancelar</button>
        <button type="button" className="login-button login-primary" disabled={disabled || submitted} onClick={() => {
          if (disabled || claimed.current) return;
          claimed.current = true; setSubmitted(true); setOpen(false); notify.current?.(false); onConfirm();
        }}>Cerrar sesión</button></div>
    </dialog>}
  </>;
}
