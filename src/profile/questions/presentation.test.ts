import { expect, it } from 'vitest';
import { parseQuestionAnswers, parseQuestionCatalog } from './contracts';
import { canSaveAnswer, moveSelection, questionRows, sameSelection, selectedIds, selectionValid, validateAnswer } from './presentation';
import { questionCatalog, savedAnswer } from './fixtures';

it('validates and sorts catalog by display order then ID', () => {
  const c = questionCatalog(); c.questions.reverse(); c.questions[0]!.displayOrder = 1;
  expect(parseQuestionCatalog(c).questions.map(q => q.id)).toEqual(['A', 'D', 'B', 'C']);
});
it.each([null, {}, { catalogVersion: 'x', questions: [{}] }, { ...questionCatalog(), questions: [questionCatalog().questions[0], questionCatalog().questions[0]] }])('rejects malformed catalog %j', raw => expect(() => parseQuestionCatalog(raw)).toThrow());
it('validates answers, optional positions, versions, timestamps and unique positions/IDs', () => {
  expect(parseQuestionAnswers({ answers: [{ ...savedAnswer(), selectedPosition: undefined }] })[0]?.selectedPosition).toBeNull();
  for (const raw of [{}, { answers: [{}] }, { answers: [savedAnswer(), savedAnswer()] }, { answers: [savedAnswer('A', { selectedPosition: 1 }), savedAnswer('B', { selectedPosition: 1 })] }, { answers: [{ ...savedAnswer(), current: undefined }] }, { answers: [savedAnswer('A', { updatedAt: 'bad' })] }, { answers: [savedAnswer('A', { selectedPosition: 4 })] }]) expect(() => parseQuestionAnswers(raw)).toThrow();
});
it('counts outdated saved answers but excludes them and removed answers from eligible rows', () => {
  const catalog = questionCatalog(), answers = [savedAnswer(), savedAnswer('B', { current: false, questionSemanticVersion: 0 }), savedAnswer('REMOVED')];
  const rows = questionRows(catalog, answers); expect(rows.filter(r => r.answer)).toHaveLength(2); expect(rows.filter(r => r.selectable).map(r => r.question.id)).toEqual(['A']);
  catalog.questions[0]!.semanticVersion = 2; expect(questionRows(catalog, answers)[0]?.selectable).toBe(false);
});
it.each(['\n', '\r', '\t', '\u0000', '\u001f', '\u007f', '\u0085', '\u009f', '\u2028', '\u2029', '<', '>'])('rejects pasted disallowed character %j without silently trimming it', char => {
  expect(validateAnswer(`${char}Respuesta${char}`).valid).toBe(false);
});
it('trims and uses UTF-16 length at exact boundaries', () => {
  expect(validateAnswer('   ').valid).toBe(false); expect(validateAnswer('  Café ñ ü ¿sí? ¡Sí!  ').normalized).toBe('Café ñ ü ¿sí? ¡Sí!');
  expect(validateAnswer('x'.repeat(160)).valid).toBe(true); expect(validateAnswer('x'.repeat(161)).valid).toBe(false);
  expect(validateAnswer('😀'.repeat(80))).toMatchObject({ count: 160, valid: true }); expect(validateAnswer('😀'.repeat(81)).valid).toBe(false);
});
it('avoids unchanged current saves, allows unchanged outdated resaves and content-only changes', () => {
  const q = questionCatalog().questions[0]!, answer = savedAnswer(); q.contentVersion = 2;
  expect(canSaveAnswer('  Respuesta A  ', q, answer)).toBe(false); expect(canSaveAnswer(answer.answer, q, { ...answer, current: false })).toBe(true);
  q.semanticVersion = 2; expect(canSaveAnswer(answer.answer, q, answer)).toBe(true);
});
it('validates zero to three unique current answered active IDs and preserves ordered positions', () => {
  const c = questionCatalog(), answers = c.questions.map(q => savedAnswer(q.id));
  expect(selectionValid([], c, answers)).toBe(true); expect(selectionValid(['C', 'B', 'A'], c, answers)).toBe(true);
  for (const ids of [['A', 'B', 'C', 'D'], ['A', 'A'], ['REMOVED']]) expect(selectionValid(ids, c, answers)).toBe(false);
  expect(selectionValid(['A'], c, [savedAnswer('A', { answer: '  ' })])).toBe(false);
  expect(selectionValid(['A'], c, [savedAnswer('A', { current: false })])).toBe(false);
  expect(selectedIds([savedAnswer('A', { selectedPosition: 2 }), savedAnswer('B', { selectedPosition: 1 })])).toEqual(['B', 'A']);
  expect(moveSelection(['A', 'B', 'C'], 2, 0)).toEqual(['C', 'A', 'B']); expect(moveSelection(['A'], -1, 0)).toEqual(['A']); expect(sameSelection(['A','B'], ['B','A'])).toBe(false);
});
