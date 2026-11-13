import { photoIdentity } from './photoIdentity';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError, object } from '../auth/api';
import type { SessionController } from '../auth/session';
import { parseVisualProfile, type VisualProfile } from './contracts';
import './visual.css';

type State = { profile: VisualProfile | null; busy: boolean; error: string; terminal: boolean; imageRevision: number; context: string; matchId: string };
export function VisualReview({ controller, matchId, onBack }: { controller: SessionController; matchId: string; onBack: () => void }) {
  const session = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const context = `${session.account?.id}/${session.profile?.id}/${session.authContextVersion}/${session.phase}`;
  const [attempt, retry] = useState(0);
  const [state, setState] = useState<State>({ profile: null, busy: true, error: '', terminal: false, imageRevision: attempt, context, matchId });
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    let disposed = false, halted = false, serial = 0, read: AbortController | null = null, deadline: ReturnType<typeof setTimeout> | undefined;
    const empty = { profile: null, busy: false, error: '', terminal: false, imageRevision: attempt, context, matchId };
    const currentSession = () => {
      const s = controller.getSnapshot();
      return !disposed && `${s.account?.id}/${s.profile?.id}/${s.authContextVersion}/${s.phase}` === context && s.phase === 'ready';
    };
    const load = async () => {
      if (halted) return;
      read?.abort(); clearTimeout(deadline);
      const request = new AbortController(), ticket = ++serial; read = request;
      const current = () => currentSession() && ticket === serial && !request.signal.aborted;
      if (!current()) return;
      setState(previous => ({ ...empty, busy: true, imageRevision: previous.imageRevision, profile: previous.context === context && previous.matchId === matchId ? previous.profile : null }));
      try {
        const path = `/matches/${encodeURIComponent(matchId)}`;
        const match = await controller.request(path, request.signal);
        if (!current()) return;
        if (!object(match) || match.id !== matchId || (match.userAId !== session.account?.id && match.userBId !== session.account?.id)) throw new ApiError('invalid');
        if (match.state !== 'VISUAL_PHASE') { halted = true; setState({ ...empty, terminal: true, error: 'El descubrimiento cambió de estado. Volvé a Actividad para actualizarlo.' }); return; }
        const profile = parseVisualProfile(await controller.request(`${path}/visual-profile`, request.signal));
        if (!current()) return;
        setState({ ...empty, profile });
        // Device time only schedules a new authoritative read; it never closes a match.
        const remaining = profile.visualExpiresAt ? Date.parse(profile.visualExpiresAt) - Date.now() : 0;
        if (remaining > 0) deadline = setTimeout(() => void load(), Math.min(remaining, 2147483647));
      } catch (error) {
        if (!current()) return;
        const denied = error instanceof ApiError && ([401,403,404].includes(error.status) || ['VISUAL_CONTENT_NOT_AVAILABLE','VISUAL_REVIEW_EXPIRED'].includes(error.code));
        halted = denied;
        setState({ ...empty, terminal: denied, error: denied ? 'El contenido visual ya no está disponible o no tenés acceso. Volvé a Actividad.' : 'No pudimos cargar el perfil. Revisá tu conexión y volvé a intentar.' });
      }
    };
    const resume = () => { if (halted) return; if (document.visibilityState === 'visible') void load(); else { read?.abort(); serial++; clearTimeout(deadline); setState({ ...empty, busy: true }); } };
    void load();
    const poll = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 30000);
    document.addEventListener('visibilitychange', resume); window.addEventListener('online', resume);
    return () => { disposed = true; serial++; read?.abort(); clearTimeout(deadline); clearInterval(poll); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); };
  }, [controller, context, matchId, attempt, session.account?.id]);
  const visible = state.context === context && state.matchId === matchId && session.phase === 'ready';
  const profile = visible ? state.profile : null;
  const photo = (index: number) => { const p = profile?.photos[index]; return p && <ProfileImage key={JSON.stringify([context, matchId, profile.profileId, photoIdentity(p.id, p.url), state.imageRevision])} url={p.url} label={`Foto ${index+1} de ${profile.photos.length} de ${profile.displayName}`} eager={index === 0} />; };
  return <section className="visual-review" aria-busy={!visible || state.busy}>
    <header className="home-heading"><h2 ref={heading} tabIndex={-1}>Perfil por descubrir</h2><button className="login-button login-outlined" onClick={onBack}>Volver a Actividad</button></header>
    {(!visible || state.busy) && <p role="status">{state.profile ? 'Actualizando perfil…' : 'Cargando perfil…'}</p>}
    {visible && state.error && <p role="alert" className="home-error">{state.error}</p>}
    {visible && !state.busy && !state.terminal && <button className="login-button login-outlined" onClick={() => retry(n => n+1)}>{state.error ? 'Reintentar' : 'Actualizar perfil'}</button>}
    {profile && <>
      <p className="home-notice">{profile.visualExpiresAt ? <>Disponible hasta: <time dateTime={profile.visualExpiresAt}>{new Date(profile.visualExpiresAt).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' })}</time>. El servidor confirma su disponibilidad.</> : 'El servidor no informó una fecha de vencimiento.'}</p>
      <article className="home-card visual-profile">
        <header><h3>{profile.displayName}</h3><p>{profile.age} años</p></header>
        {!profile.photos.length && <p role="status">No hay fotos aprobadas disponibles.</p>}
        {photo(0)}
        {profile.bio && <section className="visual-insert"><h4>Bio</h4><p>{profile.bio}</p></section>}
        {photo(1)}
        {!!profile.affinityIndicators.length && <section className="visual-insert"><h4>Afinidades compartidas</h4><p>Temas en los que encontraron afinidad.</p><ul className="visual-affinities">{profile.affinityIndicators.map(a => <li key={a.categoryId}>{a.title}</li>)}</ul></section>}
        {photo(2)}
        {!!profile.profileQuestions.length && <section className="visual-insert"><h4>Preguntas del perfil</h4>{profile.profileQuestions.map((q,i) => <div key={`${q.questionId}/${i}`}><h5>{q.prompt}</h5><p>{q.answer}</p></div>)}</section>}
        {profile.photos.slice(3).map((_,i) => photo(i+3))}
      </article>
    </>}
  </section>;
}
function ProfileImage({ url, label, eager }: { url: string; label: string; eager: boolean }) {
  const [image, setImage] = useState<{ url: string; status: 'loading' | 'loaded' | 'failed' }>(() => ({ url, status: 'loading' }));
  // Pin the exact request string while loading/loaded. Only a failed request
  // adopts a renewed signature automatically; explicit refresh remounts after
  // the new authoritative response, never with the previous expired URL.
  if (image.status === 'failed' && image.url !== url) setImage({ url, status: 'loading' });
  const status = image.status;
  return <figure className="visual-photo">
    {status !== 'failed' && <img src={image.url} alt={label} loading={eager ? 'eager' : 'lazy'} referrerPolicy="no-referrer" onLoad={() => setImage(current => ({ ...current, status: 'loaded' }))} onError={() => setImage(current => ({ ...current, status: 'failed' }))} />}
    {status !== 'loaded' && <span role="status">{status === 'failed' ? 'No se pudo cargar esta foto. Actualizá el perfil para reintentar.' : 'Cargando foto…'}</span>}
    <figcaption>{label}</figcaption>
  </figure>;
}
