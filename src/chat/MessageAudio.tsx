import { useEffect, useRef, useState } from 'react';
import { ChatIcon } from './ChatIcon';

type Phase = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'failed';
const clock = (seconds: number) => `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;

export function MessageAudio({ source, durationMillis, refresh }: {
  source: string; durationMillis: number; refresh: () => Promise<string | null>;
}) {
  const slot=useRef<HTMLDivElement>(null), latest=useRef({source,refresh}); latest.current={source,refresh};
  const [state,setState]=useState({phase:'idle' as Phase,position:0,duration:durationMillis/1000,error:''});
  const owner=useRef({audio:null as HTMLAudioElement | null,serial:0,alive:false,intent:false,phase:'idle' as Phase,position:0,dispose:()=>{}});
  const update=(patch: Partial<typeof state>) => { if(owner.current.alive) { if(patch.phase)owner.current.phase=patch.phase;if(patch.position!==undefined)owner.current.position=patch.position;setState(current=>({...current,...patch})); } };
  const release=() => { const r=owner.current;r.dispose();r.dispose=()=>{};r.audio=null; };
  const pause=(dispose=false) => {
    const r=owner.current;r.intent=false;
    if(dispose && !r.audio && r.phase!=='loading')return;
    if(r.phase==='loading' || dispose) { const position=r.phase==='loading'?r.position:r.audio?.currentTime ?? r.position;r.serial++;release();update({phase:'paused',position}); }
    else { r.audio?.pause();if(r.phase==='playing')update({phase:'paused'}); }
  };
  useEffect(()=>{
    const r=owner.current;r.alive=true;
    const hide=()=>{if(document.visibilityState!=='visible')pause(true);};
    const other=(event: Event)=>{if(event.target instanceof HTMLMediaElement && event.target!==r.audio)pause(true);};
    document.addEventListener('visibilitychange',hide);document.addEventListener('play',other,true);
    return ()=>{r.alive=false;r.intent=false;r.serial++;release();document.removeEventListener('visibilitychange',hide);document.removeEventListener('play',other,true);};
  },[]);
  const begin=(url: string,position: number,retried: boolean,serial: number) => {
    const r=owner.current;
    if(!r.alive || !r.intent || r.serial!==serial)return;
    release();
    const audio=document.createElement('audio');audio.hidden=true;audio.preload='none';audio.setAttribute('aria-hidden','true');
    r.audio=audio;slot.current?.append(audio);
    const owns=()=>r.alive && r.audio===audio && r.serial===serial;
    let handled=false,positioned=false;
    const failure=async (code=audio.error?.code ?? 0,permission=false) => {
      if(!owns() || !r.intent || handled)return;handled=true;
      if(!retried && !permission && [2,4].includes(code)) {
        update({phase:'loading'});
        try { const renewed=await latest.current.refresh();if(!owns() || !r.intent)return;
          if(renewed){begin(renewed,position,true,serial);return;}
        } catch { /* Show actionable failure; never expose a signed URL or raw error. */ }
      }
      if(owns()) { r.intent=false;update({phase:'failed',error:permission?'El navegador bloqueó la reproducción. Volvé a presionar reproducir.':code===3?'No pudimos decodificar este audio. El archivo puede estar dañado.':'No pudimos cargar este audio. Revisá la conexión o renová el enlace; el formato también puede ser incompatible.'}); }
    };
    const metadata=()=>{if(owns() && Number.isFinite(audio.duration) && audio.duration>0){update({duration:audio.duration});if(position>0 && !positioned){positioned=true;audio.currentTime=Math.min(position,audio.duration);}}};
    const playing=()=>{if(owns() && r.intent)update({phase:'playing',error:''});else audio.pause();};
    const waiting=()=>{if(owns() && r.intent)update({phase:'loading'});};
    const paused=()=>{if(r.phase==='loading' && r.intent)return;if(owns() && !audio.ended && r.phase!=='failed'){r.intent=false;update({phase:'paused',position:audio.currentTime});}};
    const ended=()=>{if(owns()){r.intent=false;update({phase:'ended',position:Number.isFinite(audio.duration) && audio.duration>0?audio.duration:audio.currentTime});}};
    const tick=()=>{if(owns())update({position:audio.currentTime});};
    const error=()=>{void failure();};
    audio.addEventListener('loadedmetadata',metadata);audio.addEventListener('durationchange',metadata);audio.addEventListener('playing',playing);audio.addEventListener('waiting',waiting);audio.addEventListener('pause',paused);audio.addEventListener('ended',ended);audio.addEventListener('timeupdate',tick);audio.addEventListener('error',error);
    r.dispose=()=>{audio.removeEventListener('loadedmetadata',metadata);audio.removeEventListener('durationchange',metadata);audio.removeEventListener('playing',playing);audio.removeEventListener('waiting',waiting);audio.removeEventListener('pause',paused);audio.removeEventListener('ended',ended);audio.removeEventListener('timeupdate',tick);audio.removeEventListener('error',error);audio.pause();audio.removeAttribute('src');audio.load();audio.remove();};
    audio.src=url;audio.load();
    void audio.play().catch((error: unknown)=>{if(!owns() || !r.intent)return;const name=error instanceof DOMException?error.name:'';if(name==='AbortError')return;void failure(audio.error?.code ?? (name==='NotSupportedError'?4:0),name==='NotAllowedError');});
  };
  const play=() => {
    const r=owner.current;
    if(r.phase==='loading' || r.phase==='playing'){pause();return;}
    document.querySelectorAll('audio').forEach(audio=>{if(audio!==r.audio)audio.pause();});
    const position=r.phase==='ended'?0:state.position;
    r.intent=true;const serial=++r.serial;
    update({phase:'loading',error:'',position});
    begin(latest.current.source,position,false,serial);
  };
  const renew=async () => {
    const r=owner.current;if(r.phase==='loading')return;
    r.intent=true;const serial=++r.serial;release();update({phase:'loading',error:''});
    try {const url=await latest.current.refresh();if(!r.alive || r.serial!==serial || !r.intent)return;if(!url)throw Error('unavailable');begin(url,state.position,true,serial);}
    catch {if(r.alive && r.serial===serial){r.intent=false;update({phase:'failed',error:'No pudimos renovar el enlace. Revisá la conexión y volvé a intentar.'});}}
  };
  return <div className="chat-playback" role="group" aria-label="Mensaje de audio" data-phase={state.phase}>
    <div ref={slot} hidden />
    <div className="chat-playback-row"><button type="button" className="chat-icon-button" aria-label={state.phase==='loading'?'Cancelar carga de audio':state.phase==='playing'?'Pausar audio':state.phase==='ended'?'Reproducir audio de nuevo':'Reproducir audio'} onClick={play}>
      {state.phase==='loading'?<span className="chat-spinner" role="status" aria-label="Cargando audio"/>:<ChatIcon name={state.phase==='playing'?'pause':'play'}/>}</button>
      <output aria-live="off" aria-label="Tiempo de audio">{clock(state.position)} / {clock(Math.ceil(state.duration))}</output></div>
    <input type="range" aria-label="Posición del audio" aria-valuetext={`${clock(state.position)} de ${clock(Math.ceil(state.duration))}`} min={0} max={Math.max(state.duration,.01)} step={.01} value={Math.min(state.position,state.duration)} disabled={!owner.current.audio || state.phase==='loading' || state.phase==='failed'} onChange={event=>{const audio=owner.current.audio;if(!audio)return;try{audio.currentTime=Number(event.target.value);update({position:audio.currentTime,...(state.phase==='ended'?{phase:'paused'}:{})});}catch{update({error:'No pudimos cambiar la posición del audio.'});}}}/>
    {state.error && <div className="chat-playback-error" role="alert">{state.error}<button type="button" onClick={()=>void renew()}>Renovar enlace</button></div>}
  </div>;
}
