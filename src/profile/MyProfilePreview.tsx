import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SessionController } from '../auth/session';
import { ApiError } from '../auth/api';
import { fullProfile, photos, type FullProfile, type Photo } from '../onboarding/contracts';
import { parseQuestionAnswers, parseQuestionCatalog, type QuestionCatalog, type SavedAnswer } from './questions/contracts';
import { questionRows } from './questions/presentation';
import { PublicProfileView, type PublicProfile } from './PublicProfileView';
import { ProfilePlaceholder } from '../visual/ProfilePlaceholder';

export function previewProfile(profile: FullProfile, images: Photo[], catalog: QuestionCatalog, answers: SavedAnswer[], now = new Date()): PublicProfile {
  const birth = new Date(`${profile.birthDate}T00:00:00Z`);
  const age = now.getFullYear() - birth.getUTCFullYear() - (now.getMonth() < birth.getUTCMonth() || (now.getMonth() === birth.getUTCMonth() && now.getDate() < birth.getUTCDate()) ? 1 : 0);
  if (!Number.isInteger(age) || age < 18) throw new ApiError('invalid');
  return {
    displayName: profile.displayName, age, bio: profile.bio,
    photos: images.filter(p => p.moderationStatus === 'APPROVED').sort((a,b) => a.position - b.position).map(({ id, url, position }) => ({ id, url, position })),
    profileQuestions: questionRows(catalog, answers).flatMap(row => row.selectable && row.selectedPosition !== null && row.answer ? [{ questionId: row.question.id, prompt: row.question.prompt, answer: row.answer.answer, position: row.selectedPosition }] : []).sort((a,b) => a.position - b.position).slice(0,3),
    affinityIndicators: [],
  };
}
interface Snapshot { identity: string; profile: PublicProfile; status: string }
export function MyProfilePreview({ controller, onBack }: { controller: SessionController; onBack: () => void }) {
  const session = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const identity = session.phase === 'ready' && session.account && session.profile && ['ACTIVE','DRAFT'].includes(session.profile.status) ? `${session.account.id}/${session.profile.id}` : '';
  const [snapshot,setSnapshot] = useState<Snapshot | null>(null), [error,setError] = useState(''), [epoch,setEpoch] = useState(0), [selected,setSelected] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); window.scrollTo(0,0); }, []);
  useEffect(() => { setSelected(''); }, [identity]);
  useEffect(() => {
    let request: AbortController | null = null;
    let disposed = false;
    setSnapshot(previous => previous?.identity === identity ? previous : null); setError('');
    if (!identity) return;
    const load = async () => {
      request?.abort();
      const abort = new AbortController(); request = abort;
      const current = () => !disposed && request === abort && !abort.signal.aborted && controller.snapshot.phase === 'ready' && `${controller.snapshot.account?.id}/${controller.snapshot.profile?.id}` === identity;
      try {
        const [profile, images, catalog, answers] = await Promise.all([
          controller.request('/me/profile', abort.signal).then(raw => fullProfile(raw, session.account!.id)),
          controller.request('/me/profile/photos', abort.signal).then(photos),
          controller.request('/reference/profile-questions', abort.signal).then(parseQuestionCatalog),
          controller.request('/me/profile/question-answers', abort.signal).then(parseQuestionAnswers),
        ]);
        if (`${profile.userId}/${profile.id}` !== identity || !['ACTIVE','DRAFT'].includes(profile.status)) throw new ApiError('invalid');
        const publicProfile = previewProfile(profile, images, catalog, answers);
        if (current()) { setSnapshot({ identity, profile: publicProfile, status: profile.status }); setError(''); }
      } catch { if (current()) { setError('No pudimos actualizar la vista previa. Revisá tu conexión y reintentá.'); abort.abort(); } }
    };
    void load();
    const resume = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', resume);
    return () => { disposed = true; request?.abort(); document.removeEventListener('visibilitychange', resume); };
  }, [controller, identity, epoch]);
  const visible = snapshot?.identity === identity && identity ? snapshot : null;
  return <section className="visual-review" aria-busy={!!identity && !visible && !error}>
    <header className="home-heading"><h2 ref={heading} tabIndex={-1}>Vista previa de mi perfil</h2><button className="login-button login-outlined" onClick={onBack}>Volver</button></header>
    {!identity && <p role="status">La vista previa no está disponible para esta sesión.</p>}
    {!!identity && error && <><p role="alert">{error}{visible && ' Se muestra la última versión confirmada.'}</p><button className="login-button login-outlined" onClick={() => setEpoch(e => e+1)}>Reintentar</button></>}
    {!!identity && !visible && !error && <ProfilePlaceholder label="Cargando perfil…"/>}
    {visible && <>
      {visible.status !== 'ACTIVE' && <p className="home-description">Tu perfil está en borrador. Esta vista previa no lo activa.</p>}
      <h3>{visible.profile.displayName}, {visible.profile.age}</h3>
      <PublicProfileView profile={visible.profile} selected={selected} onSelect={setSelected} retryEpoch={epoch} onRetry={() => setEpoch(e => e+1)}/>
    </>}
  </section>;
}
