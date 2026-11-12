import { useLayoutEffect, useRef, useState } from 'react';
import type { SessionController, SessionSnapshot } from './session';
import { SignOutButton } from './SignOutButton';
import { validStatement } from './suspension';
import './suspension.css';

export function AccountSuspension({ controller, state }: { controller: SessionController; state: SessionSnapshot }) {
  const [statement, setStatement] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const temporary = state.phase === 'temporarySuspension', status = state.appeal?.status, busy = !!state.suspensionBusy;
  useLayoutEffect(() => { heading.current?.focus(); }, [temporary]);
  useLayoutEffect(() => { if (status && status !== 'AVAILABLE') setStatement(''); }, [status]);
  const title = temporary ? 'Cuenta suspendida temporalmente' : status === 'PENDING' ? 'Revisión solicitada' : status === 'REJECTED' ? 'Revisión finalizada' : status === 'APPROVED' ? state.error ? 'Revisión aprobada' : 'Actualizando estado' : busy && !status ? 'Actualizando estado' : 'Cuenta suspendida';
  const body = temporary ? 'Tu cuenta está suspendida temporalmente. Podés actualizar el estado para consultar si el acceso está disponible.' : status === 'AVAILABLE' ? 'Tu cuenta fue suspendida permanentemente.\n\nSi considerás que la decisión fue incorrecta, podés solicitar una revisión.' : status === 'PENDING' ? 'Recibimos tu solicitud de revisión.\n\nTu cuenta continuará suspendida mientras evaluamos la decisión.' : status === 'REJECTED' ? 'Revisamos tu solicitud y la suspensión permanente continúa vigente.' : status === 'APPROVED' ? state.error ? 'Tu solicitud fue aprobada, pero no pudimos actualizar tu sesión. Intentá nuevamente.' : 'Tu solicitud fue aprobada. Estamos actualizando tu sesión.' : busy ? 'Estamos confirmando el estado de tu suspensión.' : 'No pudimos confirmar el estado de tu suspensión. Intentá actualizarlo.';
  return <section className="account-suspension" aria-busy={busy}>
    <h2 tabIndex={-1} ref={heading}>{title}</h2><p className="suspension-body">{body}</p>
    {temporary && state.suspensionExpiry && <p>Vencimiento informado: <time dateTime={state.suspensionExpiry}>{new Date(state.suspensionExpiry).toLocaleString('es-AR')}</time></p>}
    {!temporary && status === 'AVAILABLE' && <form onSubmit={event => { event.preventDefault(); void controller.submitAppeal(statement); }}>
      <label htmlFor="appeal-statement">Contanos por qué considerás que deberíamos revisar la decisión.</label>
      <textarea id="appeal-statement" rows={5} maxLength={1000} value={statement} disabled={busy} aria-describedby="appeal-count appeal-help" onChange={event => setStatement(event.target.value.slice(0, 1000))} />
      <p id="appeal-count">{statement.length}/1000</p><p id="appeal-help">Usá texto sin etiquetas ni caracteres de control.</p>
      <button className="login-button login-primary" disabled={busy || state.appealUncertain || !validStatement(statement)}>Solicitar revisión</button>
    </form>}
    {state.error && <p className="login-error" role="alert">{state.error.message}</p>}
    <p className="suspension-status" role="status">{busy ? 'Actualizando estado…' : ''}</p>
    <div className="suspension-actions"><button className="login-button login-primary" disabled={busy} onClick={controller.retry}>{status === 'APPROVED' ? 'Reintentar' : 'Consultar estado'}</button><SignOutButton onConfirm={controller.signOut} /></div>
  </section>;
}
