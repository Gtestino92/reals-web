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
import seal from './assets/reals-seal.png';
import { Home, AdminEntry } from './home/Home';

const AdminGate = lazy(() => import('./admin/AdminGate'));

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
  if (['checking', 'loading', 'login', 'authenticating'].includes(state.phase)) return <LoginScreen
    sessionLoading={state.phase === 'checking' || state.phase === 'loading'} onCancelSession={state.phase === 'loading' ? controller.signOut : undefined}
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
  const access = useSyncExternalStore(controller.admin.subscribe, controller.admin.getSnapshot);
  const blocked = useRef(false), adminBlocked = useRef(false), entryEpoch = useRef(0);
  const challengeActive = useRef(false), adminTrigger = useRef<HTMLElement | null>(null);
  const [guarded, setGuarded] = useState(false);
  const reportBlocked = useCallback((value: boolean) => { blocked.current = value; setGuarded(value); }, []);
  const reportAdminBlocked = useCallback((value: boolean) => { adminBlocked.current = value; }, []);
  // Cancelling a direct /admin challenge reveals the already-visible Home context;
  // it does not navigate away from its forms, chats or pending reads.
  const navigation = useHomeNavigation(target => (target === 'home' && challengeActive.current) || (!blocked.current && (target !== 'admin' || !adminBlocked.current)));
  const administrative = navigation.destination === 'admin';
  const [intent, setIntent] = useState(false), [entryBusy, setEntryBusy] = useState(false), [viewReady, setViewReady] = useState(false);
  const [AdminScreen, setAdminScreen] = useState<typeof import('./admin/Admin').default | null>(null);
  const [adminLoadError, setAdminLoadError] = useState('');
  useLayoutEffect(() => {
    if ((!intent && !administrative && !entryBusy) || AdminScreen) return;
    let current = true;
    // Load presentation code while checking access; importing it performs no private reads.
    void import('./admin/Admin').then(module => { if (current) setAdminScreen(() => module.default); }).catch(() => {
      if (current) { cancel(); setAdminLoadError('No se pudo cargar Administración. Revisá tu conexión y volvé a intentar.'); }
    });
    return () => { current = false; };
  }, [intent, administrative, entryBusy, AdminScreen]);
  const [chatActive, setChatActive] = useState(false);
  const [managementActive, setManagementActive] = useState(false);
  const [setupAccountAvailable, setSetupAccountAvailable] = useState(false);
  const homeReady = state.profile?.status === 'ACTIVE' || managementActive;
  const chatShell = chatActive && homeReady;
  const displayingAdmin = administrative && viewReady && access.phase === 'allowed';
  challengeActive.current = intent || (administrative && !displayingAdmin);
  useLayoutEffect(() => {
    if (!displayingAdmin) { controller.setAdminView(false, intent || administrative); if (viewReady) setViewReady(false); }
  }, [controller, displayingAdmin, viewReady, intent, administrative]);
  useLayoutEffect(() => () => { entryEpoch.current++; }, []);
  const enter = () => {
    if (!AdminScreen || blocked.current || adminBlocked.current || controller.admin.getSnapshot().phase !== 'allowed' || controller.admin.getSnapshot().busy) return false;
    adminTrigger.current = null;
    setIntent(false);
    controller.setAdminView(true); setViewReady(true);
    if (!administrative) navigation.open('admin');
    return true;
  };
  const cancel = () => {
    entryEpoch.current++; setEntryBusy(false); setIntent(false); setViewReady(false);
    controller.admin.suspendView(); controller.setAdminView(false);
    if (administrative) navigation.backTo('home', true);
  };
  useLayoutEffect(() => {
    if (navigation.destination !== 'home' && !administrative && (intent || entryBusy)) cancel();
  }, [navigation.destination]);
  const requestAdmin = () => {
    if (blocked.current || adminBlocked.current || entryBusy || !state.adminEligible) return;
    const epoch = ++entryEpoch.current, context = state.authContextVersion;
    setAdminLoadError('');
    adminTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEntryBusy(true); setViewReady(false);
    void controller.admin.check().then(() => {
      if (epoch !== entryEpoch.current || controller.getSnapshot().phase !== 'ready') return;
      setEntryBusy(false);
      if (context !== controller.getSnapshot().authContextVersion) return;
      if (blocked.current || adminBlocked.current) { controller.admin.suspendView(); return; }
      if (controller.admin.getSnapshot().phase !== 'allowed' || !enter()) setIntent(true);
    });
  };
  if (displayingAdmin && AdminScreen) return <AdminScreen controller={controller} onReturn={() => navigation.backTo('home')} onRevoked={cancel} onNavigationBlockedChange={reportBlocked} />;
  const regularNavigation = administrative ? { ...navigation, destination: 'home' as const } : navigation;
  return <><main className={chatShell ? 'chat-page' : 'login-page'}><section className={chatShell ? 'chat-shell' : 'login-panel'} aria-label={chatShell ? 'Conversación activa' : undefined} aria-labelledby={chatShell ? undefined : 'session-heading'}>
    {!chatShell && <header className="login-header session-header"><div className="login-brand"><img className="login-seal" src={seal} alt="" width="54" height="54" /><h1 id="session-heading">Reals</h1><div className="brand-divider" aria-hidden="true"><span /></div></div>{!homeReady && state.adminEligible && <div className="session-admin-entry"><AdminEntry onClick={requestAdmin} pending={entryBusy || intent} disabled={guarded} /></div>}</header>}
    {homeReady ? <Home onAdmin={state.adminEligible ? requestAdmin : undefined} adminPending={entryBusy || intent} onAdminNavigationBlockedChange={reportAdminBlocked} controller={controller} navigation={regularNavigation} onNavigationBlockedChange={reportBlocked} onManagementActiveChange={setManagementActive} onChatActiveChange={setChatActive} onCompleteProfile={() => controller.retry()} /> : <Onboarding onAdminNavigationBlockedChange={reportAdminBlocked} controller={controller} navigation={regularNavigation} onNavigationBlockedChange={reportBlocked} onAccountAvailableChange={setSetupAccountAvailable} />}
    {entryBusy && <p role="status">Consultando acceso administrativo…</p>}
    {adminLoadError && <p role="alert">{adminLoadError}</p>}
    {state.adminWarning && <p role="alert">{state.adminWarning}</p>}
    {state.verificationMessage && <p role="status">{state.verificationMessage}</p>}
    {state.error && <p className="login-error" role="alert">{state.error.message}</p>}
    {!chatShell && !homeReady && !setupAccountAvailable && <div className="session-actions"><SignOutButton onConfirm={controller.signOut} /></div>}
  </section></main>
    {(intent || administrative) && <Suspense fallback={<p role="status">Consultando acceso administrativo…</p>}><AdminGate controller={controller} modalOnly prepared={intent} onReturn={cancel} onVerified={enter} returnFocus={adminTrigger.current} /></Suspense>}
  </>;
}
