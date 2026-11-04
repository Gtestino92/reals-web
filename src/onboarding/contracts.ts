import { ApiError, object, parseProfile } from '../auth/api';
import type { Profile } from '../auth/api';

export const genders = ['MALE', 'FEMALE', 'NON_BINARY', 'OTHER'] as const;
export const intentions = ['DATE', 'FRIENDSHIP', 'CASUAL'] as const;
export const genderLabels = ['Hombre', 'Mujer', 'No binario', 'Otra identidad'];
export const preferenceLabels = ['Hombres', 'Mujeres', 'Personas no binarias', 'Otras identidades'];
export const intentionLabels = ['Citas', 'Amistad', 'Algo casual'];
export interface Fields {
  displayName: string; birthDate: string; gender: string; lookingForGenders: string[]; intention: string;
  city: string; countryCode: string; bio: string; preferredMinAge: number; preferredMaxAge: number; maxDistanceKm: number;
}
export interface FullProfile extends Profile, Fields { authenticityVerificationStatus: string }
export interface Country { code: string; displayName: string }
export interface Photo { id: string; url: string; position: number; validationStatus: string; moderationStatus: string; isPersonPhoto: boolean; isFullBody: boolean }
export interface LegalDocument { type: string; version: string; requiredAction: 'ACCEPTED' | 'ACKNOWLEDGED'; satisfied: boolean; url: string }
export const defaults: Fields = { displayName: '', birthDate: '1995-01-01', gender: 'MALE', lookingForGenders: ['FEMALE'], intention: 'DATE', city: '', countryCode: '', bio: '', preferredMinAge: 18, preferredMaxAge: 45, maxDistanceKm: 50 };
export function invalid(): never { throw new ApiError('invalid'); }
export function safeUrl(value: unknown): string {
  if (typeof value !== 'string') return invalid();
  try { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return invalid(); return value; } catch { return invalid(); }
}
export function countries(raw: unknown): Country[] {
  if (!Array.isArray(raw)) return invalid();
  return raw.map(item => { if (!object(item) || typeof item.code !== 'string' || !/^[A-Z]{2}$/.test(item.code) || typeof item.displayName !== 'string') return invalid(); return { code: item.code, displayName: item.displayName }; });
}
export function fullProfile(raw: unknown, userId: string): FullProfile {
  const base = parseProfile(raw, userId);
  if (!object(raw)) return invalid();
  const { displayName, birthDate, gender, lookingForGenders, intention, city, countryCode, bio, preferredMinAge, preferredMaxAge, maxDistanceKm, authenticityVerificationStatus } = raw;
  if (typeof displayName !== 'string' || typeof birthDate !== 'string' || typeof gender !== 'string' || !genders.some(x => x === gender) || !Array.isArray(lookingForGenders) || !lookingForGenders.every((x): x is string => typeof x === 'string' && genders.some(g => g === x)) || !lookingForGenders.length || typeof intention !== 'string' || !intentions.some(x => x === intention) || typeof city !== 'string' || typeof countryCode !== 'string' || (bio !== null && typeof bio !== 'string') || !Number.isInteger(preferredMinAge) || typeof preferredMinAge !== 'number' || preferredMinAge < 18 || !Number.isInteger(preferredMaxAge) || typeof preferredMaxAge !== 'number' || preferredMaxAge > 99 || preferredMinAge > preferredMaxAge || typeof maxDistanceKm !== 'number' || !Number.isInteger(maxDistanceKm) || maxDistanceKm < 1 || maxDistanceKm > 1000 || typeof authenticityVerificationStatus !== 'string') return invalid();
  const date = new Date(`${birthDate}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== birthDate || !['NOT_STARTED','PENDING','VERIFIED','REJECTED','NEEDS_REVIEW','STALE'].includes(authenticityVerificationStatus)) return invalid();
  return { ...base, displayName, birthDate, gender, lookingForGenders, intention, city, countryCode, bio: bio ?? '', preferredMinAge, preferredMaxAge, maxDistanceKm, authenticityVerificationStatus };
}
export function photos(raw: unknown): Photo[] {
  if (!Array.isArray(raw) || raw.length > 9) return invalid();
  const result = raw.map(item => {
    if (!object(item) || typeof item.id !== 'string' || !item.id || typeof item.position !== 'number' || !Number.isInteger(item.position) || item.position < 1 || item.position > 9 || typeof item.validationStatus !== 'string' || !['PENDING', 'VALIDATED', 'FAILED'].includes(item.validationStatus) || typeof item.moderationStatus !== 'string' || !['PENDING', 'APPROVED', 'REJECTED', 'NEEDS_REVIEW'].includes(item.moderationStatus) || typeof item.isPersonPhoto !== 'boolean' || typeof item.isFullBody !== 'boolean') return invalid();
    return { id: item.id, url: safeUrl(item.url), position: item.position, validationStatus: item.validationStatus, moderationStatus: item.moderationStatus, isPersonPhoto: item.isPersonPhoto, isFullBody: item.isFullBody };
  });
  if (new Set(result.map(x => x.id)).size !== result.length || new Set(result.map(x => x.position)).size !== result.length) return invalid();
  return result.sort((a,b) => a.position - b.position);
}
export function legal(status: unknown, catalog: unknown): { satisfied: boolean; documents: LegalDocument[] } {
  if (!object(status) || typeof status.requirementsSatisfied !== 'boolean' || !Array.isArray(status.documents) || !object(catalog) || !Array.isArray(catalog.documents)) return invalid();
  if (status.requirementsSatisfied) return { satisfied: true, documents: [] };
  if (status.documents.length === 0) return invalid();
  const entries = catalog.documents;
  const documents = status.documents.map((item): LegalDocument => {
    if (!object(item) || typeof item.type !== 'string' || typeof item.version !== 'string' || (item.requiredAction !== 'ACCEPTED' && item.requiredAction !== 'ACKNOWLEDGED') || typeof item.satisfied !== 'boolean') return invalid();
    const entry = entries.find((x: unknown) => object(x) && x.type === item.type && x.version === item.version && x.requiredAction === item.requiredAction);
    if (!object(entry)) return invalid();
    return { type: item.type, version: item.version, requiredAction: item.requiredAction, satisfied: item.satisfied, url: safeUrl(entry.url) };
  });
  return { satisfied: false, documents };
}
export const fold = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('es');
export function normalize(fields: Fields): Fields { return { ...fields, displayName: fields.displayName.trim(), city: fields.city.trim(), bio: fields.bio.trim(), countryCode: fields.countryCode.trim().toUpperCase() }; }
export function validate(f: Fields, catalog: Country[], mode: 'create' | 'details' | 'filters', now = new Date()): string[] {
  const errors: string[] = [];
  if (mode !== 'filters') {
    if (f.displayName.length < 2 || f.displayName.length > 100 || /[<>\r\n\x00-\x1f\x7f-\x9f]/.test(f.displayName)) errors.push('Nombre visible: usá texto simple de 2 a 100 caracteres.');
    if (!f.city || f.city.length > 100 || /[<>\r\n\x00-\x1f\x7f-\x9f]/.test(f.city)) errors.push('Ciudad: ingresá hasta 100 caracteres de texto simple.');
    if (!catalog.some(x => x.code === f.countryCode)) errors.push('Seleccioná un país del catálogo.');
    if (f.bio.length > 1000 || /[<>\x00-\x09\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(f.bio)) errors.push('Bio: usá texto simple de hasta 1.000 caracteres.');
  }
  if (mode === 'create') {
    const date = new Date(`${f.birthDate}T00:00:00Z`);
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(f.birthDate) && Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === f.birthDate;
    const age = now.getFullYear() - date.getUTCFullYear() - (now.getMonth() < date.getUTCMonth() || (now.getMonth() === date.getUTCMonth() && now.getDate() < date.getUTCDate()) ? 1 : 0);
    if (!validDate || age < 18 || age > 99) errors.push('Fecha de nacimiento: ingresá una fecha válida; debés tener entre 18 y 99 años.');
    if (!genders.some(x => x === f.gender)) errors.push('Seleccioná un género válido.');
  }
  if (mode !== 'details') {
    if (!intentions.some(x => x === f.intention) || !f.lookingForGenders.length || !f.lookingForGenders.every(x => genders.some(g => g === x))) errors.push('Elegí una intención y al menos un género que te interese.');
    if (![f.preferredMinAge, f.preferredMaxAge, f.maxDistanceKm].every(Number.isInteger) || f.preferredMinAge < 18 || f.preferredMaxAge > 99 || f.preferredMinAge > f.preferredMaxAge || f.maxDistanceKm < 1 || f.maxDistanceKm > 100) errors.push('Elegí edades entre 18 y 99 y una distancia entre 1 y 100 km.');
  }
  return errors;
}
export function hasInteractions(raw: unknown): boolean {
  if (!object(raw) || !object(raw.activeInteractionsSummary) || !['pendingActions', 'nextSteps', 'passiveNotices'].every(k => Array.isArray(raw[k]))) return invalid();
  const s = raw.activeInteractionsSummary;
  if (typeof s.hasPendingSchedulingConnection !== 'boolean' || !['activeInitialCount','activeConnectionCount','actionableConnectionCount'].every(k => typeof s[k] === 'number')) return invalid();
  return ['pendingActions','nextSteps','passiveNotices'].some(k => Array.isArray(raw[k]) && raw[k].length > 0) || s.hasPendingSchedulingConnection || ['activeInitialCount','activeConnectionCount','actionableConnectionCount'].some(k => typeof s[k] === 'number' && s[k] > 0);
}
