import { validExpiry } from '../auth/suspension';
import { ApiError, object } from '../auth/api';
import { errorCode, safeMessage } from '../auth/errors';
import type { GoogleContext } from '../auth/firebase';

export interface AccessState { phase: 'checking' | 'totp' | 'google' | 'switch' | 'allowed' | 'error'; busy: boolean; message: string; retryAt: number }
const initial: AccessState = { phase: 'checking', busy: false, message: '', retryAt: 0 };
const messages: Record<string, string> = {
  ADMIN_ACCESS_DENIED: 'Acceso administrativo denegado. Confirmá Google y la configuración de identidad y aplicación con el operador.',
  ADMIN_MFA_NOT_CONFIGURED: 'El operador debe configurar el segundo factor administrativo en el servidor.',
  ADMIN_MFA_REQUIRED: 'Ingresá un nuevo código para verificar el acceso administrativo.',
  ADMIN_MFA_INVALID_CODE: 'Código inválido o ya utilizado. Ingresá un nuevo código del autenticador.',
  ADMIN_MFA_RATE_LIMITED: 'Demasiados intentos. Esperá el plazo indicado antes de volver a verificar.',
  RATE_LIMIT_EXCEEDED: 'Límite de solicitudes alcanzado. Esperá antes de volver a intentar.',
  ADMIN_GRANT_EXPIRED: 'El acceso administrativo venció. Verificá nuevamente tu identidad y código.',
  ADMIN_GRANT_REVOKED: 'El acceso administrativo fue revocado. Verificá nuevamente tu identidad y código.',
  ADMIN_AUTHENTICATION_UNAVAILABLE: 'La autenticación administrativa no está disponible. Esperá y volvé a consultar el estado.',
  APP_CHECK_NOT_CONFIGURED: 'Falta configurar App Check para esta aplicación Web. Contactá al operador.',
  MISSING_APP_CHECK_TOKEN: 'Falta la verificación App Check. Revisá la configuración Web con el operador.',
  INVALID_APP_CHECK_TOKEN: 'App Check rechazó esta aplicación. Revisá proveedor, dominio y allowlists con el operador.',
  APP_CHECK_VERIFICATION_UNAVAILABLE: 'No se pudo verificar App Check. Revisá la conexión y volvé a consultar el estado.',
};
export class AdminAccess {
  private state = initial;
  private grant: { token: string; expires: number } | null = null;
  private listeners = new Set<() => void>();
  private abort = new AbortController();
  private revision = 0;
  private expiry: ReturnType<typeof setTimeout> | undefined;
  constructor(private request: (path: string, signal: AbortSignal, method?: string, body?: unknown) => Promise<unknown>, private context: () => Promise<GoogleContext>, private google: () => Promise<void>) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private install(patch: Partial<AccessState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  clear = () => { this.abort.abort(); this.abort = new AbortController(); this.revision++; clearTimeout(this.expiry); this.grant = null; this.install({ ...initial, retryAt: this.state.retryAt }); };
  token = () => {
    if (this.grant && Date.now() >= this.grant.expires) this.fail(new ApiError('authorization', 403, 'ADMIN_GRANT_EXPIRED'));
    return this.grant?.token;
  };
  fail = (error: unknown) => {
    this.clear();
    const code = error instanceof ApiError ? error.code : '';
    const challenge = ['ADMIN_MFA_REQUIRED', 'ADMIN_GRANT_EXPIRED', 'ADMIN_GRANT_REVOKED', 'ADMIN_MFA_INVALID_CODE', 'ADMIN_MFA_RATE_LIMITED'].includes(code);
    this.install({ phase: challenge ? 'totp' : 'error', message: messages[code] ?? safeMessage(error), retryAt: error instanceof ApiError && error.retryAfterSeconds !== undefined ? Date.now() + error.retryAfterSeconds * 1000 : this.state.retryAt });
  };
  check = async () => {
    if (this.state.busy || (this.state.phase === 'error' && Date.now() < this.state.retryAt)) return;
    const authorized = !!this.token() && this.state.phase === 'allowed';
    const revision = this.revision, signal = this.abort.signal;
    // Revalidation is a GET, not a new authentication or a visual ownership change.
    this.install({ phase: authorized ? 'allowed' : 'checking', busy: true, message: '' });
    try {
      const context = await this.context();
      if (revision !== this.revision) return;
      if (context.provider !== 'google.com') { this.clear(); this.install({ phase: 'switch', busy: false }); return; }
      const raw = await this.request('/admin-auth/status', signal);
      if (revision !== this.revision) return;
      if (!object(raw) || typeof raw.configured !== 'boolean' || typeof raw.grantValid !== 'boolean') throw new ApiError('invalid');
      if (!raw.configured) throw new ApiError('authorization', 403, 'ADMIN_MFA_NOT_CONFIGURED');
      const token = this.token();
      if (revision !== this.revision) return;
      if (raw.grantValid && token) this.install({ phase: 'allowed', busy: false });
      else {
        this.grant = null; clearTimeout(this.expiry);
        const age = Date.now() - context.authTime;
        this.install({ phase: !Number.isFinite(age) || age < 0 || age >= 300000 ? 'google' : 'totp', busy: false });
      }
    } catch (error) {
      if (revision !== this.revision) return;
      const token = this.token();
      if (revision !== this.revision) return;
      const transient = (error instanceof ApiError && (error.kind === 'network' || error.status === 429 || error.status >= 500)) || errorCode(error) === 'auth/network-request-failed';
      if (token && transient) {
        // Block privileged UI, retaining only the unexpired session-owned credential for explicit recovery.
        this.install({ phase: 'error', busy: false, message: messages[errorCode(error)] ?? safeMessage(error), retryAt: error instanceof ApiError && error.retryAfterSeconds !== undefined ? Date.now() + error.retryAfterSeconds * 1000 : this.state.retryAt });
      } else this.fail(error);
    }
  };
  verify = async (code: string) => {
    if (this.state.phase !== 'totp' || this.state.busy || Date.now() < this.state.retryAt) return;
    if (!/^[0-9]{6}$/.test(code)) { this.install({ message: 'Ingresá seis dígitos.' }); return; }
    const revision = this.revision, signal = this.abort.signal;
    this.install({ busy: true, message: '' });
    try {
      const context = await this.context();
      if (revision !== this.revision) return;
      const age = Date.now() - context.authTime;
      if (context.provider !== 'google.com' || !Number.isFinite(age) || age < 0 || age >= 300000) { this.install({ phase: context.provider === 'google.com' ? 'google' : 'switch', busy: false }); return; }
      const raw = await this.request('/admin-auth/verify', signal, 'POST', { code });
      if (revision !== this.revision) return;
      if (!object(raw) || typeof raw.grant !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(raw.grant) || typeof raw.expiresAt !== 'string' || !validExpiry(raw.expiresAt) || Date.parse(raw.expiresAt) <= Date.now()) throw new ApiError('invalid');
      this.grant = { token: raw.grant, expires: Date.parse(raw.expiresAt) };
      this.expiry = setTimeout(() => { this.fail(new ApiError('authorization', 403, 'ADMIN_GRANT_EXPIRED')); }, Math.min(this.grant.expires - Date.now(), 2147483647));
      this.install({ busy: false });
      // Confirm the newly issued grant with the backend before mounting privileged UI.
      await this.check();
    } catch (error) { if (revision === this.revision) this.fail(error); }
  };
  reauthenticate = () => {
    if (this.state.busy || this.state.phase === 'switch') return;
    this.clear(); const revision = this.revision;
    this.install({ phase: 'google', busy: true, message: '' });
    let popup: Promise<void>;
    try { popup = this.google(); } catch (error) { popup = Promise.reject(error); }
    void popup.then(() => { if (revision === this.revision) { this.install({ busy: false }); return this.check(); } }).catch(error => { if (revision === this.revision) this.fail(error); });
  };
}
