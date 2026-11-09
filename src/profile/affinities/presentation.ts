import type { Answer, Catalog, Question } from './contracts';
export interface QuestionContext { questionId: string; source: 'continue' | 'category' | 'review'; categoryId: string; reviewAll: boolean }
export const answerable = (c: Catalog) => c.questions.filter(q => ['SINGLE_CHOICE', 'ORDINAL_SCALE'].includes(q.answerType) && q.options.length >= 2);
export const validAnswer = (q: Question, answers: Answer[]) => answers.find(a => a.questionId === q.id && a.questionSemanticVersion === q.semanticVersion && q.options.some(o => o.code === a.answerCode));
export function presentation(c: Catalog, answers: Answer[]) {
  const questions = answerable(c), answered = questions.filter(q => validAnswer(q, answers)).length, total = questions.length;
  return { questions, answered, total, complete: total > 0 && answered === total, action: !total ? 'Abrir' : !answered ? 'Empezar' : answered === total ? 'Revisar respuestas' : 'Continuar',
    groups: c.categories.map(category => ({ category, questions: questions.filter(q => q.categoryId === category.id) })).filter(g => g.questions.length > 0) };
}
export function nextQuestion(c: Catalog, answers: Answer[], context: QuestionContext) {
  if (context.source === 'review') return undefined;
  const sequence = answerable(c).filter(q => context.source !== 'category' || q.categoryId === context.categoryId);
  const index = sequence.findIndex(q => q.id === context.questionId);
  return index < 0 ? undefined : sequence.slice(index + 1).find(q => context.reviewAll || !validAnswer(q, answers));
}
