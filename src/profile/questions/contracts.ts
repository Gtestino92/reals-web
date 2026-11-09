import { ApiError, object } from '../../auth/api';

export interface ProfileQuestion { id: string; semanticVersion: number; contentVersion: number; prompt: string; displayOrder: number }
export interface QuestionCatalog { catalogVersion: string; questions: ProfileQuestion[] }
export interface SavedAnswer {
  questionId: string; questionSemanticVersion: number; answer: string; selectedPosition: number | null;
  current: boolean; createdAt: string; updatedAt: string;
}
// Counterpart DTOs deliberately exclude private versions, timestamps and unselected answers.
export interface PublicProfileAnswer { questionId: string; prompt: string; answer: string; position: number }

function text(v: unknown): string { if (typeof v !== 'string' || !v.trim()) throw new ApiError('invalid'); return v; }
function integer(v: unknown, min = 0): number { if (typeof v !== 'number' || !Number.isInteger(v) || v < min) throw new ApiError('invalid'); return v; }
function unique<T>(items: T[], key: (v: T) => string): T[] {
  if (new Set(items.map(key)).size !== items.length) throw new ApiError('invalid');
  return items;
}
export function parseQuestionCatalog(raw: unknown): QuestionCatalog {
  if (!object(raw) || !Array.isArray(raw.questions)) throw new ApiError('invalid');
  const questions = raw.questions.map((q: unknown) => {
    if (!object(q)) throw new ApiError('invalid');
    if (typeof q.id !== 'string' || !/^[A-Z0-9_]{1,64}$/u.test(q.id)) throw new ApiError('invalid');
    return { id: text(q.id), semanticVersion: integer(q.semanticVersion, 1), contentVersion: integer(q.contentVersion, 1), prompt: text(q.prompt), displayOrder: integer(q.displayOrder, 1) };
  });
  return { catalogVersion: text(raw.catalogVersion), questions: unique(questions, q => q.id).sort((a, b) => a.displayOrder - b.displayOrder || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) };
}
export function parseQuestionAnswers(raw: unknown): SavedAnswer[] {
  if (!object(raw) || !Array.isArray(raw.answers)) throw new ApiError('invalid');
  const answers = raw.answers.map((a: unknown): SavedAnswer => {
    if (!object(a) || typeof a.answer !== 'string' || typeof a.current !== 'boolean') throw new ApiError('invalid');
    const selectedPosition = a.selectedPosition == null ? null : integer(a.selectedPosition, 1);
    if (selectedPosition !== null && selectedPosition > 3) throw new ApiError('invalid');
    const createdAt = text(a.createdAt), updatedAt = text(a.updatedAt);
    if (!Number.isFinite(Date.parse(createdAt)) || !Number.isFinite(Date.parse(updatedAt))) throw new ApiError('invalid');
    return { questionId: text(a.questionId), questionSemanticVersion: integer(a.questionSemanticVersion, 1), answer: a.answer, current: a.current, selectedPosition, createdAt, updatedAt };
  });
  const positions = answers.flatMap(a => a.selectedPosition === null ? [] : [a.selectedPosition]);
  if (new Set(positions).size !== positions.length) throw new ApiError('invalid');
  return unique(answers, a => a.questionId);
}
