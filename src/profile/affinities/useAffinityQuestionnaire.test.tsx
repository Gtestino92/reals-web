import { TabOwnershipManager } from '../../tabs/TabOwnershipManager';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ApiClient, ApiError, object } from '../../auth/api';
import { SessionController } from '../../auth/session';
import { useHomeNavigation } from '../../home/useHomeNavigation';
import { AffinityQuestionnaire } from './AffinityQuestionnaire';
import { useAffinityQuestionnaire } from './useAffinityQuestionnaire';
import { fixture, answer } from './fixtures';
function setup() {
  const user = { uid: 'f', emailVerified: true, getIdToken: async () => 'test', reload: async () => {} };
  const controller = new SessionController({ observe: () => () => {}, signIn: async () => user, signUp: async () => user, google: async () => user, verify: async () => {}, signOut: async () => {} }, new ApiClient(), false);
  controller.snapshot = { ...controller.snapshot, phase: 'ready', account: { id: 'u', status: 'ACTIVE' }, profile: { id: 'p', userId: 'u', status: 'ACTIVE' } };
  const listeners = new Set<() => void>(); vi.spyOn(controller, 'subscribe').mockImplementation(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; });
  let answers: ReturnType<typeof answer>[] = [];
  const request = vi.spyOn(controller, 'request').mockImplementation(async (path, _signal, method, body) => {
    if (path === '/reference/affinity-questions') return fixture();
    if (method === 'PATCH') { if (!object(body) || !Array.isArray(body.answers) || !object(body.answers[0]) || typeof body.answers[0].questionId !== 'string' || typeof body.answers[0].answerCode !== 'string') throw new Error('Invalid test payload'); const a = body.answers[0]; answers = [...answers.filter(x => x.questionId !== a.questionId), answer(String(a.questionId), String(a.answerCode))]; }
    if (method === 'DELETE') answers = answers.filter(a => !path.endsWith(`/${a.questionId}`));
    return { answers };
  });
  const replace = (phase: 'ready' | 'login' = 'ready') => { controller.snapshot = { ...controller.snapshot, phase, profile: { id: 'p2', userId: 'u', status: 'ACTIVE' } }; listeners.forEach(fn => fn()); };
  return { controller, request, replace };
}
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
it('installs full authoritative PATCH/DELETE snapshots and avoids unchanged writes', async () => {
  const { controller, request } = setup(); const { result } = renderHook(() => useAffinityQuestionnaire(controller)); await waitFor(() => expect(result.current.catalog).not.toBeNull());
  await act(async () => { await result.current.mutate('a', 'A'); await result.current.mutate('b', 'B'); }); expect(result.current.answers).toHaveLength(2);
  const count = request.mock.calls.length; await act(async () => { await result.current.mutate('b', 'B'); }); expect(request).toHaveBeenCalledTimes(count);
  await act(async () => { await result.current.mutate('a', null); }); expect(result.current.answers).toEqual([answer('b', 'B')]);
});
it.each(['network', 'invalid'] as const)('retains confirmed state and blocks %s uncertainty until reconciliation', async kind => {
  const { controller, request } = setup(); const { result } = renderHook(() => useAffinityQuestionnaire(controller)); await waitFor(() => expect(result.current.catalog).not.toBeNull());
  request.mockRejectedValueOnce(new ApiError(kind)); await act(async () => { await result.current.mutate('a', 'A'); }); expect(result.current.uncertain).toBe(true); expect(result.current.answers).toEqual([]);
  const count = request.mock.calls.length; await act(async () => { await result.current.mutate('b', 'B'); }); expect(request).toHaveBeenCalledTimes(count);
  await act(async () => { await result.current.refresh(); }); expect(result.current.uncertain).toBe(false);
});
it('handles definite rejection without fabricating success', async () => {
  const { controller, request } = setup(); const { result } = renderHook(() => useAffinityQuestionnaire(controller)); await waitFor(() => expect(result.current.catalog).not.toBeNull());
  request.mockRejectedValueOnce(new ApiError('backend', 400, 'INVALID_AFFINITY_ANSWER')); await act(async () => { await result.current.mutate('a', 'A'); }); expect(result.current.error).toBeTruthy(); expect(result.current.uncertain).toBe(false); expect(result.current.answers).toEqual([]);
});
it('blocks writes during revalidation and excludes duplicate writes', async () => {
  const { controller, request } = setup(); const { result } = renderHook(() => useAffinityQuestionnaire(controller)); await waitFor(() => expect(result.current.catalog).not.toBeNull());
  const stale = deferred<unknown>(); request.mockReturnValueOnce(stale.promise); let read!: Promise<void>; act(() => { read = result.current.refresh(); });
  const before = request.mock.calls.length; await act(async () => { expect(await result.current.mutate('a', 'A')).toBeNull(); }); expect(request).toHaveBeenCalledTimes(before);
  await act(async () => { stale.resolve(fixture()); await read; });
  const write = deferred<unknown>(); request.mockReturnValueOnce(write.promise); let first!: Promise<unknown>; act(() => { first = result.current.mutate('a', 'A'); });
  await act(async () => { expect(await result.current.mutate('b', 'B')).toBeNull(); write.resolve({ answers: [answer()] }); await first; });
  expect(result.current.answers).toEqual([answer()]);
});
it.each(['ready', 'login'] as const)('rejects late mutations after identity transition %s', async phase => {
  const { controller, request, replace } = setup(); const { result } = renderHook(() => useAffinityQuestionnaire(controller)); await waitFor(() => expect(result.current.catalog).not.toBeNull());
  const write = deferred<unknown>(); request.mockReturnValueOnce(write.promise); let task!: Promise<unknown>; act(() => { task = result.current.mutate('a', 'A'); });
  act(() => replace(phase)); await act(async () => { write.resolve({ answers: [answer()] }); await task; }); expect(result.current.answers).toEqual([]);
});
it('unmount aborts owned resources and rejects late success', async () => {
  const { controller, request } = setup(); const { result, unmount } = renderHook(() => useAffinityQuestionnaire(controller)); await waitFor(() => expect(result.current.catalog).not.toBeNull());
  const write = deferred<unknown>(); request.mockReturnValueOnce(write.promise); let task!: Promise<unknown>; act(() => { task = result.current.mutate('a', 'A'); }); const signal = request.mock.calls.at(-1)![1]; unmount(); expect(signal.aborted).toBe(true); write.resolve({ answers: [answer()] }); expect(await task).toBeNull();
});
it('navigates skip, revisit, local draft, save, grouped review, edit and remove with browser parents', async () => {
  const { controller, request } = setup();
  function Probe() { const model = useAffinityQuestionnaire(controller), navigation = useHomeNavigation(() => true); return <><button onClick={() => navigation.open('affinities')}>Afinidades</button><AffinityQuestionnaire model={model} navigation={navigation}/></>; }
  render(<Probe/>); fireEvent.click(screen.getByText('Afinidades')); await screen.findByText('Empezar'); fireEvent.click(screen.getByText('Empezar')); expect(screen.getByText('Pregunta a')).toBeVisible();
  fireEvent.click(screen.getByText('Omitir')); expect(screen.getByText('Pregunta b')).toBeVisible(); fireEvent.click(screen.getByText('Omitir')); fireEvent.click(screen.getByText('Omitir')); await screen.findByText('Empezar');
  fireEvent.click(screen.getByText('Empezar')); fireEvent.click(screen.getByLabelText('Nada')); expect(screen.getByText('0 de 3 respondidas')).toBeVisible(); expect(history.state.question).not.toHaveProperty('answerCode');
  fireEvent.click(screen.getByText('Siguiente')); await screen.findByText('Pregunta b'); fireEvent.click(screen.getByText('Volver')); await screen.findByText('Revisar mis respuestas'); fireEvent.click(screen.getByText('Revisar mis respuestas')); fireEvent.click(screen.getByRole('button', { name: 'Editar: Pregunta a' }));
  const count = request.mock.calls.length; fireEvent.click(screen.getByText('Volver a mis respuestas')); await screen.findByRole('button', { name: 'Editar: Pregunta a' }); expect(request).toHaveBeenCalledTimes(count);
  fireEvent.click(screen.getByRole('button', { name: 'Editar: Pregunta a' })); fireEvent.click(screen.getByLabelText('Bastante')); fireEvent.click(screen.getByText('Guardar cambios')); await screen.findByRole('button', { name: 'Editar: Pregunta a' });
  fireEvent.click(screen.getByRole('button', { name: 'Editar: Pregunta a' })); fireEvent.click(screen.getByText('Quitar respuesta')); await screen.findByText('Todavía no hay respuestas para revisar.');
});
it('keeps successful snapshots when a later refresh fails and handles DELETE uncertainty', async () => {
  const { controller, request } = setup(); const { result } = renderHook(() => useAffinityQuestionnaire(controller)); await waitFor(() => expect(result.current.catalog).not.toBeNull());
  await act(async () => { await result.current.mutate('a', 'A'); }); request.mockRejectedValueOnce(new ApiError('network'));
  await act(async () => { await result.current.refresh(); }); expect(result.current.answers).toEqual([answer()]);
  request.mockRejectedValueOnce(new ApiError('network')); await act(async () => { await result.current.mutate('a', null); }); expect(result.current.answers).toEqual([answer()]); expect(result.current.uncertain).toBe(true);
});
it('retains the local selection on uncertain failure and reconciles before another save', async () => {
  const { controller, request } = setup();
  function Probe() { const model = useAffinityQuestionnaire(controller), navigation = useHomeNavigation(() => true); return <><button onClick={() => navigation.open('affinities')}>Afinidades</button><AffinityQuestionnaire model={model} navigation={navigation}/></>; }
  render(<Probe/>); fireEvent.click(screen.getByText('Afinidades')); await screen.findByText('Empezar'); fireEvent.click(screen.getByText('Empezar')); fireEvent.click(screen.getByLabelText('Nada'));
  request.mockRejectedValueOnce(new ApiError('network')); fireEvent.click(screen.getByText('Siguiente')); await screen.findByRole('alert'); expect(screen.getByLabelText('Nada')).toBeChecked(); expect(screen.getByText('Siguiente')).toBeDisabled();
  fireEvent.click(screen.getByText('Reintentar consulta')); await waitFor(() => expect(screen.getByText('Siguiente')).toBeEnabled()); expect(screen.getByLabelText('Nada')).toBeChecked(); fireEvent.click(screen.getByText('Siguiente')); await screen.findByText('Pregunta b');
});
it('falls back to the source parent when a refreshed question disappears', async () => {
  const { controller, request } = setup();
  function Probe() { const model = useAffinityQuestionnaire(controller), navigation = useHomeNavigation(() => true); return <><button onClick={() => navigation.open('affinities')}>Afinidades</button><AffinityQuestionnaire model={model} navigation={navigation}/></>; }
  render(<Probe/>); fireEvent.click(screen.getByText('Afinidades')); await screen.findByText('Empezar'); fireEvent.click(screen.getByText('Explorar por categoría')); fireEvent.click(screen.getAllByText('Empezar categoría')[0]!);
  const catalog = fixture(); catalog.questions = catalog.questions.filter(q => q.id !== 'a'); request.mockResolvedValueOnce(catalog); act(() => document.dispatchEvent(new Event('visibilitychange'))); await screen.findAllByText('Empezar categoría'); expect(history.state.trail.at(-1)).toBe('affinity-categories');
});
it('rejects a mutation from a revoked tab through SessionController and ApiClient', async () => {
  const ownership = new TabOwnershipManager(); vi.spyOn(ownership, 'getSnapshot').mockReturnValue('active'); vi.spyOn(ownership, 'assert').mockImplementation(() => {});
  const write = deferred<Response>(), user = { uid: 'f', emailVerified: true, getIdToken: async () => 'synthetic', reload: async () => {} };
  const json = (raw: unknown) => new Response(JSON.stringify(raw));
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (path, options) => {
    if (options?.method === 'PATCH') return write.promise;
    if (path === '/api/me') return json({ id: 'u', status: 'ACTIVE' });
    if (path === '/api/me/profile') return json({ id: 'p', userId: 'u', status: 'ACTIVE' });
    return json(path === '/api/reference/affinity-questions' ? fixture() : { answers: [] });
  });
  const controller = new SessionController({ observe: next => { next(user); return () => {}; }, signIn: async () => user, signUp: async () => user, google: async () => user, verify: async () => {}, signOut: async () => {} }, new ApiClient(fetcher, ownership), false, ownership);
  const { result, unmount } = renderHook(() => useAffinityQuestionnaire(controller)); await waitFor(() => expect(result.current.catalog).not.toBeNull());
  let task!: Promise<unknown>; act(() => { task = result.current.mutate('a', 'A'); }); await waitFor(() => expect(fetcher.mock.calls.some(([,o]) => o?.method === 'PATCH')).toBe(true));
  act(() => ownership.stop()); await act(async () => { write.resolve(json({ answers: [answer()] })); expect(await task).toBeNull(); }); expect(result.current.answers).toEqual([]); unmount();
});
