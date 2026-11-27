import { ApiError, object, parseProfile } from '../auth/api';
import type { Profile } from '../auth/api';
import { browserUrl } from '../shared/browserUrl';

export const genders = ['MALE', 'FEMALE', 'NON_BINARY', 'OTHER'] as const;
export const intentions = ['DATE', 'FRIENDSHIP', 'CASUAL'] as const;
export const genderLabels = ['Hombre', 'Mujer', 'No binario', 'Otra identidad'];
export const preferenceLabels = ['Hombres', 'Mujeres', 'Personas no binarias', 'Otras identidades'];
export const intentionLabels = ['Citas', 'Amistad', 'Algo casual'];
export interface Fields {
  displayName: string; birthDate: string; gender: string; lookingForGenders: string[]; intention: string;
  city: string; countryCode: string; bio: string; preferredMinAge: number; preferredMaxAge: number; maxDistanceKm: number;
}
export interface FullProfile extends Omit<Profile, 'countryCode'>, Fields { authenticityVerificationStatus: string }
export interface Country { code: string; displayName: string }
export interface Photo { id: string; url: string; position: number; validationStatus: string; moderationStatus: string; isPersonPhoto: boolean; isFullBody: boolean }
export interface LegalDocument { type: string; version: string; requiredAction: string; satisfied: boolean; url: string }
export const defaults: Fields = { displayName: '', birthDate: '', gender: 'MALE', lookingForGenders: ['FEMALE'], intention: 'DATE', city: '', countryCode: '', bio: '', preferredMinAge: 18, preferredMaxAge: 45, maxDistanceKm: 50 };
export function invalid(): never { throw new ApiError('invalid'); }
export function safeUrl(value: unknown): string {
  return browserUrl(value) ?? invalid();
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
  if (status.documents.length !== catalog.documents.length) return invalid();
  const entries = catalog.documents;
  const documents = status.documents.map((item): LegalDocument => {
    if (!object(item) || typeof item.type !== 'string' || !item.type.trim() || typeof item.version !== 'string' || !item.version.trim() || typeof item.requiredAction !== 'string' || !item.requiredAction.trim() || typeof item.satisfied !== 'boolean') return invalid();
    const entry = entries.find((x: unknown) => object(x) && x.type === item.type && x.version === item.version && x.requiredAction === item.requiredAction);
    if (!object(entry)) return invalid();
    return { type: item.type, version: item.version, requiredAction: item.requiredAction, satisfied: item.satisfied, url: safeUrl(entry.url) };
  });
  if (new Set(documents.map(doc => doc.type)).size !== documents.length || documents.every(doc => doc.satisfied) !== status.requirementsSatisfied) return invalid();
  return { satisfied: status.requirementsSatisfied, documents };
}
export function normalize(fields: Fields): Fields { return { ...fields, displayName: fields.displayName.trim(), city: fields.city.trim(), bio: fields.bio.trim(), countryCode: fields.countryCode.trim().toUpperCase() }; }
export function profileIssues(f: Fields, catalog: Country[], mode: 'create' | 'details' | 'filters', now = new Date()) {
  const errors: Partial<Record<keyof Fields, string>> = {};
  if (mode !== 'filters') {
    if (f.displayName.length < 2 || f.displayName.length > 100 || /[<>\r\n\x00-\x1f\x7f-\x9f]/.test(f.displayName)) errors.displayName = 'Nombre visible: usá texto simple de 2 a 100 caracteres.';
    if (!f.city || f.city.length > 100 || /[<>\r\n\x00-\x1f\x7f-\x9f]/.test(f.city)) errors.city = 'Ciudad: ingresá hasta 100 caracteres de texto simple.';
    if (!catalog.some(x => x.code === f.countryCode)) errors.countryCode = 'Seleccioná un país del catálogo.';
    if (f.bio.length > 1000 || /[<>\x00-\x09\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(f.bio)) errors.bio = 'Bio: usá texto simple de hasta 1.000 caracteres.';
  }
  if (mode === 'create') {
    const date = new Date(`${f.birthDate}T00:00:00Z`);
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(f.birthDate) && Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === f.birthDate;
    const age = now.getFullYear() - date.getUTCFullYear() - (now.getMonth() < date.getUTCMonth() || (now.getMonth() === date.getUTCMonth() && now.getDate() < date.getUTCDate()) ? 1 : 0);
    if (!f.birthDate) errors.birthDate = 'Seleccioná tu fecha de nacimiento.';
    else if (!validDate) errors.birthDate = 'Ingresá una fecha de nacimiento válida.';
    else if (age < 18 || age > 99) errors.birthDate = 'Debés tener entre 18 y 99 años.';
    if (!genders.some(x => x === f.gender)) errors.gender = 'Seleccioná un género válido.';
  }
  if (mode !== 'details') {
    if (!intentions.some(x => x === f.intention)) errors.intention = 'Elegí una intención válida.';
    if (!f.lookingForGenders.length || !f.lookingForGenders.every(x => genders.some(g => g === x))) errors.lookingForGenders = 'Elegí al menos un género válido que te interese.';
    if (![f.preferredMinAge, f.preferredMaxAge].every(Number.isInteger) || f.preferredMinAge < 18 || f.preferredMaxAge > 99 || f.preferredMinAge > f.preferredMaxAge) errors.preferredMinAge = 'Elegí un rango de edad entre 18 y 99 años.';
    if (!Number.isInteger(f.maxDistanceKm) || f.maxDistanceKm < 1 || f.maxDistanceKm > 100) errors.maxDistanceKm = 'Elegí una distancia entre 1 y 100 km.';
  }
  return errors;
}
export function validate(f: Fields, catalog: Country[], mode: 'create' | 'details' | 'filters', now = new Date()): string[] {
  return Object.values(profileIssues(f, catalog, mode, now));
}
export function hasInteractions(raw: unknown): boolean {
  if (!object(raw) || !object(raw.activeInteractionsSummary) || !['pendingActions', 'nextSteps', 'passiveNotices'].every(k => Array.isArray(raw[k]))) return invalid();
  const s = raw.activeInteractionsSummary;
  if (typeof s.hasPendingSchedulingConnection !== 'boolean' || !['activeInitialCount','activeConnectionCount','actionableConnectionCount'].every(k => typeof s[k] === 'number')) return invalid();
  return ['pendingActions','nextSteps','passiveNotices'].some(k => Array.isArray(raw[k]) && raw[k].length > 0) || s.hasPendingSchedulingConnection || ['activeInitialCount','activeConnectionCount','actionableConnectionCount'].some(k => typeof s[k] === 'number' && s[k] > 0);
}
