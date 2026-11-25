import { PublicProfileLocation } from '../profile/PublicProfileLocation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { SessionController } from '../auth/session';
import { object, ApiError } from '../auth/api';
import { sessionContext } from '../visual/VisualSession';
import { parseVisualProfile, type VisualProfile } from '../visual/contracts';
import { PublicProfileView } from '../profile/PublicProfileView';
import '../visual/visual.css';

export function PartnerProfile({controller,matchId,partnerName,onBack,menu,disabled}:{controller:SessionController;matchId:string;partnerName:string|null;onBack:()=>void;menu:ReactNode;disabled:boolean}) {
  const [snapshot,setSnapshot]=useState<{profile:VisualProfile; message:string|null; messageError:boolean; epoch:number}|null>(null);
  const [error,setError]=useState(''),[epoch,setEpoch]=useState(0),[busy,setBusy]=useState(true);
  const [selected,setSelected]=useState('');
  const retired=useRef(false);
  const heading=useRef<HTMLHeadingElement>(null);
  useEffect(()=>{heading.current?.focus({preventScroll:true});},[]);
  useEffect(()=>{
    const context=sessionContext(controller);
    let request:AbortController|null=null;
    const load=async(background=false)=>{
      if(retired.current)return;
      request?.abort();
      const abort=new AbortController();request=abort;
      const current=()=>!abort.signal.aborted&&context===sessionContext(controller);
      if(!background)setBusy(true);
      try{
        const p=parseVisualProfile(await controller.request(`/matches/${encodeURIComponent(matchId)}/visual-profile`,abort.signal));
        if(!current())return;
        // Install the photo authorization immediately. The message request may
        // take longer and does not own the photo gallery.
        setSnapshot(previous=>({profile:p,epoch,message:previous?.profile.profileId===p.profileId&&p.partnerPersonalMessageSubmitted?previous.message:null,messageError:false}));
        setError('');
        if(p.partnerPersonalMessageSubmitted){
          try {
            const m=await controller.request(`/matches/${encodeURIComponent(matchId)}/personal-messages/partner`,abort.signal);
            if(!object(m)||!(m.message===null||typeof m.message==='string'))throw new ApiError('invalid');
            const message=m.message;
            if(current())setSnapshot(previous=>previous&&{...previous,message});
          } catch(failure) {
            if(current()&&denied(failure)) throw failure;
            if(current())setSnapshot(previous=>previous&&{...previous,messageError:true});
          }
        }
      }catch(failure){if(current()){
        if(failure instanceof ApiError&&failure.status===409&&failure.code==='USER_PAIR_BLOCKED')retired.current=true;
        if(denied(failure)||failure instanceof ApiError&&failure.kind==='invalid')setSnapshot(null);
        setError('No pudimos cargar el perfil. Revisá tu conexión o el acceso a esta interacción.');
      }}
      finally{if(current())setBusy(false);}
    };
    void load();
    const resume=()=>{if(document.visibilityState==='visible')void load(true);};
    document.addEventListener('visibilitychange',resume);
    return()=>{request?.abort();document.removeEventListener('visibilitychange',resume);};
  },[controller,matchId,epoch]);
  const {profile,message,messageError}=snapshot??{profile:null,message:null,messageError:false};
  return <section className="visual-review"><header className="home-heading partner-profile-heading"><div className="partner-profile-identity"><h2 ref={heading} tabIndex={-1}>{profile?`${profile.displayName}, ${profile.age}`:partnerName ?? 'Perfil'}</h2>{profile && <PublicProfileLocation city={profile.city} countryCode={profile.countryCode}/>}</div><div className="partner-profile-actions"><button className="login-button login-outlined" disabled={disabled} onClick={onBack}>Volver</button>{menu}</div></header>{busy&&!profile&&<p className="home-card partner-profile-loading" role="status">Cargando perfil…</p>}{error&&<p role="alert">{error}</p>}{error&&!retired.current&&<button className="login-button login-outlined" disabled={busy} onClick={()=>setEpoch(e=>e+1)}>Reintentar</button>}{snapshot&&profile&&<>
    <PublicProfileView key={profile.profileId} showLocation={false} profile={profile} selected={selected} onSelect={setSelected} retryEpoch={snapshot.epoch} onRetry={()=>setEpoch(e=>e+1)} personalMessage={profile.partnerPersonalMessageSubmitted&&<section className="visual-insert"><h3>Mensaje personal</h3>{messageError?<><p role="alert">No pudimos cargar el mensaje personal.</p><button className="login-button login-outlined" disabled={busy} onClick={()=>setEpoch(e=>e+1)}>Reintentar mensaje</button></>:<p>{message??(busy?'Cargando mensaje personal…':'No dejó un mensaje personal.')}</p>}</section>}/></>}
  </section>;
}

function denied(failure: unknown) {
  return failure instanceof ApiError && ((failure.status===409&&failure.code==='USER_PAIR_BLOCKED') || [401,403,404].includes(failure.status)||['VISUAL_CONTENT_NOT_AVAILABLE','VISUAL_REVIEW_EXPIRED'].includes(failure.code));
}
