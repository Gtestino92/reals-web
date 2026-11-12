import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SessionController } from '../auth/session';
import Admin from './Admin';
import './admin.css';

export default function AdminGate({ controller, onReturn, onNavigationBlockedChange, modalOnly = false, prepared = false, onVerified, returnFocus }: { controller: SessionController; onReturn?: () => void; onNavigationBlockedChange?: ((blocked: boolean) => void) | undefined; modalOnly?: boolean; prepared?: boolean; onVerified?: (() => void) | undefined; returnFocus?: HTMLElement | null }) {
  const access = controller.admin;
  const state = useSyncExternalStore(access.subscribe, access.getSnapshot);
  const [code, setCode] = useState('');
  const [now, setNow] = useState(Date.now());
  const remaining = Math.max(0, Math.ceil((state.retryAt - now) / 1000));
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null), close = useRef<HTMLButtonElement>(null);
  const claimed = useRef(false), verified = useRef(false);
  const backRef = useRef(onReturn); backRef.current = onReturn;
  const back = () => {
    setCode(''); access.suspendView();
    if (backRef.current) { backRef.current(); return; }
    controller.setAdminView(false); window.history.replaceState(null, '', '/'); window.dispatchEvent(new PopStateEvent('popstate'));
  };
  useLayoutEffect(() => {
    if (!modalOnly) controller.setAdminView(true);
    if (!prepared) void access.check();
    const visibility = () => { if (document.visibilityState === 'hidden') setCode(''); else if (!modalOnly) void access.check(); };
    const hide = () => setCode('');
    const show = (event: PageTransitionEvent) => { if (event.persisted) void access.check(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show);
    return () => { document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show); };
  }, [access, controller, modalOnly, prepared]);
  useLayoutEffect(() => {
    const current = access.getSnapshot();
    if (current.phase !== 'allowed' || current.busy) { verified.current = false; return; }
    if (!verified.current && onVerified) { verified.current = true; onVerified(); }
  }, [state.phase, state.busy, onVerified]);
  const showing = state.phase !== 'allowed' && (!modalOnly || state.phase !== 'checking');
  useLayoutEffect(() => {
    if (!showing) return;
    const previous = returnFocus ?? document.activeElement;
    const node = dialog.current; node?.showModal(); close.current?.focus();
    const pop = () => { access.suspendView(); backRef.current?.(); };
    window.addEventListener('popstate', pop);
    return () => { node?.close(); window.removeEventListener('popstate', pop); queueMicrotask(() => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); }); };
  }, [showing, access]);
  useLayoutEffect(() => { if (state.phase === 'totp' && !state.busy && remaining === 0) input.current?.focus(); }, [state.phase, state.busy, remaining]);
  useLayoutEffect(() => {
    if (state.retryAt <= Date.now()) return;
    const timer = setInterval(() => { const time = Date.now(); setNow(time); if (time >= state.retryAt) clearInterval(timer); }, 500);
    return () => clearInterval(timer);
  }, [state.retryAt]);
  const change = (value: string) => {
    const next = value.replace(/[^0-9]/g, '').slice(0, 6);
    if (claimed.current || state.busy || remaining > 0) return;
    setCode(next);
    if (next.length !== 6 || state.phase !== 'totp') return;
    claimed.current = true; setCode('');
    void access.verify(next).finally(() => { claimed.current = false; });
  };
  if (!showing && state.phase === 'checking') return <p role="status">Consultando acceso administrativo…</p>;
  if (!showing && modalOnly && state.busy) return <p role="status">Consultando acceso administrativo…</p>;
  if (!showing) return modalOnly ? null : <Admin controller={controller} onReturn={back} onNavigationBlockedChange={onNavigationBlockedChange} />;
  return <dialog ref={dialog} className="admin admin-mfa-modal" aria-labelledby="admin-mfa-title" aria-describedby="admin-mfa-help" onCancel={event => { event.preventDefault(); back(); }}>
    <header><h2 id="admin-mfa-title">Verificación administrativa</h2><button ref={close} type="button" aria-label="Cerrar verificación administrativa" onClick={back}>×</button></header>
    <p id="admin-mfa-help">Confirmá tu identidad para entrar al backoffice. Tu sesión de Reals continúa abierta.</p>
    {state.phase === 'checking' && <p role="status">Consultando acceso…</p>}
    {state.phase === 'switch' && <p>Esta sesión no usa Google. Volvé a Reals e ingresá con Google con la misma cuenta.</p>}
    {state.phase === 'google' && <p>Confirmá recientemente tu identidad con Google para continuar.</p>}
    {state.message && <p id="admin-mfa-error" role="alert">{state.message}</p>}
    {controller.snapshot.adminWarning && <p role="alert">{controller.snapshot.adminWarning}</p>}
    {state.phase === 'totp' && <div className="admin-otp">
      <label htmlFor="admin-totp">Código de seis dígitos</label>
      <div className="admin-otp-field">
        <div className="admin-otp-slots" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <span key={index}>{code[index] ?? ''}</span>)}</div>
        <input ref={input} id="admin-totp" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" value={code} aria-describedby="admin-otp-help" disabled={state.busy || remaining > 0} onChange={event => change(event.target.value)} onPaste={event => { event.preventDefault(); change(event.clipboardData.getData('text')); }} />
      </div><p id="admin-otp-help">Se verifica al completar los seis dígitos.</p>
    </div>}
    {state.busy && state.phase !== 'checking' && <p role="status">Verificando…</p>}
    {remaining > 0 && <p>Podés reintentar en {remaining} segundos.</p>}
    {state.phase !== 'switch' && <button disabled={state.busy} onClick={() => { setCode(''); access.reauthenticate(); }}>Confirmar identidad con Google</button>}
    {state.phase === 'error' && <button disabled={state.busy || remaining > 0} onClick={() => void access.check()}>Consultar estado</button>}
    <button onClick={back}>Cancelar</button>
  </dialog>;
}
