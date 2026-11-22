import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import seal from '../assets/reals-seal.png';
import googleIcon from '../assets/google-g.png';
import './login.css';

type AuthMode = 'signIn' | 'signUp';
export type LoginErrorOwner = AuthMode | 'shared';

export interface LoginScreenProps {
  loading?: boolean;
  sessionLoading?: boolean;
  googleLoading?: boolean;
  passwordResetLoading?: boolean;
  error?: string | null;
  errorOwner?: LoginErrorOwner | null;
  passwordResetMessage?: string | null;
  passwordResetAvailableAtMillis?: number | null;
  // The integration owns asynchronous work, pending state and failure mapping.
  onSignIn: (email: string, password: string, keepSignedIn: boolean) => void;
  onSignUp: (email: string, password: string, keepSignedIn: boolean) => void;
  onPasswordReset: (email: string) => void;
  onGoogleSignIn: () => void;
}

function useResetCooldown(deadline: number | null) {
  const [, refresh] = useReducer((value: number) => value + 1, 0);
  const validDeadline = deadline !== null && Number.isFinite(deadline) ? deadline : 0;

  useEffect(() => {
    let timer: number | undefined;
    const schedule = () => {
      const remaining = validDeadline - Date.now();
      if (remaining > 0) {
        timer = window.setTimeout(() => {
          refresh();
          schedule();
        }, Math.min(1000, remaining));
      }
    };
    // Recompute from the absolute deadline after background timer throttling.
    const resume = () => refresh();
    schedule();
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [validDeadline]);

  return Math.max(0, Math.ceil((validDeadline - Date.now()) / 1000));
}

export function LoginScreen({
  loading = false,
  sessionLoading = false,
  googleLoading = false,
  passwordResetLoading = false,
  error = null,
  errorOwner = null,
  passwordResetMessage = null,
  passwordResetAvailableAtMillis = null,
  onSignIn,
  onSignUp,
  onPasswordReset,
  onGoogleSignIn,
}: LoginScreenProps) {
  const [mode, setMode] = useState<AuthMode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [keepSignedIn, setKeepSignedIn] = useState(false);
  const cooldown = useResetCooldown(passwordResetAvailableAtMillis);
  const authenticating = loading || googleLoading || sessionLoading;
  const busy = authenticating || passwordResetLoading;
  const signIn = mode === 'signIn';
  const visibleError = error !== null && (
    errorOwner === 'shared' || errorOwner === mode || (errorOwner === null && signIn)
  );
  const modeOption = useRef<HTMLInputElement>(null);
  const wasAuthenticating = useRef(false);
  useLayoutEffect(() => {
    if (!authenticating && wasAuthenticating.current) modeOption.current?.focus({ preventScroll: true });
    wasAuthenticating.current = authenticating;
  }, [authenticating]);
  const resetLabel = passwordResetLoading
    ? 'Enviando...'
    : (cooldown > 0 ? `Reenviar en ${cooldown}s` : 'Olvidé mi contraseña');

  return (
    <main className="login-page">
      <section className="login-panel" aria-label="Reals" onKeyDown={(event) => {
        // Browser Back keeps its normal navigation meaning. Escape switches
        // modes without adding or replacing a history entry.
        if (event.key === 'Escape' && !signIn && !busy) {
          event.preventDefault();
          setMode('signIn');
        }
      }}>
        <LoginBrand />
        {authenticating ? <AuthenticationProgress /> : <>
          <fieldset className="login-modes" disabled={busy}>
            <legend className="login-visually-hidden">Acceso a Reals</legend>
            <label>
              <input ref={signIn ? modeOption : null} type="radio" name="auth-mode" checked={signIn} onChange={() => setMode('signIn')} />
              <span id="login-sign-in">Iniciar sesión</span>
            </label>
            <label>
              <input ref={signIn ? null : modeOption} type="radio" name="auth-mode" checked={!signIn} onChange={() => setMode('signUp')} />
              <span id="login-sign-up">Crear cuenta</span>
            </label>
          </fieldset>
          <form className="login-form" aria-labelledby={signIn ? 'login-sign-in' : 'login-sign-up'} aria-busy={busy} noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy) (signIn ? onSignIn : onSignUp)(email, password, keepSignedIn);
            }}>
            <div className="login-field">
              <input id="login-email" name="email" type="email" inputMode="email"
                autoComplete="username" autoCapitalize="none" spellCheck={false}
                placeholder=" " value={email} disabled={busy}
                onChange={(event) => setEmail(event.target.value)} />
              <label htmlFor="login-email">Email</label>
            </div>
            <div className="login-field">
              <input id="login-password" name="password" type="password"
                autoComplete={signIn ? 'current-password' : 'new-password'}
                placeholder=" " value={password} disabled={busy}
                onChange={(event) => setPassword(event.target.value)} />
              <label htmlFor="login-password">Password</label>
            </div>
            <label className="login-remember">
              <input type="checkbox" aria-describedby="persistence-description" checked={keepSignedIn} disabled={busy}
                onChange={(event) => setKeepSignedIn(event.target.checked)} />
              <span>Mantener sesión iniciada</span>
            </label>
            <p id="persistence-description" className="login-feedback">La opción se aplica a email y contraseña. Con Google, la sesión dura sólo en esta pestaña.</p>
            {visibleError && <p className="login-error" role="alert">{error}</p>}
            {signIn && passwordResetMessage !== null && (
              <p className="login-feedback" role="status">{passwordResetMessage}</p>
            )}
            <button className="login-button login-primary" type="submit" disabled={busy}>
              {signIn ? 'Ingresar' : 'Crear cuenta'}
            </button>
            {signIn && (
              <button className="login-button login-outlined" type="button"
                disabled={busy || cooldown > 0}
                onClick={() => {
                  if (!busy && cooldown <= 0) onPasswordReset(email);
                }}>
                {resetLabel}
              </button>
            )}
            <div className="login-or" aria-hidden="true"><span />o<span /></div>
            <button className="login-button login-outlined login-google" type="button" disabled={busy}
              onClick={() => { if (!busy) onGoogleSignIn(); }}>
              <img src={googleIcon} alt="" width="20" height="20" />
              Continuar con Google
            </button>
          </form>
        </>}
      </section>
    </main>
  );
}

function LoginBrand() {
  return <header className="login-header"><div className="login-brand">
    <img className="login-seal" src={seal} alt="" width="54" height="54" />
    <h1>Reals</h1>
    <div className="brand-divider" aria-hidden="true"><span /></div>
  </div></header>;
}

function AuthenticationProgress() {
  return <div className="auth-progress" role="status" aria-atomic="true">
    <span className="auth-spinner" aria-hidden="true" />
    <p>Preparando tu sesión de forma segura…</p>
  </div>;
}

export function AuthenticationLoading() {
  return <main className="login-page"><section className="login-panel" aria-label="Reals">
    <LoginBrand />
    <AuthenticationProgress />
  </section></main>;
}
