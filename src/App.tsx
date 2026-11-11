import { AccountSuspension } from './auth/AccountSuspension';
import { AccountDeletionRecovery } from './auth/AccountDeletionRecovery';
import { SignOutButton } from './auth/SignOutButton';
import { tabOwnershipEnabled } from './tabs/policy';
import { TabGate } from './tabs/TabGate';
import type { TabOwnershipManager } from './tabs/TabOwnershipManager';
import { lazy, Suspense, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { LoginScreen } from './auth/LoginScreen';
import { configureFirebase } from './auth/firebase';
import type { FirebaseSetup } from './auth/firebase';
import { ApiClient } from './auth/api';
import { SessionController } from './auth/session';
import { Onboarding } from './onboarding/Onboarding';
import { SessionLoading } from './SessionLoading';
import seal from './assets/reals-seal.png';
import { Home } from './home/Home';

const Admin = lazy(() => import('./admin/Admin'));

type AppProps = { firebase?: FirebaseSetup; api?: ApiClient; ownership?: TabOwnershipManager };
export function App(props: AppProps) {
  if (!props.ownership && !tabOwnershipEnabled(import.meta.env.DEV, window.location.hostname, import.meta.env.VITE_ENFORCE_TAB_OWNERSHIP)) return <OperationalApp {...props} />;
  return <TabGate manager={props.ownership}>{ownership => <OperationalApp {...props} ownership={ownership} />}</TabGate>;
}
export function OperationalApp({ firebase, api, ownership }: AppProps) {
  const [{ controller, firebaseSetup }] = useState(() => {
    // SDK app/auth initialization is idempotent; the service wrapper belongs to
    // this operational mount and must never retain a previous gate's manager.
    const firebaseSetup = firebase ?? configureFirebase(import.meta.env, ownership);
    const controller = 'service' in firebaseSetup ? new SessionController(firebaseSetup.service, (api ?? new ApiClient()).withOwnership(ownership), firebaseSetup.localVerification, ownership) : null;
    return { controller, firebaseSetup };
  });
  if (!controller) return <main className="login-page"><section className="login-panel"><h1>Reals</h1><p role="alert">{'error' in firebaseSetup ? firebaseSetup.error : 'Firebase no está configurado.'}</p></section></main>;
  return <SessionApp controller={controller} />;
}
function SessionApp({ controller }: { controller: SessionController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [adminRoute, setAdminRoute] = useState(() => window.location.pathname === '/admin');
  useLayoutEffect(() => {
    const pop = () => setAdminRoute(window.location.pathname === '/admin');
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  const [chatActive, setChatActive] = useState(false);
  const [managementActive, setManagementActive] = useState(false);
  const [setupAccountAvailable, setSetupAccountAvailable] = useState(false);
  useLayoutEffect(() => {
    if (state.phase !== 'ready') { setChatActive(false); setManagementActive(false); setSetupAccountAvailable(false); }
  }, [state.phase]);
  const homeReady = state.phase === 'ready' && (state.profile?.status === 'ACTIVE' || managementActive);
  const chatShell = chatActive && homeReady;
  if (state.phase === 'login' || state.phase === 'authenticating') return <LoginScreen
    loading={state.operation === 'signIn' || state.operation === 'signUp'}
    googleLoading={state.operation === 'google'} passwordResetLoading={state.operation === 'reset'}
    error={state.error?.message ?? null} errorOwner={state.error?.owner ?? null}
    passwordResetMessage={state.resetMessage} passwordResetAvailableAtMillis={state.resetAt}
    onSignIn={(email, password, keepSignedIn) => controller.authenticate('signIn', email, password, keepSignedIn)}
    onSignUp={(email, password, keepSignedIn) => controller.authenticate('signUp', email, password, keepSignedIn)}
    onGoogleSignIn={() => controller.authenticate('google')} onPasswordReset={controller.reset} />;
  if (adminRoute && state.phase === 'ready') return <Suspense fallback={<SessionLoading />}><Admin key={state.account?.id} controller={controller} /></Suspense>;
  return <main className={chatShell ? "chat-page" : "login-page"}><section className={chatShell ? "chat-shell" : "login-panel"} aria-label={chatShell ? "Conversación activa" : undefined} aria-labelledby={chatShell ? undefined : "session-heading"}>
    {!chatShell && <header className="login-header"><div className="login-brand">
      <img className="login-seal" src={seal} alt="" width="54" height="54" />
      <h1 id="session-heading">Reals</h1>
      <div className="brand-divider" aria-hidden="true"><span /></div>
    </div></header>}
    {(state.phase === 'checking' || state.phase === 'loading') && <SessionLoading />}
    {state.phase === 'signingOut' && <p role="status">Cerrando sesión…</p>}
    {state.phase === 'ready' && (homeReady ? <Home key={`${state.account?.id}-${state.profile?.id}`} controller={controller} onManagementActiveChange={setManagementActive} onChatActiveChange={setChatActive} onCompleteProfile={() => controller.retry()} /> : <Onboarding key={state.account?.id} controller={controller} onAccountAvailableChange={setSetupAccountAvailable} />)}
    {(state.phase === 'temporarySuspension' || state.phase === 'permanentAppeal') && <AccountSuspension controller={controller} state={state} />}
    {state.phase === 'deletionRecovery' && <AccountDeletionRecovery controller={controller} state={state} />}
    {state.verificationMessage && <p role="status">{state.verificationMessage}</p>}
    {state.error && !['deletionRecovery', 'temporarySuspension', 'permanentAppeal'].includes(state.phase) && <p className="login-error" role="alert">{state.error.message}</p>}
    {(state.phase === 'recoverable' || state.phase === 'restricted') && <button className="login-button login-primary" onClick={controller.retry}>Reintentar</button>}
    {!['deletionRecovery', 'temporarySuspension', 'permanentAppeal'].includes(state.phase) && !chatShell && !homeReady && !setupAccountAvailable && state.phase !== 'checking' && <div className="session-actions"><SignOutButton disabled={state.phase === 'signingOut'} onConfirm={controller.signOut} /></div>}
  </section></main>;
}
