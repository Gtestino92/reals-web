import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SessionController } from '../auth/session';
import Admin from './Admin';
import './admin.css';

export default function AdminGate({ controller, onReturn, onNavigationBlockedChange, modalOnly = false, prepared = false, onVerified, returnFocus }: { controller: SessionController; onReturn?: () => void; onNavigationBlockedChange?: ((blocked: boolean) => void) | undefined; modalOnly?: boolean; prepared?: boolean; onVerified?: (() => boolean | void) | undefined; returnFocus?: HTMLElement | null }) {
  const access = controller.admin;
  const state = useSyncExternalStore(access.subscribe, access.getSnapshot);
  const [code, setCode] = useState('');
  const [feedback, setFeedback] = useState<'idle' | 'pending' | 'invalid' | 'success' | 'complete'>('idle');
  const session = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [now, setNow] = useState(Date.now());
  const remaining = Math.max(0, Math.ceil((state.retryAt - now) / 1000));
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null), close = useRef<HTMLButtonElement>(null);
  const claimed = useRef(false), verified = useRef(false);
  const attempt = useRef(0), confirmation = useRef<{ context: number | undefined; account: string | undefined } | null>(null);
  const reset = () => { attempt.current++; claimed.current = false; confirmation.current = null; setCode(''); setFeedback('idle'); };
  const backRef = useRef(onReturn); backRef.current = onReturn;
  const back = () => {
    reset(); access.suspendView();
    if (backRef.current) { backRef.current(); return; }
    controller.setAdminView(false); window.history.replaceState(null, '', '/'); window.dispatchEvent(new PopStateEvent('popstate'));
  };
  useLayoutEffect(() => {
    if (!modalOnly) controller.setAdminView(true);
    if (!prepared) void access.check();
    const visibility = () => { if (document.visibilityState === 'hidden') setCode(''); else if (!modalOnly) void access.check(); };
    const hide = () => reset();
    const show = (event: PageTransitionEvent) => { if (event.persisted) void access.check(); };
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', hide); window.addEventListener('pageshow', show);
    return () => { attempt.current++; document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', hide); window.removeEventListener('pageshow', show); };
  }, [access, controller, modalOnly, prepared]);
  useLayoutEffect(() => {
    const current = access.getSnapshot();
    if (current.phase !== 'allowed' || current.busy) { verified.current = false; return; }
    // Fresh verification owns its presentation; a retained grant bypasses it.
    if (feedback === 'pending' || feedback === 'success') return;
    if (!verified.current && onVerified) verified.current = onVerified() !== false;
  }, [state.phase, state.busy, feedback, onVerified]);
  useLayoutEffect(() => {
    if (feedback !== 'success') return;
    const confirmed = confirmation.current;
    if (!confirmed || state.phase !== 'allowed' || state.busy || session.phase !== 'ready' || confirmed.context !== session.authContextVersion || confirmed.account !== session.account?.id) {
      reset(); return;
    }
    const id = attempt.current;
    const timer = window.setTimeout(() => {
      const current = controller.getSnapshot(), accessState = access.getSnapshot();
      if (id !== attempt.current || current.phase !== 'ready' || current.authContextVersion !== confirmed.context || current.account?.id !== confirmed.account || accessState.phase !== 'allowed' || accessState.busy || !access.token()) { reset(); return; }
      setFeedback('complete');
    }, 400);
    return () => clearTimeout(timer);
  }, [feedback, state.phase, state.busy, session.phase, session.authContextVersion, session.account?.id, access, controller]);
  const presenting = feedback === 'pending' || feedback === 'success';
  useLayoutEffect(() => {
    if (presenting && (session.phase !== 'ready' || (!state.busy && ['checking', 'error', 'switch', 'google'].includes(state.phase)))) reset();
  }, [presenting, session.phase, state.phase, state.busy]);
  const showing = presenting || (state.phase !== 'allowed' && (!modalOnly || state.phase !== 'checking'));
  useLayoutEffect(() => {
    if (!showing) return;
    const previous = returnFocus ?? document.activeElement;
    const node = dialog.current; node?.showModal(); close.current?.focus();
    const pop = () => { access.suspendView(); backRef.current?.(); };
    window.addEventListener('popstate', pop);
    return () => { node?.close(); window.removeEventListener('popstate', pop); queueMicrotask(() => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); }); };
  }, [showing, access]);
  useLayoutEffect(() => { if (state.phase === 'totp' && !state.busy && remaining === 0 && !presenting) input.current?.focus(); }, [state.phase, state.busy, remaining, presenting]);
  useLayoutEffect(() => {
    if (state.retryAt <= Date.now()) return;
    const timer = setInterval(() => { const time = Date.now(); setNow(time); if (time >= state.retryAt) clearInterval(timer); }, 500);
    return () => clearInterval(timer);
  }, [state.retryAt]);
  const change = (value: string) => {
    const next = value.replace(/[^0-9]/g, '').slice(0, 6);
    if (claimed.current || state.busy || remaining > 0 || feedback === 'success' || feedback === 'complete') return;
    setCode(next); setFeedback('idle');
    if (next.length !== 6 || state.phase !== 'totp') return;
    const id = ++attempt.current;
    const context = controller.getSnapshot();
    claimed.current = true; setFeedback('pending');
    void access.verify(next).then(() => {
      if (id !== attempt.current) return;
      claimed.current = false; setCode('');
      if (controller.getSnapshot().phase !== 'ready' || controller.getSnapshot().authContextVersion !== context.authContextVersion || controller.getSnapshot().account?.id !== context.account?.id) { setFeedback('idle'); return; }
      const current = access.getSnapshot();
      if (current.phase === 'allowed' && !current.busy) {
        confirmation.current = { context: context.authContextVersion, account: context.account?.id };
        setFeedback('success');
      } else setFeedback(current.phase === 'totp' ? 'invalid' : 'idle');
    });
  };
  if (!showing && state.phase === 'checking') return <p role="status">Consultando acceso administrativo…</p>;
  if (!showing && modalOnly && state.busy) return <p role="status">Consultando acceso administrativo…</p>;
  if (!showing) return modalOnly ? null : <Admin controller={controller} onReturn={back} onNavigationBlockedChange={onNavigationBlockedChange} />;
  return <dialog ref={dialog} className="admin admin-mfa-modal" aria-labelledby="admin-mfa-title" aria-describedby="admin-mfa-help" onCancel={event => { event.preventDefault(); back(); }}>
    <header><h2 id="admin-mfa-title">Verificación administrativa</h2><button ref={close} type="button" aria-label="Cerrar verificación administrativa" onClick={back}>×</button></header>
    <p id="admin-mfa-help">Confirmá tu identidad para entrar al backoffice. Tu sesión de Reals continúa abierta.</p>
    {state.phase === 'checking' && !presenting && <p role="status">Consultando acceso…</p>}
    {state.phase === 'switch' && <p>Esta sesión no usa Google. Volvé a Reals e ingresá con Google con la misma cuenta.</p>}
    {state.phase === 'google' && <p>Confirmá recientemente tu identidad con Google para continuar.</p>}
    {state.message && <p id="admin-mfa-error" role="alert">{state.message}</p>}
    {controller.snapshot.adminWarning && <p role="alert">{controller.snapshot.adminWarning}</p>}
    {(state.phase === 'totp' || presenting) && <div className="admin-otp">
      <label htmlFor="admin-totp">Código de seis dígitos</label>
      <div className="admin-otp-field" data-feedback={feedback}>
        <div className="admin-otp-slots" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <span key={index} data-slot={index} className={!presenting && !state.busy && remaining === 0 && index === code.length ? 'admin-otp-slot-active' : undefined}>{feedback === 'success' ? '✓' : code[index] ?? ''}{!presenting && !state.busy && remaining === 0 && index === code.length && <i className="admin-otp-caret" />}</span>)}</div>
        <input ref={input} id="admin-totp" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" value={code} aria-invalid={feedback === 'invalid'} aria-describedby={feedback === 'invalid' ? 'admin-otp-help admin-mfa-error' : 'admin-otp-help'} disabled={state.busy || remaining > 0 || presenting} onChange={event => change(event.target.value)} onPaste={event => { event.preventDefault(); change(event.clipboardData.getData('text')); }} />
      </div><p id="admin-otp-help">Se verifica al completar los seis dígitos.</p>
    </div>}
    <div className="admin-otp-feedback" role="status">{feedback === 'success' ? <span className="admin-otp-verified"><span aria-hidden="true">✓ </span><span>Acceso verificado</span></span> : (presenting || state.busy) && state.phase !== 'checking' ? 'Verificando…' : null}</div>
    {remaining > 0 && <p>Podés reintentar en {remaining} segundos.</p>}
    {state.phase !== 'switch' && <button disabled={state.busy || presenting} onClick={() => { reset(); access.reauthenticate(); }}>Confirmar identidad con Google</button>}
    {state.phase === 'error' && <button disabled={state.busy || remaining > 0} onClick={() => void access.check()}>Consultar estado</button>}
    <button onClick={back}>Cancelar</button>
  </dialog>;
}
