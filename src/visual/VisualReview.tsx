import { photoIdentity } from './photoIdentity';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { SessionController } from '../auth/session';
import { VisualSession, sessionContext, validMessage } from './VisualSession';
import { deadline, useVisualNow } from './deadline';
import './visual.css';

export function VisualReview({ controller, matchId, onBack, onFinished = onBack, onBlocked }: { controller: SessionController; matchId: string; onBack: () => void; onFinished?: () => void; onBlocked?: (value: boolean) => void }) {
  const session = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const context = sessionContext(controller), finish = useRef(onFinished); finish.current=onFinished;
  const model=useMemo(()=>new VisualSession(controller,matchId,()=>finish.current()),[controller,context,matchId]);
  const state=useSyncExternalStore(model.subscribe,model.getSnapshot);
  const now=useVisualNow();
  const [draft,setDraft]=useState(''), [menu,setMenu]=useState(false), [dialog,setDialog]=useState(false);
  const heading=useRef<HTMLHeadingElement>(null), menuButton=useRef<HTMLButtonElement>(null), menuItem=useRef<HTMLButtonElement>(null), dialogRef=useRef<HTMLDialogElement>(null);
  useEffect(()=>{setDraft('');setMenu(false);setDialog(false);},[context,matchId]);
  useEffect(()=>{heading.current?.focus({preventScroll:true});},[]);
  useEffect(()=>{if(menu)menuItem.current?.focus();},[menu]);
  useEffect(()=>{if(!dialog)return;const d=dialogRef.current;d?.showModal();return()=>{d?.close();menuButton.current?.focus();};},[dialog]);
  useEffect(()=>{onBlocked?.(!!state.pending);return()=>onBlocked?.(false);},[state.pending,onBlocked]);
  useEffect(()=>{
    model.start();void model.refresh();
    const resume=()=>{if(document.visibilityState==='visible')void model.resume();else model.conceal();};
    const poll=setInterval(()=>{if(document.visibilityState==='visible')void model.refresh();},30000);
    document.addEventListener('visibilitychange',resume);window.addEventListener('online',resume);
    return()=>{model.dispose();clearInterval(poll);document.removeEventListener('visibilitychange',resume);window.removeEventListener('online',resume);};
  },[model]);
  const expiry=state.profile?.visualExpiresAt;
  useEffect(()=>{if(!expiry)return;const ms=Date.parse(expiry)-Date.now();if(ms<=0)return;const timer=setTimeout(()=>void model.refresh(),Math.min(ms,2147483647));return()=>clearTimeout(timer);},[model,expiry]);
  const visible=model.context===context&&session.phase==='ready';
  const profile=visible?state.profile:null;
  const expired=!!expiry&&Date.parse(expiry)<=now;
  const disabled=state.busy||!!state.pending||state.uncertain||state.concealed||expired||!profile;
  const photo=(index:number)=>{const p=profile?.photos[index];return p&&<ProfileImage key={JSON.stringify([context,matchId,profile.profileId,photoIdentity(p.id,p.url)])} retryEpoch={state.imageRetry} onRetry={()=>void model.refresh(true)} url={p.url} label={`Foto ${index+1} de ${profile.photos.length} de ${profile.displayName}`} eager={index===0}/>;};
  return <section className="visual-review" aria-busy={state.busy&&!profile}>
    <header className="visual-header"><div className="home-heading visual-toolbar"><button className="login-button login-outlined" disabled={!!state.pending} onClick={onBack}>Volver a Actividad</button><div className="chat-overflow" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setMenu(false);}} onKeyDown={e=>{if(e.key==='Escape'){setMenu(false);menuButton.current?.focus();}}}>
      <button ref={menuButton} className="login-button login-outlined" aria-label="Más acciones" aria-haspopup="menu" aria-expanded={menu} disabled={disabled} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setMenu(true);}}} onClick={()=>setMenu(v=>!v)}>⋮</button>
      {menu&&<div className="chat-menu" role="menu"><button ref={menuItem} role="menuitem" onClick={()=>{setMenu(false);setDialog(true);}}>Bloquear a esta persona</button></div>}
    </div></div><h2 ref={heading} tabIndex={-1}>Descubrimiento</h2></header>
    <p>Conocé su perfil antes de decidir si querés continuar.</p>
    {expiry&&<p>{deadline(expiry,now,true)}</p>}
    {!profile&&state.busy&&<p role="status">Cargando descubrimiento…</p>}
    {state.error&&<p role="alert" className="home-error">{state.error}</p>}
    {state.error&&!state.terminal&&<button className="login-button login-outlined" disabled={state.busy||!!state.pending} onClick={()=>void model.refresh()}>Reintentar</button>}
    {expired?<p role="status">El descubrimiento venció. Actualizando estado...</p>:expiry&&Date.parse(expiry)-now<=600000&&<aside className="home-notice">Descubrimiento por vencer. El descubrimiento vence pronto. Completá tu decisión para no perder esta oportunidad.</aside>}
    <div className={`visual-content${state.concealed ? ' visual-concealed' : ''}`} style={{ visibility: state.concealed ? 'hidden' : 'visible' }} inert={state.concealed} aria-hidden={state.concealed}>
    {profile&&<>
      <article className="home-card visual-profile">
        <header><h3>{profile.displayName}</h3><p>{profile.age} años</p></header>
        {!profile.photos.length&&<p role="status">No hay fotos aprobadas disponibles.</p>}
        {photo(0)}{profile.bio&&<section className="visual-insert"><h4>Bio</h4><p>{profile.bio}</p></section>}{photo(1)}
        {!!profile.affinityIndicators.length&&<section className="visual-insert"><h4>Afinidades compartidas</h4><p>Temas en los que encontraron afinidad.</p><ul className="visual-affinities">{profile.affinityIndicators.map(a=><li key={a.categoryId}>{a.title}</li>)}</ul></section>}
        {photo(2)}{!!profile.profileQuestions.length&&<section className="visual-insert"><h4>Preguntas del perfil</h4>{profile.profileQuestions.map((q,i)=><div key={`${q.questionId}/${i}`}><h5>{q.prompt}</h5><p>{q.answer}</p></div>)}</section>}{profile.photos.slice(3).map((_,i)=>photo(i+3))}
      </article>
      <section className={`home-card visual-section ${profile.partnerPersonalMessageSubmitted&&!profile.partnerPersonalMessageRead?'visual-unread':''}`}><h3>Mensaje personal de la otra persona</h3>
        <div className="visual-message-badge">{profile.partnerPersonalMessageSubmitted&&!profile.partnerPersonalMessageRead&&<strong>Mensaje nuevo</strong>}</div>
        <p className={`visual-message-body${state.messageLoaded ? ' visual-message-loaded' : ''}`} aria-live="polite">{!profile.partnerPersonalMessageSubmitted?'No dejó un mensaje personal.':state.pending==='read'?'Leyendo mensaje...':state.messageError?'No pudimos cargar el mensaje personal. Intentá nuevamente.':state.messageLoaded?state.message||'No dejó un mensaje personal.':'La otra persona dejó un mensaje personal para vos.'}</p>
        <div className="visual-message-action">{profile.partnerPersonalMessageSubmitted&&!state.messageLoaded&&<button className="login-button login-outlined" disabled={disabled} onClick={()=>void model.act('read')}>{state.messageError?'Reintentar lectura':'Leer mensaje'}</button>}</div>
      </section>
      <section className="home-card visual-section"><h3>Mi mensaje personal</h3>
        {profile.myPersonalMessageSubmitted?<p>Ya guardaste tu mensaje personal. No se puede modificar.</p>:<><label>Mensaje personal<textarea value={draft} maxLength={280} rows={3} disabled={disabled} onChange={e=>setDraft(e.target.value.slice(0,280))}/></label><p>{draft.length}/280</p>{draft&&!validMessage(draft)&&<p>El mensaje personal no es válido.</p>}<button className="login-button login-outlined" disabled={disabled||!validMessage(draft)} onClick={()=>void model.act('save',draft)}>{state.pending==='save'?'Guardando...':'Guardar mensaje'}</button></>}
        {state.notice&&<p role="status">{state.notice}</p>}
      </section>
      <section className="home-card visual-section"><h3>Tu decisión</h3><p>Si aprobás y la otra persona también aprueba, se crea la conexión para la siguiente etapa.</p><div className="visual-decisions"><button className="login-button login-primary" disabled={disabled} onClick={()=>void model.act('APPROVED')}>{state.pending==='APPROVED'?'Aprobando...':'Aprobar'}</button><button className="login-button login-outlined" disabled={disabled} onClick={()=>void model.act('REJECTED')}>{state.pending==='REJECTED'?'Rechazando...':'Rechazar'}</button></div></section>
    </>}
    </div>
    {dialog&&<dialog ref={dialogRef} aria-labelledby="visual-block-title" onCancel={e=>{if(state.pending)e.preventDefault();else setDialog(false);}}><h3 id="visual-block-title">¿Bloquear a esta persona?</h3><p>Esta acción es definitiva y no se puede deshacer. Se cerrará la interacción actual y no volverán a ser emparejados. Bloquear no envía un reporte.</p>{state.error&&<p role="alert">{state.error}</p>}<button className="login-button login-outlined" disabled={!!state.pending} onClick={()=>setDialog(false)}>Cancelar</button><button className="login-button login-primary" disabled={disabled} onClick={()=>void model.act('block')}>{state.pending==='block'?'Bloqueando...':'Bloquear definitivamente'}</button></dialog>}
  </section>;
}
function ProfileImage({ url, label, eager, retryEpoch, onRetry }: { url: string; label: string; eager: boolean; retryEpoch: number; onRetry: () => void }) {
  const [image, setImage] = useState<{ epoch: number; url: string; status: 'loading' | 'loaded' | 'failed' }>(() => ({ epoch: retryEpoch, url, status: 'loading' }));
  // Pin the exact request string while loading/loaded. Only a failed request
  // adopts a renewed signature automatically; explicit refresh remounts after
  // the new authoritative response, never with the previous expired URL.
  if (image.status === 'failed' && (image.url !== url || image.epoch !== retryEpoch)) setImage({ epoch: retryEpoch, url, status: 'loading' });
  const status = image.status;
  return <figure className="visual-photo">
    {status !== 'failed' && <img src={image.url} alt={label} loading={eager ? 'eager' : 'lazy'} referrerPolicy="no-referrer" onLoad={() => setImage(current => ({ ...current, status: 'loaded' }))} onError={() => setImage(current => ({ ...current, status: 'failed' }))} />}
    {status !== 'loaded' && <span role="status">{status === 'failed' ? 'No se pudo cargar esta foto. Volvé a intentar.' : 'Cargando foto…'}</span>}
    {status === 'failed' && <button className="login-button login-outlined visual-photo-retry" onClick={onRetry}>Reintentar foto</button>}
    <figcaption>{label}</figcaption>
  </figure>;
}
