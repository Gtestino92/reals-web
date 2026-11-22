import { useSecondChatRestoration } from './useSecondChatRestoration';
import { SecondChatSession, SecondChatEntryIntent } from '../chat/SecondChatSession';
import { visualHomeProjection, visualReturnTarget } from './visualReturn';
import type { VisualOutcome } from '../visual/VisualSession';
import type { HomeData } from './contracts';
import { HomePriorities } from './HomePriorities';
import { useHomeTime } from './useHomeTime';
import { SecondChat } from '../chat/SecondChat';
import { SecondChatCard } from './SecondChatCard';
import { Scheduling } from '../scheduling/Scheduling';
import { VisualDeadline } from '../visual/deadline';
import { VisualReview } from '../visual/VisualReview';
import { useAffinityQuestionnaire, type AffinityModel } from '../profile/affinities/useAffinityQuestionnaire';
import { AffinityQuestionnaire } from '../profile/affinities/AffinityQuestionnaire';
import { presentation as affinityPresentation } from '../profile/affinities/presentation';
import { SignOutButton } from '../auth/SignOutButton';
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { SessionController } from '../auth/session';
import type { Activity } from './contracts';
import { Onboarding } from '../onboarding/Onboarding';
import { useHome } from './useHome';
import { activityPresentation } from './presentation';
import { SearchingScreen } from './SearchingScreen';
import { FirstChat } from '../chat/FirstChat';
import { ChatIcon } from '../chat/ChatIcon';
import { reconcileHiddenFirstChats } from './hiddenFirstChats';
import './home.css';
import { AccountSection } from './AccountSection';
import { useHomeNavigation } from './useHomeNavigation';
import type { HomeNavigation } from './useHomeNavigation';
import { isProfileQuestions } from '../profile/questions/ProfileQuestions';
import { updateFor } from '../notifications/activityPolicy';
import { useActivityNotificationContext } from '../notifications/useActivityNotifications';

const labels: Record<string, string> = {
  FIRST_CHAT: 'Primer chat', VISUAL_REVIEW: 'Perfil por descubrir', SCHEDULING: 'Coordinar horarios',
  SECOND_CHAT_SCHEDULED: 'Segundo chat programado', SECOND_CHAT_AVAILABLE: 'Segundo chat disponible',
  SECOND_CHAT_EXPIRED: 'Segundo chat: ventana finalizada', SECOND_CHAT_READ_ONLY: 'Segundo chat en modo lectura',
};
const blockedLabels: Record<string, string> = {
  PROFILE_REQUIRED: 'Creá tu perfil antes de buscar chat.',
  PROFILE_NOT_ACTIVE: 'Activá tu perfil para buscar nuevas personas.',
  ACTIVE_PENALTY: 'La búsqueda no está disponible por ahora. Revisá el estado de tu cuenta.',
  ACTIVE_MATCH_LIMIT_REACHED: 'Ya tenés conversaciones activas. Terminá una antes de buscar otra.',
  ACTIVE_CONNECTION_LIMIT_REACHED: 'Ya tenés conexiones activas. Terminá una antes de buscar otra.',
  VISUAL_ADVANCEMENT_LIMIT_REACHED: 'Alcanzaste el límite de perfiles por descubrir. Volvé a consultar más adelante.',
};
function ActivityCard({ item, accountId, onOpen, disabled = false, presented, onDismiss }: { disabled?: boolean; presented: boolean; item: Activity; accountId: string | null; onOpen: (item: Activity) => void; onDismiss: (id: string) => Promise<void> }) {
  const notifications = useActivityNotificationContext();
  const update = notifications?.enabled ? updateFor(item) : null;
  const badgeId = useId();
  const badge = update && notifications?.unread.has(update.id) ? <span className="activity-unread" id={badgeId}>Nuevo</span> : null;
  if (item.type.startsWith('SECOND_CHAT_')) return <SecondChatCard item={item} accountId={accountId} disabled={disabled} onOpen={onOpen} onDismiss={onDismiss} presented={presented} badge={badge}/>;
  if (item.type === 'VISUAL_REVIEW') return <button className="home-card home-activity-entry visual-activity" disabled={disabled} onClick={() => onOpen(item)}><span className="home-entry-title">{item.partnerName ? `Descubrí el perfil de ${item.partnerName}` : 'Descubrí el perfil'}{badge}</span><VisualDeadline start={item.visualStartedAt} end={item.visualExpiresAt}/><span className="visual-chevron" aria-hidden="true">›</span></button>;
  if (item.type === 'SCHEDULING') {
    const label = item.requiresAction ? 'Elegir horarios' : 'Ver coordinaci\u00f3n';
    return <article className="home-card scheduling-activity"><button className="scheduling-entry" aria-label={label} aria-describedby={badge ? badgeId : undefined} disabled={disabled || !item.connectionId || !item.matchId} onClick={() => onOpen(item)}><span className="home-entry-title">{item.partnerName ? `Con ${item.partnerName}` : 'Coordinaci\u00f3n'}{badge}</span><span>{label}</span><VisualDeadline start={item.createdAt} end={item.schedulingExpiresAt}/><span className="visual-chevron" aria-hidden="true">›</span></button><button className="login-button login-outlined" disabled={disabled || !item.matchId} onClick={() => onOpen({...item,type:'SCHEDULING_PROFILE'})}>Ver perfil</button></article>;
  }
  const when = item.secondChat?.availableAt;
  const body: Record<string, string> = {
    FIRST_CHAT: 'Tenés una conversación inicial para continuar.', VISUAL_REVIEW: 'Tenés un perfil por descubrir.',
    SCHEDULING: item.requiresAction ? 'Requiere tu atención para coordinar horarios.' : 'Esperando respuesta.',
    SECOND_CHAT_SCHEDULED: 'El servidor confirmó un próximo encuentro.', SECOND_CHAT_AVAILABLE: 'Tu segundo chat está disponible.',
    SECOND_CHAT_EXPIRED: 'La ventana para entrar terminó.', SECOND_CHAT_READ_ONLY: 'Esta conversación está en modo lectura.',
  };
  return <article className="home-card"><h4>{labels[item.type] ?? 'Actividad pendiente'}{badge}</h4>
    {item.partnerName && <p>Con {item.partnerName}</p>}
    {item.type === 'FIRST_CHAT' && item.chatId && <button className="login-button login-primary" disabled={disabled} onClick={() => onOpen(item)}>Abrir primer chat</button>}
    <p>{body[item.type] ?? 'Consultá esta actividad desde Android.'}</p>
    {typeof when === 'string' && <p>{item.type === 'SCHEDULING' ? 'Hasta: ' : 'Fecha: '}<time dateTime={when}>{new Date(when).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })}</time></p>}
  </article>;
}
type ManagementSurface = 'profile' | 'preferences' | 'affinities' | 'account';
export function AdminEntry({ onClick, pending, disabled }: { onClick: () => void; pending: boolean; disabled: boolean }) {
  return <button className="login-button login-outlined home-admin-entry" aria-busy={pending} disabled={disabled || pending} onClick={onClick}>
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Z" fill="none" stroke="currentColor" strokeWidth="1.8"/><path d="m8 12 3 3 5-6" fill="none" stroke="currentColor" strokeWidth="1.8"/></svg>Admin
  </button>;
}
const managementEntries = [
  ['profile', 'Tu perfil', 'Datos personales, bio, fotos y preguntas públicas.'],
  ['preferences', 'Preferencias', 'Tus filtros para encontrar personas'],
  ['affinities', 'Afinidades', 'Preguntas de compatibilidad'],
  ['account', 'Cuenta', 'Notificaciones, seguridad y sesi\u00f3n'],
] as const;

export function Home({ active = true, controller, onCompleteProfile, onChatActiveChange, onManagementActiveChange, navigation: providedNavigation, onNavigationBlockedChange, onAdminNavigationBlockedChange, delegateProfileQuestions = false, onAdmin, adminPending = false }: { active?: boolean; adminPending?: boolean; onAdmin?: (() => void) | undefined; delegateProfileQuestions?: boolean; onAdminNavigationBlockedChange?: ((blocked: boolean) => void) | undefined; onNavigationBlockedChange?: (blocked: boolean) => void; navigation?: HomeNavigation | undefined; onManagementActiveChange?: (active: boolean) => void; onChatActiveChange?: (active: boolean) => void; controller: SessionController; onCompleteProfile?: () => void }) {
  const affinities = useAffinityQuestionnaire(controller, active);
  const restoredSecond = useRef<SecondChatSession | undefined>(undefined);
  const secondEntry = useRef<SecondChatEntryIntent | undefined>(undefined);
  const [chat, setChat] = useState<Activity | null>(null), [notice, setNotice] = useState('');
  const homeReconciler = useRef<(() => Promise<HomeData | null>) | null>(null);
  const returnEpoch=useRef(0), returnAlive=useRef(true), visualDestinations=useRef(new Map<string,'home'|'activity'>());
  const [visualReturn,setVisualReturn]=useState<{matchId:string;reason:VisualOutcome;phase:'loading'|'error'}|null>(null);
  useEffect(()=>{returnAlive.current=true;return()=>{returnAlive.current=false;returnEpoch.current++;};},[]);
  const retireNotice = useCallback(() => setNotice(''), []);
  useLayoutEffect(() => { onChatActiveChange?.(!!chat); return () => onChatActiveChange?.(false); }, [chat, onChatActiveChange]);
  const suppressed = useRef(new Set<string>());
  const actedVisuals = useRef(new Set<string>());
  const hidden = useRef(new Set<string>());
  // A terminal match cannot become active again. Keep this session-only guard
  // even after a clean Home retires its currently-stale suppression entry.
  const knownClosed = useRef(new Set<string>());
  const openChat = (item: Activity, automatic = false) => {
    if (item.type.startsWith('SECOND_CHAT_') && item.connectionId && !automatic) { if (navigation.openSecondChat(item.connectionId,item.matchId)) { secondEntry.current = new SecondChatEntryIntent(controller,item.connectionId,item.matchId); setNotice(''); setChat(item); } return; }
    if (!item.chatId || knownClosed.current.has(item.matchId) || (automatic && suppressed.current.has(item.chatId))) return;
    setNotice(''); setChat(item);
  };
  const closeChat = (message = '', closed = false) => {
    if (chat?.chatId) suppressed.current.add(chat.chatId);
    if (closed && chat) { hidden.current.add(chat.matchId); knownClosed.current.add(chat.matchId); }
    if (chat?.type.startsWith('SECOND_CHAT_')) navigation.closeSecondChat();
    restoredSecond.current = undefined;
    secondEntry.current = undefined;
    setChat(null); setNotice(message);
  };
  const visualLocked = useRef(false), visualReturnLocked = useRef(false);
  const locked = useRef(false), accountLocked = useRef(false), overviewLocked = useRef(false), root = useRef<HTMLDivElement>(null);
  const currentChat = useRef(chat); currentChat.current = chat;
  const reportNavigationLock = useCallback(() => onNavigationBlockedChange?.(visualReturnLocked.current || visualLocked.current || locked.current || accountLocked.current || overviewLocked.current || !!currentChat.current), [onNavigationBlockedChange]);
  const reportVisualLock = useCallback((value: boolean) => { visualLocked.current = value; reportNavigationLock(); }, [reportNavigationLock]);
  const reportOverviewLock = useCallback((value: boolean) => { overviewLocked.current = value; reportNavigationLock(); }, [reportNavigationLock]);
  useLayoutEffect(() => { reportNavigationLock(); return () => onNavigationBlockedChange?.(false); }, [chat, onNavigationBlockedChange]);
  const localNavigation = useHomeNavigation(() => !visualReturnLocked.current && !visualLocked.current && !locked.current && !accountLocked.current && !overviewLocked.current && !chat, !providedNavigation);
  const navigation = providedNavigation ?? localNavigation;
  // Draft setup owns its shared history and renders questions outside this nested Home.
  const surface = navigation.destination === 'second-chat' || navigation.destination === 'home' || navigation.destination === 'activity' || (delegateProfileQuestions && (isProfileQuestions(navigation.destination) || ['my-profile-preview', 'setup-details'].includes(navigation.destination))) ? null : navigation.destination;
  const navigationRef=useRef(navigation);navigationRef.current=navigation;
  const finishVisual = async (matchId:string,reason:VisualOutcome) => {
    const epoch=++returnEpoch.current,account=controller.snapshot.account?.id;
    actedVisuals.current.add(matchId);visualReturnLocked.current=true;reportNavigationLock();
    setVisualReturn({matchId,reason,phase:'loading'});
    const data=await homeReconciler.current?.();
    if(!returnAlive.current||epoch!==returnEpoch.current||controller.snapshot.phase!=='ready'||controller.snapshot.account?.id!==account)return;
    if(!data){setVisualReturn({matchId,reason,phase:'error'});return;}
    const target=visualReturnTarget(data,actedVisuals.current,knownClosed.current);
    visualDestinations.current.set(matchId,target);visualReturnLocked.current=false;visualLocked.current=false;reportNavigationLock();setVisualReturn(null);
    navigationRef.current.finishVisualReview(target);
  };
  const safeVisualHome=()=>{
    if(visualReturn)visualDestinations.current.set(visualReturn.matchId,'home');
    returnEpoch.current++;visualReturnLocked.current=false;visualLocked.current=false;reportNavigationLock();setVisualReturn(null);
    setNotice('Actualiz\u00e1 Inicio para consultar tus actividades.');navigation.finishVisualReview('home');
  };
  useLayoutEffect(()=>{
    if(surface==='visual-review'&&navigation.matchId&&actedVisuals.current.has(navigation.matchId)&&!visualReturn){
      navigation.finishVisualReview(visualDestinations.current.get(navigation.matchId)??'home');
    }
  },[surface,navigation.matchId,visualReturn]);

  const profileActive = surface === 'profile' || surface === 'my-profile-preview' || isProfileQuestions(surface ?? '');
  const managementActive = profileActive || surface === 'preferences';
  const retainedManagement = useRef<'details' | 'filters' | null>(null);
  if (managementActive) retainedManagement.current = profileActive ? 'details' : 'filters';
  useLayoutEffect(() => { onManagementActiveChange?.(!!surface); return () => onManagementActiveChange?.(false); }, [surface, onManagementActiveChange]);
  const homePosition = useRef(0);
  const open = (next: ManagementSurface) => { homePosition.current = window.scrollY; retireNotice(); navigation.open(next); if (next === 'affinities') void affinities.refresh(true); };
  const returnHome = () => navigation.backTo('home');
  const preferencesSaved = () => { setNotice('Preferencias guardadas'); returnHome(); };
  const focusSurface = profileActive ? 'profile' : surface;
  const previousFocusSurface = useRef(focusSurface);
  useLayoutEffect(() => {
    const returningToAccount = previousFocusSurface.current === 'notifications' && focusSurface === 'account';
    previousFocusSurface.current = focusSurface;
    if (!active || !focusSurface || returningToAccount) return; // AccountSection restores the Notifications entry's focus.
    const heading = Array.from(root.current?.querySelectorAll('h2') ?? []).find(node => !node.closest('[hidden]'));
    document.documentElement.scrollTop = 0; document.body.scrollTop = 0;
    if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  }, [focusSurface, active]);
  return <><div hidden={!!surface || !!chat}><HomeOverview onRestoreSecond={(item,session) => { restoredSecond.current=session; secondEntry.current=undefined; navigation.restoreSecondChat(session.connectionId,session.matchId); setChat(item); }} homeReconciler={homeReconciler} returnScroll={homePosition} adminPending={adminPending} onAdmin={onAdmin} onNavigationBlockedChange={reportOverviewLock} affinities={affinities} notice={notice} retireNotice={retireNotice} controller={controller} onCompleteProfile={onCompleteProfile} onManage={open} onOpenChat={(item, automatic) => { if (item.type === 'VISUAL_REVIEW') { if (!automatic) { homePosition.current = window.scrollY; navigation.openVisualReview(item.matchId); } } else if ((item.type === 'SCHEDULING' || item.type === 'SCHEDULING_PROFILE') && item.connectionId) { if (!automatic) { homePosition.current = window.scrollY; navigation.openScheduling(item.connectionId,item.matchId,item.partnerName,item.type === 'SCHEDULING_PROFILE'); } } else openChat(item, automatic); }} suppressed={suppressed.current} hidden={hidden.current} knownClosed={knownClosed.current} actedVisuals={actedVisuals.current} active={active && !surface && !chat} chatOpen={!!chat} activityOpen={navigation.destination === 'activity'} onActivity={() => { homePosition.current = window.scrollY; navigation.open('activity'); }} onReturnHome={returnHome}/> </div>{chat?.type.startsWith('SECOND_CHAT_') && chat.connectionId ? <SecondChat key={chat.connectionId} controller={controller} connectionId={chat.connectionId} matchId={chat.matchId} entryIntent={secondEntry.current} partnerName={chat.partnerName} restoredSession={restoredSecond.current} onHome={closeChat} navigation={navigation}/> : chat?.chatId && <FirstChat key={chat.chatId} controller={controller} matchId={chat.matchId} chatId={chat.chatId} onHome={closeChat}/>}<div hidden={!surface} className="home home-management-page" ref={root}>
    {(surface === 'scheduling' || surface === 'partner-profile') && navigation.connectionId && navigation.matchId && active && <Scheduling key={navigation.connectionId} controller={controller} connectionId={navigation.connectionId} matchId={navigation.matchId} partnerName={navigation.partnerName ?? null} browse={surface === 'partner-profile'} onBrowse={navigation.openPartnerProfile} onCloseBrowse={() => navigation.backTo(navigation.trailIncludesScheduling ? 'scheduling' : navigation.trailIncludesActivity ? 'activity' : 'home')} onBlocked={reportVisualLock} onBack={() => navigation.backTo(navigation.trailIncludesActivity ? 'activity' : 'home')} onFinished={() => {visualLocked.current=false; reportNavigationLock(); navigation.backTo(navigation.trailIncludesActivity ? 'activity' : 'home');}}/>}
    {surface==='visual-review'&&visualReturn&&<section className="home-card" aria-busy={visualReturn.phase==='loading'}><h2 tabIndex={-1} ref={node=>node?.focus({preventScroll:true})}>Actualizando tus actividades</h2>{visualReturn.phase==='loading'?<p role="status">Consultando el estado de Inicio…</p>:<><p role="alert">No pudimos actualizar tus actividades. Podés reintentar o ir a Inicio para consultar el estado.</p><button className="login-button login-outlined" onClick={()=>void finishVisual(visualReturn.matchId,visualReturn.reason)}>Reintentar actualización</button><button className="login-button login-outlined" onClick={safeVisualHome}>Ir a Inicio</button></>}</section>}
    {surface === 'visual-review' && !visualReturn && navigation.matchId && !actedVisuals.current.has(navigation.matchId) && active && <VisualReview key={navigation.matchId} controller={controller} matchId={navigation.matchId} navigation={navigation} onBlocked={reportVisualLock} onFinished={reason=>void finishVisual(navigation.matchId!,reason)} onBack={() => navigation.backTo(navigation.trailIncludesActivity ? 'activity' : 'home')} />}

    <div hidden={surface !== 'account' && surface !== 'notifications'}><AccountSection controller={controller} disabled={false} onBack={() => navigation.backTo(surface === 'notifications' ? 'account' : 'home')} notificationsOpen={surface === 'notifications'} onNotificationsOpen={() => navigation.open('notifications')} onNavigationBlockedChange={value => { accountLocked.current = value; reportNavigationLock(); }} /></div>
    {retainedManagement.current && <div hidden={!managementActive}><Onboarding Home={Home} active={active && managementActive} onAdminNavigationBlockedChange={onAdminNavigationBlockedChange} controller={controller} management={retainedManagement.current} navigation={navigation} onBack={returnHome} onPreferencesSaved={preferencesSaved} onNavigationBlockedChange={value => { locked.current = value; reportNavigationLock(); }} /></div>}

    <AffinityQuestionnaire model={affinities} navigation={navigation}/>
  </div></>;
}

function HomeOverview({ onRestoreSecond, homeReconciler, returnScroll, actedVisuals, affinities, notice, retireNotice, controller, onCompleteProfile, onManage, onOpenChat, suppressed, hidden, knownClosed, active, chatOpen, activityOpen, onActivity, onReturnHome, onNavigationBlockedChange, onAdmin, adminPending }: { onRestoreSecond: (item: Activity, session: SecondChatSession) => void; homeReconciler: {current:(()=>Promise<HomeData|null>)|null}; actedVisuals: Set<string>; returnScroll: { current: number }; adminPending: boolean; onAdmin?: (() => void) | undefined; onNavigationBlockedChange: (blocked: boolean) => void; affinities: AffinityModel; activityOpen: boolean; chatOpen: boolean; onActivity: () => void; onReturnHome: () => void; active: boolean; notice: string; retireNotice: () => void; controller: SessionController; onCompleteProfile?: (() => void) | undefined; onManage: (surface: ManagementSurface) => void; onOpenChat: (item: Activity, automatic?: boolean) => void; suppressed: Set<string>; hidden: Set<string>; knownClosed: Set<string> }) {
  const notifications = useActivityNotificationContext();
  const setHomeMode = notifications?.setHomeMode;
  useLayoutEffect(() => {
    setHomeMode?.(chatOpen ? 'chat' : active ? 'ordinary' : 'elsewhere');
    return () => setHomeMode?.(null);
  }, [active, chatOpen, setHomeMode]);
  const unread = notifications?.unread.size ?? 0;
  const unreadDescription = useId();
  const { model, busy, blocked, error, canAutoOpen, refresh, refreshOnReturn, returning: returnRead, reconcileHome, dismissSecondChat, search, cancel, searchPhase, backFromSearch, canRetryLocation, retryLocation } = useHome(controller, active, notifications);
  const restoration = useSecondChatRestoration(controller,model?.home ?? null,!busy && !blocked,active && !returnRead,onRestoreSecond);
  useLayoutEffect(() => { onNavigationBlockedChange(active && (!restoration.ready || busy || searchPhase !== 'idle')); return () => onNavigationBlockedChange(false); }, [active, busy, searchPhase, restoration.ready, onNavigationBlockedChange]);
  const reconciledReturn=useRef(false);
  useLayoutEffect(()=>{
    const reconcile=async()=>{const data=await reconcileHome();if(data)reconciledReturn.current=true;return data;};
    homeReconciler.current=reconcile;return()=>{if(homeReconciler.current===reconcile)homeReconciler.current=null;};
  },[homeReconciler,reconcileHome]);
  const surface = activityOpen ? 'activity' : 'overview';
  const wasActive = useRef(active);
  const returning = active && !wasActive.current;
  useLayoutEffect(() => { if (active && !wasActive.current) {if(!reconciledReturn.current)refreshOnReturn();reconciledReturn.current=false;} wasActive.current = active; }, [active, refreshOnReturn]);
  const root = useRef<HTMLDivElement>(null);
  const home = model ? visualHomeProjection(model.home,actedVisuals,knownClosed) : undefined, m = home?.matchmaking;
  useEffect(() => { if (model && !busy && !blocked) reconcileHiddenFirstChats(model.home, hidden, knownClosed); }, [model, busy, blocked, hidden, knownClosed]);
  useEffect(() => {
    const item = home?.pendingActions.find(i => i.type === 'FIRST_CHAT' && i.chatId && !suppressed.has(i.chatId));
    if (document.visibilityState === 'visible' && canAutoOpen() && active && restoration.ready && !returning && !returnRead && item && !busy && !blocked) onOpenChat(item, true);
  }, [active, canAutoOpen, restoration.ready, returning, returnRead, home, busy, blocked, onOpenChat, suppressed]);
  const waiting = !!m?.inQueue || searchPhase !== 'idle';
  const screen = waiting ? 'search' : surface;
  useEffect(() => { if (screen !== 'overview') retireNotice(); }, [screen, retireNotice]);
  const previouslyVisible = useRef(false);
  useLayoutEffect(() => {
    const restoring = active && !previouslyVisible.current;
    previouslyVisible.current = active;
    const heading = root.current?.querySelector('h2');
    if (active && heading) { document.documentElement.scrollTop = 0; document.body.scrollTop = 0; heading.tabIndex = -1; heading.focus({ preventScroll: true }); if (restoring && returnScroll.current) window.scrollTo(0, returnScroll.current); }
  }, [active, screen, returnScroll]);
  const affinity = affinities.catalog ? affinityPresentation(affinities.catalog, affinities.answers) : null;
  const now = useHomeTime(active);
  const presentation = home ? activityPresentation(home,now) : null;
  if (!restoration.ready && model) return <section aria-label="Verificando conversaciones" aria-busy={busy || (!restoration.error && !error)}>
    {restoration.error || error ? <><p role="alert">{restoration.error || error}</p><button onClick={restoration.error ? restoration.retry : refresh}>Reintentar</button>{!model && !busy && <SignOutButton onConfirm={controller.signOut}/>}</> : <p role="status">Verificando tus conversaciones…</p>}
  </section>;
  if (waiting) return <div ref={root}><SearchingScreen phase={searchPhase === 'idle' ? 'queued' : searchPhase} error={error} busy={busy} blocked={blocked} inQueue={!!m?.inQueue} onCancel={cancel} onRefresh={refresh} onBack={backFromSearch} canRetryLocation={canRetryLocation} onRetryLocation={retryLocation}/></div>;
  if (surface === 'activity' && home && presentation) return <div ref={root} className={`home ${busy && model ? 'home-reconciling' : ''}`} aria-busy={busy}>
    <header className="home-heading"><h2>Actividad</h2><button className="login-button login-outlined" onClick={onReturnHome}>Volver a Inicio</button></header>
    <p>Descubrimientos, próximos pasos y conversaciones en un solo lugar.</p>
    {error && <p className="home-error" role="alert">{error}</p>}
    {error && <button className="login-button login-outlined" disabled={busy} onClick={refresh}>Reintentar</button>}
    {presentation.groups.map(section => <section key={section.title} aria-label={section.title}><h3>{section.title}</h3><div className="home-grid">{section.items.map((item, index) => <ActivityCard key={`${item.matchId}-${item.connectionId}-${item.type}-${index}`} item={item} accountId={controller.getSnapshot().account?.id ?? null} disabled={busy || returnRead || blocked} presented={active && !busy && !returnRead && !blocked} onOpen={onOpenChat} onDismiss={dismissSecondChat}/>)}</div></section>)}
    {presentation.groups.length === 0 && <p>{presentation.hasActivity ? 'Hay actividad en curso. Los detalles aparecerán cuando el servidor los informe.' : 'No tenés pendientes por ahora.'}</p>}
    {presentation.notices.map((notice, index) => <aside className="home-notice" key={`${notice}-${index}`}>Hay novedades sobre tus interacciones. Revisá las opciones disponibles en Actividad.</aside>)}
  </div>;
  return <div ref={root} className={`home ${busy && model ? 'home-reconciling' : ''}`} aria-busy={busy}>
    <header className="home-heading"><div><h2>Inicio</h2><p>{model ? `Hola, ${model.name}` : 'Bienvenido a Reals'}</p></div><div className="home-header-actions">{onAdmin && <AdminEntry pending={adminPending} disabled={busy || returnRead || searchPhase !== 'idle'} onClick={onAdmin} />}</div></header>
    {notice && <p className="home-notice home-terminal-notice" role="status"><span>{notice}</span><button type="button" onClick={retireNotice} aria-label={notice === 'Preferencias guardadas' ? 'Ocultar aviso' : 'Ocultar aviso del chat'}><ChatIcon name="close"/></button></p>}
    {busy && !model && <p className="home-loading-status" role="status">Actualizando Inicio…</p>}
    {busy && !model && <div className="home-placeholder" aria-hidden="true"><div className="home-card home-placeholder-search"><span /><span /><span /></div><div className="home-grid">{managementEntries.map(([target]) => <div className="home-card home-placeholder-card" key={target}><span /><span /><span /></div>)}</div></div>}
    {error && <p className="home-error" role="alert">{error}</p>}{error && <button className="login-button login-outlined" disabled={busy} onClick={refresh}>Reintentar</button>}
    {!model && !busy && error && <SignOutButton onConfirm={controller.signOut} />}
    {home && <>
      {home.profileStatus !== 'ACTIVE' && <aside className="home-card"><h3>{home.profileStatus === 'DRAFT' ? 'Tu perfil está en borrador' : 'Tu perfil no está activo'}</h3><p>Tus interacciones se conservan. Para buscar nuevas personas, revisá y activá tu perfil.</p>{onCompleteProfile && <button className="login-button login-outlined" onClick={onCompleteProfile} disabled={busy}>Completar perfil</button>}</aside>}
      {presentation && <HomePriorities items={presentation.priorities} overflow={presentation.priorityOverflow} now={now} disabled={busy || returnRead || blocked} onOpen={onOpenChat} onActivity={onActivity}/>}
      <section className="home-card home-search" aria-labelledby="search-title"><h3 id="search-title">Buscar chat</h3>
        <p>Una conversación es el comienzo de algo real.</p>
          {!m?.canSearch && <p>{blockedLabels[m?.blockedReason?.code ?? ''] ?? 'La búsqueda no está disponible por ahora. Actualizá el estado o revisá tus interacciones.'}</p>}
          <p>Usamos tu ubicación actual para buscar personas cerca. Puede ser aproximada. El navegador te pedirá permiso al iniciar.</p>
          <button className={`login-button login-primary ${m?.canSearch && home.profileStatus === 'ACTIVE' ? 'home-search-ready' : ''}`} disabled={busy || returnRead || blocked || !m?.canSearch || home.profileStatus !== 'ACTIVE'} onClick={search}>Buscar chat</button>
      </section>
      {presentation?.hasActivity && <button className="home-card home-activity-entry" onClick={onActivity} aria-label="Ver Actividad" aria-describedby={unread ? unreadDescription : undefined}><span className="home-entry-title">Actividad{unread > 0 && <span className="activity-unread" id={unreadDescription}>{unread} {unread === 1 ? 'novedad' : 'novedades'}</span>}</span><span>{presentation?.required ? `${presentation.required} requieren tu acción` : 'Tus conversaciones y próximos pasos'}</span><span aria-hidden="true">Ver actividad →</span></button>}
      {home.profileStatus === 'ACTIVE' && <nav aria-label="Administrar tu perfil y cuenta" className="home-grid home-management">
        {managementEntries.map(([target, title, description]) => <button type="button" className={`home-card home-activity-entry ${target === 'affinities' ? 'affinity-home-card' : ''}`} key={target} aria-label={title} disabled={busy || blocked} onClick={() => onManage(target)}><span className="home-entry-title">{target === 'affinities' ? affinity?.complete ? 'Tus afinidades' : affinity?.answered ? 'Seguí construyendo tus afinidades' : 'Descubrí tus afinidades' : title}</span><span>{target === 'affinities' ? 'Tus respuestas son opcionales y privadas. Ayudan a Reals a encontrar afinidades compartidas y contexto para conversar sin mostrar tus respuestas exactas.' : description}</span>{target === 'affinities' && affinity && <span>{affinity.answered} de {affinity.total} respondidas</span>}{target === 'affinities' && affinities.busy && !affinities.catalog && <span>Cargando afinidades…</span>}<span aria-hidden="true">{target === 'affinities' ? affinity?.action ?? 'Empezar' : 'Abrir'} →</span></button>)}
      </nav>}
      {presentation?.notices.map((notice, i) => <aside className="home-notice" key={`${notice}-${i}`}>Hay novedades sobre tus interacciones. Revisá las opciones disponibles en Actividad.</aside>)}
    </>}
  </div>;
}
