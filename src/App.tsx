import { useHomeNavigation } from './home/useHomeNavigation';
import { AccountSuspension } from './auth/AccountSuspension';
import { AccountDeletionRecovery } from './auth/AccountDeletionRecovery';
import { SignOutButton } from './auth/SignOutButton';
import { tabOwnershipEnabled } from './tabs/policy';
import { TabGate } from './tabs/TabGate';
import type { TabOwnershipManager } from './tabs/TabOwnershipManager';
import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { LoginScreen } from './auth/LoginScreen';
import { configureFirebase } from './auth/firebase';
import type { FirebaseSetup } from './auth/firebase';
import { ApiClient } from './auth/api';
import { SessionController } from './auth/session';
import { Onboarding } from './onboarding/Onboarding';
import { SessionLoading } from './SessionLoading';
import seal from './assets/reals-seal.png';
import { Home } from './home/Home';

const Admin = lazy(() => import('./admin/AdminGate'));

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
    const controller = 'service' in firebaseSetup ? new SessionController(firebaseSetup.service, (api ?? new ApiClient().withAppCheck(firebaseSetup.service.appCheckToken)).withOwnership(ownership), firebaseSetup.localVerification, ownership) : null;
    return { controller, firebaseSetup };
  });
  if (!controller) return <main className="login-page"><section className="login-panel"><h1>Reals</h1><p role="alert">{'error' in firebaseSetup ? firebaseSetup.error : 'Firebase no está configurado.'}</p></section></main>;
  return <SessionApp controller={controller} />;
}
function SessionApp({ controller }: { controller: SessionController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  useLayoutEffect(() => {
    // An explicit login always starts in ordinary Reals, even after a direct /admin URL.
    if (state.phase === 'login' || state.phase === 'authenticating') window.history.replaceState(null, '', '/');
  }, [state.phase]);
  if (state.phase === 'ready') return <ReadySession key={state.account?.id} controller={controller} />;
  if (state.phase === 'login' || state.phase === 'authenticating') return <LoginScreen
    loading={state.operation === 'signIn' || state.operation === 'signUp'}
    googleLoading={state.operation === 'google'} passwordResetLoading={state.operation === 'reset'}
    error={state.error?.message ?? state.adminWarning ?? null} errorOwner={state.error?.owner ?? (state.adminWarning ? 'shared' : null)}
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
    {(state.phase === 'temporarySuspension' || state.phase === 'permanentAppeal') && <AccountSuspension controller={controller} state={state} />}
    {state.phase === 'deletionRecovery' && <AccountDeletionRecovery controller={controller} state={state} />}
    {state.adminWarning && <p role="alert">{state.adminWarning}</p>}
    {state.verificationMessage && <p role="status">{state.verificationMessage}</p>}
    {state.error && !['deletionRecovery', 'temporarySuspension', 'permanentAppeal'].includes(state.phase) && <p className="login-error" role="alert">{state.error.message}</p>}
    {(state.phase === 'recoverable' || state.phase === 'restricted') && <button className="login-button login-primary" onClick={controller.retry}>Reintentar</button>}
    {!['deletionRecovery', 'temporarySuspension', 'permanentAppeal'].includes(state.phase) && state.phase !== 'checking' && <div className="session-actions"><SignOutButton disabled={state.phase === 'signingOut'} onConfirm={controller.signOut} /></div>}
  </section></main>;
}

function ReadySession({ controller }: { controller: SessionController }) {
  const state = controller.getSnapshot();
  const blocked = useRef(false);
  const reportBlocked = useCallback((value: boolean) => { blocked.current = value; }, []);
  const adminBlocked = useRef(false);
  const reportAdminBlocked = useCallback((value: boolean) => { adminBlocked.current = value; }, []);
  const navigation = useHomeNavigation(target => !blocked.current && (target !== 'admin' || !adminBlocked.current));
  const administrative = navigation.destination === 'admin';
  const [chatActive, setChatActive] = useState(false);
  const [managementActive, setManagementActive] = useState(false);
  const [setupAccountAvailable, setSetupAccountAvailable] = useState(false);
  const homeReady = state.profile?.status === 'ACTIVE' || managementActive;
  const chatShell = chatActive && homeReady;
  useLayoutEffect(() => {
    controller.setAdminView(administrative);
  }, [controller, administrative]);
  if (administrative) return <Suspense fallback={<SessionLoading />}><Admin controller={controller} onReturn={() => navigation.backTo('account')} onNavigationBlockedChange={reportBlocked} /></Suspense>;
  return <main className={chatShell ? 'chat-page' : 'login-page'}><section className={chatShell ? 'chat-shell' : 'login-panel'} aria-label={chatShell ? 'Conversaci\u00f3n activa' : undefined} aria-labelledby={chatShell ? undefined : 'session-heading'}>
    {!chatShell && <header className="login-header"><div className="login-brand"><img className="login-seal" src={seal} alt="" width="54" height="54" /><h1 id="session-heading">Reals</h1><div className="brand-divider" aria-hidden="true"><span /></div></div></header>}
    {homeReady ? <Home onAdminNavigationBlockedChange={reportAdminBlocked} controller={controller} navigation={navigation} onNavigationBlockedChange={reportBlocked} onManagementActiveChange={setManagementActive} onChatActiveChange={setChatActive} onCompleteProfile={() => controller.retry()} /> : <Onboarding onAdminNavigationBlockedChange={reportAdminBlocked} controller={controller} navigation={navigation} onNavigationBlockedChange={reportBlocked} onAccountAvailableChange={setSetupAccountAvailable} />}
    {state.adminWarning && <p role="alert">{state.adminWarning}</p>}
    {state.verificationMessage && <p role="status">{state.verificationMessage}</p>}
    {state.error && <p className="login-error" role="alert">{state.error.message}</p>}
    {!chatShell && !homeReady && !setupAccountAvailable && <div className="session-actions"><SignOutButton onConfirm={controller.signOut} /></div>}
  </section></main>;
}
