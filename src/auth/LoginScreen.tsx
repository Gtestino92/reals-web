import { useEffect, useReducer, useState } from 'react';
import seal from '../assets/reals-seal.png';
import googleIcon from '../assets/google-g.png';
import './login.css';

type AuthMode = 'signIn' | 'signUp';
export type LoginErrorOwner = AuthMode | 'shared';

export interface LoginScreenProps {
  loading?: boolean;
  googleLoading?: boolean;
  passwordResetLoading?: boolean;
  error?: string | null;
  errorOwner?: LoginErrorOwner | null;
  passwordResetMessage?: string | null;
  passwordResetAvailableAtMillis?: number | null;
  // The integration owns asynchronous work, pending state and failure mapping.
  onSignIn: (email: string, password: string, rememberCredentials: boolean) => void;
  onSignUp: (email: string, password: string, rememberCredentials: boolean) => void;
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
  const [rememberCredentials, setRememberCredentials] = useState(false);
  const cooldown = useResetCooldown(passwordResetAvailableAtMillis);
  const busy = loading || googleLoading || passwordResetLoading;
  const signIn = mode === 'signIn';
  const visibleError = error !== null && (
    errorOwner === 'shared' || errorOwner === mode || (errorOwner === null && signIn)
  );
  const submitLabel = signIn
    ? (loading ? 'Ingresando...' : 'Ingresar')
    : (loading ? 'Creando cuenta...' : 'Crear cuenta');
  const resetLabel = passwordResetLoading
    ? 'Enviando...'
    : (cooldown > 0 ? `Reenviar en ${cooldown}s` : 'Olvidé mi contraseña');

  return (
    <main className="login-page">
      <section className="login-panel" aria-labelledby="login-heading">
        <header className="login-header">
          <div className="login-brand">
            <img className="login-seal" src={seal} alt="" width="54" height="54" />
            <h1>Reals</h1>
            <div className="brand-divider" aria-hidden="true"><span /></div>
          </div>
          <h2 id="login-heading">{signIn ? 'Iniciar sesión' : 'Creá tu cuenta'}</h2>
          <p id="login-description">{signIn
            ? 'Ingresá con tu email y contraseña para continuar.'
            : 'Registrate con tu email y contraseña para empezar.'}</p>
        </header>
        <form
          className="login-form"
          aria-labelledby="login-heading"
          aria-describedby="login-description"
          aria-busy={busy}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            (signIn ? onSignIn : onSignUp)(email, password, rememberCredentials);
          }}
          onKeyDown={(event) => {
            // Browser Back keeps its normal navigation meaning. Escape offers
            // the local Android Back equivalent without modifying history.
            if (event.key === 'Escape' && !signIn && !busy) {
              event.preventDefault();
              setMode('signIn');
            }
          }}
        >
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
            <input type="checkbox" checked={rememberCredentials} disabled={busy}
              onChange={(event) => setRememberCredentials(event.target.checked)} />
            <span>Recordar credenciales</span>
          </label>
          {visibleError && <p className="login-error" role="alert">{error}</p>}
          {signIn && passwordResetMessage !== null && (
            <p className="login-feedback" role="status">{passwordResetMessage}</p>
          )}
          <button className="login-button login-primary" type="submit" disabled={busy}>
            {submitLabel}
          </button>
          <button className="login-button login-switch" type="button" disabled={busy}
            onClick={() => { if (!busy) setMode(signIn ? 'signUp' : 'signIn'); }}>
            {signIn ? '¿No tenés cuenta? Crear cuenta' : '¿Ya tenés cuenta? Ingresar'}
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
            {googleLoading ? 'Conectando con Google...' : 'Continuar con Google'}
          </button>
        </form>
      </section>
    </main>
  );
}
