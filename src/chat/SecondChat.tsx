import { OutgoingMessage } from './OutgoingMessage';
import { useChatDraftHeight, useChatViewport } from './useChatViewport';
import { activityId } from '../notifications/activityPolicy';
import { usePresentedActivity } from '../notifications/usePresentedActivity';
import type { HomeNavigation } from '../home/useHomeNavigation';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ComponentProps } from 'react';
import type { SessionController } from '../auth/session';
import { SecondChatSession, type SecondChatEntryIntent } from './SecondChatSession';
import { secondPresentation } from './secondContracts';
import { plainText, type Message } from './contracts';
import { AudioComposer } from './AudioComposer';
import { MessageAudio } from './MessageAudio';
import { ReplySwipe } from './ReplySwipe';
import { ReplyQuote, replyPreview } from './ReplyQuote';
import { ReactionLane } from './ReactionLane';
import { ChatMenu, ConfirmDialog, ConfirmDialogActions, submitChatOnEnter, TextSendButton } from './ChatControls';
import { ChatIcon } from './ChatIcon';
import { SecondChatSkeleton } from './SecondChatSkeleton';
import { useStartupDestination } from '../SessionLoading';
import './chat.css';
const endedCopy: Record<string,string> = {
  SECOND_CHAT_MUTUAL_COMPLETION: 'Finalizaron el chat de común acuerdo.', SECOND_CHAT_PARTNER_INACTIVITY: 'El chat terminó por falta de respuesta.',
  SECOND_CHAT_NO_CONVERSATION_STARTED: 'El chat terminó porque no comenzaron a conversar.', SECOND_CHAT_NO_SHOW: 'La otra persona no se presentó.',
  SECOND_CHAT_ABSOLUTE_TIMEOUT: 'Terminó el tiempo del segundo chat.',
};
function ResolutionDialog({ kind, partner, ...actions }: { kind: 'completion' | 'inactivity'; partner: string | undefined } & Pick<ComponentProps<typeof ConfirmDialogActions>, 'busy' | 'disabled' | 'feedback' | 'pendingLabel' | 'close' | 'confirm'>) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); },[]);
  return <dialog className="chat-confirm-dialog" ref={ref} aria-labelledby="second-resolution-title" onCancel={e => { e.preventDefault(); if (!actions.busy) actions.close(); }}>
    <h3 id="second-resolution-title">{kind === 'completion' ? 'Finalizar de común acuerdo' : 'Reclamar falta de respuesta'}</h3>
    <p>{partner || 'La otra persona'} tendrá un minuto para {kind === 'completion' ? 'confirmar. Pueden seguir conversando. Si alguien envía un mensaje, la solicitud se cancela.' : 'responder. Si alguien envía un nuevo mensaje, el reclamo se cancela.'}</p>
    <ConfirmDialogActions {...actions} backLabel="Cancelar" label={kind === 'completion' ? 'Enviar solicitud' : 'Enviar reclamo'}/>
  </dialog>;
}
export function SecondChat({ controller, connectionId, matchId, onHome, navigation, entryIntent, partnerName, restoredSession }: { controller: SessionController; connectionId: string; matchId: string; onHome: (message?: string) => void; navigation?: HomeNavigation; entryIntent?: SecondChatEntryIntent | undefined; partnerName?: string | null | undefined; restoredSession?: SecondChatSession | undefined }) {
  const identity = useSyncExternalStore(controller.subscribe,controller.getSnapshot);
  const [owner] = useState(() => ({ id: identity.account?.id, controller }));
  if (identity.phase !== 'ready' || identity.account?.id !== owner.id || controller !== owner.controller) return null;
  return <SecondChatView key={JSON.stringify([connectionId,matchId])} controller={controller} connectionId={connectionId} matchId={matchId} onHome={onHome} entryIntent={entryIntent} partnerName={partnerName} restoredSession={restoredSession} {...(navigation ? { navigation } : {})}/>;
}
function SecondChatView({ controller, connectionId, matchId, onHome, navigation, entryIntent, partnerName, restoredSession }: { controller: SessionController; connectionId: string; matchId: string; onHome: (message?: string) => void; navigation?: HomeNavigation; entryIntent?: SecondChatEntryIntent | undefined; partnerName?: string | null | undefined; restoredSession?: SecondChatSession | undefined }) {
  const [session] = useState(() => restoredSession ?? new SecondChatSession(controller,connectionId,matchId,controller.snapshot.account?.id ?? '',partnerName));
  const state = useSyncExternalStore(session.subscribe,session.getSnapshot);
  const [,tick] = useState(0), [draft,setDraft] = useState(''), [reply,setReply] = useState<NonNullable<Message['replyTo']> | null>(null);
  const [audioDirty,setAudioDirty] = useState(false), [audioEpoch,setAudioEpoch] = useState(0), [dialog,setDialog] = useState<'completion' | 'inactivity' | 'safety' | 'block' | null>(null);
  const [unseen,setUnseen] = useState(false), [coachmark,setCoachmark] = useState(false);
  const coach = useRef<{ previous: boolean | null; shown: boolean }>({ previous: null, shown: false });
  const root = useRef<HTMLElement>(null), observedHeight = useRef(0), timeline = useRef<HTMLOListElement>(null), atBottom = useRef(true), input = useRef<HTMLTextAreaElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const composing = useRef(false);
  const lease = useRef(0);
  // StrictMode replay must not dispose the freshly verified restoration snapshot.
  // A real unmount retires the session in the next microtask; listeners/timers stop now.
  useEffect(() => {
    const epoch = ++lease.current;
    session.start();
    // Defer until setup survives StrictMode cleanup, before consuming the one-shot intent.
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) { if (entryIntent) void session.openFromUserAction(entryIntent); else if (!restoredSession || !session.getSnapshot().status) void session.refresh(); } });
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void session.poll(); },2500);
    const clock = window.setInterval(() => tick(v => v+1),500);
    const resume = () => { session.invalidateForeground(); if (document.visibilityState === 'visible') void session.resume(); };
    window.addEventListener('online',resume); document.addEventListener('visibilitychange',resume);
    return () => { cancelled = true; clearInterval(timer); clearInterval(clock); window.removeEventListener('online',resume); document.removeEventListener('visibilitychange',resume); queueMicrotask(() => { if (lease.current === epoch) session.dispose(); }); };
  },[session]);
  const s = state.status, p = session.rules, now = session.now;
  const presentation = secondPresentation(s,now);
  const loading = !state.returnHome && !state.error && presentation !== 'terminal-unavailable' && !(p.active && p.expired) &&
    (!s || state.entryPending || (p.readable && !state.historyReady));
  const starting = useStartupDestination(!loading);
  const historyVisible = p.readable && state.historyReady && !state.returnHome && !loading;
  const headingFocused = useRef(false);
  useLayoutEffect(() => {
    if (!starting && !loading && !headingFocused.current && heading.current) {
      headingFocused.current = true;
      heading.current.focus({ preventScroll: true });
    }
  },[loading, starting]);
  usePresentedActivity(root, p.active && historyVisible ? activityId('SECOND_CHAT_AVAILABLE', connectionId, s?.scheduledAt) : null);
  const writable = p.writable && !state.blocked, ordinary = writable && !state.busy && !state.outgoing && !audioDirty;
  const textEnabled = session.canSendText && session.replyAvailable(reply) && !audioDirty;
  const canHome = session.canReturnHome;
  const home = () => { if (!session.canReturnHome) return; if ((draft || audioDirty || state.outgoing) && !window.confirm('Hay un borrador o envío pendiente. ¿Querés salir y descartarlo?')) return; onHome(); };
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => { if (!session.canReturnHome || draft || audioDirty || state.outgoing || state.busy) e.preventDefault(); };
    window.addEventListener('beforeunload',unload);
    return () => { window.removeEventListener('beforeunload',unload); };
  });
  const exitPolicy = useRef<{ canLeave: () => boolean; leave: () => void }>({ canLeave: () => false, leave: () => {} });
  exitPolicy.current = { canLeave: () => session.canReturnHome && (!(draft || audioDirty || state.outgoing) || window.confirm('Hay un borrador o env\u00edo pendiente. \u00bfQuer\u00e9s salir y descartarlo?')), leave: () => onHome() };
  const register = navigation?.registerSecondChat;
  useLayoutEffect(() => register?.({ canLeave: () => exitPolicy.current.canLeave(), leave: () => exitPolicy.current.leave() }),[register]);
  const returned = useRef(false);
  useEffect(() => { if (state.returnHome && !returned.current) { returned.current = true; onHome(state.returnHome); } },[state.returnHome,onHome]);
  useEffect(() => {
    if (presentation === 'terminal-unavailable' && !state.busy && !returned.current) { returned.current = true; onHome('Este segundo chat ya no est\u00e1 disponible.'); }
  },[presentation,state.busy,onHome]);
  useEffect(() => { session.checkAbsoluteExpiry(); },[session,now,state.busy]);
  useEffect(() => {
    if (state.audioAccess === 'RESTRICTED' && !state.outgoing && reply?.type === 'MESSAGE' && reply.messageType === 'AUDIO' && reply.senderId !== session.me) setReply(null);
  }, [state.audioAccess, state.outgoing, reply, session]);
  const draftRevision = useRef(0), submittedRevision = useRef(-1);
  const submittedReply = useRef(reply);
  const sendText = () => {
    const task = session.send(draft, reply ? { type: reply.type, targetId: reply.targetId } : null);
    if (task) {
      submittedRevision.current = draftRevision.current;
      submittedReply.current = reply;
      setDraft('');
    }
  };
  useLayoutEffect(() => {
    const outgoing = state.outgoing;
    if (outgoing?.content && outgoing.phase !== 'pending' && submittedRevision.current === draftRevision.current) {
      setDraft(outgoing.content);
    }
  }, [state.outgoing]);
  useLayoutEffect(() => {
    if (!state.confirmationVersion) return;
    if (submittedRevision.current === draftRevision.current) setDraft('');
    if (submittedReply.current === reply) setReply(null);
  }, [state.confirmationVersion]);
  useEffect(() => { if (!historyVisible) return; const c = coach.current; if (!c.shown && c.previous === false && p.completion) { c.shown = true; setCoachmark(true); } c.previous = p.completion; },[historyVisible,p.completion]);
  useLayoutEffect(() => { const list = timeline.current; if (list && atBottom.current) list.scrollTop = list.scrollHeight; else if (list) setUnseen(true); },[state.messages.length + Number(!!state.outgoing),historyVisible]);
  const { attach: setInput, resize: resizeInput } = useChatDraftHeight(input, draft);
  useChatViewport(root, timeline, atBottom, observedHeight, historyVisible, resizeInput);
  const partner = state.partnerName?.trim();
  // Temporary write gates keep the active compose draft mounted. Ending the
  // conversation releases local media; the session owns delivery reconciliation.
  useEffect(() => { if (!p.active || p.expired) setAudioDirty(false); },[p.active,p.expired]);
  const boundaryKey = useRef('');
  useEffect(() => {
    if (!s) return;
    const deadlines = [s.absoluteExpiresAt,s.entryClosesAt,s.readOnlyUntil,s.activeResolutionRequest?.expiresAt,s.activeNoShowClaim?.expiresAt,s.inactivityClosesAt,s.mutualCompletionCooldownUntil];
    const key = deadlines.filter((value): value is string => !!value && now >= Date.parse(value)).join('|');
    if (key !== boundaryKey.current) { boundaryKey.current = key; if (key) void session.refresh(); }
  },[s,now,session]);
  const request = p.pending ?? p.claim, seconds = (time: string) => Math.max(0,Math.ceil((Date.parse(time)-now)/1000));
  const me = session.me, eligible = session.eligible;
  const safety = p.active && !p.expired && !state.busy;
  const openSafety = async (kind: 'safety' | 'block') => { if (await session.prepareSafety()) setDialog(kind); };
  const shownDialog = p.active && !p.expired && !state.returnHome ? dialog : null;
  useEffect(() => { if (!shownDialog && dialog) setDialog(null); },[shownDialog,dialog]);
  const error = state.error && <p role="alert">{state.error} {state.diagnostic && <small>Referencia: second-chat/{state.diagnostic.stage}/{state.diagnostic.kind}/{state.diagnostic.httpStatus}</small>} <button type="button" disabled={state.busy} onClick={() => void session.refresh(true)}>Reintentar conexión</button></p>;
  const confirmAction = (kind: NonNullable<typeof dialog>, body?: unknown) => {
    const action = session.action(kind,body);
    if (action) void action.then(() => { if (!session.getSnapshot().error) setDialog(null); });
  };
  if (state.returnHome) return null;
  if (loading) return <SecondChatSkeleton/>;
  return <section ref={root} className="first-chat second-chat" aria-label="Segundo chat">
    <div className="chat-chrome">
    <header className="chat-heading"><div><h2 ref={heading} tabIndex={-1}>{state.partnerName || 'Segundo chat'}</h2></div>{historyVisible && p.active && !p.expired && <ChatMenu decisionOnly={false} actions={[
      ...(p.completion ? [{ label: 'Finalizar de común acuerdo', disabled: !ordinary, run: () => setDialog('completion') }] : []),
      { label: 'Reportar por seguridad', disabled: !safety, run: () => { void openSafety('safety'); } }, { label: 'Bloquear', disabled: !safety, run: () => { void openSafety('block'); } },
    ]}/>}</header>
    {state.pendingAction === 'prepare-safety' && <p role="status">Verificando el estado del chat…</p>}
    {canHome && <button onClick={home}>Volver a Inicio</button>}
    {state.notice && <p role="status">{state.notice}</p>}
    {!shownDialog && error}
    {coachmark && <aside className="chat-panel">Ya podés proponer finalizar de común acuerdo desde las opciones del chat. <button onClick={() => setCoachmark(false)}>Entendido</button></aside>}
    {s && presentation === 'pre-entry' && <aside className="chat-panel"><h3>{now < Date.parse(s.scheduledAt) ? 'Todavía no está disponible' : now >= Date.parse(s.entryClosesAt) ? 'Segundo chat vencido' : 'Entrada al segundo chat'}</h3><p>{now < Date.parse(s.scheduledAt) ? `El segundo chat abre a las ${new Date(s.scheduledAt).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}.` : now >= Date.parse(s.entryClosesAt) ? 'La ventana para entrar terminó.' : 'Entrar registra tu asistencia.'}</p>{p.canJoin && <button disabled={state.busy || state.blocked} onClick={() => void session.join()}>Entrar al segundo chat</button>}</aside>}
    {s && historyVisible && presentation === 'waiting' && <aside className="chat-panel"><h3>Esperando a {partner || 'la otra persona'}</h3>{s.myAttendanceStatus === 'LATE' && <p>Llegaste tarde.</p>}<p>Podés mandar mensajes mientras esperás.</p>{p.noShow && <button disabled={!ordinary} onClick={() => void session.action('no-show')}>{partner || 'La otra persona'} no se presentó</button>}{state.pendingAction === 'no-show' && <p role="status">Enviando reclamo…</p>}{p.cutoff && <p>La ventana para entrar terminó. Podés volver a Inicio.</p>}</aside>}
    {historyVisible && request && <aside className="chat-panel"><h3>{request.type === 'MUTUAL_COMPLETION' ? request.requesterUserId === me ? 'Cierre propuesto' : 'Te propusieron finalizar' : request.type === 'PARTNER_INACTIVITY' ? request.responderUserId === me ? 'Respondé para mantener el chat' : 'Reclamo por falta de respuesta' : 'Reclamo por ausencia pendiente'}</h3><p>{seconds(request.expiresAt) ? `Quedan ${seconds(request.expiresAt)}s.` : 'La solicitud venció. Actualizando estado…'}</p>{request.type !== 'PARTNER_NO_SHOW' && <p>Pueden seguir conversando; un nuevo mensaje cancela la solicitud.</p>}{request.type === 'MUTUAL_COMPLETION' && request.responderUserId === me && <><button disabled={!ordinary || !seconds(request.expiresAt)} onClick={() => void session.action('ACCEPTED')}>Finalizar el chat</button><button disabled={!ordinary || !seconds(request.expiresAt)} onClick={() => void session.action('REJECTED')}>Seguir conversando</button>{(state.pendingAction === 'ACCEPTED' || state.pendingAction === 'REJECTED') && <p role="status">{state.pendingAction === 'ACCEPTED' ? 'Finalizando el chat…' : 'Enviando respuesta…'}</p>}</>}</aside>}
    {historyVisible && p.inactivity && <button disabled={!ordinary} onClick={() => setDialog('inactivity')}>{partner || 'La otra persona'} no respondió</button>}
    {s?.mutualCompletionCooldownUntil && <p>Podrás volver a proponer el cierre en unos segundos.</p>}
    {s && p.active && seconds(s.absoluteExpiresAt) <= 600 && <p role="status">{p.expired ? 'El plazo local terminó. Actualizando el estado del servidor…' : `El segundo chat termina en ${Math.ceil(seconds(s.absoluteExpiresAt)/60)} minutos.`}</p>}
    {s && (presentation === 'terminal-readable' || presentation === 'terminal-unavailable') && <aside className="chat-panel"><p>{endedCopy[s.endedReason ?? ''] ?? 'Este segundo chat ya no está activo.'}</p>{p.readable && s.readOnlyUntil && <p>Podés leerlo hasta {new Date(s.readOnlyUntil).toLocaleString('es-AR')}.</p>}{!p.readable && <p>El segundo chat no está disponible para lectura.</p>}</aside>}
    {presentation === 'unavailable' && <aside className="chat-panel"><p>No se puede entrar en este momento. La ventana de entrada puede haber terminado.</p></aside>}
    {historyVisible && state.historyLimited && <p>El historial visible puede estar limitado por el servidor.</p>}
    </div>
    {historyVisible && <div className="chat-history"><ol className={`chat-timeline${presentation === 'terminal-readable' ? ' chat-timeline-retained' : ''}`} aria-label="Mensajes" ref={timeline} onScroll={() => { const l = timeline.current; if (l && (observedHeight.current === 0 || observedHeight.current === l.clientHeight)) { atBottom.current = l.scrollHeight-l.scrollTop-l.clientHeight < 100; if (atBottom.current) setUnseen(false); } }}>
      {state.messages.map((m, index, messages) => <li key={m.id} className={`chat-message-row ${m.senderId === me ? 'outgoing' : 'incoming'}${messages[index - 1]?.senderId === m.senderId ? ' chat-message-continuation' : ''}`}><ReplySwipe enabled={textEnabled && m.senderId !== me} label={partner ? `Responder mensaje de ${partner}` : 'Responder mensaje'} onReply={() => { setReply({ type:'MESSAGE',targetId:m.id,previewText:m.messageType === 'AUDIO' ? 'Mensaje de audio' : m.content,senderId:m.senderId,messageType:m.messageType }); input.current?.focus({ preventScroll: true }); }}><article className={`chat-message ${m.senderId === me ? 'outgoing' : 'incoming'}`}>
      {m.replyTo && <blockquote className="chat-quote"><ReplyQuote {...replyPreview(m.replyTo,me,state.partnerId,state.partnerName)}/></blockquote>}
      {m.messageType === 'AUDIO' && m.audio ? <MessageAudio source={m.audio.url} durationMillis={m.audio.durationMillis} refresh={() => session.renewAudio(m.id)}/> : <p>{m.content ?? 'Mensaje no compatible.'}</p>}<time dateTime={m.sentAt}>{new Date(m.sentAt).toLocaleTimeString('es-AR',{hour:'2-digit',minute:'2-digit'})}</time></article></ReplySwipe>
      {m.senderId === me ? m.reactionType && <span className="chat-received-heart" role="img" aria-label={(partner || 'La otra persona') + ' reaccionó con corazón'}><ChatIcon name="heart"/></span> : <ReactionLane pending={state.pendingReaction === m.id} confirmed={m.reactionType === 'HEART'} eligible={p.writable && eligible.has(m.id)} disabled={!ordinary} react={() => session.react(m.id)}/>}</li>)}
      {state.outgoing && p.active && !p.expired && <OutgoingMessage message={state.outgoing} continuation={state.messages.at(-1)?.senderId === me} quote={reply && state.outgoing.replyTo?.targetId === reply.targetId ? replyPreview(reply,me,state.partnerId,partner) : null}>{state.outgoing.phase !== 'pending' && <button disabled={state.busy || !p.writable || state.retryBlocked} onClick={() => void session.retry()}>Reconciliar y reintentar el mismo envío</button>}{state.outgoing.phase === 'failed' && <button disabled={state.busy} onClick={() => { session.discardFailed(); setAudioEpoch(v => v+1); setAudioDirty(false); }}>Descartar envío fallido</button>}</OutgoingMessage>}
    </ol>{unseen && <button className="chat-new-messages" onClick={() => { const l = timeline.current; if (l) l.scrollTop=l.scrollHeight; atBottom.current=true; setUnseen(false); }}>Ver mensajes nuevos</button>}</div>}
    {historyVisible && p.active && <form hidden={!p.writable} className="chat-composer" onSubmit={e => { e.preventDefault(); if (textEnabled && !composing.current && plainText(draft)) sendText(); }}>
      {reply && <aside className="chat-reply-preview" aria-label="Respuesta seleccionada"><ReplyQuote {...replyPreview(reply,me,state.partnerId,state.partnerName)}/><button type="button" className="chat-icon-button" aria-label="Quitar respuesta" disabled={!!state.outgoing} onClick={() => setReply(null)}><ChatIcon name="close"/></button></aside>}
      <AudioComposer key={audioEpoch} textDraft={input} policy={s?.audioPolicy ?? null} disabled={!writable || state.busy || !!state.outgoing || dialog !== null} payloadLocked={!!state.outgoing} confirmedFile={state.confirmed?.file ?? null} textConfirmationVersion={state.confirmed?.file === null ? state.confirmationVersion : 0} onDirtyChange={setAudioDirty} onSend={file => { submittedRevision.current = -1; submittedReply.current = reply; return session.send('',reply ? {type:'MESSAGE',targetId:reply.targetId} : null,file); }}>{microphone => <div className="chat-composer-row"><label className="chat-visually-hidden" htmlFor="second-draft">Mensaje</label><textarea ref={setInput} id="second-draft" placeholder="Mensaje" rows={1} maxLength={1000} value={draft} disabled={audioDirty} onChange={e => { draftRevision.current++; setDraft(e.target.value); }}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onBlur={() => { composing.current = false; }}
        onKeyDown={event => submitChatOnEnter(event, composing.current, textEnabled && plainText(draft))}/>{microphone}<TextSendButton draft={input} className="chat-icon-button chat-send" disabled={!textEnabled || !plainText(draft)}><ChatIcon name="send"/></TextSendButton></div>}</AudioComposer>
    </form>}
    {(shownDialog === 'safety' || shownDialog === 'block') && <ConfirmDialog kind={shownDialog} busy={state.busy} pending={state.pendingAction === shownDialog} disabled={state.blocked} feedback={error} close={() => setDialog(null)} confirm={body => confirmAction(shownDialog,body)}/>}
    {(shownDialog === 'completion' || shownDialog === 'inactivity') && <ResolutionDialog partner={partner} kind={shownDialog} busy={state.busy} disabled={state.blocked || !p[shownDialog]} feedback={error} pendingLabel={state.pendingAction === shownDialog ? shownDialog === 'completion' ? 'Enviando solicitud…' : 'Enviando reclamo…' : undefined} close={() => setDialog(null)} confirm={() => confirmAction(shownDialog)}/>}
  </section>;
}
