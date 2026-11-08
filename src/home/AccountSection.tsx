import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SessionController } from '../auth/session';
import { ApiError, object } from '../auth/api';
import { errorCode } from '../auth/errors';

type Preferences = { activityEnabled: boolean; remindersEnabled: boolean; availabilityEnabled: boolean };
const descriptions = {
  activityEnabled: 'Nuevos chats y cambios importantes en tus interacciones.',
  remindersEnabled: 'Avisos sobre revisiones pendientes y pr\u00f3ximas segundas charlas.',
  availabilityEnabled: 'Avisame cuando pueda volver a buscar a alguien nuevo.',
};
const groups = [['activityEnabled', 'Actividad'], ['remindersEnabled', 'Recordatorios'], ['availabilityEnabled', 'Disponibilidad']] as const;
function parse(value: unknown): Preferences {
  if (!object(value) || typeof value.activityEnabled !== 'boolean' || typeof value.remindersEnabled !== 'boolean' || typeof value.availabilityEnabled !== 'boolean') throw new ApiError('invalid');
  return { activityEnabled: value.activityEnabled, remindersEnabled: value.remindersEnabled, availabilityEnabled: value.availabilityEnabled };
}
export function AccountSection({ controller, disabled, setup = false, onBack, notificationsOpen = false, onNotificationsOpen, onNavigationBlockedChange }: { controller: SessionController; disabled: boolean; setup?: boolean; onBack?: () => void; notificationsOpen?: boolean; onNotificationsOpen?: () => void; onNavigationBlockedChange?: (blocked: boolean) => void }) {
  const [expanded, setExpanded] = useState(false), [view, setView] = useState<'password' | null>(null);
  const [preferences, setPreferences] = useState<Preferences | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [uncertain, setUncertain] = useState(false), [deleteUncertain, setDeleteUncertain] = useState(false);
  const owner = useRef<{ abort: AbortController; locked: boolean } | null>(null);
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
  const read = () => void run(async signal => { const value = parse(await controller.request('/me/notification-preferences', signal)); signal.throwIfAborted(); setPreferences(value); setUncertain(false); });
  useLayoutEffect(() => { onNavigationBlockedChange?.(busy || view === 'password'); }, [busy, view, onNavigationBlockedChange]);
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
  if (notificationsOpen) return <section className="home-account account-notifications" aria-label="Notificaciones"><header className="home-heading"><h2 ref={heading} tabIndex={-1}>Notificaciones</h2><button className="login-button login-outlined" disabled={busy} onClick={onBack}>Volver a Cuenta</button></header><p>Elegí qué avisos querés recibir.</p>{busy && <p role="status">Actualizando notificaciones…</p>}{preferences && groups.map(([key, label]) => <label key={key}><input type="checkbox" aria-label={label} aria-describedby={`notification-${key}`} checked={preferences[key]} disabled={blocked || uncertain} onChange={e => { const requested = { ...preferences, [key]: e.target.checked }; void run(async signal => { setUncertain(true); const value = parse(await controller.request('/me/notification-preferences', signal, 'PUT', requested)); signal.throwIfAborted(); setPreferences(value); setUncertain(false); }); }}/><span>{label}</span><span id={`notification-${key}`}>{descriptions[key]}</span></label>)}<button disabled={blocked} onClick={read}>Actualizar notificaciones</button>{error && <p role="alert">{error}</p>}</section>;
  return <section className={setup ? 'home-card home-account' : 'home-account'} aria-label="Cuenta" aria-busy={busy}>
    {setup ? <header className="home-heading"><h3>Cuenta</h3><button type="button" className="login-button login-outlined" aria-label="Cuenta" aria-expanded={expanded} aria-controls="account-options" disabled={blocked} onClick={() => setExpanded(v => !v)}>{expanded ? 'Ocultar' : 'Abrir'}</button></header> : <header className="home-heading"><h2>Cuenta</h2><button className="login-button login-outlined" disabled={busy || view === 'password'} onClick={onBack}>Volver a Inicio</button></header>}
    {(!setup || expanded) && <div id="account-options" className={setup ? undefined : 'home-card'}>
      {!setup && <button ref={notificationsButton} className="login-button login-outlined" disabled={blocked} onClick={() => { onNotificationsOpen?.(); read(); }}>Notificaciones</button>}

      {!setup && controller.hasPasswordProvider === true && <button className="login-button login-outlined" disabled={blocked} onClick={() => { setError(''); setView('password'); }}>Cambiar contraseña de Reals</button>}
      {!setup && import.meta.env.DEV && <section><h4>Apoyar Reals</h4><p>Si te gusta Reals y querés ayudar a sostener el proyecto, podés hacer un aporte voluntario. No te da beneficios dentro de la app.</p><a className="login-button login-outlined" href="https://cafecito.app/reals-app" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Apoyar en Cafecito</a></section>}
      <button className="login-button login-outlined" disabled={blocked} onClick={() => { if (!owner.current?.locked && window.confirm('Cerrar sesión\nVas a cerrar tu sesión en este dispositivo.')) controller.signOut(); }}>Cerrar sesión</button>
      <p>Eliminar la cuenta programa una eliminación recuperable durante 30 días y cierra la sesión.</p>
      <button className="login-button login-outlined" disabled={blocked || uncertain} onClick={() => { if (owner.current?.locked || !window.confirm('Eliminar cuenta\nTu cuenta quedará pendiente de eliminación y podrás recuperarla durante 30 días. ¿Programar eliminación?')) return; void run(async signal => { setDeleteUncertain(true); await controller.request('/me', signal, 'DELETE'); signal.throwIfAborted(); controller.signOut(); }); }}>Eliminar cuenta</button>
      {deleteUncertain && !busy && <button className="login-button login-outlined" onClick={() => controller.retry()}>Consultar estado de la cuenta</button>}

      {view === 'password' && <PasswordForm operationError={error} busy={blocked || uncertain} onCancel={() => setView(null)} onSubmit={(current, next) => void run(async signal => { await controller.changePassword(current, next); signal.throwIfAborted(); setView(null); setMessage('Contraseña actualizada.'); })}/>}
      {error && view !== 'password' && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    </div>}
  </section>;
}
function PasswordForm({ busy, operationError, onCancel, onSubmit }: { busy: boolean; operationError: string; onCancel: () => void; onSubmit: (current: string, next: string) => void }) {
  const [current, setCurrent] = useState(''), [next, setNext] = useState(''), [confirm, setConfirm] = useState(''), [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  useEffect(() => { if (operationError === 'La contraseña actual no es correcta.') setCurrent(''); }, [operationError]);
  return <dialog ref={dialog} aria-label="Cambiar contraseña de Reals" onCancel={e => { e.preventDefault(); if (!busy) onCancel(); }}><form aria-label="Cambiar contraseña de Reals" onSubmit={e => { e.preventDefault(); if (busy) return; const invalid = !current.trim() ? 'Ingresá tu contraseña actual.' : !next.trim() ? 'Ingresá una nueva contraseña.' : next !== confirm ? 'Las contraseñas nuevas no coinciden.' : next.length < 6 ? 'La nueva contraseña debe tener al menos 6 caracteres.' : current === next ? 'La nueva contraseña debe ser distinta de la actual.' : ''; setError(invalid); if (!invalid) onSubmit(current, next); }}><h4>Cambiar contraseña de Reals</h4><p>Actualizá la contraseña que usás para iniciar sesión en Reals con tu email. Tu contraseña de Google no cambia.</p>
    <label>Contraseña actual<input type="password" autoComplete="current-password" value={current} disabled={busy} onChange={e => setCurrent(e.target.value)}/></label>
    <label>Nueva contraseña<input type="password" autoComplete="new-password" value={next} disabled={busy} onChange={e => setNext(e.target.value)}/></label>
    <label>Repetir nueva contraseña<input type="password" autoComplete="new-password" value={confirm} disabled={busy} onChange={e => setConfirm(e.target.value)}/></label>
    {(error || operationError) && <p role="alert">{error || operationError}</p>}<button disabled={busy}>{busy ? 'Guardando…' : 'Guardar contraseña'}</button><button type="button" disabled={busy} onClick={onCancel}>Cancelar</button>
  </form></dialog>;
}
