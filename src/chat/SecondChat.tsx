import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SessionController } from '../auth/session';
import { SecondChatSession } from './SecondChatSession';
import { joined } from './secondContracts';
import { plainText, reactable, type Message } from './contracts';
import { AudioComposer } from './AudioComposer';
import { MessageAudio } from './MessageAudio';
import { ReplySwipe } from './ReplySwipe';
import { ReplyQuote, replyPreview } from './ReplyQuote';
import { ReactionLane } from './ReactionLane';
import { ChatMenu, ConfirmDialog } from './ChatControls';
import './chat.css';
const endedCopy: Record<string,string> = {
  SECOND_CHAT_MUTUAL_COMPLETION: 'Finalizaron el chat de común acuerdo.', SECOND_CHAT_PARTNER_INACTIVITY: 'El chat terminó por falta de respuesta.',
  SECOND_CHAT_NO_CONVERSATION_STARTED: 'El chat terminó porque no comenzaron a conversar.', SECOND_CHAT_NO_SHOW: 'La otra persona no se presentó.',
  SECOND_CHAT_ABSOLUTE_TIMEOUT: 'Terminó el tiempo del segundo chat.',
};
function ResolutionDialog({ kind, busy, close, confirm }: { kind: 'completion' | 'inactivity'; busy: boolean; close: () => void; confirm: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); },[]);
  return <dialog ref={ref} aria-labelledby="second-resolution-title" onCancel={e => { if (busy) e.preventDefault(); else close(); }}>
    <h3 id="second-resolution-title">{kind === 'completion' ? 'Finalizar de común acuerdo' : 'Reclamar falta de respuesta'}</h3>
    <p>{kind === 'completion' ? 'La otra persona tendrá un minuto para confirmar. Pueden seguir conversando; si alguien envía un mensaje, la solicitud se cancela.' : 'La otra persona tendrá un minuto para responder. Si alguien envía un nuevo mensaje, el reclamo se cancela.'}</p>
    <button disabled={busy} onClick={close}>Cancelar</button><button disabled={busy} onClick={confirm}>{kind === 'completion' ? 'Enviar solicitud' : 'Enviar reclamo'}</button>
  </dialog>;
}
export function SecondChat({ controller, connectionId, matchId, onHome }: { controller: SessionController; connectionId: string; matchId: string; onHome: (message?: string) => void }) {
  const [session] = useState(() => new SecondChatSession(controller,connectionId,matchId,controller.snapshot.account?.id ?? ''));
  const state = useSyncExternalStore(session.subscribe,session.getSnapshot);
  const [,tick] = useState(0), [draft,setDraft] = useState(''), [reply,setReply] = useState<NonNullable<Message['replyTo']> | null>(null);
  const [audioDirty,setAudioDirty] = useState(false), [audioEpoch,setAudioEpoch] = useState(0), [dialog,setDialog] = useState<'completion' | 'inactivity' | 'safety' | 'block' | null>(null);
  const [unseen,setUnseen] = useState(false), [coachmark,setCoachmark] = useState(false);
  const coach = useRef<{ previous: boolean | null; shown: boolean }>({ previous: null, shown: false });
  const timeline = useRef<HTMLOListElement>(null), atBottom = useRef(true), input = useRef<HTMLTextAreaElement>(null), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    session.start(); void session.refresh(); heading.current?.focus();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void session.refresh(false,true); },2500);
    const clock = window.setInterval(() => tick(v => v+1),500);
    const resume = () => { if (document.visibilityState === 'visible') void session.resume(); };
    window.addEventListener('online',resume); document.addEventListener('visibilitychange',resume);
    return () => { clearInterval(timer); clearInterval(clock); window.removeEventListener('online',resume); document.removeEventListener('visibilitychange',resume); session.dispose(); };
  },[session]);
  const s = state.status, p = session.rules, now = session.now;
  const writable = p.writable && !state.blocked, ordinary = writable && !state.busy && !state.outgoing && !audioDirty;
  const canHome = p.canReturn && !state.busy;
  const home = () => { if (!canHome) return; if ((draft || audioDirty || state.outgoing) && !window.confirm('Hay un borrador o envío pendiente. ¿Querés salir y descartarlo?')) return; onHome(); };
  useEffect(() => {
    const back = () => { if (session.rules.canReturn && !session.getSnapshot().busy) home(); };
    const unload = (e: BeforeUnloadEvent) => { if (!session.rules.canReturn || draft || audioDirty || state.outgoing || state.busy) e.preventDefault(); };
    window.addEventListener('popstate',back); window.addEventListener('beforeunload',unload);
    return () => { window.removeEventListener('popstate',back); window.removeEventListener('beforeunload',unload); };
  });
  useEffect(() => { if (state.confirmed) { setDraft(d => d === state.confirmed?.content ? '' : d); setReply(r => r?.targetId === state.confirmed?.replyTo?.targetId ? null : r); } },[state.confirmationVersion]);
  useEffect(() => { if (!s) return; const c = coach.current; if (!c.shown && c.previous === false && p.completion) { c.shown = true; setCoachmark(true); } c.previous = p.completion; },[s,p.completion]);
  useLayoutEffect(() => { const list = timeline.current; if (list && atBottom.current) list.scrollTop = list.scrollHeight; else if (list) setUnseen(true); },[state.messages.length]);
  useLayoutEffect(() => { const text = input.current; if (text) { text.style.height = 'auto'; text.style.height = `${Math.min(text.scrollHeight,128)}px`; } },[draft]);
  const readable = p.readable;
  // Retention/access withdrawal unmounts playback; stopping the composer releases streams/blobs.
  useEffect(() => { if (s && !p.writable) { setAudioEpoch(v => v+1); setAudioDirty(false); } },[s?.chatStatus,p.writable]);
  const boundaryKey = useRef('');
  useEffect(() => {
    if (!s) return;
    const deadlines = [s.absoluteExpiresAt,s.entryClosesAt,s.readOnlyUntil,s.activeResolutionRequest?.expiresAt,s.activeNoShowClaim?.expiresAt,s.inactivityClosesAt,s.mutualCompletionCooldownUntil];
    const key = deadlines.filter((value): value is string => !!value && now >= Date.parse(value)).join('|');
    if (key !== boundaryKey.current) { boundaryKey.current = key; if (key) void session.refresh(); }
  },[s,now,session]);
  const request = p.pending ?? p.claim, seconds = (time: string) => Math.max(0,Math.ceil((Date.parse(time)-now)/1000));
  const me = session.me, eligible = reactable(state.messages,me);
  const safety = p.active && !p.expired && !state.busy && !state.blocked && !state.outgoing;
  const openSafety = (kind: 'safety' | 'block') => { setAudioEpoch(v => v+1); setAudioDirty(false); setDialog(kind); };
  return <section className="first-chat second-chat" aria-label="Segundo chat">
    <header className="chat-heading"><div><p className="chat-phase">SEGUNDO CHAT</p><h2 ref={heading} tabIndex={-1}>{state.partnerName || 'Segundo chat'}</h2></div><ChatMenu decisionOnly={false} actions={[
      ...(p.completion ? [{ label: 'Finalizar de común acuerdo', disabled: !ordinary, run: () => setDialog('completion') }] : []),
      { label: 'Reportar por seguridad', disabled: !safety, run: () => openSafety('safety') }, { label: 'Bloquear', disabled: !safety, run: () => openSafety('block') },
    ]}/></header>
    {canHome && <button onClick={home}>Volver a Inicio</button>}
    {!s && <p role="status">Cargando el segundo chat…</p>}
    {state.busy && <p role="status">Procesando…</p>}
    {state.error && <p role="alert">{state.error} <button disabled={state.busy} onClick={() => void session.refresh(true)}>Reintentar conexión</button></p>}
    {coachmark && <aside className="chat-panel">Ya podés proponer finalizar de común acuerdo desde las opciones del chat. <button onClick={() => setCoachmark(false)}>Entendido</button></aside>}
    {s && !joined(s.myAttendanceStatus) && <aside className="chat-panel"><h3>{now < Date.parse(s.scheduledAt) ? 'Todavía no está disponible' : now >= Date.parse(s.entryClosesAt) ? 'Segundo chat vencido' : 'Entrada al segundo chat'}</h3><p>{now < Date.parse(s.scheduledAt) ? `El segundo chat abre a las ${new Date(s.scheduledAt).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}.` : now >= Date.parse(s.entryClosesAt) ? 'La ventana para entrar terminó.' : 'Entrar registra tu asistencia.'}</p>{p.canJoin && <button disabled={state.busy || state.blocked} onClick={() => void session.join()}>Entrar al segundo chat</button>}</aside>}
    {s && p.active && !joined(s.partnerAttendanceStatus) && <aside className="chat-panel"><h3>Esperando a {state.partnerName || 'la otra persona'}</h3><p>{s.myAttendanceStatus === 'LATE' ? 'Llegaste tarde.' : 'Llegaste a tiempo.'}</p><p>Podés mandar mensajes mientras esperás. Eso no significa que la otra persona haya llegado.</p>{p.noShow && <button disabled={!ordinary} onClick={() => void session.action('no-show')}>{state.partnerName || 'La otra persona'} no se presentó</button>}{p.cutoff && <p>La ventana para entrar terminó. Podés volver a Inicio.</p>}</aside>}
    {request && <aside className="chat-panel"><h3>{request.type === 'MUTUAL_COMPLETION' ? request.requesterUserId === me ? 'Cierre propuesto' : 'Te propusieron finalizar' : request.type === 'PARTNER_INACTIVITY' ? request.responderUserId === me ? 'Respondé para mantener el chat' : 'Reclamo por falta de respuesta' : 'Reclamo por ausencia pendiente'}</h3><p>{seconds(request.expiresAt) ? `Quedan ${seconds(request.expiresAt)}s.` : 'La solicitud venció. Actualizando estado…'}</p>{request.type !== 'PARTNER_NO_SHOW' && <p>Pueden seguir conversando; un nuevo mensaje cancela la solicitud.</p>}{request.type === 'MUTUAL_COMPLETION' && request.responderUserId === me && <><button disabled={!ordinary || !seconds(request.expiresAt)} onClick={() => void session.action('ACCEPTED')}>Finalizar el chat</button><button disabled={!ordinary || !seconds(request.expiresAt)} onClick={() => void session.action('REJECTED')}>Seguir conversando</button></>}</aside>}
    {p.inactivity && <button disabled={!ordinary} onClick={() => setDialog('inactivity')}>La otra persona no respondió</button>}
    {s?.mutualCompletionCooldownUntil && <p>Podrás volver a proponer el cierre en unos segundos.</p>}
    {s && p.active && seconds(s.absoluteExpiresAt) <= 600 && <p role="status">{p.expired ? 'El plazo local terminó. Actualizando el estado del servidor…' : `El segundo chat termina en ${Math.ceil(seconds(s.absoluteExpiresAt)/60)} minutos.`}</p>}
    {s && !p.active && <aside className="chat-panel"><p>{endedCopy[s.endedReason ?? ''] ?? 'Este segundo chat ya no está activo.'}</p>{readable && s.readOnlyUntil && <p>Podés leerlo hasta {new Date(s.readOnlyUntil).toLocaleString('es-AR')}.</p>}{!readable && <p>El segundo chat no está disponible para lectura.</p>}</aside>}
    {readable && <>{state.historyLimited && <p>El historial visible puede estar limitado por el servidor.</p>}<ol className="chat-timeline" aria-label="Mensajes" ref={timeline} onScroll={() => { const l = timeline.current; if (l) { atBottom.current = l.scrollHeight-l.scrollTop-l.clientHeight < 100; if (atBottom.current) setUnseen(false); } }}>
      {state.messages.map(m => <li key={m.id} className={`chat-message-row ${m.senderId === me ? 'outgoing' : 'incoming'}`}><ReplySwipe enabled={ordinary && m.senderId !== me} label={`Responder mensaje de ${state.partnerName}`} onReply={() => { setReply({ type:'MESSAGE',targetId:m.id,previewText:m.messageType === 'AUDIO' ? 'Mensaje de audio' : m.content,senderId:m.senderId,messageType:m.messageType }); input.current?.focus(); }}><article className={`chat-message ${m.senderId === me ? 'outgoing' : 'incoming'}`}>
      {m.replyTo && <blockquote className="chat-quote"><ReplyQuote {...replyPreview(m.replyTo,me,state.partnerId,state.partnerName)}/></blockquote>}
      {m.messageType === 'AUDIO' && m.audio ? <MessageAudio source={m.audio.url} durationMillis={m.audio.durationMillis} refresh={async () => { await session.refresh(true); return session.rules.readable && !session.getSnapshot().blocked ? session.getSnapshot().messages.find(v => v.id === m.id)?.audio?.url ?? null : null; }}/> : <p>{m.content ?? 'Mensaje no compatible.'}</p>}<time dateTime={m.sentAt}>{new Date(m.sentAt).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}</time></article></ReplySwipe>
      {m.senderId === me ? m.reactionType && <span role="img" aria-label="La otra persona reaccionó con corazón">♥</span> : <ReactionLane confirmed={m.reactionType === 'HEART'} eligible={eligible.has(m.id)} disabled={!ordinary} react={() => session.react(m.id)}/>}</li>)}
      {state.outgoing && <li className="chat-message outgoing"><p>{state.outgoing.content ?? 'Audio pendiente'}</p><p role="status">{state.outgoing.phase === 'pending' ? 'Enviando…' : state.outgoing.phase === 'uncertain' ? 'Sin confirmar' : 'Falló el envío'}</p>{state.outgoing.phase !== 'pending' && <button disabled={state.busy || !p.writable || state.retryBlocked} onClick={() => void session.retry()}>Reconciliar y reintentar el mismo envío</button>}{state.outgoing.phase === 'failed' && <button disabled={state.busy} onClick={() => { session.discardFailed(); setAudioEpoch(v => v+1); setAudioDirty(false); }}>Descartar env?o fallido</button>}</li>}
    </ol>{unseen && <button onClick={() => { const l = timeline.current; if (l) l.scrollTop=l.scrollHeight; atBottom.current=true; setUnseen(false); }}>Ver mensajes nuevos</button>}</>}
    {p.writable && <form className="chat-composer" onSubmit={e => { e.preventDefault(); if (ordinary) void session.send(draft,reply ? {type:'MESSAGE',targetId:reply.targetId} : null); }}>
      {reply && <aside className="chat-reply-preview"><ReplyQuote {...replyPreview(reply,me,state.partnerId,state.partnerName)}/><button type="button" disabled={!!state.outgoing} onClick={() => setReply(null)}>Quitar respuesta</button></aside>}
      <AudioComposer key={audioEpoch} policy={s?.audioPolicy ?? null} disabled={!writable || state.busy || !!state.outgoing || dialog !== null} payloadLocked={!!state.outgoing} confirmedFile={state.confirmed?.file ?? null} delivery={state.outgoing?.file ? state.outgoing.phase : null} textConfirmationVersion={state.confirmed?.file === null ? state.confirmationVersion : 0} onRetry={session.retry} onDirtyChange={setAudioDirty} onSend={file => session.send('',reply ? {type:'MESSAGE',targetId:reply.targetId} : null,file)}>{microphone => <div className="chat-composer-row"><label className="chat-visually-hidden" htmlFor="second-draft">Mensaje</label><textarea ref={input} id="second-draft" placeholder="Mensaje" rows={1} maxLength={1000} value={draft} disabled={!writable || audioDirty} onChange={e => setDraft(e.target.value)}/>{microphone}<button disabled={!ordinary || !plainText(draft)}>Enviar mensaje</button></div>}</AudioComposer>
    </form>}
    {(dialog === 'safety' || dialog === 'block') && <ConfirmDialog kind={dialog} busy={state.busy} close={() => setDialog(null)} confirm={body => { void session.action(dialog,body)?.then(() => setDialog(null)); }}/>}
    {(dialog === 'completion' || dialog === 'inactivity') && <ResolutionDialog kind={dialog} busy={state.busy} close={() => setDialog(null)} confirm={() => { void session.action(dialog)?.then(() => setDialog(null)); }}/>}
  </section>;
}
