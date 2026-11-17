import { PublicProfileLocation } from '../profile/PublicProfileLocation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SessionController } from '../auth/session';
import { object, ApiError } from '../auth/api';
import { sessionContext } from '../visual/VisualSession';
import { parseVisualProfile, type VisualProfile } from '../visual/contracts';
import { PublicProfileView } from '../profile/PublicProfileView';
import { ProfilePlaceholder } from '../visual/ProfilePlaceholder';
import '../visual/visual.css';

export function PartnerProfile({controller,matchId,onBack,menu,disabled}:{controller:SessionController;matchId:string;onBack:()=>void;menu:ReactNode;disabled:boolean}) {
  const [profile,setProfile]=useState<VisualProfile|null>(null),[error,setError]=useState(''),[message,setMessage]=useState<string|null>(null),[messageError,setMessageError]=useState(false),[epoch,setEpoch]=useState(0),[busy,setBusy]=useState(true);
  const [selected,setSelected]=useState('');
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
  return <section className="visual-review"><header className="home-heading"><div><h2 ref={heading} tabIndex={-1}>{profile?`${profile.displayName}, ${profile.age}`:'Perfil'}</h2>{profile && <PublicProfileLocation city={profile.city} countryCode={profile.countryCode}/>}</div><button className="login-button login-outlined" disabled={disabled} onClick={onBack}>Volver</button>{menu}</header>{busy&&!profile&&<ProfilePlaceholder label="Cargando perfil…"/>}{error&&<p role="alert">{error}</p>}{error&&<button className="login-button login-outlined" disabled={busy} onClick={()=>setEpoch(e=>e+1)}>Reintentar</button>}{profile&&<>
    <PublicProfileView showLocation={false} profile={profile} selected={selected} onSelect={setSelected} retryEpoch={epoch} onRetry={()=>setEpoch(e=>e+1)} personalMessage={profile.partnerPersonalMessageSubmitted&&<section className="visual-insert"><h3>Mensaje personal</h3>{messageError?<><p role="alert">No pudimos cargar el mensaje personal.</p><button className="login-button login-outlined" disabled={busy} onClick={()=>setEpoch(e=>e+1)}>Reintentar mensaje</button></>:<p>{message??(busy?'Cargando mensaje personal…':'No dejó un mensaje personal.')}</p>}</section>}/></>}
  </section>;
}
