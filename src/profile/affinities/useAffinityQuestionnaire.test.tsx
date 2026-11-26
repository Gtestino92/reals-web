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
async function openQuestionnaire(controller: SessionController) {
  function Probe() {
    const model = useAffinityQuestionnaire(controller);
    const navigation = useHomeNavigation(() => true);
    return <><button onClick={() => navigation.open('affinities')}>Afinidades</button><AffinityQuestionnaire model={model} navigation={navigation}/></>;
  }
  render(<Probe/>);
  fireEvent.click(screen.getByRole('button', { name: 'Afinidades' }));
  await screen.findByRole('button', { name: 'Empezar' });
}

const clickAction = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const option = (name: string) => screen.getByRole('radio', { name });

it('clears a category selection and omits it without writing or serializing the draft', async () => {
  const { controller, request } = setup();
  await openQuestionnaire(controller);
  clickAction('Explorar por categoría');
  fireEvent.click(screen.getAllByRole('button', { name: 'Empezar categoría' })[0]!);
  const entry = history.state, readCount = request.mock.calls.length;
  fireEvent.click(option('Nada'));
  expect(screen.queryByRole('button', { name: 'Omitir' })).toBeNull();
  const clear = screen.getByRole('button', { name: 'Quitar selección' });
  act(() => clear.focus());
  fireEvent.click(clear);
  expect(option('Nada')).not.toBeChecked();
  expect(option('Bastante')).not.toBeChecked();
  expect(option('Bastante')).toHaveFocus();
  expect(history.state).toEqual(entry);
  expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  clickAction('Omitir');
  expect(screen.getByText('Pregunta b')).toBeVisible();
  expect(screen.getByRole('progressbar')).toHaveValue(0);
  expect(request).toHaveBeenCalledTimes(readCount);
  act(() => history.back());
  await screen.findAllByRole('button', { name: 'Empezar categoría' });
  act(() => history.forward());
  await screen.findByText('Pregunta b');
  expect(option('Nada')).not.toBeChecked();
  clickAction('Volver');
  fireEvent.click((await screen.findAllByRole('button', { name: 'Empezar categoría' }))[0]!);
  expect(screen.getByText('Pregunta a')).toBeVisible();
  expect(option('Nada')).not.toBeChecked();
});

it('saves only the replacement selection and advances after authoritative progress changes', async () => {
  const { controller, request } = setup();
  await openQuestionnaire(controller);
  clickAction('Empezar');
  fireEvent.click(option('Nada'));
  const reads = request.mock.calls.length;
  clickAction('Quitar selección');
  fireEvent.click(option('Bastante'));
  expect(request).toHaveBeenCalledTimes(reads);
  const pending = deferred<unknown>();
  request.mockReturnValueOnce(pending.promise);
  clickAction('Siguiente');
  expect(request).toHaveBeenLastCalledWith('/me/profile/affinity-answers', expect.any(AbortSignal), 'PATCH', { answers: [{ questionId: 'a', answerCode: 'B' }] });
  expect(screen.getByRole('progressbar')).toHaveValue(0);
  expect(screen.getByRole('button', { name: 'Quitar selección' })).toBeDisabled();
  await act(async () => pending.resolve({ answers: [answer('a', 'B')] }));
  await screen.findByText('Pregunta b');
  expect(screen.getByRole('progressbar')).toHaveValue(1);
  expect(option('Bastante')).not.toBeChecked();
});

it('disables saving a draft against a changed semantic version and clears drafts on account replacement', async () => {
  const { controller, request, replace } = setup();
  await openQuestionnaire(controller);
  clickAction('Empezar');
  fireEvent.click(option('Nada'));
  const catalog = fixture();
  catalog.questions[0]!.semanticVersion++;
  request.mockResolvedValueOnce(catalog);
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(option('Nada')).not.toBeChecked();
  expect(screen.queryByRole('button', { name: 'Quitar selección' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  fireEvent.click(option('Bastante'));
  await act(async () => replace());
  await screen.findByText('Pregunta a');
  expect(option('Bastante')).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Omitir' })).toBeEnabled();
  expect(request.mock.calls.filter(([, , method]) => method === 'PATCH' || method === 'DELETE')).toEqual([]);
});
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
  clickAction('Editar: Pregunta a');
  fireEvent.click(option('Bastante'));
  clickAction('Descartar cambio');
  expect(option('Nada')).toBeChecked();
  expect(screen.queryByRole('button', { name: 'Omitir' })).toBeNull();
  expect(screen.getByRole('progressbar')).toHaveValue(1);
  expect(request).toHaveBeenCalledTimes(count);
  fireEvent.click(option('Bastante'));
  clickAction('Volver');
  await screen.findByRole('button', { name: 'Editar: Pregunta a' });
  expect(request).toHaveBeenCalledTimes(count);
  clickAction('Editar: Pregunta a');
  expect(option('Nada')).toBeChecked();
  fireEvent.click(option('Bastante'));
  clickAction('Guardar cambios');
  await screen.findByRole('button', { name: 'Editar: Pregunta a' });
  clickAction('Editar: Pregunta a');
  clickAction('Quitar respuesta');
  await screen.findByText('Todavía no hay respuestas para revisar.');
  expect(request).toHaveBeenLastCalledWith('/me/profile/affinity-answers/a', expect.any(AbortSignal), 'DELETE', undefined);
  expect(screen.getByRole('progressbar')).toHaveValue(0);
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

it.each(['PATCH','DELETE'] as const)('keeps resume quiet and lets %s supersede a delayed background read', async method => {
  const { controller, request } = setup(); const { result } = renderHook(() => useAffinityQuestionnaire(controller));
  await waitFor(() => expect(result.current.catalog).not.toBeNull());
  await act(async () => { await result.current.mutate('a','A'); });
  const catalog = result.current.catalog, old = deferred<unknown>(); request.mockReturnValueOnce(old.promise);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  const signal = request.mock.calls.at(-2)![1];
  expect(result.current.busy).toBe(false); expect(result.current.uncertain).toBe(false); expect(result.current.catalog).toBe(catalog);
  await act(async () => { await result.current.mutate('a',method === 'PATCH' ? 'B' : null); });
  expect(signal.aborted).toBe(true);
  const confirmed = result.current.answers;
  expect(confirmed).toEqual(method === 'PATCH' ? [answer('a','B')] : []);
  await act(async () => old.resolve(fixture())); expect(result.current.answers).toBe(confirmed);
});
it('keeps affinity content after resume failure but requires reconciliation before writing', async () => {
  const { controller, request } = setup(); const { result } = renderHook(() => useAffinityQuestionnaire(controller));
  await waitFor(() => expect(result.current.catalog).not.toBeNull()); const catalog = result.current.catalog;
  request.mockRejectedValueOnce(new ApiError('network')); act(() => document.dispatchEvent(new Event('visibilitychange')));
  await waitFor(() => expect(result.current.error).toBeTruthy()); expect(result.current.catalog).toBe(catalog); expect(result.current.uncertain).toBe(true);
  const before = request.mock.calls.length; await act(async () => { await result.current.mutate('a','A'); }); expect(request).toHaveBeenCalledTimes(before);
  await act(async () => { await result.current.refresh(); }); expect(result.current.uncertain).toBe(false);
});

it('retains local affinity selection, focused controls and enabled saving while resuming', async () => {
  const { controller, request } = setup();
  function Probe() { const model = useAffinityQuestionnaire(controller), navigation = useHomeNavigation(() => true); return <><button onClick={() => navigation.open('affinities')}>Afinidades</button><AffinityQuestionnaire model={model} navigation={navigation}/></>; }
  render(<Probe/>); fireEvent.click(screen.getByText('Afinidades')); fireEvent.click(await screen.findByText('Empezar'));
  const option = screen.getByLabelText('Nada'); fireEvent.click(option); option.focus();
  const old = deferred<unknown>(); request.mockReturnValueOnce(old.promise);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(screen.getByLabelText('Nada')).toBe(option); expect(option).toHaveFocus(); expect(option).toBeChecked(); expect(option).toBeEnabled();
  expect(screen.getByText('Siguiente')).toBeEnabled();
  await act(async () => old.resolve(fixture())); expect(screen.getByLabelText('Nada')).toBe(option); expect(option).toBeChecked(); expect(option).toHaveFocus();
});

it('retires a departed surface read and ignores its response after returning to Home', async () => {
  const { controller, request } = setup();
  const view = renderHook(({visible}) => useAffinityQuestionnaire(controller, visible ? 'home' : null), {initialProps:{visible:false}});
  expect(request).not.toHaveBeenCalled();
  const old = deferred<unknown>();
  request.mockReturnValueOnce(old.promise);
  view.rerender({visible:true});
  const signal = request.mock.calls[0]![1];
  view.rerender({visible:false});
  expect(signal.aborted).toBe(true);
  view.rerender({visible:true});
  await waitFor(()=>expect(view.result.current.catalog).toBeTruthy());
  const catalog = view.result.current.catalog;
  await act(async()=>old.resolve({}));
  expect(view.result.current.catalog).toBe(catalog);
  expect(view.result.current.uncertain).toBe(false);
  expect(request).toHaveBeenCalledTimes(4);
});
