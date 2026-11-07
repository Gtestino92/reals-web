import { ApiClient, bootstrap } from './api';
import type { BackendUser, Profile } from './api';
import { errorCode, safeMessage, terminalCodes } from './errors';
import type { AuthService, Identity } from './firebase';
import type { LoginErrorOwner } from './LoginScreen';

type Phase = 'checking' | 'login' | 'authenticating' | 'loading' | 'ready' | 'restricted' | 'recoverable' | 'signingOut';
export interface SessionSnapshot {
  phase: Phase;
  account: BackendUser | null;
  profile: Profile | null;
  error: { message: string; owner: LoginErrorOwner } | null;
  operation: 'signIn' | 'signUp' | 'google' | 'reset' | null;
  resetMessage: string | null;
  resetAt: number | null;
  verificationMessage: string | null;
}
const initial: SessionSnapshot = { phase: 'checking', account: null, profile: null, error: null, operation: null, resetMessage: null, resetAt: null, verificationMessage: null };
export class SessionController {
  snapshot: SessionSnapshot = initial;
  private listeners = new Set<() => void>();
  private unsubscribe: (() => void) | undefined;
  private user: Identity | null = null;
  private generation = 0;
  private observerEpoch = 0;
  private controller = new AbortController();
  private locked = false;
  private pendingVerification: Identity | null = null;
  constructor(private readonly auth: AuthService, private readonly api: ApiClient, private readonly localVerification: boolean) {}
  private install(patch: Partial<SessionSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(listener => listener()); }
  getSnapshot = () => this.snapshot;
  // Domain requests share the existing identity, cancellation and restriction handling.
  request = async (path: string, signal: AbortSignal, method = 'GET', body?: unknown) => {
    const generation = this.generation;
    const user = this.user;
    if (!user || this.snapshot.phase !== 'ready') throw new DOMException('Sesión obsoleta', 'AbortError');
    try {
      const result = await this.api.request(path, AbortSignal.any([signal, this.controller.signal]), user, method, body);
      if (!this.current(generation)) throw new DOMException('Sesión obsoleta', 'AbortError');
      return result;
    } catch (error) {
      if (this.current(generation) && (terminalCodes.has(errorCode(error)) || errorCode(error).startsWith('ACCOUNT_'))) {
        this.retry();
      }
      throw error;
    }
  };
  verifyEmail = async (send: boolean) => {
    const generation = this.generation;
    const user = this.user;
    if (!user) throw new DOMException('Sesión obsoleta', 'AbortError');
    if (send) await this.auth.verify(user);
    else { await user.reload(); if (!this.current(generation)) throw new DOMException('Sesión obsoleta', 'AbortError'); await user.getIdToken(true); }
    if (!this.current(generation)) throw new DOMException('Sesión obsoleta', 'AbortError');
    return user.emailVerified;
  };
  get emailVerified() { return this.user?.emailVerified ?? false; }
  get hasPasswordProvider() { return this.user?.providerData?.some(provider => provider.providerId === 'password') ?? null; }
  installProfile = (profile: Profile | null) => { if (this.snapshot.phase === 'ready') this.install({ profile }); };
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    if (this.listeners.size === 1) {
      const epoch = ++this.observerEpoch;
      this.unsubscribe = this.auth.observe(user => {
        if (epoch !== this.observerEpoch || !this.listeners.size) return;
        if (this.snapshot.phase === 'signingOut') return;
        if (this.snapshot.phase === 'authenticating' && user) { this.user = user; return; }
        if (this.user?.uid === user?.uid && ['loading', 'ready', 'restricted', 'recoverable'].includes(this.snapshot.phase)) return;
        this.replace(user);
      }, error => {
        if (epoch !== this.observerEpoch || !this.listeners.size) return;
        this.invalidate(); this.locked = false;
        this.install({ phase: 'recoverable', operation: null, account: null, profile: null, error: { message: safeMessage(error), owner: 'shared' } });
      });
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.observerEpoch++;
        this.unsubscribe?.(); this.unsubscribe = undefined;
        this.invalidate(); this.locked = false; this.user = null;
      }
    };
  };
  private invalidate() { this.controller.abort(); this.controller = new AbortController(); return ++this.generation; }
  private current(generation: number) { return this.listeners.size > 0 && generation === this.generation; }
  private replace(user: Identity | null) {
    this.invalidate(); this.locked = false; this.user = user;
    if (this.pendingVerification?.uid !== user?.uid) this.pendingVerification = null;
    this.install({ phase: user ? 'loading' : 'login', operation: null, account: null, profile: null, error: null, verificationMessage: null });
    const generation = this.generation;
    // StrictMode's synchronous cleanup cancels the first scheduled bootstrap.
    if (user) queueMicrotask(() => { if (this.current(generation)) void this.load(); });
  }
  private async load() {
    const user = this.user;
    if (!user || this.locked) return;
    this.locked = true;
    const generation = this.generation;
    const signal = this.controller.signal;
    this.install({ phase: 'loading', operation: null, error: null, account: null, profile: null });
    try {
      if (this.pendingVerification?.uid === user.uid) {
        await this.auth.verify(user);
        if (!this.current(generation)) return;
        this.pendingVerification = null;
        this.install({ verificationMessage: 'Te enviamos un email para verificar tu cuenta.' });
      }
      const session = await bootstrap(this.api, user, signal, this.localVerification);
      if (this.current(generation)) this.install({ phase: 'ready', ...session });
    } catch (error) {
      if (!this.current(generation)) return;
      if (terminalCodes.has(errorCode(error))) {
        // Clear only the identity owned by this generation; auth observer is gated.
        this.install({ phase: 'signingOut' });
        try { await this.auth.signOut(); }
        catch { if (this.current(generation)) this.install({ phase: 'recoverable', error: { message: 'No pudimos cerrar la sesión inválida. Intentá cerrar sesión nuevamente.', owner: 'shared' } }); return; }
        if (this.current(generation)) { this.user = null; this.install({ phase: 'login', error: { message: safeMessage(error), owner: 'shared' } }); }
      } else {
        const restricted = ['ACCOUNT_PENDING_DELETION', 'ACCOUNT_DELETED', 'ACCOUNT_TEMPORARILY_BANNED', 'ACCOUNT_PERMANENTLY_BANNED'].includes(errorCode(error));
        this.install({ phase: restricted ? 'restricted' : 'recoverable', error: { message: safeMessage(error), owner: 'shared' } });
      }
    } finally { if (this.current(generation)) this.locked = false; }
  }
  retry = () => {
    if (this.locked) return;
    if (this.user) void this.load();
    else this.install({ phase: 'login', error: null });
  };
  authenticate = (operation: 'signIn' | 'signUp' | 'google', email = '', password = '', keepSignedIn = false) => {
    if (this.locked || this.snapshot.phase !== 'login') return;
    const owner = operation === 'google' ? 'shared' : operation;
    if (operation !== 'google' && (!email.trim() || !password.trim())) {
      this.install({ error: { message: 'Ingresá email y contraseña.', owner } }); return;
    }
    this.locked = true;
    const generation = this.invalidate();
    this.install({ phase: 'authenticating', operation, error: null, resetMessage: null });
    // Called synchronously: popup opens in the original user interaction.
    let request: Promise<Identity>;
    try { request = operation === 'google' ? this.auth.google() : operation === 'signIn' ? this.auth.signIn(email.trim(), password, keepSignedIn) : this.auth.signUp(email.trim(), password, keepSignedIn); }
    catch (error) { request = Promise.reject(error); }
    void request.then(user => {
      if (!this.current(generation)) return;
      if (this.user && this.user.uid !== user.uid) { this.replace(this.user); return; }
      this.user = user;
      this.pendingVerification = operation === 'signUp' && !this.localVerification && !user.emailVerified ? user : null;
      this.locked = false;
      void this.load();
    }).catch(error => {
      if (!this.current(generation)) return;
      this.locked = false;
      this.install({ phase: 'login', operation: null, error: { message: safeMessage(error), owner } });
    });
  };
  reset = (email: string) => {
    if (this.locked || (this.snapshot.resetAt ?? 0) > Date.now()) return;
    const clean = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean)) {
      this.install({ error: { message: 'El email no tiene un formato válido.', owner: 'signIn' }, resetMessage: null }); return;
    }
    this.locked = true;
    const generation = this.generation;
    this.install({ operation: 'reset', error: null, resetMessage: null });
    void this.api.request('/auth/password-reset', this.controller.signal, undefined, 'POST', { email: clean }, 202).then(() => {
      if (this.current(generation)) this.install({ resetMessage: 'Si el email está registrado, te enviamos instrucciones para recuperar el acceso.', resetAt: Date.now() + 60000 });
    }).catch(error => {
      if (this.current(generation)) this.install({ error: { message: safeMessage(error), owner: 'signIn' } });
    }).finally(() => { if (this.current(generation)) { this.locked = false; this.install({ operation: null }); } });
  };
  signOut = () => {
    if (this.snapshot.phase === 'signingOut') return;
    const generation = this.invalidate();
    this.locked = true;
    this.install({ phase: 'signingOut', operation: null, account: null, profile: null, error: null });
    void this.auth.signOut().then(() => {
      if (this.current(generation)) { this.user = null; this.pendingVerification = null; this.install({ ...initial, phase: 'login' }); }
    }).catch(error => {
      if (this.current(generation)) this.install({ phase: 'recoverable', error: { message: safeMessage(error), owner: 'shared' } });
    }).finally(() => { if (this.current(generation)) this.locked = false; });
  };
}
