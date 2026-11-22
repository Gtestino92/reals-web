import { PublicProfileLocation } from './PublicProfileLocation';
import type { ReactNode } from 'react';
import type { VisualProfile } from '../visual/contracts';
import { ProfileImage, ThumbnailImage } from '../visual/ProfileImage';
import { photoIdentity } from '../visual/photoIdentity';
import '../visual/visual.css';

export type PublicProfile = Pick<VisualProfile, 'displayName' | 'age' | 'city' | 'countryCode' | 'bio' | 'photos' | 'profileQuestions' | 'affinityIndicators'>;

// Only presentation: interaction-specific content belongs to the caller.
export function PublicProfileView({ profile, selected, onSelect, retryEpoch, onRetry, personalMessage, showLocation = true }: {
  profile: PublicProfile; selected: string; onSelect: (id: string) => void;
  retryEpoch: number; onRetry: () => void; personalMessage?: ReactNode; showLocation?: boolean;
}) {
  const photo = profile.photos.find(p => p.id === selected) ?? profile.photos[0];
  return (
    <>
    {showLocation && <PublicProfileLocation city={profile.city} countryCode={profile.countryCode}/>}
    <article className="home-card visual-profile">
    {profile.bio&&<section className="visual-insert"><h3>Bio</h3><p>{profile.bio}</p></section>}
    {!!profile.profileQuestions.length&&<section className="visual-insert"><h3>Preguntas del perfil</h3>{profile.profileQuestions.map(q=><div key={q.questionId}><h4>{q.prompt}</h4><p>{q.answer}</p></div>)}</section>}
    {!!profile.affinityIndicators.length&&<section className="visual-insert"><h3>Afinidades compartidas</h3><ul>{profile.affinityIndicators.map(a=><li key={a.categoryId}>{a.title}</li>)}</ul></section>}
    {personalMessage}
    {!photo&&<p>No hay fotos aprobadas disponibles.</p>}{photo&&<ProfileImage key={photoIdentity(photo.id,photo.url)} url={photo.url} label={`Foto ${profile.photos.indexOf(photo)+1} de ${profile.photos.length} de ${profile.displayName}`} eager retryEpoch={retryEpoch} onRetry={onRetry}/>}
    {profile.photos.length>1&&<div className="scheduling-thumbnails" aria-label="Fotos del perfil">{profile.photos.map((p,i)=><button key={p.id} aria-label={`Ver foto ${i+1} de ${profile.photos.length}`} aria-pressed={p.id===photo?.id} onClick={()=>onSelect(p.id)}><ThumbnailImage key={photoIdentity(p.id,p.url)} url={p.url} retryEpoch={retryEpoch}/><span>{i+1}/{profile.photos.length}</span></button>)}</div>}
    </article>
    </>
  );
}
