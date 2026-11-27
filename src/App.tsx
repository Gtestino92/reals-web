import { LegalSession } from './legal/LegalSession';
import { useHomeNavigation } from './home/useHomeNavigation';
import { AccountSuspension } from './auth/AccountSuspension';
import { AccountDeletionRecovery } from './auth/AccountDeletionRecovery';
import { SignOutButton } from './auth/SignOutButton';
import { tabOwnershipEnabled } from './tabs/policy';
import { TabGate } from './tabs/TabGate';
import type { TabOwnershipManager } from './tabs/TabOwnershipManager';
import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AuthenticationLoading, LoginScreen } from './auth/LoginScreen';
import { configureFirebase } from './auth/firebase';
import type { FirebaseSetup } from './auth/firebase';
import { ApiClient } from './auth/api';
import { SessionController } from './auth/session';
import type { SessionSnapshot } from './auth/session';
import { Onboarding } from './onboarding/Onboarding';
import seal from './assets/reals-seal.png';
import { Home, AdminEntry } from './home/Home';
import type { AdminHomeState } from './home/Home';
import { ActivityNotifications, useActivityNotifications } from './notifications/useActivityNotifications';
import { StartupBoundary, useStartupDestination } from './SessionLoading';

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
  return <StartupBoundary attempt={controller.startupAttempt} slowRecovery={<><p>La preparación está tardando más de lo habitual.</p><SignOutButton onConfirm={controller.signOut}/></>}>
    <SessionDestination state={state} controller={controller} />
  </StartupBoundary>;
}
function SessionDestination({ controller, state }: { controller: SessionController; state: SessionSnapshot }) {
  const restoring = state.phase === 'checking' || (state.phase === 'loading' && state.operation === null);
  const starting = useStartupDestination(!['checking', 'loading', 'authenticating', 'ready'].includes(state.phase));
  useLayoutEffect(() => {
    // An explicit login always starts in ordinary Reals, even after a direct /admin URL.
    if (state.phase === 'login' || state.phase === 'authenticating') window.history.replaceState(null, '', '/');
  }, [state.phase]);
  if (state.phase === 'ready') return <LegalSession key={state.account?.id} controller={controller}><ReadySession key={`${state.account?.id}/${state.profile?.id}`} controller={controller} /></LegalSession>;
  if (starting && restoring) return null;
  // Manual authentication keeps its operation through backend bootstrap.
  // Restoration has no operation and must not expose an intermediate login form.
  if (restoring) return <AuthenticationLoading />;
  if (['loading', 'login', 'authenticating'].includes(state.phase)) return <LoginScreen
    sessionLoading={state.phase === 'loading'}
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
    {!['deletionRecovery', 'temporarySuspension', 'permanentAppeal'].includes(state.phase) && <div className="session-actions"><SignOutButton disabled={state.phase === 'signingOut'} onConfirm={controller.signOut} /></div>}
  </section></main>;
}

function ReadySession({ controller }: { controller: SessionController }) {
  const state = controller.getSnapshot();
  const access = useSyncExternalStore(controller.admin.subscribe, controller.admin.getSnapshot);
  const regularVisible = useRef(true);
  const reportRegularBlocked = useCallback((value: boolean) => { if (regularVisible.current) reportBlocked(value); }, []);
  const blocked = useRef(false), adminBlocked = useRef(false), entryEpoch = useRef(0);
  const challengeActive = useRef(false), adminTrigger = useRef<HTMLElement | null>(null);
  const [guarded, setGuarded] = useState(false);
  const [homeEntry, setHomeEntry] = useState({ phase: 'ready' as AdminHomeState, revision: 0 });
  const currentHomeEntry = useRef(homeEntry);
  const adminIntent = useRef<{ context: number | undefined; revision: number } | null>(null);
  const reportAdminHomeState = useCallback((phase: AdminHomeState, revision: number) => {
    const current = currentHomeEntry.current;
    if (current.phase === phase && current.revision === revision) return;
    currentHomeEntry.current = { phase, revision };
    setHomeEntry(currentHomeEntry.current);
  }, []);
  const reportBlocked = useCallback((value: boolean) => { blocked.current = value; setGuarded(value); }, []);
  const reportAdminBlocked = useCallback((value: boolean) => { adminBlocked.current = value; }, []);
  // Cancelling a direct /admin challenge reveals the already-visible Home context;
  // it does not navigate away from its forms, chats or pending reads.
  const navigation = useHomeNavigation(target => (target === 'home' && challengeActive.current) || (!blocked.current && (target !== 'admin' || !adminBlocked.current)));
  const administrative = navigation.destination === 'admin';
  useStartupDestination(administrative);
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
  const notifications = useActivityNotifications(controller, state.account?.id, administrative || intent || entryBusy);
  regularVisible.current = !displayingAdmin;
  challengeActive.current = intent || (administrative && !displayingAdmin);
  useLayoutEffect(() => {
    // Close on a displayed view's exit. A child gate can commit entry in its
    // layout effect, before this component renders the new destination.
    if (!displayingAdmin) { controller.setAdminView(false, intent || administrative); if (viewReady) setViewReady(false); }
  }, [controller, displayingAdmin]);
  useLayoutEffect(() => () => { entryEpoch.current++; }, []);
  const enter = () => {
    const home = currentHomeEntry.current, pending = adminIntent.current, session = controller.getSnapshot();
    if (!AdminScreen || blocked.current || adminBlocked.current || (homeReady && home.phase !== 'ready') ||
        (!administrative && (!pending || pending.context !== session.authContextVersion || pending.revision !== home.revision)) ||
        session.phase !== 'ready' || !controller.admin.token() || controller.admin.getSnapshot().phase !== 'allowed' || controller.admin.getSnapshot().busy) return false;
    adminIntent.current = null;
    adminTrigger.current = null;
    setIntent(false);
    controller.setAdminView(true); setViewReady(true);
    if (!administrative) navigation.open('admin');
    return true;
  };
  const cancel = () => {
    adminIntent.current = null;
    entryEpoch.current++; setEntryBusy(false); setIntent(false); setViewReady(false);
    controller.admin.suspendView(); controller.setAdminView(false);
    if (administrative) navigation.backTo('home', true);
  };
  useLayoutEffect(() => {
    if (navigation.destination !== 'home' && !administrative && (intent || entryBusy)) cancel();
  }, [navigation.destination]);
  useLayoutEffect(() => {
    const pending = adminIntent.current;
    if ((pending && (guarded || (homeReady && homeEntry.phase === 'blocked') ||
        pending.revision !== homeEntry.revision || pending.context !== state.authContextVersion)) ||
        (chatActive && administrative && !displayingAdmin)) cancel();
  }, [guarded, homeReady, homeEntry, state.authContextVersion, chatActive, administrative, displayingAdmin]);
  const requestAdmin = () => {
    if (blocked.current || adminBlocked.current || (homeReady && currentHomeEntry.current.phase === 'blocked') || adminIntent.current || !state.adminEligible) return;
    const epoch = ++entryEpoch.current, context = state.authContextVersion;
    adminIntent.current = { context, revision: currentHomeEntry.current.revision };
    setAdminLoadError('');
    adminTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEntryBusy(true); setViewReady(false);
    void controller.admin.check().then(() => {
      if (epoch !== entryEpoch.current || controller.getSnapshot().phase !== 'ready') return;
      if (context !== controller.getSnapshot().authContextVersion || blocked.current || adminBlocked.current ||
          (homeReady && currentHomeEntry.current.phase === 'blocked') || adminIntent.current?.revision !== currentHomeEntry.current.revision) { cancel(); return; }
      setEntryBusy(false);
      setIntent(true);
    });
  };

  const regularNavigation = administrative ? { ...navigation, destination: 'home' as const } : navigation;
  return <ActivityNotifications.Provider value={notifications}><div hidden={displayingAdmin}><main className={chatShell ? 'chat-page' : 'login-page'}><section className={chatShell ? 'chat-shell' : 'login-panel'} aria-label={chatShell ? 'Conversación activa' : undefined} aria-labelledby={chatShell ? undefined : 'session-heading'}>
    {!chatShell && <header className="login-header session-header"><div className="login-brand"><img className="login-seal" src={seal} alt="" width="54" height="54" /><h1 id="session-heading">Reals</h1><div className="brand-divider" aria-hidden="true"><span /></div></div>{!homeReady && state.adminEligible && <div className="session-admin-entry"><AdminEntry onClick={requestAdmin} pending={entryBusy || intent} disabled={guarded} /></div>}</header>}
    {homeReady ? <Home active={!displayingAdmin} offerInstallation={state.profile?.status === 'ACTIVE' && !administrative && !entryBusy && !intent} onAdmin={state.adminEligible ? requestAdmin : undefined} adminPending={entryBusy || intent} onAdminHomeState={reportAdminHomeState} onAdminNavigationBlockedChange={reportAdminBlocked} controller={controller} navigation={regularNavigation} onNavigationBlockedChange={reportRegularBlocked} onManagementActiveChange={setManagementActive} onChatActiveChange={setChatActive} onCompleteProfile={() => controller.retry()} /> : <Onboarding Home={Home} active={!displayingAdmin} onAdminNavigationBlockedChange={reportAdminBlocked} controller={controller} navigation={regularNavigation} onNavigationBlockedChange={reportRegularBlocked} onAccountAvailableChange={setSetupAccountAvailable} />}
    {entryBusy && <p role="status">Consultando acceso administrativo…</p>}
    {intent && homeReady && homeEntry.phase === 'checking' && access.phase === 'allowed' && !access.busy &&
      <div><p role="status">Verificando el estado de Inicio…</p><button type="button" className="login-button login-outlined" onClick={cancel}>Cancelar entrada a Admin</button></div>}
    {adminLoadError && <p role="alert">{adminLoadError}</p>}
    {state.adminWarning && <p role="alert">{state.adminWarning}</p>}
    {state.verificationMessage && <p role="status">{state.verificationMessage}</p>}
    {state.error && <p className="login-error" role="alert">{state.error.message}</p>}
    {!chatShell && !homeReady && !setupAccountAvailable && <div className="session-actions"><SignOutButton onConfirm={controller.signOut} /></div>}
  </section></main></div>
    {displayingAdmin && AdminScreen && <AdminScreen controller={controller} onReturn={() => navigation.backTo('home')} onRevoked={cancel} onNavigationBlockedChange={reportBlocked} />}
    {!displayingAdmin && (intent || administrative) && <Suspense fallback={<p role="status">Consultando acceso administrativo…</p>}><AdminGate controller={controller} modalOnly prepared={intent} onReturn={cancel} onVerified={enter} returnFocus={adminTrigger.current} /></Suspense>}
  </ActivityNotifications.Provider>;
}
