import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SessionController } from '../auth/session';
import { object, ApiError } from '../auth/api';
import { sessionContext } from '../visual/VisualSession';
import { parseVisualProfile, type VisualProfile } from '../visual/contracts';
import { ProfileImage } from '../visual/VisualReview';
import '../visual/visual.css';

export function PartnerProfile({controller,matchId,onBack,menu,disabled}:{controller:SessionController;matchId:string;onBack:()=>void;menu:ReactNode;disabled:boolean}) {
  const [profile,setProfile]=useState<VisualProfile|null>(null),[error,setError]=useState(''),[message,setMessage]=useState<string|null>(null),[messageError,setMessageError]=useState(false),[epoch,setEpoch]=useState(0),[busy,setBusy]=useState(true);
  const [selected,setSelected]=useState('');
  const photo=profile?.photos.find(p=>p.id===selected)??profile?.photos[0];
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{heading.current?.focus();},[]);
  useEffect(()=>{
    const abort=new AbortController(),context=sessionContext(controller);
    const current=()=>!abort.signal.aborted&&context===sessionContext(controller);
    const load=async()=>{
      setBusy(true);setError('');setMessageError(false);
      try{
        const p=parseVisualProfile(await controller.request(`/matches/${encodeURIComponent(matchId)}/visual-profile`,abort.signal));
        if(!current())return;setProfile(p);
        if(p.partnerPersonalMessageSubmitted){
          try {const m=await controller.request(`/matches/${encodeURIComponent(matchId)}/personal-messages/partner`,abort.signal);if(!object(m)||!(m.message===null||typeof m.message==='string'))throw new ApiError('invalid');if(current())setMessage(m.message);}
          catch{if(current())setMessageError(true);}
        }
      }catch{if(current()){setProfile(null);setError('No pudimos cargar el perfil. Revisá tu conexión o el acceso a esta interacción.');}}
      finally{if(current())setBusy(false);}
    };
    void load();return()=>abort.abort();
  },[controller,matchId,epoch]);
  return <section className="visual-review"><header className="home-heading"><h2 ref={heading} tabIndex={-1}>{profile?`${profile.displayName}, ${profile.age}`:'Perfil'}</h2><button className="login-button login-outlined" disabled={disabled} onClick={onBack}>Volver</button>{menu}</header>{busy&&<p role="status">Cargando perfil…</p>}{error&&<p role="alert">{error}</p>}{error&&<button className="login-button login-outlined" disabled={busy} onClick={()=>setEpoch(e=>e+1)}>Reintentar</button>}{profile&&<>
    <article className="home-card visual-profile">{!photo&&<p>No hay fotos aprobadas disponibles.</p>}{photo&&<ProfileImage key={photo.id} url={photo.url} label={`Foto ${profile.photos.indexOf(photo)+1} de ${profile.photos.length} de ${profile.displayName}`} eager retryEpoch={epoch} onRetry={()=>setEpoch(e=>e+1)}/>}
    {profile.photos.length>1&&<div className="scheduling-thumbnails" aria-label="Fotos del perfil">{profile.photos.map((p,i)=><button key={p.id} aria-label={`Ver foto ${i+1} de ${profile.photos.length}`} aria-pressed={p.id===photo?.id} onClick={()=>setSelected(p.id)}><img src={p.url} alt="" loading="lazy" referrerPolicy="no-referrer"/><span>{i+1}/{profile.photos.length}</span></button>)}</div>}
    {profile.bio&&<section className="visual-insert"><h3>Bio</h3><p>{profile.bio}</p></section>}{!!profile.affinityIndicators.length&&<section className="visual-insert"><h3>Afinidades compartidas</h3><ul>{profile.affinityIndicators.map(a=><li key={a.categoryId}>{a.title}</li>)}</ul></section>}{!!profile.profileQuestions.length&&<section className="visual-insert"><h3>Preguntas del perfil</h3>{profile.profileQuestions.map(q=><div key={q.questionId}><h4>{q.prompt}</h4><p>{q.answer}</p></div>)}</section>}</article>
    {profile.partnerPersonalMessageSubmitted&&<section className="home-card"><h3>Mensaje personal</h3>{messageError?<><p role="alert">No pudimos cargar el mensaje personal.</p><button className="login-button login-outlined" disabled={busy} onClick={()=>setEpoch(e=>e+1)}>Reintentar mensaje</button></>:<p>{message??(busy?'Cargando mensaje personal…':'No dejó un mensaje personal.')}</p>}</section>}</>}
  </section>;
}
