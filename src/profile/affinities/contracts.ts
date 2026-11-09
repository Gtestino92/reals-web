import { ApiError, object } from '../../auth/api';
export interface Category { id: string; title: string; description: string | null; displayOrder: number }
export interface Option { code: string; label: string; displayOrder: number }
export interface Question { id: string; categoryId: string; prompt: string; semanticVersion: number; contentVersion: number; answerType: string; options: Option[] }
export interface Catalog { catalogVersion: string; categories: Category[]; questions: Question[] }
export interface Answer { questionId: string; questionSemanticVersion: number; answerCode: string }
function str(v: unknown): string { if (typeof v !== 'string' || !v.trim()) throw new ApiError('invalid'); return v; }
function num(v: unknown): number { if (typeof v !== 'number' || !Number.isInteger(v)) throw new ApiError('invalid'); return v; }
function list<T>(v: unknown, parse: (v: unknown) => T): T[] { if (!Array.isArray(v)) throw new ApiError('invalid'); return v.map(parse); }
function unique<T>(items: T[], key: (item: T) => string): T[] { if (new Set(items.map(key)).size !== items.length) throw new ApiError('invalid'); return items; }
export function parseCatalog(v: unknown): Catalog {
  if (!object(v)) throw new ApiError('invalid');
  const categories = unique(list(v.categories, c => {
    if (!object(c) || (c.description != null && typeof c.description !== 'string')) throw new ApiError('invalid');
    return { id: str(c.id), title: str(c.title), description: c.description == null ? null : c.description, displayOrder: num(c.displayOrder) };
  }), c => c.id);
  const questions = unique(list(v.questions, q => {
    if (!object(q)) throw new ApiError('invalid');
    return { id: str(q.id), categoryId: str(q.categoryId), prompt: str(q.prompt), semanticVersion: num(q.semanticVersion), contentVersion: num(q.contentVersion), answerType: str(q.answerType), options: unique(list(q.options, o => {
      if (!object(o)) throw new ApiError('invalid');
      return { code: str(o.code), label: str(o.label), displayOrder: num(o.displayOrder) };
    }), o => o.code) };
  }), q => q.id);
  if (questions.some(q => !categories.some(c => c.id === q.categoryId))) throw new ApiError('invalid');
  return { catalogVersion: str(v.catalogVersion), categories, questions };
}
export function parseAnswers(v: unknown): Answer[] {
  if (!object(v)) throw new ApiError('invalid');
  return unique(list(v.answers, a => {
    if (!object(a)) throw new ApiError('invalid');
    return { questionId: str(a.questionId), questionSemanticVersion: num(a.questionSemanticVersion), answerCode: str(a.answerCode) };
  }), a => a.questionId);
}
