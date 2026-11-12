import { AdminAccess } from '../admin/access';
import { parseAppeal, validStatement, validExpiry } from './suspension';
import type { Appeal } from './suspension';
import type { TabOwnershipManager } from '../tabs/TabOwnershipManager';
import { ApiClient, ApiError, DeletedAccountError, bootstrap, object, parseUser } from './api';
import type { BackendUser, Profile } from './api';
import { errorCode, isRateLimitResponse, safeMessage, terminalCodes } from './errors';
import type { AuthService, Identity } from './firebase';
import type { LoginErrorOwner } from './LoginScreen';

type Phase = 'checking' | 'login' | 'authenticating' | 'loading' | 'ready' | 'restricted' | 'recoverable' | 'signingOut' | 'deletionRecovery' | 'temporarySuspension' | 'permanentAppeal';
export interface SessionSnapshot {
  authContextVersion?: number;
  adminWarning?: string | null;
  phase: Phase;
  suspensionExpiry?: string | null;
  suspensionBusy?: boolean;
  appeal?: Appeal | null;
  appealUncertain?: boolean;
  recoveryBusy?: 'reactivate' | 'finalize' | 'refresh' | null;
  recoveryUncertain?: boolean;
  recoveryTerminal?: boolean;
  account: BackendUser | null;
  profile: Profile | null;
  error: { message: string; owner: LoginErrorOwner } | null;
  operation: 'signIn' | 'signUp' | 'google' | 'reset' | null;
  resetMessage: string | null;
  resetAt: number | null;
  verificationMessage: string | null;
}
const initial: SessionSnapshot = { authContextVersion: 0, adminWarning: null, recoveryBusy: null, recoveryUncertain: false, recoveryTerminal: false, phase: 'checking', account: null, profile: null, error: null, operation: null, resetMessage: null, resetAt: null, verificationMessage: null };
export class SessionController {
  private adminView = false;
  private adminViewEpoch = 0;
  setAdminView = (active: boolean) => {
    if (this.adminView === active) return;
    this.adminView = active; this.adminViewEpoch++;
    if (!active) this.admin.suspendView();
  };
  checkAdminEligibility = async (signal: AbortSignal) => {
    const generation = this.generation, user = this.user;
    if (!user || !this.auth.googleContext || this.snapshot.phase !== 'ready' || this.snapshot.account?.status !== 'ACTIVE') return false;
    const context = await this.auth.googleContext(user).catch(error => {
      if (this.current(generation) && terminalCodes.has(errorCode(error))) this.admin.fail(error);
      throw error;
    });
    signal.throwIfAborted();
    if (!this.current(generation)) return false;
    if (context.provider !== 'google.com') { this.admin.clear(); return false; }
    const raw = await this.request('/admin-auth/status', signal);
    signal.throwIfAborted();
    if (!this.current(generation)) return false;
    if (!object(raw) || typeof raw.configured !== 'boolean' || typeof raw.grantValid !== 'boolean') throw new ApiError('invalid');
    if ((!raw.configured || !raw.grantValid) && this.admin.token()) this.admin.fail(new ApiError('authorization', 403, raw.configured ? 'ADMIN_MFA_REQUIRED' : 'ADMIN_MFA_NOT_CONFIGURED'));
    return raw.configured;
  };
  private pageHide = () => { void this.leaveAdmin(); };
  revokeAdminAccess = async () => {
    const generation = this.generation;
    await this.leaveAdmin();
    if (this.current(generation) && this.adminView) await this.admin.check();
  };
  readonly admin = new AdminAccess(
    (path, signal, method, body) => this.request(path, signal, method, body),
    () => { if (!this.user || !this.auth.googleContext) return Promise.reject(new Error('Google no está disponible. Cerrá sesión e ingresá con Google.')); return this.auth.googleContext(this.user); },
    () => { if (!this.available() || this.locked || !this.user || !this.auth.reauthenticateGoogle) return Promise.reject(new Error('Google no está disponible. Cerrá sesión e ingresá con Google.')); return this.auth.reauthenticateGoogle(this.user); },
  );
  // Capture the owned identity/grant before invalidation. Never block logout indefinitely.
  leaveAdmin = () => {
    const grant = this.admin.token(), user = this.user;
    this.admin.clear();
    if (!grant || !user || !this.available()) return Promise.resolve();
    return this.api.request('/admin-auth/revoke', AbortSignal.timeout(5000), user, 'POST', undefined, 204, false, grant).then(() => {}, () => {
      // Local retirement is unconditional; backend absolute expiry remains the safeguard.
      if (this.user === user && this.available()) this.install({ adminWarning: 'No se pudo confirmar la revocación administrativa. El acceso local fue eliminado; contactá al operador si necesitás revocación inmediata.' });
    });
  };
  snapshot: SessionSnapshot = initial;
  private listeners = new Set<() => void>();
  private unsubscribe: (() => void) | undefined;
  private user: Identity | null = null;
  private generation = 0;
  private observerEpoch = 0;
  private controller = new AbortController();
  private locked = false;
  private pendingVerification: Identity | null = null;
  private readonly ownershipSignal: AbortSignal | undefined;
  constructor(private readonly auth: AuthService, private readonly api: ApiClient, private readonly localVerification: boolean, private readonly ownership?: TabOwnershipManager) { this.ownershipSignal = ownership?.signal; }
  private available() { return !this.ownership || (!this.ownershipSignal?.aborted && this.ownership.getSnapshot() === 'active'); }
  private suspend = () => {
    this.observerEpoch++; this.unsubscribe?.(); this.unsubscribe = undefined;
    this.invalidate(); this.locked = false; this.user = null; this.pendingVerification = null;
    this.snapshot = initial;
  };
  private install(patch: Partial<SessionSnapshot>) { this.snapshot = { ...this.snapshot, ...patch }; this.listeners.forEach(listener => listener()); }
  getSnapshot = () => this.snapshot;
  // Domain requests share the existing identity, cancellation and restriction handling.
  request = async (path: string, signal: AbortSignal, method = 'GET', body?: unknown) => {
    this.ownership?.assert();
    const generation = this.generation;
    const user = this.user;
    if (!user || this.snapshot.phase !== 'ready') throw new DOMException('Sesión obsoleta', 'AbortError');
    const administrative = path.startsWith('/admin/') || path.startsWith('/admin-auth/');
    const grant = administrative ? this.admin.token() : undefined;
    const viewEpoch = this.adminViewEpoch;
    if (path.startsWith('/admin/') && (!this.adminView || !grant || this.admin.getSnapshot().phase !== 'allowed')) throw new ApiError('authorization', 403, 'ADMIN_MFA_REQUIRED');
    try {
      const result = await this.api.request(path, AbortSignal.any([signal, this.controller.signal]), user, method, body, administrative ? (path === '/admin-auth/revoke' ? 204 : 200) : undefined, !administrative, grant);
      if (path.startsWith('/admin/') && (!this.adminView || viewEpoch !== this.adminViewEpoch || this.admin.token() !== grant || this.admin.getSnapshot().phase !== 'allowed')) throw new DOMException('Sesión obsoleta', 'AbortError');
      if (!this.current(generation)) throw new DOMException('Sesión obsoleta', 'AbortError');
      return result;
    } catch (error) {
      if (administrative && grant !== this.admin.token()) throw new DOMException('Solicitud administrativa obsoleta', 'AbortError');
      if (administrative && this.current(generation) && error instanceof ApiError && (error.status === 401 || error.status === 403)) this.admin.fail(error);
      // Admin writes must never replay or automatically reenter after token denial.
      if (this.current(generation) && administrative && errorCode(error) === 'INVALID_TOKEN') {
        this.invalidate(); this.locked = false;
        this.install({ phase: 'restricted', account: null, profile: null, error: { message: safeMessage(error), owner: 'shared' } });
        throw error;
      }
      if (this.current(generation) && !isRateLimitResponse(error) && (terminalCodes.has(errorCode(error)) || errorCode(error).startsWith('ACCOUNT_'))) {
        if (!this.restrict(error)) { this.invalidate(); this.locked = false; void this.load(); }
      }
      throw error;
    }
  };
  // The caller selects an operation, never an arbitrary restricted URL/method.
  recoverDeletion = async (operation: 'reactivate' | 'finalize' | 'refresh') => {
    if (!this.available() || this.locked || !this.user || this.snapshot.phase !== 'deletionRecovery') return;
    const account = this.snapshot.account;
    if (!account || account.status !== 'DELETED') return;
    if (operation !== 'refresh' && (this.snapshot.recoveryUncertain || this.snapshot.recoveryTerminal || !account.deletedAt || !account.deletionFinalizesAt || Date.parse(account.deletedAt) >= Date.parse(account.deletionFinalizesAt))) return;
    this.locked = true;
    const generation = this.generation, user = this.user, signal = this.controller.signal;
    this.install({ recoveryBusy: operation, error: null });
    try {
      const path = operation === 'refresh' ? '/me' : operation === 'reactivate' ? '/me/reactivation' : '/me/deletion/finalization';
      const raw = await this.api.request(path, signal, user, operation === 'refresh' ? 'GET' : 'POST', undefined, 200, operation === 'refresh');
      const result = parseUser(raw);
      if (!this.current(generation)) return;
      if (result.id !== account.id) throw new ApiError('invalid');
      if (operation === 'finalize') {
        if (result.status !== 'DELETED' || !result.deletedAt || !object(raw) || raw.deletionFinalizesAt !== null) throw new ApiError('invalid');
        this.signOut(); return;
      }
      if (result.status === 'ACTIVE') {
        // Retire recovery before a fresh owned bootstrap; never install a speculative profile.
        this.locked = false; this.invalidate(); await this.load(); return;
      }
      if (operation === 'reactivate') throw new ApiError('invalid');
      this.install({ account: result, profile: null, recoveryUncertain: false });
    } catch (error) {
      if (!this.current(generation)) return;
      const terminal = !isRateLimitResponse(error) && errorCode(error) === 'ACCOUNT_DELETION_FINALIZED';
      // Any failed write requires a read before another deliberate write, including auth failures.
      this.install({ recoveryTerminal: terminal || !!this.snapshot.recoveryTerminal, recoveryUncertain: this.snapshot.recoveryUncertain || operation !== 'refresh', error: { owner: 'shared', message: terminal ? 'La cuenta ya no puede recuperarse. Podés crear una cuenta nueva.' : operation === 'refresh' ? safeMessage(error) : 'No pudimos confirmar el resultado. Consultá el estado de la cuenta antes de volver a intentar.' } });
    } finally {
      if (this.current(generation)) { this.locked = false; this.install({ recoveryBusy: null }); }
    }
  };
  verifyEmail = async (send: boolean) => {
    this.ownership?.assert();
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
  changePassword = async (current: string, next: string) => {
    if (!this.available() || this.locked || !this.user || !this.hasPasswordProvider || !this.auth.changePassword || this.snapshot.phase !== 'ready') throw new Error('Cambio no disponible.');
    const generation = this.generation, user = this.user;
    this.locked = true;
    try {
      await this.auth.changePassword(user, current, next);
      if (!this.current(generation)) throw new DOMException('Sesión obsoleta', 'AbortError');
    } finally { if (this.current(generation)) this.locked = false; }
  };
  installProfile = (profile: Profile | null) => { if (this.available() && this.snapshot.phase === 'ready') this.install({ profile }); };
  subscribe = (listener: () => void) => {
    if (!this.available()) return () => {};
    this.listeners.add(listener);
    const lease = this.ownership?.signal;
    lease?.addEventListener('abort', this.suspend, { once: true });
    if (this.listeners.size === 1) {
      window.addEventListener('pagehide', this.pageHide);
      const epoch = ++this.observerEpoch;
      this.unsubscribe = this.auth.observe(user => {
        if (epoch !== this.observerEpoch || !this.listeners.size) return;
        if (!this.available() || this.snapshot.phase === 'signingOut') return;
        if (this.snapshot.phase === 'authenticating' && user) { this.user = user; return; }
        if (this.user?.uid === user?.uid && ['loading', 'ready', 'restricted', 'recoverable', 'deletionRecovery', 'temporarySuspension', 'permanentAppeal'].includes(this.snapshot.phase)) {
          if (user && this.snapshot.phase === 'ready') {
            this.user = user;
            this.install({ authContextVersion: (this.snapshot.authContextVersion ?? 0) + 1 });
            if (this.adminView) void this.admin.check();
          }
          return;
        }
        this.replace(user);
      }, error => {
        if (epoch !== this.observerEpoch || !this.listeners.size) return;
        this.invalidate(); this.locked = false;
        this.install({ phase: 'recoverable', operation: null, account: null, profile: null, error: { message: safeMessage(error), owner: 'shared' } });
      });
    }
    return () => {
      lease?.removeEventListener('abort', this.suspend);
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        window.removeEventListener('pagehide', this.pageHide);
        this.observerEpoch++;
        this.unsubscribe?.(); this.unsubscribe = undefined;
        this.invalidate(); this.locked = false; this.user = null;
      }
    };
  };
  private invalidate() { this.adminView = false; this.adminViewEpoch++; this.admin.clear(); this.controller.abort(); this.controller = new AbortController(); return ++this.generation; }
  private current(generation: number) { return this.available() && this.listeners.size > 0 && generation === this.generation; }
  private replace(user: Identity | null) {
    this.invalidate(); this.locked = false; this.user = user;
    if (this.pendingVerification?.uid !== user?.uid) this.pendingVerification = null;
    this.install({ ...initial, appeal: null, appealUncertain: false, suspensionExpiry: null, suspensionBusy: false, phase: user ? 'loading' : 'login', operation: null, account: null, profile: null, error: null, verificationMessage: null });
    this.ownership?.assert();
    const generation = this.generation;
    // StrictMode's synchronous cleanup cancels the first scheduled bootstrap.
    if (user) queueMicrotask(() => { if (this.current(generation)) void this.load(); });
  }
  private restrict(error: unknown, fetchAppeal = true) {
    const code = errorCode(error);
    if (!['ACCOUNT_TEMPORARILY_BANNED', 'ACCOUNT_PERMANENTLY_BANNED'].includes(code) || isRateLimitResponse(error)) return false;
    this.invalidate(); this.locked = false;
    this.install({ phase: code === 'ACCOUNT_TEMPORARILY_BANNED' ? 'temporarySuspension' : 'permanentAppeal', account: null, profile: null, error: null, appeal: null, appealUncertain: false, suspensionBusy: false, suspensionExpiry: error instanceof ApiError ? validExpiry(error.detail.expiresAt) : null });
    if (fetchAppeal && code === 'ACCOUNT_PERMANENTLY_BANNED') void this.refreshAppeal();
    return true;
  }
  // Minimal restricted capability: no arbitrary URL or method is exposed.
  refreshAppeal = () => this.runAppeal();
  submitAppeal = (statement: string) => this.runAppeal(statement);
  private async runAppeal(statement?: string) {
    if (!this.available() || this.locked || !this.user || this.snapshot.phase !== 'permanentAppeal') return;
    if (statement !== undefined && (this.snapshot.appeal?.status !== 'AVAILABLE' || this.snapshot.appealUncertain || !validStatement(statement))) return;
    this.locked = true;
    const generation = this.generation, user = this.user, signal = this.controller.signal;
    this.install({ suspensionBusy: true, error: null });
    let submissionError: string | null = null;
    try {
      if (statement !== undefined) {
        this.install({ appealUncertain: true });
        try { await this.api.request('/me/ban/appeal', signal, user, 'POST', { statement: statement.trim() }, 201, false); }
        catch (error) {
          if (!this.current(generation)) return;
          if (this.restrict(error, false)) return;
          submissionError = safeMessage(error);
          // Even an uncertain write or already-submitted conflict reconciles by GET only.
          if (terminalCodes.has(errorCode(error)) && errorCode(error) !== 'INVALID_TOKEN') throw error;
        }
      }
      const appeal = parseAppeal(await this.api.request('/me/ban/appeal', signal, user, 'GET', undefined, 200));
      if (!this.current(generation)) return;
      this.install({ appeal, appealUncertain: false, error: appeal.status === 'AVAILABLE' && submissionError ? { owner: 'shared', message: submissionError } : null });
      if (appeal.status === 'APPROVED') {
        this.locked = false;
        this.invalidate();
        await this.load();
      }
    } catch (error) {
      if (!this.current(generation)) return;
      if (this.restrict(error, false)) return;
      if (terminalCodes.has(errorCode(error))) { this.locked = false; this.invalidate(); await this.load(); return; }
      this.install({ appealUncertain: true, error: { owner: 'shared', message: 'No pudimos confirmar el estado de tu solicitud. Intentá actualizarlo.' } });
    } finally {
      if (this.current(generation)) { this.locked = false; this.install({ suspensionBusy: false }); }
    }
  }
  private async load() {
    const user = this.user;
    if (!user || this.locked) return;
    this.locked = true;
    this.ownership?.assert();
    const generation = this.generation;
    const signal = this.controller.signal;
    const preserved = ['temporarySuspension', 'permanentAppeal'].includes(this.snapshot.phase);
    this.install({ phase: preserved ? this.snapshot.phase : 'loading', suspensionBusy: preserved, operation: null, error: null, account: null, profile: null, recoveryBusy: null, recoveryUncertain: false, recoveryTerminal: false });
    try {
      if (this.pendingVerification?.uid === user.uid) {
        await this.auth.verify(user);
        if (!this.current(generation)) return;
        this.pendingVerification = null;
        this.install({ verificationMessage: 'Te enviamos un email para verificar tu cuenta.' });
      }
      const session = await bootstrap(this.api, user, signal, this.localVerification);
      if (this.current(generation)) this.install({ phase: 'ready', ...session, appeal: null, appealUncertain: false, suspensionBusy: false, suspensionExpiry: null });
    } catch (error) {
      if (!this.current(generation)) return;
      if (this.restrict(error)) return;
      if (error instanceof DeletedAccountError) {
        this.install({ phase: 'deletionRecovery', account: error.account, profile: null, recoveryBusy: null, recoveryUncertain: false, recoveryTerminal: false, error: null });
      } else if (terminalCodes.has(errorCode(error))) {
        // Clear only the identity owned by this generation; auth observer is gated.
        this.install({ phase: 'signingOut' });
        try { await this.auth.signOut(); }
        catch { if (this.current(generation)) this.install({ phase: 'recoverable', error: { message: 'No pudimos cerrar la sesión inválida. Intentá cerrar sesión nuevamente.', owner: 'shared' } }); return; }
        if (this.current(generation)) { this.user = null; this.install({ phase: 'login', error: { message: safeMessage(error), owner: 'shared' } }); }
      } else {
        const restricted = ['ACCOUNT_PENDING_DELETION', 'ACCOUNT_DELETED', 'ACCOUNT_TEMPORARILY_BANNED', 'ACCOUNT_PERMANENTLY_BANNED'].includes(errorCode(error));
        this.install({ phase: preserved && !restricted ? this.snapshot.phase : restricted ? 'restricted' : 'recoverable', error: { message: safeMessage(error), owner: 'shared' } });
      }
    } finally { if (this.current(generation)) { this.locked = false; this.install({ suspensionBusy: false }); } }
  }
  retry = () => {
    if (!this.available() || this.locked) return;
    if (this.snapshot.phase === 'permanentAppeal' && this.snapshot.appeal?.status !== 'APPROVED') { void this.refreshAppeal(); return; }
    if (this.snapshot.phase === 'deletionRecovery') { void this.recoverDeletion('refresh'); return; }
    if (this.user) void this.load();
    else this.install({ phase: 'login', error: null });
  };
  authenticate = (operation: 'signIn' | 'signUp' | 'google', email = '', password = '', keepSignedIn = false) => {
    if (!this.available() || this.locked || this.snapshot.phase !== 'login') return;
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
    if (!this.available() || this.locked || (this.snapshot.resetAt ?? 0) > Date.now()) return;
    const clean = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean)) {
      this.install({ error: { message: 'El email no tiene un formato válido.', owner: 'signIn' }, resetMessage: null }); return;
    }
    this.locked = true;
    this.ownership?.assert();
    const generation = this.generation;
    this.install({ operation: 'reset', error: null, resetMessage: null });
    void this.api.request('/auth/password-reset', this.controller.signal, undefined, 'POST', { email: clean }, 202).then(() => {
      if (this.current(generation)) this.install({ resetMessage: 'Si el email está registrado, te enviamos instrucciones para recuperar el acceso.', resetAt: Date.now() + 60000 });
    }).catch(error => {
      if (this.current(generation)) this.install({ error: { message: safeMessage(error, 'password-reset'), owner: 'signIn' } });
    }).finally(() => { if (this.current(generation)) { this.locked = false; this.install({ operation: null }); } });
  };
  signOut = () => {
    if (!this.available() || this.snapshot.phase === 'signingOut') return;
    const revoke = this.leaveAdmin();
    const generation = this.invalidate();
    this.locked = true;
    this.install({ phase: 'signingOut', operation: null, account: null, profile: null, error: null });
    void revoke.then(() => { if (!this.current(generation)) return; return this.auth.signOut(); }).then(() => {
      if (this.current(generation)) { this.user = null; this.pendingVerification = null; this.install({ ...initial, phase: 'login', adminWarning: this.snapshot.adminWarning ?? null }); }
    }).catch(error => {
      if (this.current(generation)) this.install({ phase: 'recoverable', error: { message: safeMessage(error), owner: 'shared' } });
    }).finally(() => { if (this.current(generation)) this.locked = false; });
  };
}
