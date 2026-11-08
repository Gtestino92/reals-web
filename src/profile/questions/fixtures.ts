import { parseQuestionCatalog } from './contracts';
import type { SavedAnswer } from './contracts';
export const questionCatalog = () => parseQuestionCatalog({ catalogVersion: 'v1', questions: ['A', 'B', 'C', 'D'].map((id, i) => ({ id, prompt: `Pregunta ${id}`, displayOrder: i + 1, semanticVersion: 1, contentVersion: 1 })) });
export const savedAnswer = (questionId = 'A', overrides: Partial<SavedAnswer> = {}): SavedAnswer => ({ questionId, questionSemanticVersion: 1, answer: `Respuesta ${questionId}`, current: true, selectedPosition: null, createdAt: '2026-11-08T12:00:00Z', updatedAt: '2026-11-08T12:00:00Z', ...overrides });
