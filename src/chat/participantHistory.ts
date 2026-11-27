import { ApiError, type CounterpartAudioAccess } from '../auth/api';
import type { SessionController } from '../auth/session';
import { mergeMessages, reactable, reactionCursor, type Message } from './contracts';

export const pairBlocked = (error: unknown) =>
  error instanceof ApiError && error.status === 409 && error.code === 'USER_PAIR_BLOCKED';

/** Keep server order and HEART boundaries after retiring a media capability. */
export class ParticipantHistory {
  private rows: Message[] = [];
  access: CounterpartAudioAccess = 'UNKNOWN';
  private recoveryPending = false;
  constructor(private me: string) {}

  private counterpartAudio(row: Message) { return row.senderId !== this.me && row.messageType === 'AUDIO'; }
  scrub(rows: Message[]) {
    return this.access === 'ALLOWED' ? rows : rows.map(row =>
      this.counterpartAudio(row) ? { ...row, audio: null, content: null } : row);
  }
  private visible() { return this.rows.filter(row => !this.counterpartAudio(row) || row.audio !== null); }
  observe(access: CounterpartAudioAccess, publish: (messages: Message[]) => void) {
    if (this.access === 'RESTRICTED') return;
    if (access === 'UNKNOWN') this.recoveryPending = true;
    if (this.access === access) return;
    this.access = access;
    this.rows = this.scrub(this.rows);
    publish(this.visible());
  }
  async page(controller: Pick<SessionController, 'request'>, path: string, signal: AbortSignal,
    current: () => boolean, observe: (access: CounterpartAudioAccess) => void) {
    let observed = false;
    const apply = (access: CounterpartAudioAccess) => {
      if (!current()) return;
      observed = true;
      observe(access);
    };
    try {
      const body = await controller.request(path, signal, 'GET', undefined, apply);
      if (!current()) throw new DOMException('Obsolete history', 'AbortError');
      if (!observed) apply('UNKNOWN');
      return body;
    } catch (error) {
      if (pairBlocked(error)) apply('RESTRICTED');
      throw error;
    }
  }
  merge(incoming: Message[]) {
    this.rows = mergeMessages(this.rows, this.scrub(incoming));
    return this.visible();
  }
  mergeReaction(path: string, message: Message) {
    const target = this.rows.find(row => row.id === message.id);
    if (message.reactionType !== 'HEART' || !target || !path.endsWith(`/messages/${encodeURIComponent(message.id)}/reaction`)
      || message.senderId !== target.senderId || message.messageType !== target.messageType
      || (this.counterpartAudio(target) && !target.audio)) throw new ApiError('invalid');
    return this.merge([message]);
  }
  finishRead(incoming: Message[], bounded: boolean) {
    if (bounded && this.access === 'ALLOWED') this.recoveryPending = false;
    return this.merge(incoming);
  }
  cursor(reactions: boolean) {
    if (this.recoveryPending && this.access === 'ALLOWED') return undefined;
    return reactions ? reactionCursor(this.rows) : this.rows.at(-1)?.id;
  }
  get eligible() { return reactable(this.rows, this.me); }
  clear() { this.rows = []; }
}
