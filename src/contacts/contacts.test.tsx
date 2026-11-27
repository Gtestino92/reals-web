import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import Contacts from './Contacts';
import { ApiClient, ApiError } from '../auth/api';
import { controllerFixture } from '../chat/fixtures';
import { additionResult, contactStatus, importResult, ownerPath } from './contracts';
import type { ContactRow } from './providers';

const initial = { mutationRevision: crypto.randomUUID(), requiredConsentVersion: 3, acceptedConsentVersion: null,
  acceptedAt: null, state: 'NOT_CONFIGURED', syncedAt: null, importAvailable: true };
const accepted = { ...initial, acceptedAt: new Date().toISOString(), acceptedConsentVersion: 3, mutationRevision: crypto.randomUUID() };
const synced = { ...accepted, syncedAt: accepted.acceptedAt, state: 'SYNCED' };
const rows = [{ name: 'Ejemplo', number: '+12025550100' }, { name: 'Ejemplo', number: '+12025550101' }];
const click = async (name: string) => fireEvent.click(await screen.findByRole('button', { name }));
it('sends the captured revision on protected PUTs and no contact header on other requests', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({}));
  const api = new ApiClient(fetcher);
  for (const [path, method] of [[ownerPath + '/consent', 'PUT'], [ownerPath + '/selection/additions', 'PUT'], [ownerPath + '/selection/additions?extra', 'PUT'], [ownerPath + '/selection/additions', 'POST'], [ownerPath + '/selection', 'DELETE'], ['/me', 'PUT']] as const) {
    await api.request(path, new AbortController().signal, undefined, method, undefined, undefined, true, undefined, undefined, initial.mutationRevision);
  }
  expect(fetcher.mock.calls.map(([, options]) => new Headers(options?.headers).get('X-Contact-Revision'))).toEqual([initial.mutationRevision, initial.mutationRevision, null, null, null, null]);
});
it.each([{ mutationRevision: 'unknown' }, { syncedAt: 32 }, { acceptedAt: 'invalid' }, { state: 'OTHER' }, { importAvailable: null }])('rejects invalid owner data %o', patch => {
  expect(() => contactStatus({ ...initial, ...patch })).toThrow();
});
it('accepts omitted nullable status fields', () => {
  expect(contactStatus({ mutationRevision: initial.mutationRevision, requiredConsentVersion: 1, state: 'NOT_CONFIGURED', importAvailable: false }).acceptedAt).toBeNull();
});
it.each([
  [synced, -1], [synced, 1.5], [synced, Number.MAX_SAFE_INTEGER + 1], [synced, null], [synced, '6'],
  [initial, 1], [initial, null], [{ ...synced, state: 'RESYNC_REQUIRED' }, 0],
] as const)('rejects counts incompatible with owner status', (status, totalDistinctCount) => {
  expect(() => contactStatus({ ...status, totalDistinctCount })).toThrow();
});

it('validates both mutation totals against the nested owner snapshot when supplied', () => {
  const result = { status: { ...synced, totalDistinctCount: 5 }, submittedCount: 2 };
  expect(() => importResult({ ...result, distinctCount: 2 }, 2)).toThrow();
  expect(() => additionResult({ ...result, addedDistinctCount: 1, totalDistinctCount: 4 }, 2)).toThrow();
  expect(contactStatus(initial).totalDistinctCount).toBeUndefined();
  expect(contactStatus({ ...initial, totalDistinctCount: 0 }).totalDistinctCount).toBe(0);
});

it('installs the current total on entry, foreground reconciliation and remount', async () => {
  const controller = controllerFixture();
  const request = vi.spyOn(controller, 'request').mockResolvedValue({ ...synced, importAvailable: false, totalDistinctCount: 0 });
  const mount = () => render(<Contacts controller={controller} onBack={vi.fn()} sources={{}}/>);
  const view = mount();
  const count = await screen.findByText('0 teléfonos');
  let finish!: (value: unknown) => void;
  request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent(window, new Event('pageshow'));
  expect(count).toBeVisible();
  await act(async () => finish({ ...synced, mutationRevision: crypto.randomUUID(), totalDistinctCount: 6 }));
  expect(screen.getByText('6 teléfonos')).toBe(count);
  request.mockResolvedValueOnce({ ...synced, state: 'RESYNC_REQUIRED', totalDistinctCount: null });
  await act(async () => window.dispatchEvent(new Event('pageshow')));
  expect(count).not.toBeInTheDocument();
  view.unmount();
  request.mockResolvedValueOnce({ ...synced, totalDistinctCount: 8 });
  mount();
  expect(await screen.findByText('8 teléfonos')).toBeVisible();
  request.mockResolvedValueOnce(synced);
  await act(async () => window.dispatchEvent(new Event('pageshow')));
  expect(screen.queryByText(/^\d+ teléfonos?$/)).toBeNull();
  expect(request.mock.calls.map(c => c[0])).toEqual(Array(5).fill(ownerPath));
});
it.each(['Borrar contactos', 'Deshabilitar'])('removes the synchronized total after %s', async confirm => {
  const controller = controllerFixture(), back = vi.fn();
  const request = vi.spyOn(controller, 'request').mockResolvedValueOnce({ ...synced, totalDistinctCount: 6 })
    .mockResolvedValueOnce(undefined).mockResolvedValue({ ...(confirm === 'Deshabilitar' ? initial : accepted), totalDistinctCount: 0 });
  render(<Contacts controller={controller} onBack={back} sources={{}}/>);
  expect(await screen.findByText('6 teléfonos')).toBeVisible();
  await click(confirm === 'Deshabilitar' ? 'Deshabilitar contactos en común' : 'Borrar contactos compartidos');
  await click(confirm);
  await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
  expect(screen.queryByText(/^\d+ teléfonos?$/)).toBeNull();
  expect(back).toHaveBeenCalledTimes(confirm === 'Deshabilitar' ? 1 : 0);
});

it('replaces the displayed total with the confirmed replacement size', async () => {
  const controller = controllerFixture();
  vi.spyOn(controller, 'request').mockResolvedValueOnce({ ...synced, totalDistinctCount: 6 }).mockResolvedValueOnce({
    status: { ...synced, mutationRevision: crypto.randomUUID(), totalDistinctCount: 2 }, submittedCount: 2, distinctCount: 2,
  });
  render(<Contacts controller={controller} onBack={vi.fn()} sources={{ picker: async () => async () => rows }}/>);
  await click('Reemplazar selección');
  await screen.findByRole('checkbox', { name: /Deseleccionar todos/ });
  await click('Reemplazar selección');
  expect(await screen.findByText('2 teléfonos')).toBeVisible();
  expect(screen.queryByText('6 teléfonos')).toBeNull();
});
it('accepts confirmed empty selection and validates counts', () => {
  expect(importResult({ status: synced, submittedCount: 0, distinctCount: 0 }, 0).distinctCount).toBe(0);
  expect(() => importResult({ status: synced, submittedCount: 1, distinctCount: 2 }, 1)).toThrow();
});
it('requires separate consent and selection, advances the revision and submits only selected numbers', async () => {
  const controller = controllerFixture();
  const request = vi.spyOn(controller, 'request').mockResolvedValueOnce(initial).mockResolvedValueOnce(accepted)
    .mockResolvedValueOnce({ status: { ...synced, totalDistinctCount: 1 }, submittedCount: 1, distinctCount: 1 });
  const pick = vi.fn(async () => rows);
  render(<Contacts controller={controller} onBack={vi.fn()} sources={{ picker: async () => pick }}/>);
  await click('Acepto participar');
  expect(request.mock.calls[1]?.slice(2)).toEqual(['PUT', { version: 3 }, undefined, initial.mutationRevision]);
  expect(pick).not.toHaveBeenCalled();
  await click('Elegir del dispositivo');
  fireEvent.click((await screen.findAllByRole('checkbox'))[2]!);
  await click('Importar contactos');
  expect(await screen.findByText('Sincronizaste 1 teléfono.')).toBeVisible();
  expect(screen.getByText('1 teléfono')).toBeVisible();
  expect(request.mock.calls[2]?.slice(2)).toEqual(['PUT', { numbers: [rows[0]!.number] }, undefined, accepted.mutationRevision]);
  expect(JSON.stringify(localStorage)).not.toContain(rows[0]!.number);
});
it.each(['CONTACT_MUTATION_STALE', 'CONTACT_REVISION_REQUIRED', 'CONTACT_REPLACEMENT_LIMIT', 'INVALID_CONTACT_SELECTION', 'CONTACT_BODY_LIMIT', 'CONTACT_CONSENT_REQUIRED', 'CONTACT_IMPORT_DISABLED', 'LEGAL_ACTION_REQUIRED', 'network'])('retires failed writes and reconciles without replay (%s)', async code => {
  const controller = controllerFixture();
  const request = vi.spyOn(controller, 'request').mockResolvedValueOnce(accepted)
    .mockRejectedValueOnce(new ApiError(code === 'network' ? 'network' : 'backend', 409, code)).mockResolvedValue(synced);
  render(<Contacts controller={controller} onBack={vi.fn()} sources={{ picker: async () => async () => rows }}/>);
  await click('Elegir del dispositivo'); await click('Importar contactos');
  expect(await screen.findByRole('heading', { name: 'Contactos sincronizados' })).toBeVisible();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(request.mock.calls.map(c => c[2] ?? 'GET')).toEqual(['GET', 'PUT', 'GET']);
});
it('reconciles a selection rejected by Fetch redirect policy without replay', async () => {
  const controller = controllerFixture();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(accepted))
    .mockRejectedValueOnce(new TypeError('Redirect rejected')).mockResolvedValue(Response.json(accepted));
  const api = new ApiClient(fetcher);
  vi.spyOn(controller, 'request').mockImplementation((path, signal, method, body, access, revision) =>
    api.request(path, signal, undefined, method, body, undefined, true, undefined, access, revision));
  render(<Contacts controller={controller} onBack={vi.fn()} sources={{ picker: async () => async () => rows }}/>);
  await click('Elegir del dispositivo'); await click('Importar contactos');
  await screen.findByText(/No pudimos confirmar el resultado/);
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(fetcher.mock.calls.map(([url, init]) => [url, init?.method, init?.redirect])).toEqual([
    ['/api' + ownerPath, 'GET', 'error'],
    ['/api' + ownerPath + '/selection', 'PUT', 'error'],
    ['/api' + ownerPath, 'GET', 'error'],
  ]);
});
it('discards stale consent and requires a fresh decision', async () => {
  const controller = controllerFixture();
  const request = vi.spyOn(controller, 'request').mockResolvedValueOnce(initial).mockRejectedValueOnce(new ApiError('backend', 409, 'CONTACT_MUTATION_STALE')).mockResolvedValue(initial);
  render(<Contacts controller={controller} onBack={vi.fn()} sources={{ picker: async () => async () => rows }}/>);
  await click('Acepto participar');
  expect(await screen.findByText(/El estado de tus contactos cambió/)).toBeVisible();
  expect(request).toHaveBeenCalledTimes(3);
});
it.each([['Borrar contactos compartidos', 'selection'], ['Deshabilitar contactos en común', 'consent']])('allows unconditional %s with imports disabled', async (button, path) => {
  const controller = controllerFixture();
  const request = vi.spyOn(controller, 'request').mockResolvedValueOnce({ ...synced, state: 'RESYNC_REQUIRED', importAvailable: false }).mockResolvedValueOnce(undefined).mockResolvedValue(initial);
  const onBack = vi.fn();
  render(<Contacts controller={controller} onBack={onBack} sources={{}}/>);
  expect(await screen.findByText('Necesitás volver a sincronizar')).toBeVisible();
  await click(button);
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
  await click('Cancelar');
  expect(request).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: button })).toHaveFocus();
  await click(button);
  await click(path === 'selection' ? 'Borrar contactos' : 'Deshabilitar');
  await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
  expect(onBack).toHaveBeenCalledTimes(path === 'consent' ? 1 : 0);
  expect(request.mock.calls[1]?.[0]).toBe(ownerPath + '/' + path);
  expect(request.mock.calls[1]?.slice(2)).toEqual(['DELETE', undefined, undefined, undefined]);
});
it.each(['cancel', 'pagehide', 'session', 'unmount'])('ignores late picker after %s', async reason => {
  const controller = controllerFixture(), lease = new AbortController();
  vi.spyOn(controller, 'sessionSignal', 'get').mockReturnValue(lease.signal);
  vi.spyOn(controller, 'request').mockResolvedValue(accepted);
  let resolve!: (rows: ContactRow[]) => void;
  const pending = new Promise<ContactRow[]>(done => { resolve = done; });
  const view = render(<Contacts controller={controller} onBack={vi.fn()} sources={{ picker: async () => () => pending }}/>);
  await click('Elegir del dispositivo');
  if (reason === 'cancel') await click('Volver a Cuenta');
  if (reason === 'unmount') view.unmount();
  if (reason === 'pagehide') fireEvent(window, new Event('pagehide'));
  if (reason === 'session') act(() => lease.abort());
  await act(async () => resolve(rows));
  expect(screen.queryByRole('checkbox')).toBeNull();
});



it('preserves review on compatible resume and discards it on an external revision', async () => {
  const controller = controllerFixture();
  const request = vi.spyOn(controller, 'request').mockResolvedValue(accepted);
  render(<Contacts controller={controller} onBack={vi.fn()} sources={{ picker: async () => async () => rows }}/>);
  await click('Elegir del dispositivo');
  const box = (await screen.findAllByRole('checkbox'))[0]!;
  fireEvent.click(box);
  await act(async () => { window.dispatchEvent(new Event('pageshow')); });
  expect(screen.getAllByRole('checkbox')[0]).toBe(box);
  expect(box).not.toBeChecked();
  request.mockRejectedValueOnce(new ApiError('network'));
  await act(async () => { window.dispatchEvent(new Event('pageshow')); });
  expect(screen.getByRole('button', { name: 'Importar contactos' })).toBeDisabled();
  expect(screen.getAllByRole('checkbox')[0]).toBe(box);
  request.mockResolvedValue({ ...accepted, mutationRevision: crypto.randomUUID() });
  await click('Consultar estado');
  await screen.findByText(/El estado de tus contactos cambió/);
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(request.mock.calls.every(call => call[2] === undefined)).toBe(true);
});
it('preselects Google numbers and prevents an empty update', async () => {
  const controller = controllerFixture();
  const request = vi.spyOn(controller, 'request').mockResolvedValue(synced);
  render(<Contacts controller={controller} onBack={vi.fn()} sources={{ google: async () => async () => rows }}/>);
  await click('Agregar contactos'); await click('Elegir cuenta de Google');
  expect((await screen.findAllByRole('checkbox'))[0]).toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: /Deseleccionar todos/ }));
  expect(screen.getByRole('button', { name: 'Agregar contactos' })).toBeDisabled();
  expect(request).toHaveBeenCalledTimes(1);
});

it.each([
  [false, {}, 'Las importaciones están pausadas por el momento.'],
  [true, {}, 'Por ahora no hay fuentes de contactos habilitadas.'],
  [true, { picker: async (): Promise<null> => null }, 'Este navegador no ofrece el selector de contactos del dispositivo.'],
  [true, { picker: async (): Promise<never> => { throw Error(); } }, 'No pudimos comprobar el selector. Volvé a entrar en Contactos para reintentar.'],
] as const)('explains availability when imports=%s and sources=%o', async (importAvailable, sources, message) => {
  const controller = controllerFixture();
  vi.spyOn(controller, 'request').mockResolvedValue({ ...synced, importAvailable });
  render(<Contacts controller={controller} onBack={vi.fn()} sources={sources}/>);
  expect(await screen.findByText(message)).toBeVisible();
  expect(screen.getByRole('button', { name: 'Deshabilitar contactos en común' })).toBeEnabled();
});

it('uses the same loading presentation through discovery, then keeps consent progress on the action', async () => {
  const controller = controllerFixture();
  let finishRead!: (value: unknown) => void, finishWrite!: (value: unknown) => void;
  let ready!: () => void;
  const request = vi.spyOn(controller, 'request')
    .mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }))
    .mockImplementationOnce(() => new Promise(resolve => { finishWrite = resolve; }));
  render(<Contacts controller={controller} onBack={vi.fn()} sources={{ picker: async () => {
    await new Promise<void>(resolve => { ready = resolve; }); return async () => rows;
  } }}/>);
  const skeleton = screen.getByRole('status', { name: 'Cargando contactos' });
  await act(async () => finishRead(initial));
  expect(skeleton).toBeVisible();
  await act(async () => ready());
  const button = screen.getByRole('button', { name: 'Acepto participar' });
  fireEvent.click(button); fireEvent.click(button);
  expect(button).toHaveAttribute('aria-busy', 'true'); expect(button).toBeDisabled();
  expect(screen.queryByText('Actualizando…')).toBeNull();
  expect(request).toHaveBeenCalledTimes(2);
  await act(async () => finishWrite(accepted));
  expect(await screen.findByRole('button', { name: 'Elegir del dispositivo' })).toBeEnabled();
});
it('recovers an initial status failure and keeps a synced set through empty and rejected picks', async () => {
  const controller = controllerFixture();
  const request = vi.spyOn(controller, 'request').mockRejectedValueOnce(new Error()).mockResolvedValue(synced);
  const source = vi.fn().mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError')).mockResolvedValueOnce([]);
  render(<Contacts controller={controller} onBack={vi.fn()} sources={{ picker: async () => source }}/>);
  await click('Consultar estado'); await click('Agregar contactos');
  await screen.findByText(/no permitió/); await click('Agregar contactos');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Agregar contactos' })).toBeEnabled());
  expect(screen.queryByText(/No se eligieron teléfonos/)).toBeNull();
  expect(screen.getByRole('heading', { name: 'Contactos sincronizados' })).toBeVisible();
  expect(request.mock.calls.every(call => call[2] === undefined)).toBe(true);
});

it('keeps privacy controls available during slow capability discovery and shows withdrawal progress in place', async () => {
  const controller = controllerFixture();
  let finish!: (value: unknown) => void;
  const request = vi.spyOn(controller, 'request').mockResolvedValueOnce(synced)
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(initial);
  const onBack = vi.fn();
  render(<Contacts controller={controller} onBack={onBack} sources={{ picker: () => new Promise(() => {}) }}/>);
  const button = await screen.findByRole('button', { name: 'Deshabilitar contactos en común' });
  expect(screen.getByRole('status', { name: 'Cargando contactos' })).toBeVisible();
  fireEvent.click(button);
  await click('Deshabilitar');
  expect(onBack).not.toHaveBeenCalled();
  expect(button).toHaveAttribute('aria-busy', 'true');
  expect(button).toBeDisabled();
  await act(async () => finish(undefined));
  expect(request.mock.calls[1]?.slice(2)).toEqual(['DELETE', undefined, undefined, undefined]);
});
it('keeps the confirmation button and its label while the selection write settles', async () => {
  const controller = controllerFixture();
  let finish!: (value: unknown) => void;
  vi.spyOn(controller, 'request').mockResolvedValueOnce(accepted)
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<Contacts controller={controller} onBack={vi.fn()} sources={{ picker: async () => async () => rows }}/>);
  await click('Elegir del dispositivo');
  const button = await screen.findByRole('button', { name: 'Importar contactos' });
  fireEvent.click(button);
  expect(button).toHaveAttribute('aria-busy', 'true'); expect(button).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancelar selección' })).toBeDisabled();
  await act(async () => finish({ status: synced, submittedCount: 2, distinctCount: 2 }));
  expect(await screen.findByText('Sincronizaste 2 teléfonos.')).toBeVisible();
});

it.each(['empty', 'cancel', 'success', 'revision'])('preserves the native launch surface during resume and handles %s settlement', async outcome => {
  const controller = controllerFixture();
  const request = vi.spyOn(controller, 'request').mockResolvedValueOnce(initial).mockResolvedValue(accepted);
  let finish!: (rows: ContactRow[]) => void, fail!: (error: Error) => void;
  const source = vi.fn(() => new Promise<ContactRow[]>((resolve, reject) => { finish = resolve; fail = reject; }));
  render(<Contacts controller={controller} onBack={vi.fn()} sources={{ picker: async () => source }}/>);
  await click('Acepto participar');
  const notice = await screen.findByText(/Consentimiento registrado/);
  const trigger = screen.getByRole('button', { name: 'Elegir del dispositivo' });
  fireEvent.click(trigger);
  fireEvent.click(trigger);
  expect(source).toHaveBeenCalledOnce();
  expect(trigger).toBeDisabled();
  expect(notice).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Cancelar' })).toBeNull();
  if (outcome === 'revision') request.mockResolvedValueOnce({ ...accepted, mutationRevision: crypto.randomUUID() });
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  await act(async () => {
    if (outcome === 'cancel') fail(new DOMException('', 'AbortError'));
    else finish(outcome === 'empty' ? [] : rows);
  });
  if (outcome === 'success') {
    expect(screen.getByText('Revisá tus contactos')).toBeVisible();
    expect(trigger).not.toBeInTheDocument();
  } else {
    expect(trigger).toBeEnabled();
    expect(screen.queryByRole('checkbox')).toBeNull();
    if (outcome === 'revision') expect(screen.getByText(/El estado de tus contactos cambió/)).toBeVisible();
    else expect(notice).toHaveTextContent('Consentimiento registrado');
  }
});

it.each([true, false])('settles the picker before the foreground read (same revision: %s)', async compatible => {
  const controller = controllerFixture();
  const request = vi.spyOn(controller, 'request').mockResolvedValue(synced);
  let settlePicker!: (rows: ContactRow[]) => void;
  let settleRead!: (status: typeof synced) => void;
  const pick = () => new Promise<ContactRow[]>(resolve => { settlePicker = resolve; });
  render(<Contacts controller={controller} onBack={vi.fn()} sources={{ picker: async () => pick }}/>);
  await click('Agregar contactos');
  request.mockImplementationOnce(() => new Promise(resolve => { settleRead = resolve; }));
  fireEvent(document, new Event('visibilitychange'));
  await act(async () => settlePicker(rows));
  const review = screen.getByRole('heading', { name: 'Agregar contactos' });
  expect(review).toBeVisible();
  await act(async () => settleRead(compatible ? synced : { ...synced, mutationRevision: crypto.randomUUID() }));
  if (compatible) expect(screen.getByRole('heading', { name: 'Agregar contactos' })).toBe(review);
  else {
    expect(review).not.toBeInTheDocument();
    expect(screen.getByText(/El estado de tus contactos cambió/)).toBeVisible();
  }
});

it('stays in Contacts when the server cannot confirm withdrawal', async () => {
  const controller = controllerFixture(), onBack = vi.fn();
  const request = vi.spyOn(controller, 'request').mockResolvedValueOnce(synced)
    .mockRejectedValueOnce(new Error()).mockResolvedValue(synced);
  render(<Contacts controller={controller} onBack={onBack} sources={{}}/>);
  await click('Deshabilitar contactos en común');
  await click('Deshabilitar');
  expect(await screen.findByText(/No pudimos confirmar el resultado/)).toBeVisible();
  expect(request.mock.calls.filter(call => call[2] === 'DELETE')).toHaveLength(1);
  expect(onBack).not.toHaveBeenCalled();
});

it.each([
  { submittedCount: 3 }, { submittedCount: -1 }, { addedDistinctCount: -1 }, { addedDistinctCount: 1.5 },
  { addedDistinctCount: 3 }, { totalDistinctCount: 0 }, { totalDistinctCount: Number.MAX_SAFE_INTEGER + 1 },
  { status: accepted }, { status: { ...synced, requiredConsentVersion: 4 } },
])('rejects inconsistent addition results %o', patch => {
  expect(() => additionResult({ status: synced, submittedCount: 2, addedDistinctCount: 1, totalDistinctCount: 5, ...patch }, 2)).toThrow();
});

it.each([
  [0, 'Todos los contactos seleccionados ya estaban sincronizados.'],
  [1, 'Agregaste 1 teléfono. Tenés 83 sincronizados.'],
  [2, 'Agregaste 2 teléfonos. Tenés 83 sincronizados.'],
] as const)('uses authoritative counts for %i new numbers', async (addedDistinctCount, message) => {
  const controller = controllerFixture();
  const request = vi.spyOn(controller, 'request').mockResolvedValueOnce(synced).mockResolvedValue({
    status: { ...synced, totalDistinctCount: 83, mutationRevision: addedDistinctCount ? crypto.randomUUID() : synced.mutationRevision },
    submittedCount: 2, addedDistinctCount, totalDistinctCount: 83,
  });
  const source = vi.fn(async () => rows);
  render(<Contacts controller={controller} onBack={vi.fn()} sources={{ picker: async () => source }}/>);
  fireEvent.click(await screen.findByRole('button', { name: 'Agregar contactos' }));
  expect(source).toHaveBeenCalledOnce();
  await screen.findByRole('heading', { name: 'Agregar contactos' });
  await click('Agregar contactos');
  expect(await screen.findByText(message)).toBeVisible();
  expect(screen.getByText('83 teléfonos')).toBeVisible();
  expect(request.mock.calls[1]?.[0]).toBe(ownerPath + '/selection/additions');
  expect(request.mock.calls[1]?.slice(2)).toEqual(['PUT', { numbers: rows.map(r => r.number) }, undefined, synced.mutationRevision]);
});

it.each(['Agregar contactos', 'Reemplazar selección'])('retains %s in the provider chooser and review', async action => {
  const controller = controllerFixture(), picker = vi.fn(async () => rows);
  const request = vi.spyOn(controller, 'request').mockResolvedValueOnce(synced).mockResolvedValue({
    status: synced, submittedCount: 2, distinctCount: 2, addedDistinctCount: 0, totalDistinctCount: 3,
  });
  render(<Contacts controller={controller} onBack={vi.fn()} sources={{ picker: async () => picker, google: async () => picker }}/>);
  await click(action);
  expect(await screen.findByRole('heading', { name: action })).toBeVisible();
  expect(picker).not.toHaveBeenCalled();
  await click('Elegir del dispositivo');
  await screen.findByRole('checkbox', { name: /Deseleccionar todos/ });
  await click(action);
  expect(request.mock.calls[1]?.[0]).toBe(ownerPath + (action === 'Agregar contactos' ? '/selection/additions' : '/selection'));
  expect(request.mock.calls[1]?.[5]).toBe(synced.mutationRevision);
});

it.each([
  ['CONTACT_SET_LIMIT', /superaría el total permitido/], ['CONTACT_REPLACEMENT_LIMIT', /adiciones y reemplazos/],
  ['CONTACT_FULL_REPLACEMENT_REQUIRED', /selección completa antes de agregar/], ['network', /No pudimos confirmar/],
] as const)('reconciles rejected additions without replay or automatic replacement (%s)', async (code, message) => {
  const controller = controllerFixture();
  const request = vi.spyOn(controller, 'request').mockResolvedValueOnce(synced)
    .mockRejectedValueOnce(new ApiError(code === 'network' ? 'network' : 'backend', 409, code))
    .mockResolvedValue(code === 'CONTACT_FULL_REPLACEMENT_REQUIRED' ? { ...synced, state: 'RESYNC_REQUIRED' } : synced);
  render(<Contacts controller={controller} onBack={vi.fn()} sources={{ picker: async () => async () => rows }}/>);
  await click('Agregar contactos');
  await screen.findByRole('checkbox', { name: /Deseleccionar todos/ });
  await click('Agregar contactos');
  expect(await screen.findByText(message)).toBeVisible();
  expect(await screen.findByRole('button', { name: 'Reemplazar selección' })).toBeEnabled();
  if (code === 'CONTACT_FULL_REPLACEMENT_REQUIRED') expect(screen.queryByRole('button', { name: 'Agregar contactos' })).toBeNull();
  expect(request.mock.calls.map(c => c[0])).toEqual([ownerPath, ownerPath + '/selection/additions', ownerPath]);
});

it.each([
  { requiredConsentVersion: 4, acceptedConsentVersion: 3 },
  { requiredConsentVersion: 4, acceptedConsentVersion: 4 },
  { state: 'RESYNC_REQUIRED' },
])('retires the additive choice on incompatible status even at the same revision %o', async patch => {
  const controller = controllerFixture();
  const request = vi.spyOn(controller, 'request').mockResolvedValue(synced);
  let finish!: (rows: ContactRow[]) => void;
  render(<Contacts controller={controller} onBack={vi.fn()} sources={{ picker: async () => () => new Promise(resolve => { finish = resolve; }) }}/>);
  await click('Agregar contactos');
  request.mockResolvedValue({ ...synced, ...patch });
  await act(async () => window.dispatchEvent(new Event('pageshow')));
  await act(async () => finish(rows));
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(await screen.findByText(/El estado de tus contactos cambió/)).toBeVisible();
  expect(request.mock.calls.every(call => call[2] === undefined)).toBe(true);
});

it('locks an additive write and rejects its late result after session retirement', async () => {
  const controller = controllerFixture(), session = new AbortController();
  vi.spyOn(controller, 'sessionSignal', 'get').mockReturnValue(session.signal);
  let finish!: (result: unknown) => void;
  const request = vi.spyOn(controller, 'request').mockResolvedValueOnce(synced)
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  render(<Contacts controller={controller} onBack={vi.fn()} sources={{ picker: async () => async () => rows }}/>);
  await click('Agregar contactos');
  await screen.findByRole('checkbox', { name: /Deseleccionar todos/ });
  const confirm = screen.getByRole('button', { name: 'Agregar contactos' });
  fireEvent.click(confirm); fireEvent.click(confirm);
  expect(confirm).toBeDisabled();
  expect(confirm).toHaveAttribute('aria-busy', 'true');
  act(() => session.abort());
  await act(async () => finish({ status: synced, submittedCount: 2, addedDistinctCount: 2, totalDistinctCount: 3 }));
  expect(screen.queryByText(/Agregaste/)).toBeNull();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(request).toHaveBeenCalledTimes(2);
});
