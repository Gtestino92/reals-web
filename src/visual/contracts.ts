import { ApiError, object } from '../auth/api';
import { browserUrl } from '../shared/browserUrl';

const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const position = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export interface VisualProfile {
  profileId: string; displayName: string; age: number; bio: string | null; visualExpiresAt: string | null;
  photos: { id: string; url: string; position: number }[];
  affinityIndicators: { categoryId: string; title: string }[];
  profileQuestions: { questionId: string; prompt: string; answer: string; position: number }[];
}
export function parseVisualProfile(v: unknown): VisualProfile {
  if (!object(v) || !text(v.profileId) || !text(v.displayName) || typeof v.age !== 'number' || !Number.isSafeInteger(v.age) || v.age < 18 ||
    (v.bio != null && typeof v.bio !== 'string') || !Array.isArray(v.photos) ||
    (v.visualExpiresAt != null && (typeof v.visualExpiresAt !== 'string' || !Number.isFinite(Date.parse(v.visualExpiresAt)))) ||
    (v.affinityIndicators != null && !Array.isArray(v.affinityIndicators)) || (v.profileQuestions != null && !Array.isArray(v.profileQuestions))) throw new ApiError('invalid');
  const photos: VisualProfile['photos'] = [];
  for (const row of v.photos) {
    if (!object(row) || row.moderationStatus !== 'APPROVED') continue;
    const url = browserUrl(row.url);
    if (text(row.id) && position(row.position) && url && !photos.some(p => p.id === row.id)) photos.push({ id: row.id, position: row.position, url });
  }
  const affinityIndicators: VisualProfile['affinityIndicators'] = [];
  for (const row of v.affinityIndicators ?? []) {
    if (object(row) && text(row.categoryId) && text(row.title) && !affinityIndicators.some(a => a.categoryId === row.categoryId) && affinityIndicators.length < 3) affinityIndicators.push({ categoryId: row.categoryId, title: row.title });
  }
  const profileQuestions: VisualProfile['profileQuestions'] = [];
  for (const row of v.profileQuestions ?? []) {
    if (object(row) && text(row.questionId) && text(row.prompt) && text(row.answer) && position(row.position)) profileQuestions.push({ questionId: row.questionId, prompt: row.prompt, answer: row.answer, position: row.position });
  }
  return { profileId: v.profileId, displayName: v.displayName, age: v.age, bio: v.bio?.trim() ? v.bio : null,
    visualExpiresAt: v.visualExpiresAt ?? null, photos: photos.sort((a,b) => a.position-b.position), affinityIndicators, profileQuestions: profileQuestions.sort((a,b) => a.position-b.position) };
}
