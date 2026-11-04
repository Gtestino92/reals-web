import { expect, it } from 'vitest';
import { ApiError } from './api';
import { safeMessage } from './errors';

// Escapes keep the expected accents independent of source-file encoding edits.
it.each([
  ['invalid', 'La respuesta del backend no es v\u00e1lida. Verific\u00e1 la versi\u00f3n del servidor y reintent\u00e1.'],
  ['network', 'No pudimos conectar con el backend. Revis\u00e1 que est\u00e9 iniciado y reintent\u00e1.'],
] as const)('preserves Spanish accents in the %s backend message', (kind, expected) => {
  expect(safeMessage(new ApiError(kind))).toBe(expected);
});
