import { ApiError, object } from '../auth/api';
import type { SessionController } from '../auth/session';
import { mergeMessages, parseMessage, plainText, reactable, reactionCursor, str, type Message, type Reply } from './contracts';
import { messageRequest, type Outgoing } from './messageRequest';
import { parseSecondStatus, secondPolicy, type SecondStatus } from './secondContracts';
interface State {
  returnHome: string | null; status: SecondStatus | null; receivedAt: number; messages: Message[]; partnerId: string; partnerName: string;
  retryBlocked: boolean; busy: boolean; blocked: boolean; error: string; outgoing: Outgoing | null; confirmed: Outgoing | null; confirmationVersion: number; historyLimited: boolean;
}
/** Owns one connection and one authenticated lifetime. Reads never release mutation ownership. */
export class SecondChatSession {
  private state: State = { returnHome: null, status: null, receivedAt: 0, messages: [], partnerId: '', partnerName: '', retryBlocked: false, busy: false, blocked: true, error: '', outgoing: null, confirmed: null, confirmationVersion: 0, historyLimited: false };
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
  private identityCurrent() { const s = this.controller.getSnapshot?.(); return !s || s.phase === 'ready' && s.account?.id === this.me; }
  constructor(private controller: Pick<SessionController,'request'> & Partial<Pick<SessionController,'getSnapshot'>>, readonly connectionId: string, readonly matchId: string, readonly me: string) {}
  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  getSnapshot = () => this.state;
  private install(p: Partial<State>) { if (!this.lifetime.signal.aborted) { this.state = { ...this.state, ...p }; this.listeners.forEach(f => f()); } }
  start() { if (this.retired || !this.identityCurrent()) return; if (this.lifetime.signal.aborted) { this.lifetime = new AbortController(); this.generation++; this.read = null; this.writing = false; this.entering = false; } }
  dispose() { this.lifetime.abort(); this.read?.abort(); this.generation++; this.state = { ...this.state, returnHome: null, status: null, partnerId: '', partnerName: '', outgoing: null, confirmed: null, messages: [], busy: false, blocked: true }; this.listeners.forEach(f => f()); }
  get now() { return this.state.status ? Date.parse(this.state.status.serverTime) + Math.max(0, Date.now() - this.state.receivedAt) : Date.now(); }
  get rules() { return secondPolicy(this.state.status,this.now); }
  private current(g: number, signal: AbortSignal) { return this.identityCurrent() && !this.retired && g === this.generation && !signal.aborted && !this.lifetime.signal.aborted; }
  private request(path: string, signal: AbortSignal, method = 'GET', body?: unknown) { return this.controller.request(path,signal,method,body); }
  private async load(signal: AbortSignal, g: number, full = false) {
    let partnerId = this.state.partnerId;
    if (!partnerId) {
      const match = await this.request(`/matches/${this.matchId}`,signal);
      if (!object(match) || match.id !== this.matchId || (match.userAId !== this.me && match.userBId !== this.me)) throw new ApiError('invalid');
      partnerId = str(match.userAId === this.me ? match.userBId : match.userAId);
    }
    const status = parseSecondStatus(await this.request(`/connections/${this.connectionId}/second-chat/status`,signal),this.connectionId,[this.me,partnerId]);
    const receivedAt = Date.now();
    if (!this.current(g,signal)) return;
    // Install lifecycle immediately: slow message reads cannot extend write/retention windows.
    this.install({ status, receivedAt, partnerId });
    const rules = secondPolicy(status,Date.parse(status.serverTime));
    if (!rules.readable) { this.install({ messages: [], blocked: false }); return; }
    const raw = await this.request(`/chats/${status.chatId}`,signal);
    if (!object(raw) || raw.id !== status.chatId || raw.matchId !== this.matchId || raw.connectionId !== this.connectionId || raw.chatType !== 'SECOND_CHAT' || !object(raw.partner) || raw.partner.userId !== partnerId) throw new ApiError('invalid');
    if (!this.current(g,signal)) return;
    const partnerName = str(raw.partner.displayName);
    this.alternate = !this.alternate;
    let cursor = full ? undefined : this.alternate ? reactionCursor(this.state.messages) : this.state.messages.at(-1)?.id;
    let incoming: Message[] = [], limited = false;
    const seen = new Set<string>();
    for (let page = 0; page < 20; page++) {
      const value = await this.request(`/chats/${status.chatId}/messages?limit=500${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`,signal);
      if (!this.current(g,signal)) return;
      const rows = Array.isArray(value) ? value : object(value) && Array.isArray(value.messages) && typeof value.hasMore === 'boolean' ? value.messages : null;
      if (!rows) throw new ApiError('invalid');
      const parsed = rows.map(v => parseMessage(v,status.chatId ?? '',[this.me,partnerId]));
      incoming = mergeMessages(incoming,parsed);
      if (!object(value) || !value.hasMore) { limited = !cursor && rows.length >= 500; break; }
      const next = parsed.at(-1)?.id;
      if (!next || next === cursor || seen.has(next)) throw new ApiError('invalid');
      seen.add(next); cursor = next; limited = true;
      if (page === 19) throw new ApiError('invalid');
    }
    if (!this.current(g,signal)) return;
    const messages = mergeMessages(this.state.messages,incoming), outgoing = this.state.outgoing;
    const confirmed = outgoing && messages.some(m => m.senderId === this.me && m.clientMessageId === outgoing.clientMessageId);
    this.install({ messages, partnerName, blocked: false, historyLimited: limited,
      ...(confirmed ? { outgoing: null, confirmed: outgoing, confirmationVersion: this.state.confirmationVersion + 1 } : {}) });
  }
  refresh = async (full = false, silent = false): Promise<void> => {
    if (this.retired || !this.identityCurrent() || this.writing || this.lifetime.signal.aborted) return;
    if (this.read) {
      // Playback renewal needs a full snapshot, not the result of an incremental poll.
      if (full && this.readTask) { try { await this.readTask; } catch { return; } return this.refresh(true,silent); }
      return;
    }
    const read = new AbortController(); this.read = read;
    const signal = AbortSignal.any([read.signal,this.lifetime.signal]), g = ++this.generation;
    const task = this.load(signal,g,full); this.readTask = task;
    try { await task; if (this.current(g,signal) && !silent) this.install({ error: '' }); }
    catch { if (this.current(g,signal)) this.install({ blocked: true, error: 'No pudimos actualizar el chat. Revisá tu conexión y reintentá.' }); }
    finally { if (g === this.generation) { this.read = null; this.readTask = null; } }
  };
  resume = () => { if (this.writing) return; this.read?.abort(); this.read = null; return this.refresh(); };
  private async write(path: string, method: string, body?: unknown, outgoing?: Outgoing) {
    if (this.writing || this.lifetime.signal.aborted) return;
    this.writing = true; this.read?.abort(); this.read = null;
    const g = ++this.generation, signal = this.lifetime.signal;
    this.install({ busy: true, error: '', ...(outgoing ? { outgoing: { ...outgoing, phase: 'pending' } } : {}) });
    let errorText = '';
    const safety = path.endsWith('/safety-cancellations') || path.endsWith('/block');
    try {
      const result = await this.request(path,signal,method,body);
      if (!this.current(g,signal)) return;
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
        this.install({ messages: mergeMessages(this.state.messages,[message]), ...(outgoing ? { outgoing: null, confirmed: outgoing, confirmationVersion: this.state.confirmationVersion + 1 } : {}) });
      }
    } catch (e) {
      if (!this.current(g,signal)) return;
      const ambiguous = !(e instanceof ApiError) || e.status === 0 || e.status >= 500 || e.kind === 'invalid';
      errorText = 'No pudimos confirmar la acción. Actualizamos el estado antes de permitir otro intento.';
      if (outgoing && this.state.outgoing) this.install({ retryBlocked: e instanceof ApiError && e.code.includes('IDEMPOTENCY'), outgoing: { ...outgoing, phase: ambiguous ? 'uncertain' : 'failed' } });
    }
    try {
      await this.load(signal,g,!!outgoing);
      if (safety && this.current(g,signal) && ['CANCELLED','CLOSED'].includes(this.state.status?.chatStatus ?? '')) this.returnToHome('La interacci\u00f3n ya no est\u00e1 disponible. Actualizamos Inicio.');
    }
    catch (error) { if (safety && this.current(g,signal) && error instanceof ApiError && [403,404].includes(error.status)) { this.returnToHome('La interacci\u00f3n no est\u00e1 accesible. Consult\u00e1 Inicio para actualizar el estado.'); return; } if (this.current(g,signal)) this.install({ blocked: true }); errorText = 'No pudimos reconciliar la acción. Reintentá la conexión antes de continuar.'; }
    finally { if (this.current(g,signal)) { this.writing = false; this.install({ busy: false, error: errorText }); } }
  }
  private returnToHome(message: string) {
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
  join = async () => {
    if (!this.allowed || this.state.outgoing) return;
    const lifetime = this.lifetime;
    this.entering = true; this.read?.abort(); this.read = null; this.install({ busy: true });
    try {
      await this.refresh();
      if (lifetime !== this.lifetime || lifetime.signal.aborted) return;
      this.entering = false;
      if (this.allowed && this.rules.canJoin) await this.write(`/connections/${this.connectionId}/second-chat/join`,'POST');
    } finally {
      if (lifetime === this.lifetime && !lifetime.signal.aborted) { this.entering = false; if (!this.writing) this.install({ busy: false }); }
    }
  };
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
    if (!this.allowed || !this.rules.writable || this.state.outgoing || !reactable(this.state.messages,this.me).has(id)) return;
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
