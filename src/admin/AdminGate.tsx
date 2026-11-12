import { useLayoutEffect, useState, useSyncExternalStore } from 'react';
import type { SessionController } from '../auth/session';
import { SignOutButton } from '../auth/SignOutButton';
import Admin from './Admin';
import './admin.css';

export default function AdminGate({ controller }: { controller: SessionController }) {
  const access = controller.admin;
  const state = useSyncExternalStore(access.subscribe, access.getSnapshot);
  const [code, setCode] = useState('');
  const [now, setNow] = useState(Date.now());
  useLayoutEffect(() => {
    void access.check();
    const visibility = () => { if (document.visibilityState === 'hidden') setCode(''); else void access.check(); };
    const page = () => { setCode(''); void controller.leaveAdmin(); };
    window.addEventListener('pagehide', page);
    window.addEventListener('pageshow', visibility);
    document.addEventListener('visibilitychange', visibility);
    // The operational session owns the grant; visual cleanup must not revoke it.
    return () => { window.removeEventListener('pagehide', page); window.removeEventListener('pageshow', visibility); document.removeEventListener('visibilitychange', visibility); };
  }, [access, controller]);
  useLayoutEffect(() => {
    if (state.retryAt <= Date.now()) return;
    const timer = setInterval(() => { const time = Date.now(); setNow(time); if (time >= state.retryAt) clearInterval(timer); }, 500);
    return () => clearInterval(timer);
  }, [state.retryAt]);
  if (state.phase === 'allowed') return <Admin controller={controller} />;
  const remaining = Math.max(0, Math.ceil((state.retryAt - now) / 1000));
  const back = () => { void controller.leaveAdmin(); window.history.replaceState(null, '', '/'); window.dispatchEvent(new PopStateEvent('popstate')); };
  return <main className="admin"><h1>Verificación administrativa</h1>
    {state.phase === 'checking' && <p role="status">Consultando acceso…</p>}
    {state.phase === 'switch' && <p>Esta sesión no usa Google. Cerrá sesión e ingresá con Google con la misma cuenta de Reals; después volvé a /admin.</p>}
    {state.phase === 'google' && <p>Confirmá recientemente tu identidad con Google para continuar.</p>}
    {state.message && <p role="alert">{state.message}</p>}
    {controller.snapshot.adminWarning && <p role="alert">{controller.snapshot.adminWarning}</p>}
    {state.phase === 'totp' && <form onSubmit={event => { event.preventDefault(); const submitted = code; setCode(''); void access.verify(submitted); }}>
      <label htmlFor="admin-totp">Código de seis dígitos</label>
      <input id="admin-totp" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={event => setCode(event.target.value)} disabled={state.busy || remaining > 0} required />
      <button disabled={state.busy || remaining > 0 || !/^[0-9]{6}$/.test(code)}>Verificar código</button>
    </form>}
    {remaining > 0 && <p>Podés reintentar en {remaining} segundos.</p>}
    {state.phase !== 'switch' && <button disabled={state.busy} onClick={() => { setCode(''); access.reauthenticate(); }}>Confirmar identidad con Google</button>}
    {state.phase === 'error' && <button disabled={state.busy || remaining > 0} onClick={() => void access.check()}>Consultar estado</button>}
    <button onClick={back}>Volver a Reals</button>
    <SignOutButton disabled={state.busy} onConfirm={controller.signOut} />
  </main>;
}
