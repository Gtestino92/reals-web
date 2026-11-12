import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '../../auth/api';
import { SessionController } from '../../auth/session';
import { TabOwnershipManager } from '../../tabs/TabOwnershipManager';
import { parseQuestionAnswers } from './contracts';
import { questionCatalog, savedAnswer } from './fixtures';
import { useProfileQuestions } from './useProfileQuestions';

function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
function setup(answers = [savedAnswer()]) {
  const user = { uid: 'f', emailVerified: true, getIdToken: async () => 'test', reload: async () => {} };
  const controller = new SessionController({ observe: () => () => {}, signIn: async () => user, signUp: async () => user, google: async () => user, verify: async () => {}, signOut: async () => {} }, new ApiClient(), false);
  controller.snapshot = { ...controller.snapshot, phase: 'ready', account: { id: 'u', status: 'ACTIVE' }, profile: { id: 'p', userId: 'u', status: 'ACTIVE' } };
  const listeners = new Set<() => void>(); vi.spyOn(controller, 'subscribe').mockImplementation(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; });
  const request = vi.spyOn(controller, 'request').mockImplementation(async path => path === '/reference/profile-questions' ? questionCatalog() : { answers });
  const replace = (phase: 'ready' | 'login' = 'ready') => { controller.snapshot = { ...controller.snapshot, phase, profile: { id: 'p2', userId: 'u', status: 'ACTIVE' } }; listeners.forEach(fn => fn()); };
  const hook = () => useProfileQuestions(controller, true);
  return { controller, request, replace, hook };
}
it('loads lazily only when opened', async () => {
  const { controller, request } = setup(); const { result, rerender } = renderHook(({ active }) => useProfileQuestions(controller, active), { initialProps: { active: false } });
  expect(request).not.toHaveBeenCalled(); rerender({ active: true }); await waitFor(() => expect(result.current.catalog).not.toBeNull());
});
it('suppresses unchanged current saves but allows unchanged outdated resaves with trimmed body', async () => {
  const { hook, request } = setup([savedAnswer('A', { current: false }), savedAnswer('B')]); const { result } = renderHook(hook); await waitFor(() => expect(result.current.catalog).not.toBeNull());
  const count = request.mock.calls.length; await act(async () => { await result.current.mutate({ kind: 'upsert', questionId: 'B', answer: ' Respuesta B ' }); }); expect(request).toHaveBeenCalledTimes(count);
  request.mockResolvedValueOnce({ answers: [savedAnswer()] }); await act(async () => { await result.current.mutate({ kind: 'upsert', questionId: 'A', answer: ' Respuesta A ' }); });
  expect(request).toHaveBeenLastCalledWith('/me/profile/question-answers/A', expect.any(AbortSignal), 'PUT', { answer: 'Respuesta A' }); expect(result.current.answers).toEqual([savedAnswer()]);
});
it('installs the authoritative delete snapshot with compacted public positions', async () => {
  const { hook, request } = setup([savedAnswer('A', { selectedPosition: 1 }), savedAnswer('B', { selectedPosition: 2 })]); const { result } = renderHook(hook); await waitFor(() => expect(result.current.catalog).not.toBeNull());
  request.mockResolvedValueOnce({ answers: [savedAnswer('B', { selectedPosition: 1 })] }); await act(async () => { await result.current.mutate({ kind: 'delete', questionId: 'A' }); });
  expect(result.current.answers).toEqual([savedAnswer('B', { selectedPosition: 1 })]); expect(request).toHaveBeenLastCalledWith('/me/profile/question-answers/A', expect.any(AbortSignal), 'DELETE', undefined);
});
it('sends the ordered selection, avoids no-ops and allows clearing', async () => {
  const { hook, request } = setup([savedAnswer(), savedAnswer('B')]); const { result } = renderHook(hook); await waitFor(() => expect(result.current.catalog).not.toBeNull());
  const count = request.mock.calls.length; await act(async () => { await result.current.mutate({ kind: 'selection', questionIds: [] }); await result.current.mutate({ kind: 'selection', questionIds: ['A','A'] }); }); expect(request).toHaveBeenCalledTimes(count);
  request.mockResolvedValueOnce({ answers: [savedAnswer('A', { selectedPosition: 2 }), savedAnswer('B', { selectedPosition: 1 })] }); await act(async () => { await result.current.mutate({ kind: 'selection', questionIds: ['B','A'] }); });
  expect(request).toHaveBeenLastCalledWith('/me/profile/question-selections', expect.any(AbortSignal), 'PUT', { questionIds: ['B','A'] });
  request.mockResolvedValueOnce({ answers: [savedAnswer(), savedAnswer('B')] }); await act(async () => { await result.current.mutate({ kind: 'selection', questionIds: [] }); }); expect(result.current.answers.every(a => a.selectedPosition === null)).toBe(true);
});
it.each(['upsert', 'delete', 'selection'] as const)('blocks conflicting writes after uncertain %s until an authoritative read', async kind => {
  const { hook, request } = setup(); const { result } = renderHook(hook); await waitFor(() => expect(result.current.catalog).not.toBeNull());
  request.mockRejectedValueOnce(new ApiError('network')); await act(async () => { await result.current.mutate(kind === 'selection' ? { kind, questionIds: ['A'] } : kind === 'upsert' ? { kind, questionId: 'A', answer: 'Nueva' } : { kind, questionId: 'A' }); }); expect(result.current.uncertain).toBe(true);
  const count = request.mock.calls.length; await act(async () => { await result.current.mutate({ kind: 'delete', questionId: 'A' }); }); expect(request).toHaveBeenCalledTimes(count);
  await act(async () => { await result.current.refresh(); }); expect(result.current.uncertain).toBe(false);
});
it('distinguishes definite rejection from malformed mutation success', async () => {
  const { hook, request } = setup(); const { result } = renderHook(hook); await waitFor(() => expect(result.current.catalog).not.toBeNull());
  request.mockRejectedValueOnce(new ApiError('backend', 400, 'INVALID_PROFILE_QUESTION_ANSWER')); await act(async () => { await result.current.mutate({ kind: 'delete', questionId: 'A' }); }); expect(result.current.uncertain).toBe(false); expect(result.current.error).toBeTruthy();
  request.mockResolvedValueOnce({ answers: [{}] }); await act(async () => { await result.current.mutate({ kind: 'delete', questionId: 'A' }); }); expect(result.current.uncertain).toBe(true); expect(result.current.answers).toEqual([savedAnswer()]);
});
it('blocks writes during revalidation and synchronously excludes duplicate mutations', async () => {
  const { hook, request } = setup(); const { result } = renderHook(hook); await waitFor(() => expect(result.current.catalog).not.toBeNull());
  const read = deferred<unknown>(); request.mockReturnValueOnce(read.promise); let reading!: Promise<void>; act(() => { reading = result.current.refresh(); });
  const before = request.mock.calls.length; await act(async () => { expect(await result.current.mutate({ kind: 'delete', questionId: 'A' })).toBeNull(); }); expect(request).toHaveBeenCalledTimes(before);
  await act(async () => { read.resolve(questionCatalog()); await reading; });
  const write = deferred<unknown>(); request.mockReturnValueOnce(write.promise); let writing!: Promise<unknown>; act(() => { writing = result.current.mutate({ kind: 'upsert', questionId: 'B', answer: 'Nueva' }); });
  const count = request.mock.calls.length; await act(async () => { await result.current.mutate({ kind: 'selection', questionIds: ['A'] }); }); expect(request).toHaveBeenCalledTimes(count);
  await act(async () => { write.resolve({ answers: [savedAnswer('B')] }); await writing; }); expect(result.current.answers).toEqual([savedAnswer('B')]);
  request.mockRejectedValueOnce(new ApiError('network')); await act(async () => { await result.current.refresh(); }); expect(result.current.answers).toEqual([savedAnswer('B')]); expect(result.current.uncertain).toBe(true);
});
it.each(['ready', 'login'] as const)('rejects late writes and clears identity state on %s replacement', async phase => {
  const { hook, request, replace } = setup(); const { result } = renderHook(hook); await waitFor(() => expect(result.current.catalog).not.toBeNull());
  const write = deferred<unknown>(); request.mockReturnValueOnce(write.promise); let task!: Promise<unknown>; act(() => { task = result.current.mutate({ kind: 'delete', questionId: 'A' }); });
  request.mockImplementation(async path => path === '/reference/profile-questions' ? questionCatalog() : { answers: [] }); act(() => replace(phase));
  await act(async () => { write.resolve({ answers: [savedAnswer('PRIVATE_OLD')] }); expect(await task).toBeNull(); }); expect(result.current.answers).toEqual([]);
});
it('aborts on disposal and rejects late reads', async () => {
  const { hook, request } = setup(); const read = deferred<unknown>(); request.mockReturnValueOnce(read.promise); const { result, unmount } = renderHook(hook);
  const signal = request.mock.calls[0]![1]; unmount(); expect(signal.aborted).toBe(true); await act(async () => { read.resolve(questionCatalog()); }); expect(result.current.catalog).toBeNull();
});
it('rejects a revoked tab through real SessionController and ApiClient cancellation', async () => {
  const ownership = new TabOwnershipManager(); vi.spyOn(ownership, 'getSnapshot').mockReturnValue('active'); vi.spyOn(ownership, 'assert').mockImplementation(() => {});
  const write = deferred<Response>(), user = { uid: 'f', emailVerified: true, getIdToken: async () => 'synthetic', reload: async () => {} };
  const json = (raw: unknown) => new Response(JSON.stringify(raw));
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path, options) => {
    if (options?.method === 'PUT') return write.promise;
    if (path === '/api/me') return json({ id: 'u', status: 'ACTIVE' });
    if (path === '/api/me/profile') return json({ id: 'p', userId: 'u', status: 'ACTIVE' });
    return json(path === '/api/reference/profile-questions' ? questionCatalog() : { answers: [savedAnswer()] });
  });
  const controller = new SessionController({ observe: next => { next(user); return () => {}; }, signIn: async () => user, signUp: async () => user, google: async () => user, verify: async () => {}, signOut: async () => {} }, new ApiClient(fetcher, ownership), false, ownership);
  const { result, unmount } = renderHook(() => useProfileQuestions(controller, true)); await waitFor(() => expect(result.current.catalog).not.toBeNull());
  let task!: Promise<unknown>; act(() => { task = result.current.mutate({ kind: 'upsert', questionId: 'A', answer: 'Nueva' }); }); await waitFor(() => expect(fetcher.mock.calls.some(([,o]) => o?.method === 'PUT')).toBe(true));
  act(() => ownership.stop()); await act(async () => { write.resolve(json({ answers: [savedAnswer('A', { answer: 'Old private' })] })); expect(await task).toBeNull(); }); expect(parseQuestionAnswers({ answers: result.current.answers }).some(a => a.answer === 'Old private')).toBe(false); unmount();
});
