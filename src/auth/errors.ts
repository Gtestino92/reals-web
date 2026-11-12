export function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : '';
}
const messages: Record<string, string> = {
  APP_CHECK_NOT_CONFIGURED: 'Falta configurar App Check para esta aplicación Web. Contactá al operador.',
  MISSING_APP_CHECK_TOKEN: 'Falta la verificación App Check. Contactá al operador.',
  INVALID_APP_CHECK_TOKEN: 'App Check rechazó esta aplicación. Revisá la configuración con el operador.',
  APP_CHECK_VERIFICATION_UNAVAILABLE: 'No se pudo verificar App Check. Revisá la conexión e intentá nuevamente.',
  'auth/user-mismatch': 'La cuenta de Google no coincide con esta sesión. Elegí la misma cuenta de Reals.',
  'auth/admin-google-required': 'La confirmación no produjo una sesión reciente de Google. Cerrá sesión e ingresá con Google con la misma cuenta de Reals.',
  'auth/persistence-unavailable': 'No pudimos configurar la duración de la sesión. Recargá la página e intentá nuevamente.',
  'auth/invalid-credential': 'No se pudo iniciar sesión. Revisá el email y la contraseña. Si eliminaste tu cuenta, creá una nueva.',
  'auth/wrong-password': 'Revisá el email y la contraseña.',
  'auth/user-not-found': 'Revisá el email y la contraseña.',
  'auth/invalid-email': 'El email no tiene un formato válido.',
  'auth/weak-password': 'La contraseña es demasiado débil.',
  'auth/email-already-in-use': 'Ya existe una cuenta con ese email. Iniciá sesión con el método con el que creaste la cuenta.',
  'auth/account-exists-with-different-credential': 'Ya existe una cuenta asociada a ese email. Iniciá sesión con el método original.',
  'auth/popup-closed-by-user': 'Cancelaste el inicio de sesión con Google.',
  'auth/cancelled-popup-request': 'Se canceló el inicio de sesión con Google.',
  'auth/popup-blocked': 'El navegador bloqueó la ventana de Google. Permití ventanas emergentes e intentá nuevamente.',
  'auth/unauthorized-domain': 'Este dominio no está autorizado en Firebase Authentication. Revisá los dominios de desarrollo.',
  'auth/operation-not-allowed': 'El proveedor no está habilitado en Firebase Authentication.',
  'auth/network-request-failed': 'No pudimos conectar con Firebase. Revisá tu conexión e intentá nuevamente.',
  'auth/too-many-requests': 'Demasiados intentos. Esperá antes de volver a intentar.',
  'auth/user-disabled': 'Esta cuenta está deshabilitada. Volvé a iniciar sesión con una cuenta habilitada.',
  AUTH_METHOD_NOT_ALLOWED: 'Iniciá sesión con el método con el que creaste tu cuenta.',
  EMAIL_ALREADY_LINKED_TO_DIFFERENT_FIREBASE_USER: 'Ya existe una cuenta asociada a ese email. Iniciá sesión con el método original.',
  INVALID_TOKEN: 'Tu sesión necesita renovarse. Volvé a iniciar sesión.',
  ACCOUNT_DELETED: 'Tu cuenta está pendiente de eliminación.',
  ACCOUNT_PENDING_DELETION: 'Tu cuenta está pendiente de eliminación.',
  ACCOUNT_TEMPORARILY_BANNED: 'Tu cuenta está suspendida temporalmente.',
  ACCOUNT_PERMANENTLY_BANNED: 'Tu cuenta está suspendida permanentemente.',
};
export const terminalCodes = new Set(['INVALID_TOKEN', 'AUTH_METHOD_NOT_ALLOWED', 'EMAIL_ALREADY_LINKED_TO_DIFFERENT_FIREBASE_USER', 'UNSUPPORTED_AUTH_PROVIDER', 'auth/user-disabled', 'auth/user-token-expired', 'auth/invalid-user-token', 'auth/user-not-found']);
// Bound advisory copy, not eligibility. Covers backend provisioning windows up to 365 days.
export const maxRetryAfterSeconds = 365 * 24 * 60 * 60;
export function isRateLimitResponse(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === 429;
}
function approximateWait(error: object): string {
  if (!('retryAfterSeconds' in error) || typeof error.retryAfterSeconds !== 'number') return '';
  const seconds = error.retryAfterSeconds;
  if (!Number.isSafeInteger(seconds) || seconds < 0 || seconds > maxRetryAfterSeconds) return '';
  if (seconds === 0) return ' Podés reintentar en unos instantes.';
  const divisor = seconds < 60 ? 1 : seconds < 3600 ? 60 : seconds < 86400 ? 3600 : 86400;
  const unit = divisor === 1 ? 'segundo' : divisor === 60 ? 'minuto' : divisor === 3600 ? 'hora' : 'día';
  const amount = Math.ceil(seconds / divisor);
  return ` Esperá aproximadamente ${amount} ${unit}${amount === 1 ? '' : 's'} antes de reintentar.`;
}
export function safeMessage(error: unknown, context: 'general' | 'password-reset' = 'general'): string {
  if (isRateLimitResponse(error) && typeof error === 'object' && error !== null) {
    const code = errorCode(error);
    if (code === 'ACCOUNT_PROVISIONING_LIMIT_EXCEEDED') return 'Los nuevos registros desde esta conexión están temporalmente limitados. Intentá nuevamente más tarde.' + approximateWait(error);
    if (code === 'RATE_LIMIT_EXCEEDED') return (context === 'password-reset' ? 'Por ahora no se puede solicitar otra recuperación de acceso.' : 'Hay demasiadas solicitudes. Intentá nuevamente más tarde.') + approximateWait(error);
  }
  if (typeof error === 'object' && error !== null && 'kind' in error) {
    if (error.kind === 'invalid') return 'La respuesta del backend no es válida. Verificá la versión del servidor y reintentá.';
    if (error.kind === 'network') return 'No pudimos conectar con el backend. Revisá que esté iniciado y reintentá.';
  }
  return messages[errorCode(error)] ?? 'No pudimos completar la operación. Revisá tu conexión y volvé a intentar.';
}
