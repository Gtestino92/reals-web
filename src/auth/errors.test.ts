import { expect, it } from 'vitest';
import { ApiError } from './api';
import { safeMessage } from './errors';

it.each([
  [undefined, ''], [0, 'unos instantes'], [1, 'aproximadamente 1 segundo'], [59, 'aproximadamente 59 segundos'], [61, 'aproximadamente 2 minutos'],
  [3600, 'aproximadamente 1 hora'], [86401, 'aproximadamente 2 días'], [604800, 'aproximadamente 7 días'],
])('provisioning quota copy uses safe advisory waiting metadata %s', (seconds, hint) => {
  const error = new ApiError('backend', 429, 'ACCOUNT_PROVISIONING_LIMIT_EXCEEDED', { message: 'private diagnostic' }, seconds);
  const message = safeMessage(error);
  expect(message).toContain('Los nuevos registros desde esta conexión están temporalmente limitados.');
  if (hint) expect(message).toContain(hint); else expect(message).not.toContain('Esperá');
  expect(message).not.toContain('private diagnostic');
});
it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 31536001, Number.MAX_SAFE_INTEGER])('omits unsafe manually supplied waiting metadata %s', seconds => {
  expect(safeMessage(new ApiError('backend', 429, 'ACCOUNT_PROVISIONING_LIMIT_EXCEEDED', {}, seconds))).not.toMatch(/aproximadamente|instantes/);
});
it('uses generic rate-limit copy and neutral password-reset context without exposing backend details', () => {
  const error = new ApiError('backend', 429, 'RATE_LIMIT_EXCEEDED', { message: 'email exists' }, 60);
  expect(safeMessage(error)).toContain('Hay demasiadas solicitudes.');
  expect(safeMessage(error, 'password-reset')).toBe('Por ahora no se puede solicitar otra recuperación de acceso. Esperá aproximadamente 1 minuto antes de reintentar.');
  expect(safeMessage(new ApiError('backend', 500, 'OTHER'), 'password-reset')).toBe(safeMessage(new ApiError('backend', 500, 'OTHER')));
});

// Escapes keep the expected accents independent of source-file encoding edits.
it.each([
  ['invalid', 'La respuesta del backend no es v\u00e1lida. Verific\u00e1 la versi\u00f3n del servidor y reintent\u00e1.'],
  ['network', 'No pudimos conectar con el backend. Revis\u00e1 que est\u00e9 iniciado y reintent\u00e1.'],
] as const)('preserves Spanish accents in the %s backend message', (kind, expected) => {
  expect(safeMessage(new ApiError(kind))).toBe(expected);
});
