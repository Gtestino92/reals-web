import { useEffect, useRef, useState } from 'react';
import type { SessionController } from '../auth/session';
import type { Activity } from './contracts';
import { Onboarding } from '../onboarding/Onboarding';
import { useHome } from './useHome';
import { activityPresentation } from './presentation';
import { SearchingScreen } from './SearchingScreen';
import { FirstChat } from '../chat/FirstChat';
import './home.css';

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
function ActivityCard({ item, onOpen }: { item: Activity; onOpen: (item: Activity) => void }) {
  const when = item.type === 'SCHEDULING' ? item.schedulingExpiresAt : item.type === 'VISUAL_REVIEW' ? item.visualExpiresAt : item.secondChat?.availableAt;
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
    {typeof when === 'string' && <p>{item.type === 'SCHEDULING' || item.type === 'VISUAL_REVIEW' ? 'Hasta: ' : 'Fecha: '}<time dateTime={when}>{new Date(when).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })}</time></p>}
  </article>;
}
type ManagementSurface = 'profile' | 'preferences' | 'affinities' | 'account';
const managementEntries = [
  ['profile', 'Tu perfil', 'Datos personales, bio y fotos'],
  ['preferences', 'Preferencias', 'Tus filtros para encontrar personas'],
  ['affinities', 'Afinidades', 'Preguntas de compatibilidad'],
  ['account', 'Cuenta', 'Notificaciones, seguridad y sesión'],
] as const;

export function Home({ controller, onCompleteProfile }: { controller: SessionController; onCompleteProfile?: () => void }) {
  const [chat, setChat] = useState<Activity | null>(null), [notice, setNotice] = useState('');
  const suppressed = useRef(new Set<string>());
  const openChat = (item: Activity, automatic = false) => {
    if (!item.chatId || (automatic && suppressed.current.has(item.chatId))) return;
    window.history.pushState(null, ''); setNotice(''); setChat(item);
  };
  const closeChat = (message = '') => { if (chat?.chatId) suppressed.current.add(chat.chatId); setChat(null); setNotice(message); };
  const [surface, setSurface] = useState<ManagementSurface | null>(null);
  const locked = useRef(false), root = useRef<HTMLDivElement>(null);
  const open = (next: ManagementSurface) => {
    locked.current = next === 'profile' || next === 'preferences';
    window.history.pushState(null, '');
    setSurface(next);
  };
  const returnHome = () => { locked.current = false; setSurface(null); };
  useEffect(() => {
    if (!surface) return;
    const pop = () => {
      if (locked.current) window.history.pushState(null, '');
      else setSurface(null);
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, [surface]);
  useEffect(() => {
    const heading = root.current?.querySelector('h2');
    if (heading) { heading.tabIndex = -1; heading.focus(); }
  }, [surface]);
  if (chat?.chatId) return <FirstChat key={chat.chatId} controller={controller} matchId={chat.matchId} chatId={chat.chatId} onHome={closeChat}/>;
  if (!surface) return <>{notice && <p role="status">{notice}</p>}<HomeOverview controller={controller} onCompleteProfile={onCompleteProfile} onManage={open} onOpenChat={openChat} suppressed={suppressed.current}/></>;
  return <div className="home" ref={root}>
    <header className="home-heading"><h2>{managementEntries.find(entry => entry[0] === surface)?.[1]}</h2></header>
    {surface === 'profile' || surface === 'preferences' ? <Onboarding controller={controller} management={surface === 'profile' ? 'details' : 'filters'} onBack={returnHome} onNavigationBlockedChange={value => { locked.current = value; }} /> : <>
      <button className="login-button login-outlined" onClick={() => window.history.back()}>Volver a Inicio</button>
      {surface === 'affinities' ? <section className="home-card"><h3>Próximamente</h3><p>Las preguntas de compatibilidad y su progreso todavía no están disponibles en la Web.</p></section> : <>
        <section className="home-card"><h3>Notificaciones</h3><p>Próximamente: preferencias de notificaciones en la Web.</p></section>
        {controller.hasPasswordProvider !== false && <section className="home-card"><h3>Cambiar contraseña</h3><p>Próximamente en la Web para cuentas con contraseña.</p></section>}
        {controller.hasPasswordProvider === false && <p>La seguridad de tu acceso se administra desde tu proveedor de inicio de sesión.</p>}
        <section className="home-card"><h3>Eliminar cuenta</h3><p>Próximamente en la Web. Esta acción todavía no está disponible.</p></section>
      </>}
    </>}
  </div>;
}

function HomeOverview({ controller, onCompleteProfile, onManage, onOpenChat, suppressed }: { controller: SessionController; onCompleteProfile?: (() => void) | undefined; onManage: (surface: ManagementSurface) => void; onOpenChat: (item: Activity, automatic?: boolean) => void; suppressed: Set<string> }) {
  const { model, busy, blocked, error, refresh, search, cancel, searchPhase, backFromSearch, canRetryLocation, retryLocation } = useHome(controller);
  const [surface, setSurface] = useState<'overview' | 'activity'>('overview');
  const root = useRef<HTMLDivElement>(null);
  const home = model?.home, m = home?.matchmaking;
  useEffect(() => {
    const item = home?.pendingActions.find(i => i.type === 'FIRST_CHAT' && i.chatId && !suppressed.has(i.chatId));
    if (item && !busy && !blocked) onOpenChat(item, true);
  }, [home, busy, blocked, onOpenChat, suppressed]);
  const waiting = !!m?.inQueue || searchPhase !== 'idle';
  const screen = waiting ? 'search' : surface;
  useEffect(() => {
    if (surface !== 'activity') return;
    const pop = () => setSurface('overview');
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, [surface]);
  useEffect(() => {
    if (waiting) setSurface('overview');
    const heading = root.current?.querySelector('h2');
    if (heading) { heading.tabIndex = -1; heading.focus(); }
  }, [screen, waiting]);
  const presentation = home ? activityPresentation(home) : null;
  if (waiting) return <div ref={root}><SearchingScreen phase={searchPhase === 'idle' ? 'queued' : searchPhase} error={error} busy={busy} blocked={blocked} inQueue={!!m?.inQueue} onCancel={cancel} onRefresh={refresh} onBack={backFromSearch} canRetryLocation={canRetryLocation} onRetryLocation={retryLocation}/></div>;
  if (surface === 'activity' && home && presentation) return <div ref={root} className="home" aria-busy={busy}>
    <header className="home-heading"><h2>Actividad</h2><button className="login-button login-outlined" onClick={() => window.history.back()}>Volver a Inicio</button></header>
    <p>Descubrimientos, próximos pasos y conversaciones en un solo lugar.</p>
    {error && <p className="home-error" role="alert">{error}</p>}
    <button className="login-button login-outlined" disabled={busy} onClick={refresh}>Actualizar</button>
    {presentation.groups.map(section => <section key={section.title} aria-label={section.title}><h3>{section.title}</h3><div className="home-grid">{section.items.map((item, index) => <ActivityCard key={`${item.matchId}-${item.connectionId}-${item.type}-${index}`} item={item} onOpen={onOpenChat}/>)}</div></section>)}
    {presentation.groups.length === 0 && <p>{home.summary.hasPendingSchedulingConnection ? 'Estamos preparando una coordinación de horarios.' : presentation.hasActivity ? 'Hay actividad en curso. Los detalles aparecerán cuando el servidor los informe.' : 'No tenés pendientes por ahora.'}</p>}
    {home.passiveNotices.map((notice, index) => <aside className="home-notice" key={`${notice}-${index}`}>{notice === 'SCHEDULING_PREPARING' ? 'Estamos preparando tus próximos pasos para coordinar horarios.' : 'Hay novedades sobre tus interacciones. Consultalas desde Android.'}</aside>)}
    <p className="home-notice">Podés continuar tu primer chat desde acá. Descubrir perfiles y coordinar horarios sigue disponible desde Android.</p>
  </div>;
  return <div ref={root} className="home" aria-busy={busy}>
    <header className="home-heading"><div><h2>Inicio</h2><p>{model ? `Hola, ${model.name}` : 'Bienvenido a Reals'}</p></div><button className="login-button login-outlined" disabled={busy} onClick={refresh}>Actualizar</button></header>
    {busy && <p role="status">Actualizando Inicio…</p>}
    {error && <p className="home-error" role="alert">{error}</p>}
    {home && <>
      {home.profileStatus !== 'ACTIVE' && <aside className="home-card"><h3>{home.profileStatus === 'DRAFT' ? 'Tu perfil está en borrador' : 'Tu perfil no está activo'}</h3><p>Tus interacciones se conservan. Para buscar nuevas personas, revisá y activá tu perfil.</p>{onCompleteProfile && <button className="login-button login-outlined" onClick={onCompleteProfile} disabled={busy}>Completar perfil</button>}</aside>}
      {!!presentation?.priorities.length && <section className="home-priority" aria-label="Prioridad ahora"><h3>Prioridad ahora</h3>{presentation.priorities.map((item, index) => <p key={`${item.matchId}-${item.type}-${index}`}>{labels[item.type] ?? 'Actividad pendiente'}{item.partnerName ? ` con ${item.partnerName}` : ''} · Revisá tu Actividad.</p>)}</section>}
      <section className="home-card home-search" aria-labelledby="search-title"><h3 id="search-title">Buscar chat</h3>
        <p>Una conversación es el comienzo de algo real.</p>
          {!m?.canSearch && <p>{blockedLabels[m?.blockedReason?.code ?? ''] ?? 'La búsqueda no está disponible por ahora. Actualizá el estado o revisá tus interacciones.'}</p>}
          <p>Usamos tu ubicación actual para buscar personas cerca. Puede ser aproximada. El navegador te pedirá permiso al iniciar.</p>
          <button className="login-button login-primary" disabled={busy || blocked || !m?.canSearch || home.profileStatus !== 'ACTIVE'} onClick={search}>Buscar chat</button>
      </section>
      {presentation?.hasActivity && <button className="home-card home-activity-entry" onClick={() => { window.history.pushState(null, ''); setSurface('activity'); }} aria-label="Ver Actividad"><span className="home-entry-title">Actividad</span><span>{presentation.required ? `${presentation.required} requieren tu acción` : 'Tus conversaciones y próximos pasos'}</span><span aria-hidden="true">Ver actividad →</span></button>}
      {home.profileStatus === 'ACTIVE' && <nav aria-label="Administrar tu perfil y cuenta" className="home-grid home-management">
        {managementEntries.map(([target, title, description]) => <button type="button" className="home-card home-activity-entry" key={target} aria-label={title} disabled={busy || blocked} onClick={() => onManage(target)}><span className="home-entry-title">{title}</span><span>{description}</span><span aria-hidden="true">Abrir →</span></button>)}
      </nav>}
      {home.passiveNotices.map((notice, i) => <aside className="home-notice" key={`${notice}-${i}`}>{notice === 'SCHEDULING_PREPARING' ? 'Estamos preparando tus próximos pasos para coordinar horarios.' : 'Hay novedades sobre tus interacciones. Consultalas desde Android.'}</aside>)}
    </>}
  </div>;
}
