import { VisualDeadline } from '../visual/deadline';
import { VisualReview } from '../visual/VisualReview';
import { useAffinityQuestionnaire, type AffinityModel } from '../profile/affinities/useAffinityQuestionnaire';
import { AffinityQuestionnaire } from '../profile/affinities/AffinityQuestionnaire';
import { presentation as affinityPresentation } from '../profile/affinities/presentation';
import { SignOutButton } from '../auth/SignOutButton';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SessionController } from '../auth/session';
import type { Activity } from './contracts';
import { Onboarding } from '../onboarding/Onboarding';
import { useHome } from './useHome';
import { activityPresentation } from './presentation';
import { SearchingScreen } from './SearchingScreen';
import { FirstChat } from '../chat/FirstChat';
import { ChatIcon } from '../chat/ChatIcon';
import { reconcileHiddenFirstChats, visibleHome } from './hiddenFirstChats';
import './home.css';
import { AccountSection } from './AccountSection';
import { useHomeNavigation } from './useHomeNavigation';
import type { HomeNavigation } from './useHomeNavigation';
import { isProfileQuestions } from '../profile/questions/ProfileQuestions';

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
function ActivityCard({ item, onOpen, disabled = false }: { disabled?: boolean; item: Activity; onOpen: (item: Activity) => void }) {
  if (item.type === 'VISUAL_REVIEW') return <button className="home-card home-activity-entry visual-activity" disabled={disabled} onClick={() => onOpen(item)}><span className="home-entry-title">{item.partnerName ? `Descubrí el perfil de ${item.partnerName}` : 'Descubrí el perfil'}</span><VisualDeadline start={item.visualStartedAt} end={item.visualExpiresAt}/><span className="visual-chevron" aria-hidden="true">›</span></button>;
  const when = item.type === 'SCHEDULING' ? item.schedulingExpiresAt : item.secondChat?.availableAt;
  const body: Record<string, string> = {
    FIRST_CHAT: 'Tenés una conversación inicial para continuar.', VISUAL_REVIEW: 'Tenés un perfil por descubrir.',
    SCHEDULING: item.requiresAction ? 'Requiere tu atención para coordinar horarios.' : 'Esperando respuesta.',
    SECOND_CHAT_SCHEDULED: 'El servidor confirmó un próximo encuentro.', SECOND_CHAT_AVAILABLE: 'Tu segundo chat está disponible.',
    SECOND_CHAT_EXPIRED: 'La ventana para entrar terminó.', SECOND_CHAT_READ_ONLY: 'Esta conversación está en modo lectura.',
  };
  return <article className="home-card"><h4>{labels[item.type] ?? 'Actividad pendiente'}</h4>
    {item.partnerName && <p>Con {item.partnerName}</p>}
    {item.type === 'FIRST_CHAT' && item.chatId && <button className="login-button login-primary" onClick={() => onOpen(item)}>Abrir primer chat</button>}
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
  const [chat, setChat] = useState<Activity | null>(null), [notice, setNotice] = useState('');
  const retireNotice = useCallback(() => setNotice(''), []);
  useLayoutEffect(() => { onChatActiveChange?.(!!chat); return () => onChatActiveChange?.(false); }, [chat, onChatActiveChange]);
  const suppressed = useRef(new Set<string>());
  const actedVisuals = useRef(new Set<string>());
  const hidden = useRef(new Set<string>());
  // A terminal match cannot become active again. Keep this session-only guard
  // even after a clean Home retires its currently-stale suppression entry.
  const knownClosed = useRef(new Set<string>());
  const openChat = (item: Activity, automatic = false) => {
    if (!item.chatId || knownClosed.current.has(item.matchId) || (automatic && suppressed.current.has(item.chatId))) return;
    setNotice(''); setChat(item);
  };
  const closeChat = (message = '', closed = false) => {
    if (chat?.chatId) suppressed.current.add(chat.chatId);
    if (closed && chat) { hidden.current.add(chat.matchId); knownClosed.current.add(chat.matchId); }
    setChat(null); setNotice(message);
  };
  const visualLocked = useRef(false);
  const locked = useRef(false), accountLocked = useRef(false), overviewLocked = useRef(false), root = useRef<HTMLDivElement>(null);
  const currentChat = useRef(chat); currentChat.current = chat;
  const reportNavigationLock = useCallback(() => onNavigationBlockedChange?.(visualLocked.current || locked.current || accountLocked.current || overviewLocked.current || !!currentChat.current), [onNavigationBlockedChange]);
  const reportVisualLock = useCallback((value: boolean) => { visualLocked.current = value; reportNavigationLock(); }, [reportNavigationLock]);
  const reportOverviewLock = useCallback((value: boolean) => { overviewLocked.current = value; reportNavigationLock(); }, [reportNavigationLock]);
  useLayoutEffect(() => { reportNavigationLock(); return () => onNavigationBlockedChange?.(false); }, [chat, onNavigationBlockedChange]);
  const localNavigation = useHomeNavigation(() => !visualLocked.current && !locked.current && !accountLocked.current && !overviewLocked.current && !chat, !providedNavigation);
  const navigation = providedNavigation ?? localNavigation;
  // Draft setup owns its shared history and renders questions outside this nested Home.
  const surface = navigation.destination === 'home' || navigation.destination === 'activity' || (delegateProfileQuestions && isProfileQuestions(navigation.destination)) ? null : navigation.destination;
  useLayoutEffect(() => { if (surface === 'visual-review' && navigation.matchId && actedVisuals.current.has(navigation.matchId)) navigation.backTo(navigation.trailIncludesActivity ? 'activity' : 'home', true); }, [surface, navigation.matchId]);
  const profileActive = surface === 'profile' || isProfileQuestions(surface ?? '');
  const managementActive = profileActive || surface === 'preferences';
  const retainedManagement = useRef<'details' | 'filters' | null>(null);
  if (managementActive) retainedManagement.current = profileActive ? 'details' : 'filters';
  useLayoutEffect(() => { onManagementActiveChange?.(!!surface); return () => onManagementActiveChange?.(false); }, [surface, onManagementActiveChange]);
  const homePosition = useRef(0);
  const open = (next: ManagementSurface) => { homePosition.current = window.scrollY; retireNotice(); navigation.open(next); if (next === 'affinities') void affinities.refresh(); };
  const returnHome = () => navigation.backTo('home');
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
  return <><div hidden={!!surface || !!chat}><HomeOverview returnScroll={homePosition} adminPending={adminPending} onAdmin={onAdmin} onNavigationBlockedChange={reportOverviewLock} affinities={affinities} notice={notice} retireNotice={retireNotice} controller={controller} onCompleteProfile={onCompleteProfile} onManage={open} onOpenChat={(item, automatic) => { if (item.type === 'VISUAL_REVIEW') { if (!automatic) { homePosition.current = window.scrollY; navigation.openVisualReview(item.matchId); } } else openChat(item, automatic); }} suppressed={suppressed.current} hidden={hidden.current} knownClosed={knownClosed.current} actedVisuals={actedVisuals.current} active={active && !surface && !chat} activityOpen={navigation.destination === 'activity'} onActivity={() => { homePosition.current = window.scrollY; navigation.open('activity'); }} onReturnHome={returnHome}/> </div>{chat?.chatId && <FirstChat key={chat.chatId} controller={controller} matchId={chat.matchId} chatId={chat.chatId} onHome={closeChat}/>}<div hidden={!surface} className="home home-management-page" ref={root}>
    {surface === 'visual-review' && navigation.matchId && !actedVisuals.current.has(navigation.matchId) && active && <VisualReview key={navigation.matchId} controller={controller} matchId={navigation.matchId} onBlocked={reportVisualLock} onFinished={() => { visualLocked.current = false; reportNavigationLock(); actedVisuals.current.add(navigation.matchId!); navigation.backTo(navigation.trailIncludesActivity ? 'activity' : 'home'); }} onBack={() => navigation.backTo(navigation.trailIncludesActivity ? 'activity' : 'home')} />}
    <div hidden={surface !== 'account' && surface !== 'notifications'}><AccountSection controller={controller} disabled={false} onBack={() => navigation.backTo(surface === 'notifications' ? 'account' : 'home')} notificationsOpen={surface === 'notifications'} onNotificationsOpen={() => navigation.open('notifications')} onNavigationBlockedChange={value => { accountLocked.current = value; reportNavigationLock(); }} /></div>
    {retainedManagement.current && <div hidden={!managementActive}><Onboarding Home={Home} active={active && managementActive} onAdminNavigationBlockedChange={onAdminNavigationBlockedChange} controller={controller} management={retainedManagement.current} navigation={navigation} onBack={returnHome} onNavigationBlockedChange={value => { locked.current = value; reportNavigationLock(); }} /></div>}

    <AffinityQuestionnaire model={affinities} navigation={navigation}/>
  </div></>;
}

function HomeOverview({ returnScroll, actedVisuals, affinities, notice, retireNotice, controller, onCompleteProfile, onManage, onOpenChat, suppressed, hidden, knownClosed, active, activityOpen, onActivity, onReturnHome, onNavigationBlockedChange, onAdmin, adminPending }: { actedVisuals: Set<string>; returnScroll: { current: number }; adminPending: boolean; onAdmin?: (() => void) | undefined; onNavigationBlockedChange: (blocked: boolean) => void; affinities: AffinityModel; activityOpen: boolean; onActivity: () => void; onReturnHome: () => void; active: boolean; notice: string; retireNotice: () => void; controller: SessionController; onCompleteProfile?: (() => void) | undefined; onManage: (surface: ManagementSurface) => void; onOpenChat: (item: Activity, automatic?: boolean) => void; suppressed: Set<string>; hidden: Set<string>; knownClosed: Set<string> }) {
  const { model, busy, blocked, error, refresh, search, cancel, searchPhase, backFromSearch, canRetryLocation, retryLocation } = useHome(controller, active);
  useLayoutEffect(() => { onNavigationBlockedChange(active && (busy || searchPhase !== 'idle')); return () => onNavigationBlockedChange(false); }, [active, busy, searchPhase, onNavigationBlockedChange]);
  const surface = activityOpen ? 'activity' : 'overview';
  const wasActive = useRef(active);
  const returning = active && !wasActive.current;
  useLayoutEffect(() => { if (active && !wasActive.current) refresh(); wasActive.current = active; }, [active, refresh]);
  const root = useRef<HTMLDivElement>(null);
  const home = model ? visibleHome({ ...model.home, pendingActions: model.home.pendingActions.filter(a => a.type !== 'VISUAL_REVIEW' || !actedVisuals.has(a.matchId)) }, knownClosed) : undefined, m = home?.matchmaking;
  useEffect(() => { if (model && !busy && !blocked) reconcileHiddenFirstChats(model.home, hidden, knownClosed); }, [model, busy, blocked, hidden, knownClosed]);
  useEffect(() => {
    const item = home?.pendingActions.find(i => i.type === 'FIRST_CHAT' && i.chatId && !suppressed.has(i.chatId));
    if (active && !returning && item && !busy && !blocked) onOpenChat(item, true);
  }, [active, returning, home, busy, blocked, onOpenChat, suppressed]);
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
  const presentation = home ? activityPresentation(home) : null;
  if (waiting) return <div ref={root}><SearchingScreen phase={searchPhase === 'idle' ? 'queued' : searchPhase} error={error} busy={busy} blocked={blocked} inQueue={!!m?.inQueue} onCancel={cancel} onRefresh={refresh} onBack={backFromSearch} canRetryLocation={canRetryLocation} onRetryLocation={retryLocation}/></div>;
  if (surface === 'activity' && home && presentation) return <div ref={root} className={`home ${busy && model ? 'home-reconciling' : ''}`} aria-busy={busy}>
    <header className="home-heading"><h2>Actividad</h2><button className="login-button login-outlined" onClick={onReturnHome}>Volver a Inicio</button></header>
    <p>Descubrimientos, próximos pasos y conversaciones en un solo lugar.</p>
    {error && <p className="home-error" role="alert">{error}</p>}
    {error && <button className="login-button login-outlined" disabled={busy} onClick={refresh}>Reintentar</button>}
    {presentation.groups.map(section => <section key={section.title} aria-label={section.title}><h3>{section.title}</h3><div className="home-grid">{section.items.map((item, index) => <ActivityCard key={`${item.matchId}-${item.connectionId}-${item.type}-${index}`} item={item} disabled={busy || blocked} onOpen={onOpenChat}/>)}</div></section>)}
    {presentation.groups.length === 0 && <p>{home.summary.hasPendingSchedulingConnection ? 'Estamos preparando una coordinación de horarios.' : presentation.hasActivity ? 'Hay actividad en curso. Los detalles aparecerán cuando el servidor los informe.' : 'No tenés pendientes por ahora.'}</p>}
    {home.passiveNotices.map((notice, index) => <aside className="home-notice" key={`${notice}-${index}`}>{notice === 'SCHEDULING_PREPARING' ? 'Estamos preparando tus próximos pasos para coordinar horarios.' : 'Hay novedades sobre tus interacciones. Consultalas desde Android.'}</aside>)}
  </div>;
  return <div ref={root} className={`home ${busy && model ? 'home-reconciling' : ''}`} aria-busy={busy}>
    <header className="home-heading"><div><h2>Inicio</h2><p>{model ? `Hola, ${model.name}` : 'Bienvenido a Reals'}</p></div><div className="home-header-actions">{onAdmin && <AdminEntry pending={adminPending} disabled={busy || searchPhase !== 'idle'} onClick={onAdmin} />}</div></header>
    {notice && <p className="home-notice home-terminal-notice" role="status"><span>{notice}</span><button type="button" onClick={retireNotice} aria-label="Ocultar aviso del chat"><ChatIcon name="close"/></button></p>}
    {busy && !model && <p className="home-loading-status" role="status">Actualizando Inicio…</p>}
    {busy && !model && <div className="home-placeholder" aria-hidden="true"><div className="home-card home-placeholder-search"><span /><span /><span /></div><div className="home-grid">{managementEntries.map(([target]) => <div className="home-card home-placeholder-card" key={target}><span /><span /><span /></div>)}</div></div>}
    {error && <p className="home-error" role="alert">{error}</p>}{error && <button className="login-button login-outlined" disabled={busy} onClick={refresh}>Reintentar</button>}
    {!model && !busy && error && <SignOutButton onConfirm={controller.signOut} />}
    {home && <>
      {home.profileStatus !== 'ACTIVE' && <aside className="home-card"><h3>{home.profileStatus === 'DRAFT' ? 'Tu perfil está en borrador' : 'Tu perfil no está activo'}</h3><p>Tus interacciones se conservan. Para buscar nuevas personas, revisá y activá tu perfil.</p>{onCompleteProfile && <button className="login-button login-outlined" onClick={onCompleteProfile} disabled={busy}>Completar perfil</button>}</aside>}
      {!!presentation?.priorities.length && <section className="home-priority" aria-label="Prioridad ahora"><h3>Prioridad ahora</h3>{presentation.priorities.map((item, index) => <p key={`${item.matchId}-${item.type}-${index}`}>{labels[item.type] ?? 'Actividad pendiente'}{item.partnerName ? ` con ${item.partnerName}` : ''} · Revisá tu Actividad.</p>)}</section>}
      <section className="home-card home-search" aria-labelledby="search-title"><h3 id="search-title">Buscar chat</h3>
        <p>Una conversación es el comienzo de algo real.</p>
          {!m?.canSearch && <p>{blockedLabels[m?.blockedReason?.code ?? ''] ?? 'La búsqueda no está disponible por ahora. Actualizá el estado o revisá tus interacciones.'}</p>}
          <p>Usamos tu ubicación actual para buscar personas cerca. Puede ser aproximada. El navegador te pedirá permiso al iniciar.</p>
          <button className={`login-button login-primary ${m?.canSearch && home.profileStatus === 'ACTIVE' ? 'home-search-ready' : ''}`} disabled={busy || blocked || !m?.canSearch || home.profileStatus !== 'ACTIVE'} onClick={search}>Buscar chat</button>
      </section>
      {presentation?.hasActivity && <button className="home-card home-activity-entry" onClick={onActivity} aria-label="Ver Actividad"><span className="home-entry-title">Actividad</span><span>{presentation.required ? `${presentation.required} requieren tu acción` : 'Tus conversaciones y próximos pasos'}</span><span aria-hidden="true">Ver actividad →</span></button>}
      {home.profileStatus === 'ACTIVE' && <nav aria-label="Administrar tu perfil y cuenta" className="home-grid home-management">
        {managementEntries.map(([target, title, description]) => <button type="button" className={`home-card home-activity-entry ${target === 'affinities' ? 'affinity-home-card' : ''}`} key={target} aria-label={title} disabled={busy || blocked} onClick={() => onManage(target)}><span className="home-entry-title">{target === 'affinities' ? affinity?.complete ? 'Tus afinidades' : affinity?.answered ? 'Seguí construyendo tus afinidades' : 'Descubrí tus afinidades' : title}</span><span>{target === 'affinities' ? 'Tus respuestas son opcionales y privadas. Ayudan a Reals a encontrar afinidades compartidas y contexto para conversar sin mostrar tus respuestas exactas.' : description}</span>{target === 'affinities' && affinity && <span>{affinity.answered} de {affinity.total} respondidas</span>}{target === 'affinities' && affinities.busy && !affinities.catalog && <span>Cargando afinidades…</span>}<span aria-hidden="true">{target === 'affinities' ? affinity?.action ?? 'Empezar' : 'Abrir'} →</span></button>)}
      </nav>}
      {home.passiveNotices.map((notice, i) => <aside className="home-notice" key={`${notice}-${i}`}>{notice === 'SCHEDULING_PREPARING' ? 'Estamos preparando tus próximos pasos para coordinar horarios.' : 'Hay novedades sobre tus interacciones. Consultalas desde Android.'}</aside>)}
    </>}
  </div>;
}
