import { ParticipantHistory, pairBlocked } from './participantHistory';
import { ApiError, object, type CounterpartAudioAccess } from '../auth/api';
import type { SessionController } from '../auth/session';
import { mergeMessages, parseChat, parseGuidance, parseExits, parseMutualExitAcknowledgement, parseMessage, plainText, policy, mutualExitDeadline, str } from './contracts';
import type { Chat, Exit, Message, Reply } from './contracts';
import { confirmsOutgoing, messageRequest, type Outgoing } from './messageRequest';
export type FirstChatClosure = boolean | 'local-expiry';
export type { Outgoing } from './messageRequest';
type ExitAction = 'mutual' | 'acceptance' | 'rejection' | 'timeout';
interface State { exitAction: ExitAction | null; textReady: boolean; foregroundVerified: boolean; pendingReaction: string | null; audioAccess: CounterpartAudioAccess; decisionPending: 'approve' | 'reject' | null; guidancePending: boolean; messageError: boolean; messagePending: boolean; confirmedReply: Reply | null; confirmedFile: Blob | null; reactionFeedback: 'pending' | 'error' | null; chat: Chat | null; messages: Message[]; exits: Exit[]; busy: boolean; error: string; blocked: boolean; outgoing: Outgoing | null; confirmed: string | null; confirmationVersion: number; offset: number; historyLimited: boolean }
export class ChatSession {
  private state: State = { exitAction: null, textReady: false, foregroundVerified: false, pendingReaction: null, audioAccess: 'UNKNOWN', decisionPending: null, guidancePending: false, messageError: false, messagePending: false, confirmedReply: null, confirmedFile: null, reactionFeedback: null, chat: null, messages: [], exits: [], busy: false, error: '', blocked: true, outgoing: null, confirmed: null, confirmationVersion: 0, offset: 0, historyLimited: false };
  private readonly history: ParticipantHistory;
  get eligible() { return this.history.eligible; }
  private observeAccess = (access: CounterpartAudioAccess) => {
    if (access === 'RESTRICTED') this.hideContactRange();
    this.history.observe(access, messages => this.install({ messages, audioAccess: this.history.access,
      pendingReaction: access === 'RESTRICTED' ? null : this.state.pendingReaction }));
  };
  private listeners = new Set<() => void>();
  private lifetime = new AbortController();
  private read: AbortController | null = null;
  private serial = 0;
  private disclosureEpoch = 0;
  private postWriteRead: AbortController | null = null;
  private interruptedCursor: { cursor: string | undefined } | null = null;
  private lastTextRefresh = 0;
  poll = () => {
    if (this.checkAbsoluteDeadline()) return;
    if (this.rules.expired && (this.writing || this.read)) return this.verifyInactivity();
    if (this.state.outgoing?.phase === 'pending' && this.writing && Date.now() - this.decisionStarted >= 5000)
      return this.verifyExitDuringSend(this.state.outgoing);
    if (Date.now() - this.lastTextRefresh >= 500) return this.refresh(false,true);
  };
  private writing = false;
  private decisionStarted = 0;
  private reconcileReactions = false;
  private partner = '';
  private terminal = false;
  private terminalNotice: string | null = null;
  private timeoutAttempt: { id: string; count: number; retryAt: number; recoverable: boolean } | null = null;
  private absoluteDeadline = Infinity;
  private clockUncertainty = 0;
  private checkingInactivity = false;
  private checkingSendExit = false;
  private async verifyExitDuringSend(outgoing: Outgoing) {
    if (this.checkingSendExit) return;
    this.checkingSendExit = true;
    const serial = this.serial;
    try {
      const raw = await this.request(`/chats/${this.chatId}/exit-requests`, this.lifetime.signal);
      if (this.current(serial) && this.state.outgoing === outgoing)
        this.install({ exits: this.readExits(raw) });
    } catch (error) {
      if (this.current(serial) && this.state.outgoing === outgoing && !this.terminalError(error))
        this.install({ error: 'No pudimos verificar las solicitudes de salida mientras se entrega el mensaje.' });
    } finally { this.checkingSendExit = false; }
  }
  private verifiedInactivity: Pick<Chat, 'serverTime' | 'inactivityExpiresAt'> | null = null;

  private reconcileInactivity(chat: Chat) {
    const verified = this.verifiedInactivity;
    if (verified && Date.parse(verified.serverTime) > Date.parse(chat.serverTime))
      return { ...chat, inactivityExpiresAt: verified.inactivityExpiresAt };
    return chat;
  }
  constructor(private controller: SessionController, readonly matchId: string, readonly chatId: string, readonly me: string, private onTerminal: (message: string, closed: FirstChatClosure) => void) { this.history = new ParticipantHistory(me); }
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.state;
  private install(patch: Partial<State>) { if (!this.lifetime.signal.aborted) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); } }
  start() { if (this.lifetime.signal.aborted) { this.lifetime = new AbortController(); this.read = null; this.writing = false; this.serial++; } }
  dispose() { this.postWriteRead?.abort(); this.postWriteRead = null; this.interruptedCursor = null; this.lastTextRefresh = 0; this.hideContactRange(); this.history.clear(); this.install({ textReady: false, foregroundVerified: false, pendingReaction: null, messages: [], blocked: true }); this.lifetime.abort(); this.read?.abort(); }
  private hideContactRange(background = false) {
    const chat = this.state.chat;
    if (chat?.sharedContactRange) {
      const { sharedContactRange, ...concealed } = chat;
      this.install({ chat: concealed, ...(background ? { foregroundVerified: false } : {}) });
    } else if (background && this.state.foregroundVerified) this.install({ foregroundVerified: false });
  }
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
  private finish(message: string, closed: FirstChatClosure = true) {
    if (this.terminal) return;
    this.terminal = true;
    this.install({ busy: false, decisionPending: null, exitAction: null, guidancePending: false, messagePending: false, outgoing: null, confirmedFile: null, chat: null, exits: [] });
    this.dispose();
    this.onTerminal(this.terminalNotice ?? message, closed);
  }
  private checkAbsoluteDeadline = () => {
    if (this.terminal || !this.current(this.serial)) return true;
    if (Date.now() < this.absoluteDeadline) return false;
    // Home suppresses automatic re-entry by chat ID. Only a backend result marks a match closed.
    this.finish('El plazo del chat terminó.', 'local-expiry');
    return true;
  };
  private async verifyInactivity() {
    if (this.checkingInactivity || this.terminal || !this.current(this.serial)) return;
    const serial = this.serial, signal = this.lifetime.signal;
    this.checkingInactivity = true;
    try {
      // The normal reconciliation may be waiting for an upload or a history body.
      const raw = await this.request(`/matches/${this.matchId}/chat`, signal);
      if (!this.current(serial)) return;
      const chat = parseChat(raw, this.matchId, this.chatId, this.partner);
      if (['CANCELLED','EXPIRED','ABANDONED','CLOSED','FINISHED'].includes(chat.status))
        this.finish(chat.status === 'ABANDONED' ? 'El chat se cerró por inactividad.' : 'El chat terminó.');
      else if (chat.status === 'ACTIVE') {
        const displayed = this.state.chat;
        if (displayed && Date.parse(chat.serverTime) >= Date.parse(displayed.serverTime) &&
            chat.myDecision === displayed.myDecision && chat.partnerDecision === displayed.partnerDecision) {
          this.verifiedInactivity = { serverTime: chat.serverTime, inactivityExpiresAt: chat.inactivityExpiresAt };
          this.install({ chat: { ...displayed, inactivityExpiresAt: chat.inactivityExpiresAt } });
        }
      } else throw new ApiError('invalid');
    } catch (error) {
      if (this.current(serial) && !this.terminalError(error))
        this.install({ error: 'No pudimos verificar el plazo de inactividad. Revisá tu conexión.' });
    } finally { this.checkingInactivity = false; }
  }
  private terminalError(error: unknown) {
    if (error instanceof ApiError && ['CHAT_EXPIRED','CHAT_ABANDONED'].includes(error.code)) {
      this.finish(error.code === 'CHAT_ABANDONED' ? 'El chat se cerró por inactividad.' : 'El chat venció.'); return true;
    }
    return false;
  }
  private async request(path: string, signal: AbortSignal, method = 'GET', body?: unknown) {
    const serial = this.serial;
    try { return await this.controller.request(path, signal, method, body); }
    catch (error) {
      if (!signal.aborted && this.current(serial) && pairBlocked(error)) this.observeAccess('RESTRICTED');
      throw error;
    }
  }
  private parseMessage = (v: unknown) => parseMessage(v, this.chatId, [this.me, this.partner]);
  private async messages(signal: AbortSignal, serial: number, cursor?: string, onAccess?: (access: CounterpartAudioAccess) => void): Promise<Message[]> {
    let result: Message[] = [], after = cursor;
    for (;;) {
      const raw = await this.history.page(this.controller, `/chats/${this.chatId}/messages?limit=500${after ? `&after=${encodeURIComponent(after)}` : ''}`, signal,
        () => this.current(serial) && !this.terminal && !signal.aborted, access => {
          this.observeAccess(access);
          onAccess?.(access);
          result = this.history.scrub(result);
        });
      const rows = Array.isArray(raw) ? raw : object(raw) && Array.isArray(raw.messages) && typeof raw.hasMore === 'boolean' ? raw.messages : null;
      if (!rows) throw new ApiError('invalid');
      const parsed = rows.map(this.parseMessage);
      result = mergeMessages(result, this.history.scrub(parsed));
      if (!object(raw) || raw.hasMore !== true) return result;
      const next = parsed.at(-1)?.id;
      if (!next || next === after) throw new ApiError('invalid');
      after = next;
      signal.throwIfAborted();
    }
  }
  private readExits(raw: unknown) {
    const exits = parseExits(raw, this.chatId, [this.me, this.partner]);
    const pending = this.rules.pending;
    if (pending && !exits.some(exit => exit.id === pending.id)) throw new ApiError('invalid');
    if (exits.some(exit => exit.type === 'MUTUAL_CANCEL' && ['ACCEPTED', 'REJECTED', 'TIMED_OUT'].includes(exit.status)))
      this.finish('La conversación se cerró.');
    return exits;
  }
  private async load(signal: AbortSignal, serial: number, full = false, sent?: { allowOverlap: boolean; cursor: string | undefined }) {
    const started = Date.now();
    const epoch = this.disclosureEpoch;
    const chatPath = `/matches/${this.matchId}/chat`;
    const exitsPath = `/chats/${this.chatId}/exit-requests`;
    // Start independent participant reads only with an initialized, validated owner.
    let lifecycleReady = false, headerAllowed = false;
    const updateTextLane = () => {
      if (sent?.allowOverlap && lifecycleReady && this.current(serial) && !signal.aborted) {
        this.interruptedCursor = sent;
        this.install({ textReady: headerAllowed && this.history.access === 'ALLOWED' && epoch === this.disclosureEpoch && document.visibilityState === 'visible' && this.state.chat?.myDecision === 'PENDING' && this.rules.ordinary });
      }
    };
    const page = sent && this.messages(signal, serial, sent.cursor, access => {
      headerAllowed = access === 'ALLOWED';
      updateTextLane();
    });
    page?.catch(() => {}); // Awaited after lifecycle validation.
    const parallel = sent && Promise.all([
      this.request(chatPath, signal).then(raw => ({ raw, received: Date.now() })),
      this.request(exitsPath, signal),
    ] as const);
    // The match can terminate before we consume the other responses.
    parallel?.catch(() => {});
    const match = await this.request(`/matches/${this.matchId}`, signal);
    if (!object(match) || match.id !== this.matchId || (match.userAId !== this.me && match.userBId !== this.me)) throw new ApiError('invalid');
    if (!this.current(serial)) return;
    const partner = str(match.userAId === this.me ? match.userBId : match.userAId);
    if (sent && partner !== this.partner) throw new ApiError('invalid');
    this.partner = partner;
    if (match.state !== 'CHAT_ACTIVE' && !['VISUAL_PHASE','VISUAL_APPROVED','CHAT_REJECTED','VISUAL_REJECTED','EXPIRED'].includes(str(match.state))) throw new ApiError('invalid');
    if (match.state !== 'CHAT_ACTIVE') { this.hideContactRange(); await this.presentDecision(signal); if (this.current(serial)) this.finish(this.state.decisionPending && match.state !== 'EXPIRED' ? '' : 'El chat terminó.'); return; }
    const snapshotStarted = parallel ? started : Date.now();
    const prefetched = await parallel;
    const raw = prefetched ? prefetched[0].raw : await this.request(chatPath, signal);
    if (!this.current(serial)) return;
    const received = prefetched?.[0].received ?? Date.now();
    const chat = parseChat(raw, this.matchId, this.chatId, this.partner);
    if (chat.status !== 'ACTIVE' && !['CANCELLED','EXPIRED','ABANDONED','CLOSED','FINISHED'].includes(chat.status)) throw new ApiError('invalid');
    if (chat.status !== 'ACTIVE') { if (this.current(serial)) this.finish(chat.status === 'ABANDONED' ? 'El chat se cerró por inactividad.' : 'El chat terminó. Actualizamos Inicio.'); return; }
    if (this.state.chat?.sharedContactRange !== chat.sharedContactRange) this.hideContactRange();
    const cursor = sent ? sent.cursor : full ? undefined : this.history.cursor(this.reconcileReactions);
    if (!sent) this.reconcileReactions = !this.reconcileReactions;
    const offset = Date.parse(chat.serverTime) - (snapshotStarted + received) / 2;
    this.clockUncertainty = Math.max(0, received - snapshotStarted) / 2 + 1;
    this.absoluteDeadline = Date.parse(chat.timeoutAt) - offset;
    if (this.checkAbsoluteDeadline()) return;
    if (chat.myDecision !== 'PENDING') {
      await this.presentDecision(signal);
      if (this.current(serial)) this.finish('', false);
      return;
    }
    if (prefetched) {
      const exits = this.readExits(prefetched[1]);
      const foregroundVerified = epoch === this.disclosureEpoch && document.visibilityState === 'visible';
      const provisional = { ...chat };
      if (!headerAllowed || !foregroundVerified || this.history.access !== 'ALLOWED') delete provisional.sharedContactRange;
      this.install({ chat: this.reconcileInactivity(provisional), exits, offset, foregroundVerified });
      lifecycleReady = true;
      updateTextLane();
    }
    const [messages, exits] = page ? [await page, this.state.exits] : await Promise.all([
      this.messages(signal, serial, cursor), this.request(exitsPath, signal).then(rawExits => {
        if (!this.current(serial)) return [];
        const exits = this.readExits(rawExits);
        if (exits.some(exit => exit.type === 'MUTUAL_CANCEL' && exit.status === 'PENDING'))
          this.install({ exits, offset });
        return exits;
      }),
    ]);
    if (!this.current(serial)) return;
    if (sent) this.reconcileReactions = !this.reconcileReactions;
    const merged = this.history.finishRead(messages, !cursor);
    const outgoing = this.state.outgoing;
    const confirmed = outgoing && merged.some(m => confirmsOutgoing(m, outgoing, this.me));
    const foregroundVerified = epoch === this.disclosureEpoch && document.visibilityState === 'visible';
    // An older or background read may retain an existing range, but cannot grant a new one.
    if (this.history.access === 'RESTRICTED' || (!foregroundVerified && chat.sharedContactRange !== this.state.chat?.sharedContactRange)) delete chat.sharedContactRange;
    this.install({ foregroundVerified, chat: this.reconcileInactivity(chat), messages: merged, exits, offset, blocked: false,
      ...(confirmed ? { outgoing: null, confirmed: outgoing.content, confirmedReply: outgoing.replyTo, confirmedFile: outgoing.file, confirmationVersion: this.state.confirmationVersion + 1 } : {}), historyLimited: this.state.historyLimited || (!cursor && messages.length >= 500) });
  }
  private current(serial: number) {
    const owner = this.controller.getSnapshot();
    return owner.phase === 'ready' && owner.account?.id === this.me && !this.lifetime.signal.aborted && serial === this.serial;
  }
  renewAudio = async (id: string) => {
    const lifetime = this.lifetime;
    const previous = this.state.messages.find(row => row.id === id);
    if (!previous?.audio || !this.current(this.serial) || this.terminal) return null;
    this.read?.abort();
    this.read = null;
    const task = this.refresh(true);
    const serial = this.serial;
    await task;
    if (lifetime !== this.lifetime || !this.current(serial) || this.terminal || this.state.busy || this.state.blocked) return null;
    const fresh = this.state.messages.find(row => row.id === id);
    return fresh !== previous ? fresh?.audio?.url ?? null : null;
  };
  concealContacts = () => {
    this.disclosureEpoch++;
    if (this.state.textReady) this.install({ textReady: false });
    this.hideContactRange(true);
  };
  invalidateForeground = () => {
    this.disclosureEpoch++;
    if (this.state.textReady) this.install({ textReady: false });
    if (this.state.foregroundVerified) this.install({ foregroundVerified: false });
  };
  resume = () => {
    this.invalidateForeground();
    if (this.checkAbsoluteDeadline()) return;
    if (this.terminal || this.writing || !this.current(this.serial)) return;
    // A foreground snapshot supersedes an older read, never an uncertain write.
    this.read?.abort(); this.read = null;
    return this.refresh(false, true);
  };
  refresh = async (full = false, silent = false) => {
    if (this.terminal || this.writing || this.read || !this.current(this.serial)) return;
    const read = new AbortController(); this.read = read;
    const signal = AbortSignal.any([read.signal, this.lifetime.signal]), serial = ++this.serial;
    // Bound the first snapshot even when a token provider ignores AbortSignal.
    const initial = !this.state.chat;
    const deadline = initial ? setTimeout(() => {
      if (!this.current(serial) || this.read !== read) return;
      read.abort(); this.read = null; this.serial++;
      this.install({ busy: false, blocked: true, error: 'La conversación está tardando en responder. Reintentá la conexión.' });
    }, 30000) : undefined;
    read.signal.addEventListener('abort', () => clearTimeout(deadline), { once: true });
    this.install({ busy: !this.state.chat });
    try { await this.load(signal, serial, full || this.state.blocked); if (this.current(serial) && (initial || !silent)) this.install({ error: '', reactionFeedback: null, messageError: false }); }
    catch (error) {
      if (this.current(serial) && !signal.aborted && !this.terminalError(error)) {
        this.hideContactRange();
        this.install({ blocked: true, error: 'No pudimos actualizar el chat. Revisá tu conexión y usá Reintentar conexión.' });
      }
    }
    finally { clearTimeout(deadline); if (this.current(serial)) { this.read = null; this.install({ busy: false }); } }
  };
  private get acknowledgedExitRead() {
    return this.postWriteRead !== null && (this.state.exitAction === 'mutual' ||
      (this.state.messagePending && !this.state.outgoing && !!this.rules.pending));
  }
  private async write(path: string, method: string, body: unknown, outgoing?: Outgoing, reactionId: string | null = null, exitAction: ExitAction | null = null) {
    if (this.terminal || (this.writing && !(outgoing && !outgoing.file && this.state.textReady) && !(exitAction === 'timeout' && this.acknowledgedExitRead)) || !this.current(this.serial)) return;
    const interrupted = this.state.textReady ? this.interruptedCursor : null;
    this.postWriteRead?.abort();
    this.postWriteRead = null;
    this.interruptedCursor = null;
    this.writing = true; this.read?.abort(); this.read = null;
    const serial = ++this.serial, signal = this.lifetime.signal;
    const sent = outgoing && !outgoing.file && this.state.chat && !this.state.blocked
      ? { allowOverlap: !interrupted, cursor: interrupted ? interrupted.cursor : this.history.cursor(this.reconcileReactions) } : undefined;
    const reconciliation = new AbortController();
    let accepted = false;
    this.decisionStarted = Date.now();
    this.install({ exitAction, textReady: false, pendingReaction: reactionId, busy: true, decisionPending: path.endsWith('/chat-decision') && object(body) ? body.decision==='APPROVED'?'approve':body.decision==='REJECTED'?'reject':null : null, guidancePending: path.endsWith('/guidance/next-request'), messageError: false, messagePending: !!outgoing, reactionFeedback: method === 'PUT' ? 'pending' : null, error: '', ...(outgoing ? { outgoing: { ...outgoing, phase: 'pending' } } : {}) });
    try {
      const result = await this.request(path, signal, method, body);
      if (!this.current(serial)) return;
      if (outgoing) {
        const message = this.parseMessage(result);
        if (!confirmsOutgoing(message, outgoing, this.me)) throw new ApiError('invalid');
        this.install({ messages: this.history.merge([message]), outgoing: null, confirmed: outgoing.content, confirmedReply: outgoing.replyTo, confirmedFile: outgoing.file, confirmationVersion: this.state.confirmationVersion + 1 });
      } else if (exitAction === 'mutual') {
        const latestCreation = Math.min(Date.now() + this.state.offset + this.clockUncertainty,
          this.absoluteDeadline + this.state.offset);
        const exit = parseMutualExitAcknowledgement(result, this.chatId, this.me, this.partner, latestCreation);
        if (this.state.exits.some(previous => previous.id === exit.id)) throw new ApiError('invalid');
        this.install({ exits: [...this.state.exits, exit] });
      } else if (exitAction) {
        if (!object(result) || !object(result.chat) || result.chat.status !== 'CANCELLED' ||
            result.chat.id !== this.chatId || result.chat.matchId !== this.matchId || result.chat.chatType !== 'FIRST_CHAT') throw new ApiError('invalid');
        const [resolved] = parseExits([result.exitRequest], this.chatId, [this.me, this.partner]);
        const pending = this.rules.pending;
        const expected = { acceptance: 'ACCEPTED', rejection: 'REJECTED', timeout: 'TIMED_OUT' };
        if (pending && resolved?.id === pending.id && resolved.type === pending.type &&
            resolved.requesterUserId === pending.requesterUserId && resolved.status === expected[exitAction]) {
          this.finish('La conversación se cerró.');
          return;
        }
        throw new ApiError('invalid');
      } else if (method === 'PUT') {
        this.install({ pendingReaction: null, messages: this.history.mergeReaction(path, this.parseMessage(result)) });
      }
      accepted = true;
      if (path.endsWith('/block') || path.endsWith('/safety-cancellations') && object(body) && body.blockUser === true) this.observeAccess('RESTRICTED');
      if (path.endsWith('/guidance/next-request') && this.state.chat) this.install({ chat: { ...this.state.chat, guidance: parseGuidance(result) } });
      if (path.endsWith('/safety-cancellations')) this.terminalNotice = 'Recibimos tu reporte y cerramos el chat por seguridad. Será revisado.';
      if (path.endsWith('/block')) this.terminalNotice = 'La persona quedó bloqueada. Actualizamos Inicio.';
      // The response is not used to synthesize lifecycle transitions; read authoritative state.
      this.postWriteRead = reconciliation;
      await this.load(AbortSignal.any([signal, reconciliation.signal]), serial, false, sent);
      if (sent && this.current(serial)) this.lastTextRefresh = Date.now();
    } catch (error) {
      if (!this.current(serial)) return;
      if (this.terminalError(error)) return;
      if (accepted) { this.hideContactRange(); this.install({ pendingReaction: null, blocked: true, messageError: !!outgoing, reactionFeedback: method === 'PUT' ? 'error' : null, error: 'La acción fue confirmada, pero no pudimos actualizar el chat. Usá Reintentar conexión; no hace falta repetirla.' }); return; }
      const ambiguous = !(error instanceof ApiError) || error.status === 0 || error.status >= 500 || error.kind === 'invalid';
      const code = error instanceof ApiError ? error.code : '';
      this.install({ pendingReaction: null, blocked: true, messageError: !!outgoing, reactionFeedback: method === 'PUT' ? 'error' : null, error: outgoing && ambiguous ? 'Envío sin confirmar. Actualizá antes de reintentar; conservamos el mismo mensaje.' : code === 'CHAT_APPROVAL_TOO_EARLY' || code.includes('PARTICIPATION') || code.includes('APPROVAL') ? 'Todavía no se cumplen los requisitos para aprobar. Seguí conversando y actualizá el estado.' : 'No pudimos completar la acción. Actualizá el estado antes de volver a intentar.',
        ...(outgoing && this.state.outgoing ? { outgoing: { ...outgoing, phase: ambiguous ? 'uncertain' : 'failed' } } : {}) });
      const attempt = exitAction === 'timeout' ? this.timeoutAttempt : null;
      if (attempt) attempt.recoverable = ambiguous || code === 'CHAT_EXIT_REQUEST_NOT_AVAILABLE';
      try {
        await this.load(signal, serial, !!outgoing);
        if (!this.current(serial)) return;
        if (attempt?.recoverable && attempt.count < 2 && this.rules.pending?.id === attempt.id) {
          attempt.retryAt = Date.now() + 2000;
          this.install({ error: '' });
        } else if (attempt && this.rules.pending?.id === attempt.id) {
          this.install({ error: code === 'CHAT_EXIT_REQUEST_NOT_AVAILABLE'
            ? 'La solicitud sigue pendiente. Actualizá la conexión para verificar si ya se puede cerrar.'
            : 'No pudimos confirmar el cierre. Actualizá la conexión para verificar el estado.' });
        } else if (exitAction === 'mutual' && this.rules.pending) this.install({ error: '' });
      } catch (readError) {
        if (this.current(serial)) this.terminalError(readError);
      }
    } finally { reconciliation.abort(); if (this.current(serial)) { this.postWriteRead = null; this.interruptedCursor = null; this.writing = false; this.install({ textReady: false, busy: false, exitAction: null, decisionPending: null, guidancePending: false, messagePending: false, reactionFeedback: this.state.reactionFeedback === 'pending' ? null : this.state.reactionFeedback }); } }
  }
  private get rules() { return policy(this.state.chat, this.state.exits, Date.now() + this.state.offset); }
  get canSendText() {
    return !this.terminal && this.current(this.serial) && !this.state.blocked && !this.state.outgoing &&
      this.history.access !== 'RESTRICTED' && this.state.chat?.myDecision === 'PENDING' && this.rules.ordinary &&
      ((!this.writing && !this.state.busy) || this.state.textReady);
  }
  replyAvailable(replyTo: Reply | null) {
    if (!replyTo) return true;
    if (replyTo.type === 'GUIDANCE_QUESTION') return this.state.chat?.guidance?.question.instanceId === replyTo.targetId;
    return this.state.messages.some(m => m.id === replyTo.targetId && m.senderId !== this.me);
  }
  send(content: string, replyTo: Reply | null, file: Blob | null = null) {
    const a = this.state.chat?.audioPolicy;
    if (file) {
      if (this.writing || this.state.busy || this.state.blocked || this.state.outgoing || !this.rules.ordinary ||
          !a?.enabled || a.remainingMessages === 0 || file.size > a.maxFileSizeBytes || file.type !== 'audio/mp4') return;
    } else if (!this.canSendText || !plainText(content)) return;
    if (!this.replyAvailable(replyTo)) {
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
    if (this.state.outgoing === o && !this.state.blocked && (o.file || this.history.access !== 'RESTRICTED') && this.rules.ordinary) return this.sendOutgoing(o);
  };
  editFailed = () => { if (!this.writing && this.state.outgoing?.phase === 'failed') this.install({ outgoing: null }); };
  checkExitTimeout = () => {
    if (this.checkAbsoluteDeadline()) return;
    const pending = this.rules.pending;
    if (!pending || this.rules.expired || !this.state.foregroundVerified || this.state.blocked ||
        ((this.state.busy || this.writing) && !this.acknowledgedExitRead)) return;
    if (Date.now() + this.state.offset < mutualExitDeadline(pending)) return;
    const previous = this.timeoutAttempt?.id === pending.id ? this.timeoutAttempt : null;
    if (previous && Date.now() < previous.retryAt) return;
    this.timeoutAttempt = { id: pending.id, count: (previous?.count ?? 0) + 1, retryAt: Infinity, recoverable: false };
    return this.write(`/chats/${this.chatId}/exit-requests/${encodeURIComponent(pending.id)}/timeout`, 'POST', undefined, undefined, null, 'timeout');
  };
  recover = async () => {
    if (this.writing || this.read) return;
    const attempt = this.timeoutAttempt;
    const task = this.refresh(true), serial = this.serial;
    await task;
    if (attempt && this.timeoutAttempt === attempt && this.current(serial) && !this.state.blocked && this.rules.pending?.id === attempt.id) {
      if (attempt.recoverable) this.timeoutAttempt = null;
      else this.install({ error: 'El servidor no permitió cerrar la conversación. Podés volver a consultar el estado.' });
    }
  };
  action = (kind: 'approve' | 'reject' | 'guidance' | 'mutual' | 'safety' | 'block' | 'acceptance' | 'rejection', body?: unknown, requestId?: string) => {
    if (this.writing || this.state.busy || this.state.blocked) return;
    const p = this.rules;
    // Reconcile an ambiguous send before a different write; safety remains available.
    if (this.state.outgoing?.phase === 'uncertain' && !['safety','block','acceptance','rejection'].includes(kind)) return;
    if ((kind === 'approve' || kind === 'reject') && !p.decide) return;
    if ((kind === 'guidance' || kind === 'mutual') && !p.ordinary) return;
    if ((kind === 'safety' || kind === 'block') && !p.safety) return;
    if (kind === 'safety' && (!object(body) || typeof body.reason !== 'string' || !['INAPPROPRIATE_BEHAVIOR','HARASSMENT','CHILD_SAFETY_CONCERN','OTHER'].includes(body.reason) || typeof body.details !== 'string' || !plainText(body.details) || typeof body.blockUser !== 'boolean')) return;
    if (kind === 'guidance' && (!this.state.chat?.guidance?.canRequestNext || this.state.chat.guidance.myNextRequested || this.state.chat.guidance.completed)) return;
    if ((kind === 'acceptance' || kind === 'rejection') && (!p.pending || p.pending.id !== requestId ||
        p.pending.responderUserId !== this.me || p.expired || Date.now() + this.state.offset >= mutualExitDeadline(p.pending))) return;
    const exitAction = kind === 'mutual' || kind === 'acceptance' || kind === 'rejection' ? kind : null;
    const path = kind === 'approve' || kind === 'reject' ? `/matches/${this.matchId}/chat-decision` : kind === 'block' ? `/matches/${this.matchId}/block` : `/chats/${this.chatId}/${kind === 'guidance' ? 'guidance/next-request' : kind === 'mutual' ? 'exit-requests' : kind === 'safety' ? 'safety-cancellations' : `exit-requests/${encodeURIComponent(requestId ?? '')}/${kind}`}`;
    return this.write(path, 'POST', kind === 'approve' || kind === 'reject' ? { decision: kind === 'approve' ? 'APPROVED' : 'REJECTED' } : kind === 'mutual' ? { reason: 'NO_LONGER_INTERESTED' } : body, undefined, null, exitAction);
  };
  react(id: string) {
    if (!this.rules.ordinary || this.state.busy || this.state.blocked || this.state.outgoing?.phase === 'uncertain' || !this.eligible.has(id)) return;
    return this.write(`/chats/${this.chatId}/messages/${encodeURIComponent(id)}/reaction`, 'PUT', { type: 'HEART' }, undefined, id);
  }
}
