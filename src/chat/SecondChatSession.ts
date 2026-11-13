import { ApiError, object } from '../auth/api';
import type { SessionController } from '../auth/session';
import { mergeMessages, parseMessage, plainText, reactable, reactionCursor, str, type Message, type Reply } from './contracts';
import { messageRequest, type Outgoing } from './messageRequest';
import { parseSecondStatus, secondPolicy, type SecondStatus } from './secondContracts';
interface State {
  status: SecondStatus | null; receivedAt: number; messages: Message[]; partnerId: string; partnerName: string;
  retryBlocked: boolean; busy: boolean; blocked: boolean; error: string; outgoing: Outgoing | null; confirmed: Outgoing | null; confirmationVersion: number; historyLimited: boolean;
}
/** Owns one connection and one authenticated lifetime. Reads never release mutation ownership. */
export class SecondChatSession {
  private state: State = { status: null, receivedAt: 0, messages: [], partnerId: '', partnerName: '', retryBlocked: false, busy: false, blocked: true, error: '', outgoing: null, confirmed: null, confirmationVersion: 0, historyLimited: false };
  private listeners = new Set<() => void>();
  private lifetime = new AbortController();
  private read: AbortController | null = null;
  private generation = 0;
  private writing = false;
  private entering = false;
  private alternate = false;
  constructor(private controller: Pick<SessionController,'request'>, readonly connectionId: string, readonly matchId: string, readonly me: string) {}
  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  getSnapshot = () => this.state;
  private install(p: Partial<State>) { if (!this.lifetime.signal.aborted) { this.state = { ...this.state, ...p }; this.listeners.forEach(f => f()); } }
  start() { if (this.lifetime.signal.aborted) { this.lifetime = new AbortController(); this.generation++; this.read = null; this.writing = false; this.entering = false; } }
  dispose() { this.lifetime.abort(); this.read?.abort(); this.generation++; this.state = { ...this.state, outgoing: null, confirmed: null, messages: [], blocked: true }; }
  get now() { return this.state.status ? Date.parse(this.state.status.serverTime) + Math.max(0, Date.now() - this.state.receivedAt) : Date.now(); }
  get rules() { return secondPolicy(this.state.status,this.now); }
  private current(g: number, signal: AbortSignal) { return g === this.generation && !signal.aborted && !this.lifetime.signal.aborted; }
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
    const partnerName = str(raw.partner.displayName);
    this.alternate = !this.alternate;
    let cursor = full ? undefined : this.alternate ? reactionCursor(this.state.messages) : this.state.messages.at(-1)?.id;
    let incoming: Message[] = [], limited = false;
    const seen = new Set<string>();
    for (let page = 0; page < 20; page++) {
      const value = await this.request(`/chats/${status.chatId}/messages?limit=500${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`,signal);
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
  refresh = async (full = false, silent = false) => {
    if (this.writing || this.read || this.lifetime.signal.aborted) return;
    const read = new AbortController(); this.read = read;
    const signal = AbortSignal.any([read.signal,this.lifetime.signal]), g = ++this.generation;
    try { await this.load(signal,g,full); if (this.current(g,signal) && !silent) this.install({ error: '' }); }
    catch { if (this.current(g,signal)) this.install({ blocked: true, error: 'No pudimos actualizar el chat. Revisá tu conexión y reintentá.' }); }
    finally { if (g === this.generation) this.read = null; }
  };
  resume = () => { if (this.writing) return; this.read?.abort(); this.read = null; return this.refresh(); };
  private async write(path: string, method: string, body?: unknown, outgoing?: Outgoing) {
    if (this.writing || this.lifetime.signal.aborted) return;
    this.writing = true; this.read?.abort(); this.read = null;
    const g = ++this.generation, signal = this.lifetime.signal;
    this.install({ busy: true, error: '', ...(outgoing ? { outgoing: { ...outgoing, phase: 'pending' } } : {}) });
    let errorText = '';
    try {
      const result = await this.request(path,signal,method,body);
      if (!this.current(g,signal)) return;
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
    try { await this.load(signal,g,!!outgoing); }
    catch { if (this.current(g,signal)) this.install({ blocked: true }); errorText = 'No pudimos reconciliar la acción. Reintentá la conexión antes de continuar.'; }
    finally { if (this.current(g,signal)) { this.writing = false; this.install({ busy: false, error: errorText }); } }
  }
  private get allowed() { return !this.entering && !this.writing && !this.state.blocked && !this.lifetime.signal.aborted; }
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
    if (!this.allowed || this.state.outgoing) return;
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
