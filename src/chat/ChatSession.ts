import { ApiError, object } from '../auth/api';
import type { SessionController } from '../auth/session';
import { mergeMessages, parseChat, parseGuidance, parseExits, parseMessage, plainText, policy, reactable, reactionCursor, str } from './contracts';
import type { Chat, Exit, Message, Reply } from './contracts';
import { messageRequest, type Outgoing } from './messageRequest';
export type { Outgoing } from './messageRequest';
interface State { decisionPending: 'approve' | 'reject' | null; guidancePending: boolean; messageError: boolean; messagePending: boolean; confirmedReply: Reply | null; confirmedFile: Blob | null; reactionFeedback: 'pending' | 'error' | null; chat: Chat | null; messages: Message[]; exits: Exit[]; busy: boolean; error: string; blocked: boolean; outgoing: Outgoing | null; confirmed: string | null; confirmationVersion: number; offset: number; historyLimited: boolean }
export class ChatSession {
  private state: State = { decisionPending: null, guidancePending: false, messageError: false, messagePending: false, confirmedReply: null, confirmedFile: null, reactionFeedback: null, chat: null, messages: [], exits: [], busy: false, error: '', blocked: true, outgoing: null, confirmed: null, confirmationVersion: 0, offset: 0, historyLimited: false };
  private listeners = new Set<() => void>();
  private lifetime = new AbortController();
  private read: AbortController | null = null;
  private serial = 0;
  private writing = false;
  private decisionStarted = 0;
  private reconcileReactions = false;
  private partner = '';
  private terminal = false;
  private terminalNotice: string | null = null;
  private timedOutRequests = new Set<string>();
  constructor(private controller: SessionController, readonly matchId: string, readonly chatId: string, readonly me: string, private onTerminal: (message: string, closed: boolean) => void) {}
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.state;
  private install(patch: Partial<State>) { if (!this.lifetime.signal.aborted) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); } }
  start() { if (this.lifetime.signal.aborted) { this.lifetime = new AbortController(); this.read = null; this.writing = false; this.serial++; } }
  dispose() { this.lifetime.abort(); this.read?.abort(); }
  private async presentDecision(signal: AbortSignal) {
    const remaining = 300 - (Date.now() - this.decisionStarted);
    if (!this.state.decisionPending || remaining <= 0 || document.visibilityState !== 'visible') return;
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); document.removeEventListener('visibilitychange', done); resolve(); };
      const timer = setTimeout(done, remaining);
      signal.addEventListener('abort', done, { once: true });
      document.addEventListener('visibilitychange', done, { once: true });
      if (signal.aborted) done();
    });
  }
  private finish(message: string, closed = true) { this.terminal = true; this.install({ blocked: true, busy: false }); this.onTerminal(this.terminalNotice ?? message, closed); }
  private terminalError(error: unknown) {
    if (error instanceof ApiError && ['CHAT_EXPIRED','CHAT_ABANDONED'].includes(error.code)) {
      this.finish(error.code === 'CHAT_ABANDONED' ? 'El chat se cerró por inactividad.' : 'El chat venció.'); return true;
    }
    return false;
  }
  private request(path: string, signal: AbortSignal, method = 'GET', body?: unknown) { return this.controller.request(path, signal, method, body); }
  private parseMessage = (v: unknown) => parseMessage(v, this.chatId, [this.me, this.partner]);
  private async messages(signal: AbortSignal, cursor?: string): Promise<Message[]> {
    let result: Message[] = [], after = cursor;
    for (;;) {
      const raw = await this.request(`/chats/${this.chatId}/messages?limit=500${after ? `&after=${encodeURIComponent(after)}` : ''}`, signal);
      const rows = Array.isArray(raw) ? raw : object(raw) && Array.isArray(raw.messages) && typeof raw.hasMore === 'boolean' ? raw.messages : null;
      if (!rows) throw new ApiError('invalid');
      const parsed = rows.map(this.parseMessage);
      result = mergeMessages(result, parsed);
      if (!object(raw) || raw.hasMore !== true) return result;
      const next = parsed.at(-1)?.id;
      if (!next || next === after) throw new ApiError('invalid');
      after = next;
      signal.throwIfAborted();
    }
  }
  private async load(signal: AbortSignal, serial: number, full = false) {
    const match = await this.request(`/matches/${this.matchId}`, signal);
    if (!object(match) || match.id !== this.matchId || (match.userAId !== this.me && match.userBId !== this.me)) throw new ApiError('invalid');
    this.partner = str(match.userAId === this.me ? match.userBId : match.userAId);
    if (match.state !== 'CHAT_ACTIVE' && !['VISUAL_PHASE','VISUAL_APPROVED','CHAT_REJECTED','VISUAL_REJECTED','EXPIRED'].includes(str(match.state))) throw new ApiError('invalid');
    if (match.state !== 'CHAT_ACTIVE') { await this.presentDecision(signal); if (this.current(serial)) this.finish(this.state.decisionPending ? 'Tu decisión quedó registrada.' : 'El chat terminó.'); return; }
    const started = Date.now();
    const raw = await this.request(`/matches/${this.matchId}/chat`, signal);
    const received = Date.now();
    const chat = parseChat(raw, this.matchId, this.chatId, this.partner);
    if (chat.status !== 'ACTIVE' && !['CANCELLED','EXPIRED','ABANDONED','CLOSED','FINISHED'].includes(chat.status)) throw new ApiError('invalid');
    if (chat.status !== 'ACTIVE') { if (this.current(serial)) this.finish(chat.status === 'ABANDONED' ? 'El chat se cerró por inactividad.' : 'El chat terminó. Actualizamos Inicio.'); return; }
    const cursor = full ? undefined : this.reconcileReactions ? reactionCursor(this.state.messages) : this.state.messages.at(-1)?.id;
    this.reconcileReactions = !this.reconcileReactions;
    const [messages, exits] = await Promise.all([
      this.messages(signal, cursor), this.request(`/chats/${this.chatId}/exit-requests`, signal).then(v => parseExits(v, this.chatId, [this.me, this.partner])),
    ]);
    if (!this.current(serial)) return;
    if (chat.myDecision !== 'PENDING') { await this.presentDecision(signal); if (!this.current(serial)) return; }
    const merged = mergeMessages(this.state.messages, messages);
    const outgoing = this.state.outgoing;
    const confirmed = outgoing && merged.some(m => m.clientMessageId === outgoing.clientMessageId && m.senderId === this.me);
    this.install({ chat, messages: merged, exits, offset: Date.parse(chat.serverTime) - (started + received) / 2, blocked: false,
      ...(confirmed ? { outgoing: null, confirmed: outgoing.content, confirmedReply: outgoing.replyTo, confirmedFile: outgoing.file, confirmationVersion: this.state.confirmationVersion + 1 } : {}), historyLimited: this.state.historyLimited || (!cursor && messages.length >= 500) });
    if (chat.myDecision !== 'PENDING') this.finish('Tu decisión quedó registrada.', false);
  }
  private current(serial: number) { return !this.lifetime.signal.aborted && serial === this.serial; }
  resume = () => {
    if (this.terminal || this.writing || this.lifetime.signal.aborted) return;
    // A foreground snapshot supersedes an older read, never an uncertain write.
    this.read?.abort(); this.read = null;
    return this.refresh(false, true);
  };
  refresh = async (full = false, silent = false) => {
    if (this.terminal || this.writing || this.read || this.lifetime.signal.aborted) return;
    const read = new AbortController(); this.read = read;
    const signal = AbortSignal.any([read.signal, this.lifetime.signal]), serial = ++this.serial;
    this.install({ busy: !this.state.chat });
    try { await this.load(signal, serial, full); if (this.current(serial) && !silent) this.install({ error: '', reactionFeedback: null, messageError: false }); }
    catch (error) { if (this.current(serial) && !signal.aborted && !this.terminalError(error)) this.install({ blocked: true, error: 'No pudimos actualizar el chat. Revisá tu conexión y usá Reintentar conexión.' }); }
    finally { if (this.current(serial)) { this.read = null; this.install({ busy: false }); } }
  };
  private async write(path: string, method: string, body: unknown, outgoing?: Outgoing) {
    if (this.terminal || this.writing || this.lifetime.signal.aborted) return;
    this.writing = true; this.read?.abort(); this.read = null;
    const serial = ++this.serial, signal = this.lifetime.signal;
    let accepted = false;
    this.decisionStarted = Date.now();
    this.install({ busy: true, decisionPending: path.endsWith('/chat-decision') && object(body) ? body.decision==='APPROVED'?'approve':body.decision==='REJECTED'?'reject':null : null, guidancePending: path.endsWith('/guidance/next-request'), messageError: false, messagePending: !!outgoing, reactionFeedback: method === 'PUT' ? 'pending' : null, error: '', ...(outgoing ? { outgoing: { ...outgoing, phase: 'pending' } } : {}) });
    try {
      const result = await this.request(path, signal, method, body);
      if (!this.current(serial)) return;
      if (outgoing) {
        const message = this.parseMessage(result);
        if (message.senderId !== this.me || message.clientMessageId !== outgoing.clientMessageId) throw new ApiError('invalid');
        this.install({ messages: mergeMessages(this.state.messages, [message]), outgoing: null, confirmed: outgoing.content, confirmedReply: outgoing.replyTo, confirmedFile: outgoing.file, confirmationVersion: this.state.confirmationVersion + 1 });
      } else if (method === 'PUT') {
        this.install({ messages: mergeMessages(this.state.messages, [this.parseMessage(result)]) });
      }
      accepted = true;
      if (path.endsWith('/guidance/next-request') && this.state.chat) this.install({ chat: { ...this.state.chat, guidance: parseGuidance(result) } });
      if (path.endsWith('/safety-cancellations')) this.terminalNotice = 'Recibimos tu reporte y cerramos el chat por seguridad. Será revisado.';
      if (path.endsWith('/block')) this.terminalNotice = 'La persona quedó bloqueada. Actualizamos Inicio.';
      // The response is not used to synthesize lifecycle transitions; read authoritative state.
      await this.load(signal, serial);
    } catch (error) {
      if (!this.current(serial)) return;
      if (this.terminalError(error)) return;
      if (accepted) { this.install({ blocked: true, messageError: !!outgoing, reactionFeedback: method === 'PUT' ? 'error' : null, error: 'La acción fue confirmada, pero no pudimos actualizar el chat. Usá Reintentar conexión; no hace falta repetirla.' }); return; }
      const ambiguous = !(error instanceof ApiError) || error.status === 0 || error.status >= 500 || error.kind === 'invalid';
      const code = error instanceof ApiError ? error.code : '';
      this.install({ blocked: true, messageError: !!outgoing, reactionFeedback: method === 'PUT' ? 'error' : null, error: outgoing && ambiguous ? 'Envío sin confirmar. Actualizá antes de reintentar; conservamos el mismo mensaje.' : code === 'CHAT_APPROVAL_TOO_EARLY' || code.includes('PARTICIPATION') || code.includes('APPROVAL') ? 'Todavía no se cumplen los requisitos para aprobar. Seguí conversando y actualizá el estado.' : 'No pudimos completar la acción. Actualizá el estado antes de volver a intentar.',
        ...(outgoing && this.state.outgoing ? { outgoing: { ...outgoing, phase: ambiguous ? 'uncertain' : 'failed' } } : {}) });
      try { await this.load(signal, serial, !!outgoing); } catch { /* Error remains visible; no mutation is replayed automatically. */ }
    } finally { if (this.current(serial)) { this.writing = false; this.install({ busy: false, decisionPending: null, guidancePending: false, messagePending: false, reactionFeedback: this.state.reactionFeedback === 'pending' ? null : this.state.reactionFeedback }); } }
  }
  private get rules() { return policy(this.state.chat, this.state.exits, Date.now() + this.state.offset); }
  send(content: string, replyTo: Reply | null, file: Blob | null = null) {
    const a = this.state.chat?.audioPolicy;
    if (this.writing || this.state.busy || this.state.blocked || this.state.outgoing || !this.rules.ordinary || (file ? !a?.enabled || a.remainingMessages === 0 || file.size > a.maxFileSizeBytes || file.type !== 'audio/mp4' : !plainText(content))) return;
    if (replyTo && (replyTo.type === 'GUIDANCE_QUESTION' ? this.state.chat?.guidance?.question.instanceId !== replyTo.targetId : !this.state.messages.some(m => m.id === replyTo.targetId && m.senderId !== this.me))) {
      this.install({ error: 'El destino de la respuesta cambió. Quitá la respuesta o seleccioná una pregunta o mensaje vigente. Conservamos tu borrador.' }); return;
    }
    return this.sendOutgoing({ content: file ? null : content, file, replyTo, clientMessageId: crypto.randomUUID(), phase: 'pending' });
  }
  private sendOutgoing(o: Outgoing) {
    const request = messageRequest(this.chatId, o);
    return this.write(request.path, 'POST', request.body, o);
  }
  retry = async () => {
    const o = this.state.outgoing;
    if (!o || this.writing || this.state.busy) return;
    await this.refresh(true);
    if (this.state.outgoing === o && !this.state.blocked && this.rules.ordinary) return this.sendOutgoing(o);
  };
  editFailed = () => { if (!this.writing && this.state.outgoing?.phase === 'failed') this.install({ outgoing: null }); };
  checkExitTimeout = () => {
    const pending = this.rules.pending;
    if (!pending || this.state.busy || this.state.blocked || this.writing || this.timedOutRequests.has(pending.id) || this.state.outgoing?.phase === 'uncertain') return;
    // Same advisory delay as Android. The backend alone decides whether it expired.
    if (Date.now() + this.state.offset < Date.parse(pending.createdAt) + 20000) return;
    this.timedOutRequests.add(pending.id);
    return this.action('timeout');
  };
  action = (kind: 'approve' | 'reject' | 'guidance' | 'mutual' | 'cancel' | 'safety' | 'block' | 'acceptance' | 'rejection' | 'timeout', body?: unknown) => {
    if (this.writing || this.state.busy || this.state.blocked) return;
    const p = this.rules;
    // Reconcile an ambiguous send before a different write; safety remains available.
    if (this.state.outgoing?.phase === 'uncertain' && kind !== 'safety' && kind !== 'block') return;
    if ((kind === 'approve' || kind === 'reject') && !p.decide) return;
    if ((kind === 'guidance' || kind === 'mutual') && !p.ordinary) return;
    if (kind === 'cancel' && (!p.safety || p.decisionOnly)) return;
    if ((kind === 'safety' || kind === 'block') && !p.safety) return;
    if (kind === 'safety' && (!object(body) || typeof body.reason !== 'string' || !['INAPPROPRIATE_BEHAVIOR','HARASSMENT','CHILD_SAFETY_CONCERN','OTHER'].includes(body.reason) || typeof body.details !== 'string' || !plainText(body.details) || typeof body.blockUser !== 'boolean')) return;
    if (kind === 'guidance' && (!this.state.chat?.guidance?.canRequestNext || this.state.chat.guidance.myNextRequested || this.state.chat.guidance.completed)) return;
    if (['acceptance','rejection','timeout'].includes(kind) && (!p.pending || (kind !== 'timeout' && p.pending.responderUserId !== this.me))) return;
    const path = kind === 'approve' || kind === 'reject' ? `/matches/${this.matchId}/chat-decision` : kind === 'block' ? `/matches/${this.matchId}/block` : `/chats/${this.chatId}/${kind === 'guidance' ? 'guidance/next-request' : kind === 'mutual' ? 'exit-requests' : kind === 'cancel' ? 'cancellations' : kind === 'safety' ? 'safety-cancellations' : `exit-requests/${p.pending?.id}/${kind}`}`;
    return this.write(path, 'POST', kind === 'approve' || kind === 'reject' ? { decision: kind === 'approve' ? 'APPROVED' : 'REJECTED' } : kind === 'mutual' || kind === 'cancel' ? { reason: 'NO_LONGER_INTERESTED' } : body);
  };
  react(id: string) {
    if (!this.rules.ordinary || this.state.busy || this.state.blocked || this.state.outgoing?.phase === 'uncertain' || !reactable(this.state.messages, this.me).has(id)) return;
    return this.write(`/chats/${this.chatId}/messages/${encodeURIComponent(id)}/reaction`, 'PUT', { type: 'HEART' });
  }
}
