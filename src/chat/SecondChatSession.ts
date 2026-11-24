import { ParticipantHistory, pairBlocked } from './participantHistory';
import { ApiError, object, type CounterpartAudioAccess } from '../auth/api';
import type { SessionController } from '../auth/session';
import { mergeMessages, parseMessage, plainText, str, type Message, type Reply } from './contracts';
import { messageRequest, type Outgoing } from './messageRequest';
import { parseSecondStatus, secondPolicy, type SecondStatus } from './secondContracts';
/** Memory-only capability created by a successful explicit navigation; never persisted in history. */
export class SecondChatEntryIntent {
  private consumed = false;
  private readonly owner;
  constructor(private controller: SessionController, private connectionId: string, private matchId: string) {
    const snapshot = controller.getSnapshot();
    this.owner = { id: snapshot.account?.id, version: snapshot.authContextVersion };
  }
  consume(controller: unknown, connectionId: string, matchId: string, me: string) {
    const current = this.controller.getSnapshot();
    if (this.consumed || controller !== this.controller || connectionId !== this.connectionId || matchId !== this.matchId || current.phase !== 'ready' || current.account?.id !== me || current.account?.id !== this.owner.id || current.authContextVersion !== this.owner.version) return false;
    this.consumed = true;
    return true;
  }
}
interface State {
  audioAccess: CounterpartAudioAccess;
  returnHome: string | null; status: SecondStatus | null; receivedAt: number; messages: Message[]; partnerId: string; partnerName: string;
  retryBlocked: boolean; busy: boolean; blocked: boolean; error: string; outgoing: Outgoing | null; confirmed: Outgoing | null; confirmationVersion: number; historyLimited: boolean;
  diagnostic: ReadDiagnostic | null;
  notice: string;
}
type ReadStage = 'match' | 'status' | 'chat' | 'messages' | 'action';
interface ReadDiagnostic { stage: ReadStage; kind: ApiError['kind'] | 'unexpected'; httpStatus: number }
// Retain only allowlisted metadata: never response bodies, URLs, IDs or exception text.
class ReadFailure extends Error {
  readonly diagnostic: ReadDiagnostic;
  constructor(stage: ReadStage, error: unknown) {
    super('second-chat-read');
    this.diagnostic = { stage, kind: error instanceof ApiError ? error.kind : 'unexpected', httpStatus: error instanceof ApiError ? error.status : 0 };
  }
}
const diagnostic = (error: unknown): ReadDiagnostic => error instanceof ReadFailure ? error.diagnostic : new ReadFailure('action',error).diagnostic;
const terminal = (status: SecondStatus | null) => !!status && ['FINISHED','ABANDONED','EXPIRED','CANCELLED','CLOSED'].includes(status.chatStatus ?? '');
const audioConflictCodes = new Set(['CHAT_AUDIO_FEATURE_DISABLED','CHAT_AUDIO_GUIDANCE_REQUIRED','CHAT_AUDIO_GUIDANCE_NOT_AVAILABLE','CHAT_AUDIO_LIMIT_REACHED','CHAT_AUDIO_WAITING_FOR_BOTH','CHAT_AUDIO_NOT_AVAILABLE_YET','CHAT_NOT_AVAILABLE','SECOND_CHAT_EXPIRED','SECOND_CHAT_ALREADY_RESOLVED','SECOND_CHAT_CONVERSATION_ALREADY_RESOLVED','SECOND_CHAT_JOIN_REQUIRED','CHAT_MUTUAL_CANCELLATION_PENDING']);
/** Owns one connection and one authenticated lifetime. Reads never release mutation ownership. */
export class SecondChatSession {
  private state: State = { audioAccess: 'UNKNOWN', returnHome: null, status: null, receivedAt: 0, messages: [], partnerId: '', partnerName: '', retryBlocked: false, busy: false, blocked: true, error: '', diagnostic: null, notice: '', outgoing: null, confirmed: null, confirmationVersion: 0, historyLimited: false };
  private readonly history: ParticipantHistory;
  get eligible() { return this.history.eligible; }
  private observeAccess = (access: CounterpartAudioAccess) =>
    this.history.observe(access, messages => this.install({ messages, audioAccess: this.history.access }));
  private listeners = new Set<() => void>();
  private lifetime = new AbortController();
  private read: AbortController | null = null;
  private readTask: Promise<void> | null = null;
  private generation = 0;
  private writing = false;
  private entering = false;
  private alternate = false;
  private retired = false;
  private expiryPending = false;
  private readonly homePartnerName: string;
  private audioLifecycleConflict = false;
  private attendanceUncertain = false;
  private identityCurrent() { const s = this.controller.getSnapshot?.(); return !s || s.phase === 'ready' && s.account?.id === this.me; }
  constructor(private controller: Pick<SessionController,'request'> & Partial<Pick<SessionController,'getSnapshot'>>, readonly connectionId: string, readonly matchId: string, readonly me: string, partnerName?: string | null) { this.history = new ParticipantHistory(me); this.homePartnerName = partnerName?.trim() ?? ''; this.state = { ...this.state, partnerName: this.homePartnerName }; }
  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  getSnapshot = () => this.state;
  private install(p: Partial<State>) { if (!this.lifetime.signal.aborted) { this.state = { ...this.state, ...p }; this.listeners.forEach(f => f()); } }
  start() { if (this.retired || !this.identityCurrent()) return; if (this.lifetime.signal.aborted) { this.lifetime = new AbortController(); this.generation++; this.read = null; this.writing = false; this.entering = false; this.install({ partnerName: this.homePartnerName }); } }
  dispose() { this.history.clear(); this.lifetime.abort(); this.read?.abort(); this.generation++; this.state = { ...this.state, returnHome: null, status: null, partnerId: '', partnerName: '', outgoing: null, confirmed: null, messages: [], busy: false, blocked: true }; this.listeners.forEach(f => f()); }
  get now() { return this.state.status ? Date.parse(this.state.status.serverTime) + Math.max(0, Date.now() - this.state.receivedAt) : Date.now(); }
  get rules() { return secondPolicy(this.state.status,this.now); }
  get canReturnHome() { return !this.state.busy && !this.attendanceUncertain && (this.state.status ? this.rules.canReturn : !!this.state.diagnostic && [403,404].includes(this.state.diagnostic.httpStatus)); }
  private current(g: number, signal: AbortSignal) { return this.identityCurrent() && !this.retired && g === this.generation && !signal.aborted && !this.lifetime.signal.aborted; }
  private request(path: string, signal: AbortSignal, method = 'GET', body?: unknown) { return this.controller.request(path,signal,method,body); }
  private installStatus(status: SecondStatus, receivedAt: number, partnerId: string) {
    const readable = secondPolicy(status, Date.parse(status.serverTime)).readable;
    const replaced = this.state.status?.chatId !== status.chatId;
    if (!readable || replaced) this.history.clear();
    this.install({ status, receivedAt, partnerId, ...(!readable || replaced ? { messages: [] } : {}) });
    return readable;
  }
  private async load(signal: AbortSignal, g: number, full = false) {
    let stage: ReadStage = 'match';
    try {
      let partnerId = this.state.partnerId;
      if (!partnerId) {
        const match = await this.request(`/matches/${this.matchId}`,signal);
        if (!object(match) || match.id !== this.matchId || (match.userAId !== this.me && match.userBId !== this.me)) throw new ApiError('invalid');
        partnerId = str(match.userAId === this.me ? match.userBId : match.userAId);
        if (partnerId === this.me) throw new ApiError('invalid');
      }
      stage = 'status';
      const status = parseSecondStatus(await this.request(`/connections/${this.connectionId}/second-chat/status`,signal),this.connectionId,[this.me,partnerId]);
      const receivedAt = Date.now();
      if (!this.current(g,signal)) return;
      // Install lifecycle immediately: slow message reads cannot extend write/retention windows.
      this.attendanceUncertain = false;
      if (!this.installStatus(status, receivedAt, partnerId)) { this.install({ blocked: false }); return; }
      stage = 'chat';
      const raw = await this.request(`/chats/${status.chatId}`,signal);
      if (!object(raw) || raw.id !== status.chatId || raw.matchId !== this.matchId || raw.connectionId !== this.connectionId || raw.chatType !== 'SECOND_CHAT') throw new ApiError('invalid');
      if (!this.current(g,signal)) return;
      stage = 'messages';
      const terminalAudio = terminal(status) && !!(this.state.outgoing?.file || this.state.confirmed?.file);
      this.alternate = !this.alternate;
      let cursor = full || terminalAudio ? undefined : this.history.cursor(this.alternate);
      const bounded = !cursor;
      let incoming: Message[] = [], limited = false;
      const seen = new Set<string>();
      for (let page = 0; page < 20; page++) {
        const value = await this.history.page(this.controller, `/chats/${status.chatId}/messages?limit=500${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`, signal, () => this.current(g,signal), access => {
          this.observeAccess(access);
          incoming = this.history.scrub(incoming);
        });
        if (!this.current(g,signal)) return;
        const rows = Array.isArray(value) ? value : object(value) && Array.isArray(value.messages) && typeof value.hasMore === 'boolean' ? value.messages : null;
        if (!rows) throw new ApiError('invalid');
        const parsed = rows.map(v => parseMessage(v,status.chatId ?? '',[this.me,partnerId]));
        incoming = mergeMessages(incoming,this.history.scrub(parsed));
        if (!object(value) || !value.hasMore) {
          limited = !cursor && rows.length >= 500;
          // The initial backend list has no hasMore. Resolve a terminal audio's
          // UUID beyond that first page before deciding that it was not committed.
          if (!(terminalAudio && Array.isArray(value) && rows.length === 500)) break;
        }
        const next = parsed.at(-1)?.id;
        if (!next || next === cursor || seen.has(next)) throw new ApiError('invalid');
        seen.add(next); cursor = next; limited = true;
        if (page === 19) throw new ApiError('invalid');
      }
      if (!this.current(g,signal)) return;
      if (!this.rules.readable) { this.history.clear(); this.install({ messages: [], blocked: false }); return; }
      const messages = this.history.finishRead(incoming, bounded), outgoing = this.state.outgoing;
      const confirmed = outgoing && messages.some(m => m.senderId === this.me && m.clientMessageId === outgoing.clientMessageId);
      this.install({ messages, blocked: false, historyLimited: limited,
        ...(confirmed ? { outgoing: null, confirmed: outgoing, confirmationVersion: this.state.confirmationVersion + 1 } : {}),
        ...(terminalAudio ? { error: '', diagnostic: null,
          notice: confirmed || this.state.confirmed?.file ? 'El segundo chat terminó. Tu audio quedó guardado en la conversación.' : limited ? 'El segundo chat terminó. No pudimos verificar todo el historial del audio pendiente.' : this.audioLifecycleConflict ? 'El segundo chat terminó y ya no admite audios. El audio pendiente no se envió.' : 'El segundo chat terminó. El audio pendiente no se envió.',
          ...(!limited || confirmed || this.state.confirmed?.file ? { outgoing: null, confirmed: null, retryBlocked: false } : {}) } : {}) });
    } catch (error) {
      if (this.current(g,signal) && pairBlocked(error)) this.observeAccess('RESTRICTED');
      throw new ReadFailure(stage,error);
    }
  }
  refresh = async (full = false, silent = false): Promise<void> => {
    if (this.retired || !this.identityCurrent() || this.writing || this.lifetime.signal.aborted) return;
    if (this.read) {
      // Playback renewal needs a full snapshot, not the result of an incremental poll.
      if (full && this.readTask) {
        const lifetime = this.lifetime;
        try { await this.readTask; } catch { return; }
        if (lifetime === this.lifetime && !lifetime.signal.aborted) return this.refresh(true,silent);
      }
      return;
    }
    const read = new AbortController(); this.read = read;
    const signal = AbortSignal.any([read.signal,this.lifetime.signal]), g = ++this.generation;
    const task = this.load(signal,g,full); this.readTask = task;
    try { await task; if (this.current(g,signal) && !silent) this.install({ error: '', diagnostic: null }); }
    catch (error) { if (this.current(g,signal)) this.install({ blocked: true, diagnostic: diagnostic(error), error: 'No pudimos actualizar el chat. Revisá tu conexión y reintentá.' }); }
    finally { if (g === this.generation) { this.read = null; this.readTask = null; } }
  };
  renewAudio = async (id: string) => {
    const lifetime = this.lifetime;
    const previous = this.state.messages.find(row => row.id === id);
    if (!previous?.audio || !this.current(this.generation, lifetime.signal) || !this.rules.readable) return null;
    if (this.read && this.readTask) {
      const generation = this.generation;
      try { await this.readTask; } catch { return null; }
      if (!this.current(generation, lifetime.signal) || !this.state.messages.some(row => row.id === id && row.audio)) return null;
    }
    const task = this.refresh(true);
    const generation = this.generation;
    await task;
    if (!this.current(generation, lifetime.signal) || !this.rules.readable || this.state.busy || this.state.blocked) return null;
    const fresh = this.state.messages.find(row => row.id === id);
    return fresh !== previous ? fresh?.audio?.url ?? null : null;
  };
  resume = () => { if (this.writing || this.entering) return; this.read?.abort(); this.read = null; return this.refresh(); };
  private async write(path: string, method: string, body?: unknown, outgoing?: Outgoing) {
    if (this.writing || this.lifetime.signal.aborted) return;
    this.writing = true; this.read?.abort(); this.read = null;
    if (path.endsWith('/join')) this.attendanceUncertain = true;
    const g = ++this.generation, signal = this.lifetime.signal;
    this.install({ busy: true, error: '', diagnostic: null, notice: '', ...(outgoing ? { confirmed: null, outgoing: { ...outgoing, phase: 'pending' } } : {}) });
    let errorText = '';
    const safety = path.endsWith('/safety-cancellations') || path.endsWith('/block');
    try {
      const result = await this.request(path,signal,method,body);
      if (!this.current(g,signal)) return;
      if (path.startsWith(`/connections/${this.connectionId}/second-chat/`)) {
        const status = parseSecondStatus(result,this.connectionId,[this.me,this.state.partnerId]);
        if (path.endsWith('/join') && !['ON_TIME','LATE'].includes(status.myAttendanceStatus)) throw new ApiError('invalid');
        // Preserve confirmed attendance even if the following chat/message read fails.
        this.attendanceUncertain = false;
        this.installStatus(status, Date.now(), this.state.partnerId);
      }
      if (safety) {
        const valid = path.endsWith('/block')
          ? object(result) && typeof result.id === 'string' && result.id.length > 0 && typeof result.source === 'string' && ['MANUAL','SAFETY_REPORT','ADMIN'].includes(result.source) && typeof result.createdAt === 'string' && Number.isFinite(Date.parse(result.createdAt))
          : object(result) && object(result.chat) && result.chat.id === this.state.status?.chatId && result.chat.status === 'CANCELLED';
        if (!valid) throw new ApiError('invalid');
        this.returnToHome(path.endsWith('/block') ? 'La persona qued\u00f3 bloqueada.' : 'Recibimos tu reporte y cerramos el chat por seguridad. Ser\u00e1 revisado.');
        return;
      }
      if (outgoing || method === 'PUT') {
        const message = parseMessage(result,this.state.status?.chatId ?? '',[this.me,this.state.partnerId]);
        if (outgoing && (message.senderId !== this.me || message.clientMessageId !== outgoing.clientMessageId)) throw new ApiError('invalid');
        this.install({ messages: outgoing ? this.history.merge([message]) : this.history.mergeReaction(path, message), ...(outgoing ? { outgoing: null, confirmed: outgoing, confirmationVersion: this.state.confirmationVersion + 1 } : {}) });
      }
    } catch (e) {
      if (!this.current(g,signal)) return;
      if (pairBlocked(e)) this.observeAccess('RESTRICTED');
      this.install({ diagnostic: diagnostic(e) });
      if (outgoing?.file) this.audioLifecycleConflict = e instanceof ApiError && e.status === 409 && audioConflictCodes.has(e.code);
      const ambiguous = !(e instanceof ApiError) || e.status === 0 || e.status >= 500 || e.kind === 'invalid';
      errorText = 'No pudimos confirmar la acción. Actualizamos el estado antes de permitir otro intento.';
      if (outgoing && this.state.outgoing) this.install({ retryBlocked: e instanceof ApiError && e.code.includes('IDEMPOTENCY'), outgoing: { ...outgoing, phase: ambiguous ? 'uncertain' : 'failed' } });
    }
    try {
      await this.load(signal,g,!!outgoing);
      if (safety && this.current(g,signal) && ['CANCELLED','CLOSED'].includes(this.state.status?.chatStatus ?? '')) this.returnToHome('La interacci\u00f3n ya no est\u00e1 disponible. Actualizamos Inicio.');
    }
    catch (error) { const failure = diagnostic(error); if (safety && this.current(g,signal) && [403,404].includes(failure.httpStatus)) { this.returnToHome('La interacci\u00f3n no est\u00e1 accesible. Consult\u00e1 Inicio para actualizar el estado.'); return; } if (this.current(g,signal)) this.install({ blocked: true, diagnostic: failure }); errorText = 'No pudimos reconciliar la acción. Reintentá la conexión antes de continuar.'; }
    finally { if (this.current(g,signal)) { this.writing = false; this.install({ busy: false, error: terminal(this.state.status) && this.state.notice ? '' : errorText }); } }
  }
  private returnToHome(message: string) {
    this.history.clear();
    this.install({ returnHome: message, busy: false, blocked: true, messages: [], outgoing: null, confirmed: null });
    this.retired = true; this.read?.abort();
  }
  checkAbsoluteExpiry = () => {
    if (this.retired || !this.identityCurrent()) return;
    if (this.rules.active && this.rules.expired) this.expiryPending = true;
    if (this.expiryPending && !this.state.busy) this.returnToHome('El segundo chat venci\u00f3.');
  };
  prepareSafety = async () => {
    if (this.retired || this.writing || this.entering || this.lifetime.signal.aborted || !this.identityCurrent()) return false;
    // Reconciliation only: a safety request never retries or replaces the retained UUID.
    this.entering = true; this.install({ busy: true }); this.read?.abort(); this.read = null;
    try { await this.refresh(true); }
    finally { this.entering = false; if (!this.retired) this.install({ busy: false }); }
    return this.allowed && this.rules.active && !this.rules.expired;
  };
  private get allowed() { return !this.retired && this.identityCurrent() && !this.entering && !this.writing && !this.state.blocked && !this.lifetime.signal.aborted; }
  openFromUserAction = (intent: SecondChatEntryIntent) => {
    if (this.retired || !this.identityCurrent() || this.lifetime.signal.aborted) return;
    if (!intent.consume(this.controller,this.connectionId,this.matchId,this.me)) return this.refresh();
    return this.enter(true);
  };
  join = () => this.enter(false);
  private async enter(initial: boolean) {
    if (this.entering || this.writing || this.retired || !this.identityCurrent() || this.lifetime.signal.aborted || (!initial && !this.allowed) || this.state.outgoing) return;
    const lifetime = this.lifetime, ownershipVersion = this.controller.getSnapshot?.().authContextVersion;
    this.entering = true; this.read?.abort(); this.read = null; this.install({ busy: true });
    try {
      await this.refresh();
      if (lifetime !== this.lifetime || lifetime.signal.aborted || ownershipVersion !== this.controller.getSnapshot?.().authContextVersion) return;
      this.entering = false;
      if (this.allowed && this.rules.canJoin && this.state.status?.myAttendanceStatus === 'PENDING') await this.write(`/connections/${this.connectionId}/second-chat/join`,'POST');
    } finally {
      if (lifetime === this.lifetime && !lifetime.signal.aborted && this.identityCurrent()) { this.entering = false; if (!this.writing) this.install({ busy: false }); }
    }
  }
  send(content: string, replyTo: Reply | null, file: Blob | null = null) {
    const a = this.state.status?.audioPolicy;
    if (!this.allowed || !this.rules.writable || this.state.outgoing || (file ? !a?.enabled || a.remainingMessages === 0 || file.type !== 'audio/mp4' || file.size > a.maxFileSizeBytes : !plainText(content))) return;
    if (replyTo && (replyTo.type !== 'MESSAGE' || !this.state.messages.some(m => m.id === replyTo.targetId && m.senderId !== this.me && (m.messageType === 'TEXT' || m.messageType === 'AUDIO')))) return;
    return this.sendOutgoing({ content: file ? null : content, file, replyTo, clientMessageId: crypto.randomUUID(), phase: 'pending' });
  }
  private sendOutgoing(o: Outgoing) { const request = messageRequest(this.state.status?.chatId ?? '',o); return this.write(request.path,'POST',request.body,o); }
  retry = async () => {
    if (!this.allowed || this.writing || this.state.retryBlocked) return;
    const outgoing = this.state.outgoing;
    if (!outgoing) return;
    await this.refresh(true);
    const current = this.state.outgoing;
    if (this.allowed && this.rules.writable && current?.clientMessageId === outgoing.clientMessageId) return this.sendOutgoing(outgoing);
  };
  discardFailed = () => { if (!this.writing && this.state.outgoing?.phase === 'failed') this.install({ outgoing: null, retryBlocked: false }); };
  react = (id: string) => {
    if (!this.allowed || !this.rules.writable || this.state.outgoing || !this.eligible.has(id)) return;
    return this.write(`/chats/${this.state.status?.chatId}/messages/${encodeURIComponent(id)}/reaction`,'PUT',{ type: 'HEART' });
  };
  action = (kind: 'no-show' | 'completion' | 'inactivity' | 'ACCEPTED' | 'REJECTED' | 'safety' | 'block', body?: unknown) => {
    if (!this.allowed || (this.state.outgoing && kind !== 'safety' && kind !== 'block')) return;
    const p = this.rules, s = this.state.status;
    if (!s || !p.active || p.expired) return;
    if (kind === 'no-show' && !p.noShow || kind === 'completion' && !p.completion || kind === 'inactivity' && !p.inactivity) return;
    if (['ACCEPTED','REJECTED'].includes(kind) && (!p.pending || p.pending.type !== 'MUTUAL_COMPLETION' || p.pending.responderUserId !== this.me || this.now >= Date.parse(p.pending.expiresAt))) return;
    if (kind === 'safety' && (!object(body) || !['INAPPROPRIATE_BEHAVIOR','HARASSMENT','CHILD_SAFETY_CONCERN','OTHER'].includes(str(body.reason)) || typeof body.details !== 'string' || !plainText(body.details) || typeof body.blockUser !== 'boolean')) return;
    const base = `/connections/${this.connectionId}/second-chat`;
    const path = kind === 'block' ? `/matches/${this.matchId}/block` : kind === 'safety' ? `/chats/${s.chatId}/safety-cancellations` : kind === 'no-show' ? `${base}/no-show-claims` : kind === 'completion' ? `${base}/completion-requests` : kind === 'inactivity' ? `${base}/inactivity-claims` : `${base}/completion-requests/${p.pending?.id}/decision`;
    return this.write(path,'POST',['ACCEPTED','REJECTED'].includes(kind) ? { decision: kind } : body);
  };
}
