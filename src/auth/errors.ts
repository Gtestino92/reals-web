export function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : '';
}
const messages: Record<string, string> = {
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
export function safeMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'kind' in error) {
    if (error.kind === 'invalid') return 'La respuesta del backend no es v?lida. Verific? la versi?n del servidor y reintent?.';
    if (error.kind === 'network') return 'No pudimos conectar con el backend. Revis? que est? iniciado y reintent?.';
  }
  return messages[errorCode(error)] ?? 'No pudimos completar la operación. Revisá tu conexión y volvé a intentar.';
}
