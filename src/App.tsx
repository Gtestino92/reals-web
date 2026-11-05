import { useState, useSyncExternalStore } from 'react';
import { LoginScreen } from './auth/LoginScreen';
import { configureFirebase } from './auth/firebase';
import type { FirebaseSetup } from './auth/firebase';
import { ApiClient } from './auth/api';
import { SessionController } from './auth/session';
import { Onboarding } from './onboarding/Onboarding';
import { SessionLoading } from './SessionLoading';
import seal from './assets/reals-seal.png';
import { Home } from './home/Home';

let defaultSetup: FirebaseSetup | undefined;
function setup() { return defaultSetup ??= configureFirebase(); }
export function App({ firebase = setup(), api }: { firebase?: FirebaseSetup; api?: ApiClient }) {
  const [controller] = useState(() => 'service' in firebase ? new SessionController(firebase.service, api ?? new ApiClient(), firebase.localVerification) : null);
  if (!controller) return <main className="login-page"><section className="login-panel"><h1>Reals</h1><p role="alert">{'error' in firebase ? firebase.error : 'Firebase no está configurado.'}</p></section></main>;
  return <SessionApp controller={controller} />;
}
function SessionApp({ controller }: { controller: SessionController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  if (state.phase === 'login' || state.phase === 'authenticating') return <LoginScreen
    loading={state.operation === 'signIn' || state.operation === 'signUp'}
    googleLoading={state.operation === 'google'} passwordResetLoading={state.operation === 'reset'}
    error={state.error?.message ?? null} errorOwner={state.error?.owner ?? null}
    passwordResetMessage={state.resetMessage} passwordResetAvailableAtMillis={state.resetAt}
    onSignIn={(email, password, keepSignedIn) => controller.authenticate('signIn', email, password, keepSignedIn)}
    onSignUp={(email, password, keepSignedIn) => controller.authenticate('signUp', email, password, keepSignedIn)}
    onGoogleSignIn={() => controller.authenticate('google')} onPasswordReset={controller.reset} />;
  return <main className="login-page"><section className="login-panel" aria-labelledby="session-heading">
    <header className="login-header"><div className="login-brand">
      <img className="login-seal" src={seal} alt="" width="54" height="54" />
      <h1 id="session-heading">Reals</h1>
      <div className="brand-divider" aria-hidden="true"><span /></div>
    </div></header>
    {(state.phase === 'checking' || state.phase === 'loading') && <SessionLoading />}
    {state.phase === 'signingOut' && <p role="status">Cerrando sesión…</p>}
    {state.phase === 'ready' && (state.profile?.status === 'ACTIVE' ? <Home key={`${state.account?.id}-${state.profile.id}`} controller={controller} onCompleteProfile={() => controller.retry()} /> : <Onboarding controller={controller} />)}
    {state.verificationMessage && <p role="status">{state.verificationMessage}</p>}
    {state.error && <p className="login-error" role="alert">{state.error.message}</p>}
    {(state.phase === 'recoverable' || state.phase === 'restricted') && <button className="login-button login-primary" onClick={controller.retry}>Reintentar</button>}
    {state.phase !== 'checking' && <div className="session-actions"><button className="login-button login-outlined" disabled={state.phase === 'signingOut'} onClick={controller.signOut}>Cerrar sesión</button></div>}
  </section></main>;
}
