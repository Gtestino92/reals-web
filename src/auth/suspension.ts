import { ApiError, object } from './api';

export interface Appeal { status: 'AVAILABLE' | 'PENDING' | 'REJECTED' | 'APPROVED'; banActive: boolean }
export function parseAppeal(raw: unknown): Appeal {
  if (!object(raw) || typeof raw.banActive !== 'boolean') throw new ApiError('invalid');
  const status = raw.status;
  if (status !== 'AVAILABLE' && status !== 'PENDING' && status !== 'REJECTED' && status !== 'APPROVED') throw new ApiError('invalid');
  if (raw.banActive !== (status !== 'APPROVED')) throw new ApiError('invalid');
  return { status, banActive: raw.banActive };
}
export function validStatement(value: string) {
  return value.length <= 1000 && !!value.trim() && !/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f<>]/.test(value);
}
export function validExpiry(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) return null;
  return new Date(`${value.slice(0, 10)}T00:00:00Z`).toISOString().slice(0, 10) === value.slice(0, 10) ? value : null;
}
