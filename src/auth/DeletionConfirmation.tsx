import { useId, useLayoutEffect, useRef } from 'react';
import './sign-out.css';

export function DeletionConfirmation({ final = false, onCancel, onConfirm }: { final?: boolean; onCancel: () => void; onConfirm: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null), claimed = useRef(false);
  const title = useId(), description = useId();
  useLayoutEffect(() => {
    const previous = document.activeElement, node = dialog.current;
    node?.showModal(); cancel.current?.focus();
    const back = () => onCancel();
    window.addEventListener('popstate', back);
    return () => { window.removeEventListener('popstate', back); node?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, [onCancel]);
  return <dialog ref={dialog} className="reals-sign-out-dialog" aria-labelledby={title} aria-describedby={description} onCancel={e => { e.preventDefault(); onCancel(); }}>
    <h2 id={title}>{final ? 'Eliminar definitivamente la cuenta' : 'Eliminar cuenta'}</h2>
    <p id={description}>{final ? 'Esta acción no se puede deshacer y perderás la posibilidad de recuperar esta cuenta. Después podrás crear una cuenta nueva y elegir nuevamente el método de inicio de sesión.' : 'Tu cuenta quedará pendiente de eliminación y podrás recuperarla durante 30 días.'}</p>
    <div className="sign-out-actions"><button ref={cancel} className="login-button login-outlined" onClick={onCancel}>Cancelar</button><button className="login-button deletion-destructive" onClick={() => { if (claimed.current) return; claimed.current = true; onConfirm(); }}>{final ? 'Eliminar definitivamente' : 'Programar eliminación'}</button></div>
  </dialog>;
}
