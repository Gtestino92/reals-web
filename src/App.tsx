import { useState, useSyncExternalStore } from 'react';
import { LoginScreen } from './auth/LoginScreen';
import { configureFirebase } from './auth/firebase';
import type { FirebaseSetup } from './auth/firebase';
import { ApiClient } from './auth/api';
import { SessionController } from './auth/session';

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
    onSignIn={(email, password) => controller.authenticate('signIn', email, password)}
    onSignUp={(email, password) => controller.authenticate('signUp', email, password)}
    onGoogleSignIn={() => controller.authenticate('google')} onPasswordReset={controller.reset} />;
  return <main className="login-page"><section className="login-panel" aria-labelledby="session-heading">
    <h1 id="session-heading">Reals</h1>
    <p role="status">{state.phase === 'checking' ? 'Comprobando sesión de Firebase...' : state.phase === 'signingOut' ? 'Cerrando sesión...' : state.phase === 'loading' ? 'Firebase autenticado. Cargando sesión del backend...' : state.phase === 'ready' ? 'Firebase autenticado. Sesión del backend lista.' : 'La sesión del backend no está lista.'}</p>
    {state.phase === 'ready' && <><p>Estado de cuenta: {state.account?.status}</p><p>{state.profile ? `Perfil existente: ${state.profile.status}` : 'Sin perfil: falta completar el registro.'}</p><p>Este es un punto de integración temporal. El inicio y la edición de perfil se implementarán en otra etapa.</p></>}
    {state.verificationMessage && <p>{state.verificationMessage}</p>}
    {state.error && <p className="login-error" role="alert">{state.error.message}</p>}
    {(state.phase === 'recoverable' || state.phase === 'restricted') && <button className="login-button login-primary" onClick={controller.retry}>Reintentar</button>}
    {state.phase !== 'checking' && <button className="login-button login-outlined" disabled={state.phase === 'signingOut'} onClick={controller.signOut}>Cerrar sesión</button>}
  </section></main>;
}
