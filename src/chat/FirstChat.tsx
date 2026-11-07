import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SessionController } from '../auth/session';
import { ChatSession } from './ChatSession';
import { plainText, policy, reactable } from './contracts';
import type { Message, Reply } from './contracts';
import { AudioComposer } from './AudioComposer';
import './chat.css';

function MessageAudio({ message, refresh }: { message: Message; refresh: () => void }) {
  const ref = useRef<HTMLAudioElement>(null), [failed,setFailed] = useState(false);
  useEffect(() => { const audio = ref.current; setFailed(false); return () => { if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); } }; }, [message.audio?.url]);
  return <><audio ref={ref} controls preload="none" src={message.audio?.url} aria-label="Mensaje de audio" onError={() => setFailed(true)} onPlay={e => { document.querySelectorAll('audio').forEach(a => { if (a !== e.currentTarget) a.pause(); }); }} />{failed && <p role="alert">No pudimos reproducir el audio. El enlace puede haber vencido. <button onClick={refresh}>Renovar enlace</button></p>}</>;
}
function ConfirmDialog({ kind, busy, close, confirm }: { kind: string; busy: boolean; close: () => void; confirm: (body?: unknown) => void }) {
  const ref = useRef<HTMLDialogElement>(null), [details,setDetails] = useState(''), [reason,setReason] = useState('INAPPROPRIATE_BEHAVIOR'), [block,setBlock] = useState(false);
  useEffect(() => { const d = ref.current; d?.showModal(); return () => d?.close(); }, []);
  const safety = kind === 'safety';
  return <dialog ref={ref} aria-labelledby="chat-dialog-title" onCancel={e => { if (busy) e.preventDefault(); else close(); }}>
    <h3 id="chat-dialog-title">{safety ? 'Reportar y cerrar chat' : kind === 'block' ? 'Bloquear a esta persona' : kind === 'mutual' ? 'Solicitar salida consensuada' : kind === 'approve' ? 'Aprobar chat' : 'Cerrar chat'}</h3>
    <p>{safety ? 'Describí qué pasó. Este reporte cerrará el chat por seguridad y será revisado.' : kind === 'block' ? 'Se cerrará la interacción y esta persona quedará bloqueada.' : kind === 'mutual' ? 'La conversación se pausa hasta resolver la solicitud. Tanto aceptar como rechazar la salida cierran el chat.' : kind === 'approve' ? 'Si aprobás, la conversación se pausa mientras la otra persona decide. El servidor verifica la participación requerida.' : 'Esta decisión cierra el chat. Una salida unilateral puede afectar tu confiabilidad según las reglas del servidor.'}</p>
    {safety && <><label>Motivo<select value={reason} onChange={e => setReason(e.target.value)} disabled={busy}><option value="INAPPROPRIATE_BEHAVIOR">Comportamiento inapropiado</option><option value="HARASSMENT">Acoso</option><option value="CHILD_SAFETY_CONCERN">Seguridad de menores</option><option value="OTHER">Otro</option></select></label><label>Detalle<textarea value={details} maxLength={1000} onChange={e => setDetails(e.target.value)} disabled={busy}/></label><label><input type="checkbox" checked={block} onChange={e => setBlock(e.target.checked)} disabled={busy}/>Bloquear también a esta persona</label></>}
    <button disabled={busy} onClick={close}>Volver</button><button disabled={busy || (safety && !plainText(details.trim()))} onClick={() => confirm(safety ? { reason, details: details.trim(), blockUser: block } : undefined)}>Confirmar</button>
  </dialog>;
}
function ChatMenu({ actions }: { actions: { label: string; disabled: boolean; run: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const boundary = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !boundary.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return <div ref={boundary} className="chat-overflow" onBlur={event => {
    // Trigger and popup share one focus boundary. Pointer focus reaches the
    // trigger before click; closing here would make that click reopen the menu.
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={event => { if (event.key === 'Escape' && open) { event.preventDefault(); close(); } }}><button ref={trigger} aria-label="Opciones del chat" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(current => !current)} onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); } }}>⋮</button>
    {open && <div ref={menu} role="menu" aria-label="Decisiones y seguridad" className="chat-menu" onKeyDown={event => {
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const index = items.findIndex(item => item === document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }
    }}>{actions.map(action => <button role="menuitem" key={action.label} disabled={action.disabled} onClick={() => { close(); action.run(); }}>{action.label}</button>)}</div>}
  </div>;
}
export function FirstChat({ controller, matchId, chatId, onHome }: { controller: SessionController; matchId: string; chatId: string; onHome: (message?: string, closed?: boolean) => void }) {
  const dirty = useRef(false), knownClosed = useRef(false), terminalMessage = useRef('');
  const [terminalNotice,setTerminalNotice] = useState(''), [audioDirty,setAudioDirty] = useState(false);
  const [session] = useState(() => new ChatSession(controller,matchId,chatId,controller.snapshot.account?.id ?? '',(message, closed) => { knownClosed.current = closed; terminalMessage.current = message; if (dirty.current) setTerminalNotice(message + ' Conservamos tu borrador hasta que vuelvas a Inicio.'); else onHome(message,closed); }));
  const state = useSyncExternalStore(session.subscribe,session.getSnapshot);
  const [draft,setDraft] = useState(''), [reply,setReply] = useState<(Reply & { preview: string }) | null>(null), [dialog,setDialog] = useState<Parameters<ChatSession['action']>[0] | null>(null), [now,setNow] = useState(Date.now()), [unseen,setUnseen] = useState(false);
  const timeline = useRef<HTMLOListElement>(null), nearBottom = useRef(true), text = useRef<HTMLTextAreaElement>(null), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    session.start(); void session.refresh(); heading.current?.focus();
    const timer = window.setInterval(() => { setNow(Date.now()); if (document.visibilityState === 'visible') void session.refresh(false,true); },5000);
    const tick = window.setInterval(() => { setNow(Date.now()); if (document.visibilityState === 'visible') void session.checkExitTimeout(); },1000);
    const resume = () => { if (document.visibilityState === 'visible') void session.refresh(); };
    document.addEventListener('visibilitychange',resume); window.addEventListener('online',resume);
    return () => { session.dispose(); clearInterval(timer); clearInterval(tick); document.removeEventListener('visibilitychange',resume); window.removeEventListener('online',resume); };
  }, [session]);
  useEffect(() => {
    const viewport = window.visualViewport, root = timeline.current?.closest<HTMLElement>('.first-chat');
    const resize = () => { if (root && viewport) root.style.setProperty('--chat-viewport',`${viewport.height}px`); };
    resize(); viewport?.addEventListener('resize',resize); return () => viewport?.removeEventListener('resize',resize);
  }, []);
  useEffect(() => { if (state.confirmationVersion > 0) { setDraft(d => d === state.confirmed ? '' : d); setReply(null); } }, [state.confirmationVersion]);
  useEffect(() => {
    const list = timeline.current;
    if (nearBottom.current && list) { list.scrollTop = list.scrollHeight; setUnseen(false); } else setUnseen(true);
  }, [state.messages.length]);
  useEffect(() => { const warn = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault(); } }; window.addEventListener('beforeunload',warn); return () => window.removeEventListener('beforeunload',warn); }, [draft,state.outgoing]);
  const chat = state.chat, p = policy(chat,state.exits,now+state.offset), me = session.me, eligible = reactable(state.messages,me), g = chat?.guidance;
  const disabled = state.busy || state.blocked, ordinary = p.ordinary && !disabled && !state.outgoing;
  const deadline = chat ? Math.min(Date.parse(chat.timeoutAt), !p.decisionOnly && chat.inactivityExpiresAt ? Date.parse(chat.inactivityExpiresAt) : Infinity) : Infinity;
  const remaining = Math.max(0,Math.ceil((deadline-now-state.offset)/1000));
  const beginReply = (target: Reply, preview: string) => { setReply({ ...target,preview }); text.current?.focus(); };
  dirty.current = !!draft || !!state.outgoing || audioDirty;
  const home = () => { if (!dirty.current || window.confirm('Hay un borrador o envío pendiente. ¿Querés salir y descartarlo?')) onHome(terminalMessage.current,knownClosed.current); };
  useEffect(() => {
    // Back changes browser history, never the authoritative conversation lifecycle.
    // Do not push replacement entries: a second Back can leave this document normally.
    const back = () => { if (knownClosed.current) home(); };
    window.addEventListener('popstate',back);
    return () => window.removeEventListener('popstate',back);
  });
  return <section className="first-chat" aria-label="Primer chat">
    <header className="chat-heading"><div><p className="chat-phase">PRIMER CHAT</p><h2 ref={heading} tabIndex={-1}>{chat?.partner.displayName ?? 'Cargando conversación…'}</h2></div><ChatMenu actions={[
      { label: 'Rechazar chat', disabled: disabled || audioDirty || !p.decide, run: () => setDialog('reject') },
      ...(!p.decisionOnly ? [
        { label: 'Salida consensuada', disabled: !ordinary, run: () => setDialog('mutual') },
        { label: 'Salir unilateralmente', disabled: disabled || !p.safety, run: () => setDialog('cancel') },
      ] : []),
      { label: 'Reportar por seguridad', disabled: disabled || !p.safety, run: () => setDialog('safety') },
      { label: 'Bloquear', disabled: disabled || !p.safety, run: () => setDialog('block') },
    ]}/></header>
    <button className="chat-approve" disabled={disabled || audioDirty || !p.decide} onClick={() => setDialog('approve')}>Aprobar chat</button>
    {terminalNotice && <p role="status">{terminalNotice} <button onClick={home}>Volver a Inicio</button></p>}{state.busy && <p className="chat-status" role="status">Actualizando…</p>}{state.error && <p role="alert">{state.error} <button disabled={state.busy} onClick={() => void session.refresh()}>Reintentar conexión</button></p>}
    {chat && remaining <= 60 && <p role="status">{remaining ? `El plazo del chat termina en ${remaining} s.` : 'El plazo local terminó. Consultando el estado del servidor…'}</p>}
    {p.decisionOnly && <aside className="chat-panel">{chat?.myDecision === 'PENDING' ? 'La otra persona aprobó. La conversación está pausada mientras decidís.' : 'Guardamos tu aprobación. Esperando la otra decisión.'}</aside>}
    {g && <aside className="chat-panel chat-guidance" aria-label="Conversación guiada"><p>Pregunta {g.questionOrdinal} de {g.maxQuestions}</p><p>{g.question.text}</p><p>{g.canRequestNext ? 'Ya podés pedir continuar.' : 'Sigan participando. Responder directamente a la pregunta ayuda a avanzar.'}</p>
      <button disabled={!ordinary || !g.question.instanceId} onClick={() => g.question.instanceId && beginReply({ type: 'GUIDANCE_QUESTION',targetId: g.question.instanceId },g.question.text)}>Responder pregunta</button>
      {g.completed ? <p>Etapa guiada completada.</p> : g.myNextRequested ? <p>Esperando a la otra persona para continuar.</p> : <button disabled={!ordinary || !g.canRequestNext || (g.progressionAction !== null && !['NEXT_QUESTION','COMPLETE'].includes(g.progressionAction))} onClick={() => void session.action('guidance')}>{g.progressionAction === 'COMPLETE' ? 'Completar etapa' : 'Otra pregunta'}</button>}
    </aside>}
    {p.pending && <aside className="chat-panel"><h3>Salida consensuada pendiente</h3><p>Los mensajes están pausados. Aceptar o rechazar cierra la conversación.</p>{p.pending.responderUserId === me ? <><button disabled={disabled} onClick={() => void session.action('acceptance')}>Aceptar salida</button><button disabled={disabled} onClick={() => void session.action('rejection')}>Rechazar salida</button></> : <p>Esperando la respuesta de la otra persona.</p>}<button disabled={disabled} onClick={() => void session.action('timeout')}>Consultar vencimiento de la solicitud</button></aside>}
    {state.historyLimited && <p>Se cargaron los últimos 500 mensajes. El servidor no ofrece acceso a páginas anteriores.</p>}
    <ol className="chat-timeline" aria-label="Mensajes" ref={timeline} onScroll={() => { const l = timeline.current; if (l) nearBottom.current = l.scrollHeight-l.scrollTop-l.clientHeight < 100; if (nearBottom.current) setUnseen(false); }}>
      {state.messages.map(m => <li key={m.id} className={m.senderId === me ? 'chat-message outgoing' : 'chat-message incoming'}>
        <span className="chat-sender">{m.senderId === me ? 'Vos' : chat?.partner.displayName}</span>
        {m.replyTo && <blockquote>{m.replyTo.type === 'GUIDANCE_QUESTION' ? 'Pregunta: ' : 'Respuesta a: '}{m.replyTo.previewText ?? 'Audio'}</blockquote>}
        {m.messageType === 'TEXT' && m.content ? <p>{m.content}</p> : m.messageType === 'AUDIO' && m.audio ? <MessageAudio message={m} refresh={() => void session.refresh(true)}/> : <p>Mensaje no compatible.</p>}
        <time dateTime={m.sentAt}>{new Date(m.sentAt).toLocaleTimeString('es-AR',{ hour: '2-digit',minute:'2-digit' })}</time>
        {m.reactionType && <span aria-label="Reacción corazón"> ♥</span>}
        {m.senderId !== me && (m.messageType === 'TEXT' || m.messageType === 'AUDIO') && <button disabled={!ordinary} onClick={() => beginReply({ type:'MESSAGE',targetId:m.id },m.content ?? 'Audio')}>Responder</button>}
        {eligible.has(m.id) && <button disabled={!ordinary} aria-label="Reaccionar con corazón" onClick={() => void session.react(m.id)}>♡</button>}
      </li>)}
      {state.outgoing && <li className="chat-message outgoing"><p>{state.outgoing.content ?? 'Audio pendiente'}</p><p role="status">{state.outgoing.phase === 'pending' ? 'Enviando…' : state.outgoing.phase === 'uncertain' ? 'Sin confirmar' : 'Falló el envío'}</p>{state.outgoing.phase !== 'pending' && <button disabled={disabled || !p.ordinary} onClick={() => void session.retry()}>Reconciliar y reintentar el mismo envío</button>}{state.outgoing.phase === 'failed' && <button disabled={disabled} onClick={session.editFailed}>Editar borrador</button>}</li>}
    </ol>
    {unseen && <button onClick={() => { const l = timeline.current; if (l) l.scrollTop=l.scrollHeight; nearBottom.current=true; setUnseen(false); }}>Ver mensajes nuevos</button>}
    <form className="chat-composer" onSubmit={e => { e.preventDefault(); if (ordinary && !audioDirty) void session.send(draft,reply ? { type:reply.type,targetId:reply.targetId } : null); }}>
      {reply && <aside>Respondiendo: {reply.preview}<button type="button" disabled={!!state.outgoing} onClick={() => setReply(null)}>Quitar respuesta</button></aside>}
      <label htmlFor="chat-draft">Mensaje</label><textarea id="chat-draft" ref={text} maxLength={1000} value={draft} onChange={e => setDraft(e.target.value)} disabled={!ordinary || audioDirty} rows={2}/><span>{draft.length}/1000</span><button disabled={!ordinary || audioDirty || !plainText(draft)}>Enviar mensaje</button>
      {!!draft && !plainText(draft) && <p>Usá texto sin &lt;, &gt; ni caracteres de control. Máximo 1000 caracteres.</p>}
    </form>
    <AudioComposer key={state.messages.filter(m => m.senderId === me && m.messageType === 'AUDIO').length} payloadLocked={!!state.outgoing} onDirtyChange={setAudioDirty} policy={chat?.audioPolicy ?? null} disabled={!ordinary || !!draft} onSend={file => void session.send('',reply ? { type:reply.type,targetId:reply.targetId } : null,file)} />
    {dialog && <ConfirmDialog kind={dialog} busy={state.busy} close={() => setDialog(null)} confirm={body => { void (async () => { await session.action(dialog,body); if (!session.getSnapshot().error) setDialog(null); })(); }}/> }
  </section>;
}
