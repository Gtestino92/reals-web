import { DeletionConfirmation } from '../auth/DeletionConfirmation';
import { SignOutButton } from '../auth/SignOutButton';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { SessionController } from '../auth/session';
import { errorCode } from '../auth/errors';
import { activityTypes, type ActivityType } from '../notifications/activityPolicy';
import { useActivityNotificationContext } from '../notifications/useActivityNotifications';
import './notification-settings.css';
import './password-dialog.css';

const activityLabels: Record<ActivityType, readonly [title: string, description: string]> = {
  FIRST_CHAT: ['Primer chat disponible', 'Cuando ya podés empezar un primer chat.'],
  VISUAL_REVIEW: ['Revisión visual disponible', 'Cuando ya podés ver el perfil de la otra persona.'],
  SCHEDULING: ['Coordinación disponible', 'Cuando ya pueden proponer horarios para el segundo chat.'],
  SECOND_CHAT_SCHEDULED: ['Horario del segundo chat confirmado', 'Cuando se confirma el día y la hora del segundo chat.'],
  SECOND_CHAT_AVAILABLE: ['Entrada al segundo chat disponible', 'Cuando se abre la ventana para entrar al segundo chat.'],
};
export function AccountSection({ controller, disabled, legalOnly = false, deletionDisabled = false, hideDeletion = false, setup = false, onBack, notificationsOpen = false, onNotificationsOpen, onNavigationBlockedChange }: { controller: SessionController; disabled: boolean; legalOnly?: boolean; deletionDisabled?: boolean; hideDeletion?: boolean; setup?: boolean; onBack?: () => void; notificationsOpen?: boolean; onNotificationsOpen?: () => void; onNavigationBlockedChange?: (blocked: boolean) => void }) {
  const web = useActivityNotificationContext();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const dismissDelete = useCallback(() => setDeleteOpen(false), []);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [expanded, setExpanded] = useState(false), [view, setView] = useState<'password' | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [deleteUncertain, setDeleteUncertain] = useState(false);
  const owner = useRef<{ abort: AbortController; locked: boolean } | null>(null);
  const notificationId = useId();
  useEffect(() => { const r = { abort: new AbortController(), locked: false }; owner.current = r; return () => { r.abort.abort(); if (owner.current === r) owner.current = null; }; }, [controller]);
  const run = async (task: (signal: AbortSignal) => Promise<void>) => {
    const r = owner.current;
    if (!r || r.locked || disabled) return;
    r.locked = true; onNavigationBlockedChange?.(true); setBusy(true); setError(''); setMessage('');
    try { await task(r.abort.signal); }
    catch (failure) {
      if (!r.abort.signal.aborted) {
        const code = errorCode(failure);
        setError(code === 'auth/wrong-password' || code === 'auth/invalid-credential' ? 'La contraseña actual no es correcta.' : code === 'auth/weak-password' ? 'La contraseña nueva es demasiado débil.' : 'No pudimos confirmar el resultado. Revisá tu conexión y consultá el estado antes de volver a intentar.');
      }
    }
    finally { if (owner.current === r && !r.abort.signal.aborted) { r.locked = false; setBusy(false); } }
  };
  useLayoutEffect(() => { onNavigationBlockedChange?.(busy || (legalOnly && deleteUncertain) || view === 'password' || signOutOpen || deleteOpen); }, [busy, legalOnly, deleteUncertain, view, signOutOpen, deleteOpen, onNavigationBlockedChange]);
  useEffect(() => {
    if (view !== 'password') return;
    // Home restores the owned entry; idle modal Back dismisses only the dialog.
    const dismiss = () => { if (!owner.current?.locked) setView(null); };
    window.addEventListener('popstate', dismiss);
    return () => window.removeEventListener('popstate', dismiss);
  }, [view]);
  const heading = useRef<HTMLHeadingElement>(null), notificationsButton = useRef<HTMLButtonElement>(null);
  const previousNotifications = useRef(notificationsOpen);
  useLayoutEffect(() => {
    if (notificationsOpen) heading.current?.focus({ preventScroll: true });
    else if (previousNotifications.current) notificationsButton.current?.focus({ preventScroll: true });
    previousNotifications.current = notificationsOpen;
  }, [notificationsOpen]);
  const blocked = disabled || busy || deleteUncertain;
  if (notificationsOpen) return <section className="home-account account-notifications" aria-label="Notificaciones">
    <header className="notification-heading">
      <div className="home-heading"><h2 ref={heading} tabIndex={-1}>Notificaciones</h2><button className="login-button login-outlined" disabled={busy} onClick={onBack}>Volver a Cuenta</button></div>
      <p>Elegí qué novedades querés destacar mientras Reals Web esté abierto. Los ajustes se aplican a tu cuenta en este navegador.</p>
      <div className="brand-divider" aria-hidden="true"><span/></div>
    </header>
    {web && <div className="notification-rows">{activityTypes.map(type => {
      const [title, description] = activityLabels[type], id = `${notificationId}-${type}`;
      return <label className="notification-row" key={type}>
        <span className="notification-copy"><span className="notification-title" id={`${id}-title`}>{title}</span><span className="notification-description" id={`${id}-description`}>{description}</span></span>
        <span className="notification-switch-target"><input type="checkbox" role="switch" className="notification-switch" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} checked={web.categories[type]} disabled={blocked} onChange={e => web.setCategory(type, e.target.checked)}/></span>
      </label>;
    })}</div>}
    {web?.persistenceFailed && <p role="status">No pudimos guardar los ajustes en este navegador. Se mantienen durante esta sesión.</p>}
  </section>;
  return <section className={setup ? 'home-card home-account' : 'home-account'} aria-label="Cuenta" aria-busy={busy}>
    {legalOnly ? null : setup ? <header className="home-heading"><h3>Cuenta</h3><button type="button" className="login-button login-outlined" aria-label="Cuenta" aria-expanded={expanded} aria-controls="account-options" disabled={blocked} onClick={() => setExpanded(v => !v)}>{expanded ? 'Ocultar' : 'Abrir'}</button></header> : <header className="home-heading"><h2>Cuenta</h2><button className="login-button login-outlined" disabled={busy || view === 'password'} onClick={onBack}>Volver a Inicio</button></header>}
    {(!setup || expanded) && <div id={legalOnly ? undefined : "account-options"} className={legalOnly ? 'legal-account-actions' : setup ? undefined : 'home-card'}>
      {!legalOnly && <button className="login-button login-outlined" disabled={blocked} onClick={() => controller.legalEvents.dispatchEvent(new Event('inspect'))}>Documentos vigentes</button>}
      {!legalOnly && !setup && <button ref={notificationsButton} className="login-button login-outlined" disabled={blocked} onClick={onNotificationsOpen}>Notificaciones</button>}

      {!legalOnly && !setup && controller.hasPasswordProvider === true && <button className="login-button login-outlined" disabled={blocked} onClick={() => { setError(''); setView('password'); }}>Cambiar contraseña de Reals</button>}
      {!legalOnly && !setup && import.meta.env.DEV && <section className="account-support" aria-labelledby={`${notificationId}-support`}><h3 id={`${notificationId}-support`}>Apoyar Reals</h3><p>Si te gusta Reals y querés ayudar a sostener el proyecto, podés hacer un aporte voluntario. No te da beneficios dentro de la app.</p><a className="login-button login-outlined account-support-link" href="https://cafecito.app/reals-app" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Apoyar en Cafecito</a></section>}
      <SignOutButton disabled={blocked} onOpenChange={setSignOutOpen} onConfirm={controller.signOut} />
      {!legalOnly && <p>Eliminar la cuenta programa una eliminación recuperable durante 30 días y cierra la sesión.</p>}
      {!hideDeletion && <button className="login-button login-outlined" disabled={blocked || deletionDisabled} onClick={() => { if (!owner.current?.locked) setDeleteOpen(true); }}>Eliminar cuenta</button>}
      {deleteOpen && <DeletionConfirmation onCancel={dismissDelete} onConfirm={() => { setDeleteOpen(false); void run(async signal => { setDeleteUncertain(true); await controller.request('/me', signal, 'DELETE'); signal.throwIfAborted(); controller.signOut(); }); }}/>}
      {deleteUncertain && !busy && <button className="login-button login-outlined" onClick={() => controller.retry()}>Consultar estado de la cuenta</button>}

      {view === 'password' && <PasswordForm operationError={error} busy={blocked} onCancel={() => setView(null)} onSubmit={(current, next) => void run(async signal => { await controller.changePassword(current, next); signal.throwIfAborted(); setView(null); setMessage('Contraseña actualizada.'); })}/>}
      {error && view !== 'password' && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    </div>}
  </section>;
}
function PasswordForm({ busy, operationError, onCancel, onSubmit }: { busy: boolean; operationError: string; onCancel: () => void; onSubmit: (current: string, next: string) => void }) {
  const [current, setCurrent] = useState(''), [next, setNext] = useState(''), [confirm, setConfirm] = useState(''), [error, setError] = useState('');
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  useEffect(() => { if (operationError === 'La contraseña actual no es correcta.') setCurrent(''); }, [operationError]);
  return <dialog ref={dialog} className="password-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onCancel={e => { e.preventDefault(); if (!busy) onCancel(); }}><form aria-label="Cambiar contraseña de Reals" aria-busy={busy} onSubmit={e => { e.preventDefault(); if (busy) return; const invalid = !current.trim() ? 'Ingresá tu contraseña actual.' : !next.trim() ? 'Ingresá una nueva contraseña.' : next !== confirm ? 'Las contraseñas nuevas no coinciden.' : next.length < 6 ? 'La nueva contraseña debe tener al menos 6 caracteres.' : current === next ? 'La nueva contraseña debe ser distinta de la actual.' : ''; setError(invalid); if (!invalid) onSubmit(current, next); }}>
    <header><h2 id={`${id}-title`}>Cambiar contraseña de Reals</h2><p id={`${id}-description`}>Actualizá la contraseña que usás para iniciar sesión en Reals con tu email. Tu contraseña de Google no cambia.</p><div className="brand-divider" aria-hidden="true"><span/></div></header>
    <div className="password-fields">
      <div className="login-field"><input id={`${id}-current`} type="password" autoComplete="current-password" placeholder=" " value={current} disabled={busy} onChange={e => setCurrent(e.target.value)}/><label htmlFor={`${id}-current`}>Contraseña actual</label></div>
      <div className="login-field"><input id={`${id}-new`} type="password" autoComplete="new-password" placeholder=" " value={next} disabled={busy} onChange={e => setNext(e.target.value)}/><label htmlFor={`${id}-new`}>Nueva contraseña</label></div>
      <div className="login-field"><input id={`${id}-confirm`} type="password" autoComplete="new-password" placeholder=" " value={confirm} disabled={busy} onChange={e => setConfirm(e.target.value)}/><label htmlFor={`${id}-confirm`}>Repetir nueva contraseña</label></div>
    </div>
    {(error || operationError) && <p role="alert" className="login-error password-error">{error || operationError}</p>}
    <div className="password-actions"><button type="button" className="login-button login-outlined" disabled={busy} onClick={onCancel}>Cancelar</button><button type="submit" className="login-button login-primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar contraseña'}</button></div>
  </form></dialog>;
}
