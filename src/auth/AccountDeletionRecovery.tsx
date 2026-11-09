import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SessionController, SessionSnapshot } from './session';
import { DeletionConfirmation } from './DeletionConfirmation';
import './deletion-recovery.css';

export function AccountDeletionRecovery({ controller, state }: { controller: SessionController; state: SessionSnapshot }) {
  const [confirming, setConfirming] = useState(false);
  const dismiss = useCallback(() => setConfirming(false), []);
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    const resume = () => { if (document.visibilityState === 'visible') void controller.recoverDeletion('refresh'); };
    window.addEventListener('pageshow', resume); document.addEventListener('visibilitychange', resume);
    return () => { window.removeEventListener('pageshow', resume); document.removeEventListener('visibilitychange', resume); };
  }, [controller]);
  const account = state.account, busy = !!state.recoveryBusy;
  const metadata = !!account?.deletedAt && !!account.deletionFinalizesAt && Date.parse(account.deletedAt) < Date.parse(account.deletionFinalizesAt);
  const blocked = busy || state.recoveryUncertain || state.recoveryTerminal || !metadata;
  return <section className="deletion-recovery" aria-busy={busy}>
    <h2 ref={heading} tabIndex={-1}>Cuenta pendiente de eliminación</h2>
    <p>Esta cuenta está pendiente de eliminación{metadata ? ` hasta el ${new Date(account?.deletionFinalizesAt ?? '').toLocaleString('es-AR')}` : ''}. Si la recuperás, conservarás tu perfil y fotos, pero deberás activar el perfil nuevamente. Tus conexiones activas anteriores no se restaurarán.</p>
    {!metadata && <p role="status">No pudimos obtener un plazo de recuperación válido. Consultá el estado de la cuenta.</p>}
    {state.error && <p role="alert" className="login-error">{state.error.message}</p>}
    <p role="status">{busy ? state.recoveryBusy === 'reactivate' ? 'Reactivando…' : state.recoveryBusy === 'finalize' ? 'Eliminando definitivamente…' : 'Consultando estado…' : ''}</p>
    <div className="deletion-actions"><button className="login-button login-primary" disabled={blocked} onClick={() => void controller.recoverDeletion('reactivate')}>Reactivar cuenta</button><button className="login-button login-outlined" disabled={busy} onClick={controller.signOut}>Mantener eliminación</button></div>
    <button className="login-button login-outlined" disabled={blocked} onClick={() => setConfirming(true)}>Eliminar definitivamente ahora</button>
    <button className="login-button login-outlined" disabled={busy} onClick={() => void controller.recoverDeletion('refresh')}>Consultar estado de la cuenta</button>
    {confirming && <DeletionConfirmation final onCancel={dismiss} onConfirm={() => { setConfirming(false); void controller.recoverDeletion('finalize'); }}/>}
  </section>;
}
