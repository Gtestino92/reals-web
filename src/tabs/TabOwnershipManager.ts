export type OwnershipState = 'initializing' | 'active' | 'blocked' | 'requesting-transfer' | 'error' | 'unsupported';
export const LOCK_NAME = 'reals:application:v1';
const CHANNEL = 'reals:tab-transfer:v1';
export class TabOwnershipManager {
  private state: OwnershipState = 'initializing';
  private listeners = new Set<() => void>();
  private channel: BroadcastChannel | null = null;
  private pending: AbortController | null = null;
  private lease = new AbortController();
  private release: (() => void) | null = null;
  private grant: string | null = null;
  private running = false;
  private resume = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  get signal() { return this.lease.signal; }
  assert = () => { if (this.state !== 'active') throw new DOMException('Pestaña inactiva', 'AbortError'); };
  private install(state: OwnershipState) { this.state = state; this.listeners.forEach(fn => fn()); }
  start = () => {
    if (this.running) return;
    this.running = true;
    if (!globalThis.isSecureContext || !navigator.locks || !globalThis.BroadcastChannel) { this.install('unsupported'); return; }
    try {
      this.channel = new BroadcastChannel(CHANNEL);
      this.channel.onmessage = ({ data }: MessageEvent<unknown>) => {
        if (typeof data !== 'object' || !data) return;
        if ('type' in data && data.type === 'ask' && this.grant) this.send({ type: 'owner', grant: this.grant });
        if ('type' in data && data.type === 'owner' && 'grant' in data && typeof data.grant === 'string' && this.pending) this.send({ type: 'release', grant: data.grant });
        if ('type' in data && data.type === 'release' && 'grant' in data && data.grant === this.grant && this.grant) this.revoke();
      };
      this.channel.onmessageerror = () => this.fail();
      window.addEventListener('pagehide', this.hide);
      window.addEventListener('pageshow', this.show);
      this.request();
    } catch { this.fail(); }
  };
  private send(message: { type: string; grant?: string }) { try { this.channel?.postMessage(message); } catch { this.fail(); } }
  private clearPending() { clearInterval(this.timer); clearTimeout(this.deadline); this.pending?.abort(); this.pending = null; }
  private revoke() {
    // Revoke requests synchronously BEFORE releasing the authoritative lock.
    this.state = 'blocked';
    this.lease.abort(); this.grant = null;
    this.install('blocked');
    this.release?.(); this.release = null;
  }
  private fail() { this.clearPending(); this.revoke(); this.channel?.close(); this.channel = null; this.install('error'); }
  request = () => {
    if (!this.running || this.pending || this.state === 'active') return;
    if (!this.channel) { this.running = false; this.start(); return; }
    const pending = new AbortController(); this.pending = pending;
    this.install('requesting-transfer');
    this.timer = setInterval(() => this.send({ type: 'ask' }), 250);
    this.deadline = setTimeout(() => { if (this.pending === pending) this.fail(); }, 8000);
    // Queue before asking for release: the browser serializes all contenders.
    try { void navigator.locks.request(LOCK_NAME, { mode: 'exclusive', signal: pending.signal }, async () => {
      if (!this.running || this.pending !== pending || pending.signal.aborted) return;
      const grant = crypto.randomUUID();
      clearInterval(this.timer); clearTimeout(this.deadline); this.pending = null;
      this.lease = new AbortController(); this.grant = grant;
      await new Promise<void>(resolve => { this.release = resolve; this.install('active'); this.send({ type: 'owner', grant }); });
    }).catch(() => { if (this.pending === pending) this.fail(); });
    } catch { this.fail(); }
    this.send({ type: 'ask' });
  };
  private hide = () => { this.resume = this.state === 'active' || !!this.pending; this.clearPending(); this.revoke(); };
  private show = (event: PageTransitionEvent) => { if (event.persisted && this.resume) { this.resume = false; this.request(); } };
  stop = () => {
    this.running = false; this.clearPending(); this.revoke();
    this.channel?.close(); this.channel = null;
    window.removeEventListener('pagehide', this.hide); window.removeEventListener('pageshow', this.show);
  };
}
