import { describe, expect, it } from 'vitest';
import { parseAnswers, parseCatalog } from './contracts';
import { nextQuestion, presentation, validAnswer } from './presentation';
import { fixture, answer } from './fixtures';
describe('catalog and persisted answer rules', () => {
  it('preserves canonical category, question and option array order', () => {
    const c = fixture(); expect(presentation(c, []).groups.map(g => g.category.id)).toEqual(['music', 'plans']); expect(c.questions[0]?.options.map(o => o.code)).toEqual(['B', 'A']);
  });
  it.each([null, {}, { catalogVersion: 'v', categories: [], questions: [{}] }])('rejects malformed catalogs %j', raw => expect(() => parseCatalog(raw)).toThrow());
  it('rejects duplicate IDs and malformed answer snapshots', () => {
    const c = fixture(); c.questions.push(c.questions[0]!); expect(() => parseCatalog(c)).toThrow();
    expect(() => parseAnswers({ answers: [answer(), answer()] })).toThrow(); expect(() => parseAnswers({ answers: [{ questionId: 'a' }] })).toThrow();
  });
  it('excludes unsupported and single-option questions from progress', () => {
    const c = fixture(); c.questions[0]!.answerType = 'FUTURE'; c.questions[1]!.options.pop(); expect(presentation(c, [answer(), answer('b'), answer('c')])).toMatchObject({ total: 1, answered: 1, complete: true });
  });
  it('requires current semantic version and code but permits content changes', () => {
    const c = fixture(), q = c.questions[0]!; q.contentVersion = 20;
    expect(validAnswer(q, [answer()])).toBeDefined(); expect(validAnswer(q, [answer('a', 'A', 2)])).toBeUndefined(); expect(validAnswer(q, [answer('a', 'removed')])).toBeUndefined();
    expect(presentation(c, [answer('removed')]).answered).toBe(0);
  });
  it('starts, continues, reviews and supports empty catalog', () => {
    const c = fixture(); expect(presentation(c, []).action).toBe('Empezar'); expect(presentation(c, [answer()]).action).toBe('Continuar'); expect(presentation(c, c.questions.map(q => answer(q.id))).action).toBe('Revisar respuestas'); c.questions = []; expect(presentation(c, []).total).toBe(0);
  });
  it('continues after current question without wrapping, including skipped revisits', () => {
    const c = fixture(), ctx = { questionId: 'b', source: 'continue' as const, categoryId: '', reviewAll: false };
    expect(nextQuestion(c, [], ctx)?.id).toBe('c'); expect(nextQuestion(c, [], { ...ctx, questionId: 'c' })).toBeUndefined(); expect(presentation(c, [answer('c')]).questions.find(q => !validAnswer(q, [answer('c')]))?.id).toBe('a');
  });
  it('category review includes saved answers while continue skips them', () => {
    const c = fixture(), ctx = { questionId: 'a', source: 'category' as const, categoryId: 'music', reviewAll: false };
    expect(nextQuestion(c, [answer('b')], ctx)).toBeUndefined(); expect(nextQuestion(c, [answer('b')], { ...ctx, reviewAll: true })?.id).toBe('b');
  });
});
