import type { ProfileQuestion, QuestionCatalog, SavedAnswer } from './contracts';

export function validateAnswer(input: string) {
  const normalized = input.trim();
  // Check raw input first: trim must not hide pasted newlines, tabs or separators.
  const error = /[\r\n\u2028\u2029]/u.test(input) ? 'La respuesta debe escribirse en una sola línea.'
    : /[\u0000-\u001f\u007f-\u009f<>]/u.test(input) ? 'Usá texto simple, sin caracteres de control ni < o >.'
    : !normalized ? 'Escribí una respuesta para guardar.'
    : normalized.length > 160 ? 'La respuesta puede tener hasta 160 caracteres.' : '';
  return { normalized, count: normalized.length, error, valid: !error };
}
export const currentAnswer = (q: ProfileQuestion, a: SavedAnswer | undefined) => !!a && a.current && a.questionSemanticVersion === q.semanticVersion;
export function questionRows(catalog: QuestionCatalog, answers: SavedAnswer[]) {
  return catalog.questions.map(question => {
    const answer = answers.find(a => a.questionId === question.id);
    const current = currentAnswer(question, answer);
    return { question, answer, current, selectable: current && !!answer?.answer.trim(), selectedPosition: current ? answer?.selectedPosition ?? null : null };
  });
}
export const selectedIds = (answers: SavedAnswer[]) => answers.filter(a => a.current && a.selectedPosition !== null).sort((a, b) => (a.selectedPosition ?? 0) - (b.selectedPosition ?? 0)).map(a => a.questionId);
export const sameSelection = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);
export function selectionValid(ids: string[], catalog: QuestionCatalog, answers: SavedAnswer[]) {
  const eligible = new Set(questionRows(catalog, answers).filter(r => r.selectable).map(r => r.question.id));
  return ids.length <= 3 && new Set(ids).size === ids.length && ids.every(id => eligible.has(id));
}
export function moveSelection(ids: string[], from: number, to: number) {
  if (from < 0 || to < 0 || from >= ids.length || to >= ids.length) return ids;
  const next = [...ids], item = next.splice(from, 1)[0];
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}
export const canSaveAnswer = (input: string, q: ProfileQuestion, saved?: SavedAnswer) => {
  const validation = validateAnswer(input);
  return validation.valid && (!currentAnswer(q, saved) || validation.normalized !== saved?.answer.trim());
};
