import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { SessionController } from '../auth/session';
import { sessionContext } from '../visual/VisualSession';
import { VisualDeadline, useVisualNow } from '../visual/deadline';
import { SchedulingSession } from './SchedulingSession';
import { conflicts, days, localSlot, reviewReason, roundState, validateSlots } from './policy';
import type { Availability } from './contracts';
import { PartnerProfile } from './PartnerProfile';
import './scheduling.css';

export const formatSlot=(v: string)=>new Date(v).toLocaleString('es-AR',{dateStyle:'full',timeStyle:'short'});
export function Scheduling({controller,connectionId,matchId,partnerName,onBack,onFinished,onBlocked,browse,onBrowse,onCloseBrowse}: {controller: SessionController;connectionId: string;matchId: string;partnerName: string|null;onBack:()=>void;onFinished:()=>void;onBlocked:(value:boolean)=>void;browse:boolean;onBrowse:()=>void;onCloseBrowse:()=>void}) {
  useSyncExternalStore(controller.subscribe,controller.getSnapshot);
  const context=sessionContext(controller), finish=useRef(onFinished), lock=useRef(onBlocked);finish.current=onFinished;lock.current=onBlocked;
  const model=useMemo(()=>new SchedulingSession(controller,connectionId,matchId,()=>finish.current(),value=>lock.current(value)),[controller,context,connectionId,matchId]);
  const s=useSyncExternalStore(model.subscribe,model.getSnapshot), clock=useVisualNow(), now=clock+s.offset;
  const r=roundState(s.busy&&!s.negotiation,s.negotiation,s.proposals,controller.getSnapshot().account?.id??'');
  const [menu,setMenu]=useState(false),[dialog,setDialog]=useState(false);
  const dialogRef=useRef<HTMLDialogElement>(null),menuButton=useRef<HTMLButtonElement>(null),menuItem=useRef<HTMLButtonElement>(null);
  useEffect(()=>{onBlocked(s.pending);return()=>onBlocked(false);},[s.pending,onBlocked]);
  useEffect(()=>{if(menu)menuItem.current?.focus();},[menu]);
  useEffect(()=>{if(dialog){const d=dialogRef.current;d?.showModal();return()=>{d?.close();menuButton.current?.focus();};}},[dialog]);
  useEffect(()=>{
    model.start();void model.refresh();
    const resume=()=>{if(document.visibilityState==='visible')void model.refresh();};
    const timer=setInterval(()=>{const state=model.getSnapshot();if(!state.terminal&&(!state.negotiation||state.negotiation.status==='PENDING'))void model.refresh();},7000);
    document.addEventListener('visibilitychange',resume);window.addEventListener('online',resume);
    return()=>{model.dispose();clearInterval(timer);document.removeEventListener('visibilitychange',resume);window.removeEventListener('online',resume);};
  },[model]);
  const expires=s.negotiation?.schedulingExpiresAt, expired=!!expires&&Date.parse(expires)<=now;
  const expiryRequested=useRef('');
  useEffect(()=>{if(expired&&expiryRequested.current!==expires){expiryRequested.current=expires??'';void model.refresh();}},[expired,expires,model]);
  const disabled=s.busy||!s.verified||s.uncertain||s.terminal||expired||s.negotiation?.status!=='PENDING';
  const error=<>{s.error&&<p role="alert" className="home-error">{s.error}</p>}</>;
  const blockMenu=<div className="chat-overflow" onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))setMenu(false);}} onKeyDown={e=>{if(e.key==='Escape'){setMenu(false);menuButton.current?.focus();}}}><button ref={menuButton} className="login-button login-outlined" aria-label="Más acciones" aria-haspopup="menu" aria-expanded={menu} disabled={s.busy||s.terminal} onClick={()=>setMenu(v=>!v)} onKeyDown={e=>{if(e.key==='ArrowDown'){e.preventDefault();setMenu(true);}}}>⋮</button>{menu&&<div className="chat-menu" role="menu"><button ref={menuItem} role="menuitem" onClick={()=>{setMenu(false);setDialog(true);}}>Bloquear a esta persona</button></div>}</div>;
  return <section className="scheduling" aria-busy={s.busy}>
    {browse?<PartnerProfile controller={controller} matchId={matchId} onBack={onCloseBrowse} disabled={s.pending} menu={blockMenu}/>:<>
      <header className="home-heading"><h2>Coordinar horarios</h2><button className="login-button login-outlined" disabled={s.pending} onClick={onBack}>Volver a Actividad</button>{blockMenu}</header>
      <p>{partnerName?`Con ${partnerName}`:'Con la otra persona'}</p>
      {s.negotiation&&<p>Ronda {s.negotiation.roundNumber}{s.busy?' · Actualizando…':''}</p>}
      {s.negotiation?.status==='PENDING'&&<VisualDeadline start={s.negotiation.createdAt} end={expires??null} now={now}/>}
      {s.errorContext==='screen'&&error}{s.message&&<p role="status">{s.message}</p>}
      {s.error&&<button className="login-button login-outlined" disabled={s.busy} onClick={()=>void model.refresh()}>Reintentar</button>}
      {s.negotiation?.status==='PENDING'&&(expired?<aside className="home-notice">La coordinación venció. Actualizando estado…</aside>:expires&&Date.parse(expires)-now<=3600000&&<aside className="home-notice">Coordinación por vencer. Confirmá o enviá opciones para no perder la conexión.</aside>)}
      {s.terminal?<p>La conexión ya no está disponible. Volvé a Actividad.</p>:s.connection?.state==='SCHEDULING_PENDING'?<p role="status">Estamos preparando la coordinación de horarios.</p>:<>
      {r.stage==='Loading'&&<p role="status">Cargando coordinación…</p>}
      {r.stage==='Unknown'&&<p>No pudimos interpretar el estado actual. Reintentá para consultar el estado.</p>}
      {r.stage==='WaitingForMyProposals'&&<section className="home-card"><h3>Proponé tus horarios</h3><p>Elegí entre 1 y 3 opciones, en orden de preferencia.</p><SlotPicker key={`${connectionId}/${s.negotiation?.roundNumber}`} now={now} availability={s.availability} selected={s.draft} disabled={disabled} onChange={model.setDraft}/>{s.errorContext==='submit'&&error}<button className="login-button login-primary" disabled={disabled||!!validateSlots(s.draft,now,s.availability)} onClick={()=>void model.act('submit')}>Enviar horarios</button></section>}
      {r.stage==='WaitingForPartnerProposals'&&<section className="home-card"><h3>Esperando a la otra persona</h3><p>{r.myPending.length?'Esperando a que la otra persona revise tus opciones.':'La otra persona rechazó tus opciones. Ahora esperamos que envíe las suyas.'}</p><OwnProposals values={r.myPending.map(p=>p.proposedDateTime)}/></section>}
      {r.stage==='ReviewPartnerProposals'&&<section className="home-card"><h3>Horarios que recibiste</h3><p>Elegí una opción o rechazá la lista para continuar la coordinación.</p><ol>{r.received.map(p=>{const reason=reviewReason(p.proposedDateTime,now,s.availability);return <li key={p.id}><time dateTime={p.proposedDateTime}>{formatSlot(p.proposedDateTime)}</time>{reason&&<p className="home-error">{reason}</p>}<button className="login-button login-primary" disabled={disabled||!!reason} onClick={()=>void model.act('accept',p.id)}>Aceptar opción {p.preferenceOrder}</button></li>;})}</ol>{r.received.every(p=>!!reviewReason(p.proposedDateTime,now,s.availability))&&<p>No hay horarios disponibles para aceptar. Podés rechazar la lista.</p>}<OwnProposals values={r.myPending.map(p=>p.proposedDateTime)}/>{s.errorContext==='review'&&error}<button className="login-button login-outlined" disabled={disabled} onClick={()=>void model.act('reject')}>Rechazar estas opciones</button></section>}
      {r.stage==='Scheduled'&&<section className="home-card"><h3>Horario confirmado</h3><p>{s.negotiation?.confirmedDateTime&&formatSlot(s.negotiation.confirmedDateTime)}</p></section>}
      {r.stage==='Failed'&&<section className="home-card"><p>No hubo acuerdo. La coordinación ya no está disponible.</p></section>}
      </>}
      <button className="login-button login-outlined" disabled={s.busy||s.terminal} onClick={onBrowse}>Ver perfil</button>
      <button className="login-button login-primary" disabled={s.pending} onClick={onBack}>Volver a Actividad</button>
    </>}
    {dialog&&<dialog ref={dialogRef} aria-labelledby="scheduling-block-title" onCancel={e=>{if(s.pending)e.preventDefault();else setDialog(false);}}><h3 id="scheduling-block-title">¿Bloquear a esta persona?</h3><p>Esta acción es definitiva y no se puede deshacer. Se cerrará la interacción actual y no volverán a ser emparejados. Bloquear no envía un reporte.</p>{error}<button className="login-button login-outlined" disabled={s.pending} onClick={()=>setDialog(false)}>Cancelar</button><button className="login-button login-primary" disabled={s.busy||!s.verified||s.uncertain||s.terminal} onClick={()=>void model.act('block')}>Bloquear definitivamente</button></dialog>}
  </section>;
}
function OwnProposals({values}:{values:string[]}) {return values.length>0&&<><h4>Tus opciones</h4><ol>{values.map(v=><li key={v}>{formatSlot(v)}</li>)}</ol></>;}
function SlotPicker({now,availability,selected,disabled,onChange}:{now:number;availability:Availability|null;selected:string[];disabled:boolean;onChange:(v:string[])=>void}) {
  const dates=days(now), [date,setDate]=useState(dates[0]??''),[hour,setHour]=useState(8),[minute,setMinute]=useState(0),[error,setError]=useState('');
  const reason=(day:string,h:number,m:number)=>{const v=localSlot(day,h,m);return !v?'No disponible':validateSlots([v],now,availability);};
  const blocked=(day:string,h:number,m:number)=>{const v=localSlot(day,h,m);return !!v&&!!availability&&conflicts(v,availability);};
  const hours=Array.from({length:24},(_,i)=>i), candidate=localSlot(date,hour,minute);
  useEffect(()=>{
    const day=dates.includes(date)&&hours.some(h=>[0,30].some(m=>!reason(date,h,m)))?date:dates.find(d=>hours.some(h=>[0,30].some(m=>!reason(d,h,m))));
    if(!day)return;
    const h=[hour,...hours].find(h=>[0,30].some(m=>!reason(day,h,m)));
    if(h===undefined)return;
    const m=[minute,0,30].find(m=>!reason(day,h,m));
    setDate(day);setHour(h);if(m!==undefined)setMinute(m);
  },[now,availability,date,hour,minute]);
  return <><fieldset disabled={disabled}><legend>Elegí día y hora</legend>
    <label>Día<select value={date} onChange={e=>{setDate(e.target.value);setError('');}}>{dates.map((d,i)=><option key={d} value={d} disabled={!hours.some(h=>[0,30].some(m=>!reason(d,h,m)))}>{i===0?'Hoy':i===1?'Mañana':new Date(`${d}T12:00:00`).toLocaleDateString('es-AR',{weekday:'long',day:'numeric',month:'short'})}{!hours.some(h=>[0,30].some(m=>!reason(d,h,m)))?' · No disponible':''}</option>)}</select></label>
    <div className="scheduling-time"><label>Hora<select value={hour} onChange={e=>setHour(Number(e.target.value))}>{hours.map(h=><option key={h} value={h} disabled={[0,30].every(m=>!!reason(date,h,m))} className={[0,30].every(m=>blocked(date,h,m))?'scheduling-conflict':''}>{String(h).padStart(2,'0')}{[0,30].every(m=>!!reason(date,h,m))?' · No disponible':''}</option>)}</select></label><label>Minutos<select value={minute} onChange={e=>setMinute(Number(e.target.value))}>{[0,30].map(m=><option key={m} value={m} disabled={!!reason(date,hour,m)} className={blocked(date,hour,m)?'scheduling-conflict':''}>{String(m).padStart(2,'0')}{reason(date,hour,m)?blocked(date,hour,m)?' · Se superpone':' · No disponible':''}</option>)}</select></label></div>
    {availability&&availability.unavailableWindows.length>0&&<p>Los horarios bloqueados se superponen con otra cita confirmada (ventana de ±{availability.conflictWindowMinutes} minutos). La confirmación depende de la disponibilidad de ambas personas.</p>}
    <button className="login-button login-outlined" disabled={selected.length>=3||!candidate||!!reason(date,hour,minute)} onClick={()=>{if(!candidate)return;const message=validateSlots([...selected,candidate],now,availability);setError(message);if(!message)onChange([...selected,candidate]);}}>Agregar opción</button>
    </fieldset><h4>Opciones elegidas</h4>{!selected.length&&<p>Todavía no agregaste horarios.</p>}<ol>{selected.map((v,i)=><li key={v}>{formatSlot(v)}{validateSlots([v],now,availability)&&<p className="home-error">{validateSlots([v],now,availability)}</p>}<button className="login-button login-outlined" disabled={disabled} onClick={()=>{setError('');onChange(selected.filter((_,index)=>index!==i));}}>Quitar opción {i+1}</button></li>)}</ol>{(error||selected.length>0&&validateSlots(selected,now,availability))&&<p role="alert" className="home-error">{error||validateSlots(selected,now,availability)}</p>}</>;
}
