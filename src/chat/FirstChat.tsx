import { useChatDraftHeight, useChatViewport } from './useChatViewport';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useStartupDestination } from '../SessionLoading';
import type { SessionController } from '../auth/session';
import { ChatSession } from './ChatSession';
import { plainText, policy } from './contracts';
import type { Message } from './contracts';
import { MessageAudio } from './MessageAudio';
import { AudioComposer } from './AudioComposer';
import './chat.css';
import { ReplySwipe } from './ReplySwipe';
import { ReactionLane } from './ReactionLane';
import { ChatIcon } from './ChatIcon';
import { replyPreview, ReplyQuote } from './ReplyQuote';

import { ConfirmDialog, ChatMenu, submitChatOnEnter, TextSendButton } from './ChatControls';
import { activityId } from '../notifications/activityPolicy';
import { usePresentedActivity } from '../notifications/usePresentedActivity';
import { SharedContactIndicator } from './SharedContactIndicator';
type DialogAction = 'mutual' | 'cancel' | 'safety' | 'block';
export function FirstChat({ controller, matchId, chatId, onHome }: { controller: SessionController; matchId: string; chatId: string; onHome: (message?: string, closed?: boolean) => void }) {
  const dirty = useRef(false), knownClosed = useRef(false), terminalMessage = useRef('');
  const [terminalNotice,setTerminalNotice] = useState(''), [audioDirty,setAudioDirty] = useState(false), [audioEpoch,setAudioEpoch] = useState(0);
  const [session] = useState(() => new ChatSession(controller,matchId,chatId,controller.snapshot.account?.id ?? '',(message, closed) => { knownClosed.current = closed; terminalMessage.current = message; if (dirty.current) setTerminalNotice(message + ' Conservamos tu borrador hasta que vuelvas a Inicio.'); else onHome(message,closed); }));
  const state = useSyncExternalStore(session.subscribe,session.getSnapshot);
  const starting = useStartupDestination(!!state.chat || !!state.error);
  const [draft,setDraft] = useState(''), [reply,setReply] = useState<NonNullable<Message['replyTo']> | null>(null), [dialog,setDialog] = useState<DialogAction | null>(null), [now,setNow] = useState(Date.now()), [unseen,setUnseen] = useState(false);
  const root = useRef<HTMLElement>(null), timeline = useRef<HTMLOListElement>(null), nearBottom = useRef(true), text = useRef<HTMLTextAreaElement>(null), heading = useRef<HTMLHeadingElement>(null);
  const composing = useRef(false), observedHeight = useRef(0);
  const { attach: setText, resize: resizeInput } = useChatDraftHeight(text, draft);
  useChatViewport(root, timeline, nearBottom, observedHeight, true, resizeInput);
  useEffect(() => {
    const owner = controller.sessionSignal;
    session.start();
    const retire = () => session.dispose();
    if (owner?.aborted) { retire(); return; }
    owner?.addEventListener('abort', retire, { once: true });
    void session.refresh();
    const timer = window.setInterval(() => { setNow(Date.now()); if (document.visibilityState === 'visible') void session.refresh(false,true); },5000);
    const tick = window.setInterval(() => { setNow(Date.now()); if (document.visibilityState === 'visible') void session.checkExitTimeout(); },1000);
    const resume = () => { if (document.visibilityState === 'visible') void session.resume(); else session.concealContacts(); };
    window.addEventListener('pagehide', session.concealContacts); document.addEventListener('visibilitychange',resume); window.addEventListener('online',resume);
    return () => { owner?.removeEventListener('abort', retire); session.dispose(); clearInterval(timer); clearInterval(tick); window.removeEventListener('pagehide', session.concealContacts); document.removeEventListener('visibilitychange',resume); window.removeEventListener('online',resume); };
  }, [session, controller]);
  useLayoutEffect(() => { if (!starting) heading.current?.focus(); }, [starting]);
  useEffect(() => {
    if (state.audioAccess === 'RESTRICTED' && !state.outgoing && reply?.type === 'MESSAGE' && reply.messageType === 'AUDIO' && reply.senderId !== session.me) setReply(null);
  }, [state.audioAccess, state.outgoing, reply, session]);
  useEffect(() => { if (state.confirmationVersion > 0) { setDraft(d => d === state.confirmed ? '' : d); setReply(current => current?.type === state.confirmedReply?.type && current?.targetId === state.confirmedReply?.targetId ? null : current); } }, [state.confirmationVersion]);
  useEffect(() => {
    const list = timeline.current;
    if (nearBottom.current && list) { list.scrollTop = list.scrollHeight; setUnseen(false); } else setUnseen(true);
  }, [state.messages.length]);
  useEffect(() => { const warn = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault(); } }; window.addEventListener('beforeunload',warn); return () => window.removeEventListener('beforeunload',warn); }, [draft,state.outgoing]);
  const chat = state.chat, p = policy(chat,state.exits,now+state.offset), me = session.me, eligible = session.eligible, g = chat?.guidance;
  usePresentedActivity(root, chat?.status === 'ACTIVE' && !knownClosed.current ? activityId('FIRST_CHAT', matchId, chatId) : null);
  const partner = chat?.partner.displayName.trim();
  const disabled = state.busy || state.blocked, ordinary = p.ordinary && !disabled && !state.outgoing;
  const decisionPanel=chat?.status==='ACTIVE' && chat.myDecision==='PENDING' && chat.partnerDecision==='APPROVED';
  const decisionTitle=useRef<HTMLHeadingElement>(null);
  const decisionDisabled=disabled || audioDirty || !p.decide || state.outgoing?.phase==='uncertain';
  useEffect(()=>{if(p.decisionOnly && dialog && dialog!=='safety' && dialog!=='block'){setDialog(null);decisionTitle.current?.focus({preventScroll:true});}},[p.decisionOnly,dialog]);
  const canProgressGuidance = !!g && p.ordinary && g.canRequestNext && !g.completed && !g.myNextRequested &&
    (g.progressionAction === 'COMPLETE' || g.progressionAction === 'NEXT_QUESTION' || (g.progressionAction === null && g.questionOrdinal < g.maxQuestions));
  const deadline = chat ? Math.min(Date.parse(chat.timeoutAt), !p.decisionOnly && chat.inactivityExpiresAt ? Date.parse(chat.inactivityExpiresAt) : Infinity) : Infinity;
  const remaining = Math.max(0,Math.ceil((deadline-now-state.offset)/1000));
  const beginReply = (target: Omit<NonNullable<Message['replyTo']>, 'previewText'>, previewText: string) => { setReply({ ...target,previewText }); text.current?.focus({ preventScroll: true }); };
  dirty.current = !!draft || !!state.outgoing || audioDirty;
  const home = () => { if (!dirty.current || window.confirm('Hay un borrador o envío pendiente. ¿Querés salir y descartarlo?')) onHome(terminalMessage.current,knownClosed.current); };
  useEffect(() => {
    // Back changes browser history, never the authoritative conversation lifecycle.
    // Do not push replacement entries: a second Back can leave this document normally.
    const back = () => { if (knownClosed.current) home(); };
    window.addEventListener('popstate',back);
    return () => window.removeEventListener('popstate',back);
  });
  return <section ref={root} className="first-chat" aria-label="Primer chat">
    <div className="chat-chrome">
    <header className="chat-heading chat-heading-actions">
    <div className="chat-identity"><p className="chat-phase">PRIMER CHAT</p><h2 ref={heading} tabIndex={-1}>{chat?.partner.displayName ?? 'Cargando conversación…'}</h2></div>
    {!p.decisionOnly && <button className={`chat-approve ${p.decide && !state.blocked && !audioDirty ? "chat-stable-control" : ""}`} aria-busy={!!state.decisionPending} disabled={decisionDisabled} onClick={() => { if(!decisionDisabled)void session.action('approve'); }}><span aria-live="polite">{state.decisionPending ? state.decisionPending==='approve'?'Aprobando…':'Rechazando…' : 'Aprobar chat'}</span></button>}
    <ChatMenu decisionOnly={p.decisionOnly} actions={[
      ...(!decisionPanel ? [{ label: 'Rechazar chat', disabled: decisionDisabled, run: () => { if(!decisionDisabled)void session.action('reject'); } }] : []),
      ...(!p.decisionOnly ? [
        { label: 'Salida consensuada', disabled: !ordinary, run: () => setDialog('mutual') },
        { label: 'Salir unilateralmente', disabled: disabled || !p.safety, run: () => setDialog('cancel') },
      ] : []),
      { label: 'Reportar por seguridad', disabled: disabled || !p.safety, run: () => setDialog('safety') },
      { label: 'Bloquear', disabled: disabled || !p.safety, run: () => setDialog('block') },
    ]}/></header>
    {chat?.sharedContactRange && !state.blocked && state.audioAccess !== 'RESTRICTED' && !p.decisionOnly && remaining > 0 && <SharedContactIndicator owner={me} chat={chatId} range={chat.sharedContactRange}/>}
    {terminalNotice && <p role="status">{terminalNotice} <button onClick={home}>Volver a Inicio</button></p>}{state.busy && dialog === null && state.reactionFeedback === null && !state.messagePending && !state.guidancePending && !state.decisionPending && <p className="chat-status" role="status">Actualizando…</p>}{state.error && !state.messageError && !dialog && <p className={state.reactionFeedback === 'error' ? 'chat-reaction-error' : undefined} role="alert">{state.error} <button disabled={state.busy} onClick={() => void session.refresh()}>Reintentar conexión</button></p>}
    {chat && remaining <= 60 && <p role="status">{remaining ? `El plazo del chat termina en ${remaining} s.` : 'El plazo local terminó. Consultando el estado del servidor…'}</p>}
    {decisionPanel && <aside className="chat-panel chat-decision-card" aria-labelledby="chat-decision-title">
      <h3 ref={decisionTitle} id="chat-decision-title" tabIndex={-1}>{chat?.partner.displayName.trim() || 'La otra persona'} aprobó el chat.</h3>
      <p role="status">El chat está pausado mientras decidís. ¿Querés aprobar también?</p>
      <div className="chat-decision-actions"><button className="chat-decision-approve" aria-label="Aprobar" aria-busy={state.decisionPending==='approve'} disabled={decisionDisabled} onClick={()=>{if(!decisionDisabled)void session.action('approve');}}>{state.decisionPending==='approve'?'Aprobando…':'Aprobar'}</button><button aria-label="No aprobar" aria-busy={state.decisionPending==='reject'} disabled={decisionDisabled} onClick={()=>{if(!decisionDisabled)void session.action('reject');}}>{state.decisionPending==='reject'?'Rechazando…':'No aprobar'}</button></div>
    </aside>}
    {p.decisionOnly && audioDirty && <p role="status">Conservamos tu borrador de audio. <button disabled={!!state.outgoing?.file} onClick={()=>{setAudioEpoch(value=>value+1);setAudioDirty(false);}}>Descartar borrador de audio</button></p>}
    {p.decisionOnly && state.messageError && state.error && <p className="chat-composer-error" role="alert">{state.error} <button disabled={state.busy} onClick={()=>void session.refresh()}>Reintentar conexión</button></p>}
    {g && !p.decisionOnly && <div className="chat-guidance-viewport"><ReplySwipe mouseDoubleClick key={g.question.instanceId ?? g.question.text} enabled={ordinary && !audioDirty && !!g.question.instanceId} label="Responder pregunta" onReply={() => g.question.instanceId && beginReply({ type: 'GUIDANCE_QUESTION', targetId: g.question.instanceId }, g.question.text)}><aside className="chat-panel chat-guidance" aria-label="Conversación guiada"><div className="chat-guidance-copy"><p className="chat-guidance-ordinal">Pregunta {g.questionOrdinal} de {g.maxQuestions}</p><p>{g.question.text}</p>
      {g.completed ? <p className="chat-guidance-state">Etapa guiada completada.</p> : g.myNextRequested && <p className="chat-guidance-state">Esperando a {partner || 'la otra persona'} para continuar.</p>}</div>
      {canProgressGuidance && <button className={`${g.progressionAction === 'COMPLETE' ? 'chat-guidance-complete' : 'chat-guidance-next'} ${!state.blocked && !audioDirty ? 'chat-stable-control' : ''}`} aria-busy={state.guidancePending} aria-label={g.progressionAction === 'COMPLETE' ? 'Completar etapa' : 'Otra pregunta'} disabled={!ordinary || audioDirty} onClick={() => void session.action('guidance')}>{g.progressionAction === 'COMPLETE' ? 'Completar' : <ChatIcon name="next"/>}{state.guidancePending && <span className="chat-visually-hidden" role="status">Solicitando avance…</span>}</button>}
    </aside></ReplySwipe></div>}
    {p.pending && <aside className="chat-panel"><h3>Salida consensuada pendiente</h3><p>Los mensajes están pausados. Aceptar o rechazar cierra la conversación.</p>{p.pending.responderUserId === me ? <><button disabled={disabled} onClick={() => void session.action('acceptance')}>Aceptar salida</button><button disabled={disabled} onClick={() => void session.action('rejection')}>Rechazar salida</button></> : <p>Esperando la respuesta de {partner || 'la otra persona'}.</p>}<button disabled={disabled} onClick={() => void session.action('timeout')}>Consultar vencimiento de la solicitud</button></aside>}
    {state.historyLimited && <p>Se cargaron los últimos 500 mensajes. El servidor no ofrece acceso a páginas anteriores.</p>}
    </div>
    <div className="chat-history">
    <ol className="chat-timeline" aria-label="Mensajes" ref={timeline} onScroll={() => { const l = timeline.current; if (l && (observedHeight.current === 0 || observedHeight.current === l.clientHeight)) nearBottom.current = l.scrollHeight-l.scrollTop-l.clientHeight < 100; if (nearBottom.current) setUnseen(false); }}>
      {state.messages.map((m, index, messages) => <li key={m.id} className={`chat-message-row ${m.senderId === me ? 'outgoing' : 'incoming'}${messages[index - 1]?.senderId === m.senderId ? ' chat-message-continuation' : ''}`}>
        <ReplySwipe enabled={ordinary && !audioDirty && m.senderId !== me && ((m.messageType === 'TEXT' && !!m.content) || (m.messageType === 'AUDIO' && !!m.audio))} label={`Responder mensaje de ${chat?.partner.displayName ?? 'tu match'}`} onReply={() => beginReply({ type: 'MESSAGE', targetId: m.id, senderId: m.senderId, messageType: m.messageType }, m.messageType === 'AUDIO' ? 'Mensaje de audio' : m.content ?? '')}><article className={m.senderId === me ? 'chat-message outgoing' : 'chat-message incoming'}>
        {m.replyTo && <blockquote className="chat-quote"><ReplyQuote {...replyPreview(m.replyTo,me,chat?.partner.userId,chat?.partner.displayName)}/></blockquote>}
        {m.messageType === 'TEXT' && m.content ? <p>{m.content}</p> : m.messageType === 'AUDIO' && m.audio ? <MessageAudio source={m.audio.url} durationMillis={m.audio.durationMillis} refresh={() => session.renewAudio(m.id)}/> : <p>Mensaje no compatible.</p>}
        <time dateTime={m.sentAt}>{new Date(m.sentAt).toLocaleTimeString('es-AR',{ hour: '2-digit',minute:'2-digit' })}</time>
        </article></ReplySwipe>
        {m.senderId === me ? m.reactionType && <span className="chat-received-heart" role="img" aria-label={(partner || 'La otra persona') + ' reaccionó con corazón'}>♥</span> : <ReactionLane confirmed={m.reactionType === 'HEART'} eligible={eligible.has(m.id)} disabled={!ordinary || audioDirty} react={() => session.react(m.id)}/>}
      </li>)}
      {state.outgoing && <li className="chat-message outgoing"><p>{state.outgoing.content ?? 'Audio pendiente'}</p><p role="status">{state.outgoing.phase === 'pending' ? 'Enviando…' : state.outgoing.phase === 'uncertain' ? 'Sin confirmar' : 'Falló el envío'}</p>{state.outgoing.phase !== 'pending' && <button disabled={disabled || !p.ordinary} onClick={() => void session.retry()}>Reconciliar y reintentar el mismo envío</button>}{state.outgoing.phase === 'failed' && <button disabled={disabled} onClick={session.editFailed}>Editar borrador</button>}</li>}
    </ol>
    {unseen && <button className="chat-new-messages" onClick={() => { const l = timeline.current; if (l) l.scrollTop=l.scrollHeight; nearBottom.current=true; setUnseen(false); }}>Ver mensajes nuevos</button>}
    </div>
    {/* Hide ordinary composition while retaining draft ownership and delivery reconciliation. */}
    <form hidden={p.decisionOnly} className="chat-composer" aria-busy={state.messagePending} onSubmit={e => { e.preventDefault(); if (ordinary && !audioDirty && !composing.current && plainText(draft)) void session.send(draft,reply ? { type:reply.type,targetId:reply.targetId } : null); }}>
      {reply && <aside className="chat-reply-preview" aria-label="Respuesta seleccionada"><ReplyQuote {...replyPreview(reply,me,chat?.partner.userId,chat?.partner.displayName)}/><button type="button" className="chat-icon-button" aria-label="Quitar respuesta" disabled={!!state.outgoing} onClick={() => setReply(null)}><ChatIcon name="close"/></button></aside>}
      <AudioComposer key={audioEpoch} textDraft={text} textConfirmationVersion={state.confirmed !== null && state.confirmedFile === null ? state.confirmationVersion : 0} policy={chat?.audioPolicy ?? null} disabled={!ordinary || dialog !== null} payloadLocked={!!state.outgoing} confirmedFile={state.confirmedFile} onDirtyChange={setAudioDirty} onSend={file => session.send('',reply ? { type:reply.type,targetId:reply.targetId } : null,file)}>{microphone => <>
      <div className="chat-composer-row">
      <label className="chat-visually-hidden" htmlFor="chat-draft">Mensaje</label><textarea placeholder="Mensaje" id="chat-draft" ref={setText} maxLength={1000} value={draft} onChange={e => setDraft(e.target.value)} disabled={!p.ordinary || state.blocked || audioDirty} rows={1}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onBlur={() => { composing.current = false; }}
        onKeyDown={event => submitChatOnEnter(event, composing.current, ordinary && !audioDirty && plainText(draft))}/>{microphone}<TextSendButton draft={text} className="chat-icon-button chat-send" disabled={!ordinary || audioDirty || !plainText(draft)}><ChatIcon name="send"/></TextSendButton></div><span className="chat-character-count">{draft.length}/1000</span>
      {!!draft && !plainText(draft) && <p>Usá texto sin &lt;, &gt; ni caracteres de control. Máximo 1000 caracteres.</p>}
      </>}</AudioComposer>
      {state.error && state.messageError && !dialog && <p className="chat-composer-error" role="alert">{state.error} <button type="button" disabled={state.busy} onClick={() => void session.refresh()}>Reintentar conexión</button></p>}
    </form>
    {dialog && (!p.decisionOnly || dialog==='safety' || dialog==='block') && <ConfirmDialog kind={dialog} busy={state.busy} disabled={state.blocked} feedback={state.error && <p role="alert">{state.error} <button type="button" disabled={state.busy} onClick={() => void session.refresh()}>Reintentar conexión</button></p>} close={() => setDialog(null)} confirm={body => { void (async () => { await session.action(dialog,body); if (!session.getSnapshot().error) setDialog(null); })(); }}/> }
  </section>;
}
