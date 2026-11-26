import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import Contacts from './Contacts';
import { ApiClient, ApiError } from '../auth/api';
import { controllerFixture } from '../chat/fixtures';
import { contactStatus, importResult, ownerPath } from './contracts';
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
  for (const [path, method] of [[ownerPath + '/consent', 'PUT'], [ownerPath + '/selection', 'DELETE'], ['/me', 'PUT']] as const) {
    await api.request(path, new AbortController().signal, undefined, method, undefined, undefined, true, undefined, undefined, initial.mutationRevision);
  }
  expect(fetcher.mock.calls.map(([, options]) => new Headers(options?.headers).get('X-Contact-Revision'))).toEqual([initial.mutationRevision, null, null]);
});
it.each([{ mutationRevision: 'unknown' }, { syncedAt: 32 }, { acceptedAt: 'invalid' }, { state: 'OTHER' }, { importAvailable: null }])('rejects invalid owner data %o', patch => {
  expect(() => contactStatus({ ...initial, ...patch })).toThrow();
});
it('accepts omitted nullable status fields', () => {
  expect(contactStatus({ mutationRevision: initial.mutationRevision, requiredConsentVersion: 1, state: 'NOT_CONFIGURED', importAvailable: false }).acceptedAt).toBeNull();
});
it('accepts confirmed empty selection and validates counts', () => {
  expect(importResult({ status: synced, submittedCount: 0, distinctCount: 0 }, 0).distinctCount).toBe(0);
  expect(() => importResult({ status: synced, submittedCount: 1, distinctCount: 2 }, 1)).toThrow();
});
it('requires separate consent and selection, advances the revision and submits only selected numbers', async () => {
  const controller = controllerFixture();
  const request = vi.spyOn(controller, 'request').mockResolvedValueOnce(initial).mockResolvedValueOnce(accepted)
    .mockResolvedValueOnce({ status: synced, submittedCount: 1, distinctCount: 1 });
  const pick = vi.fn(async () => rows);
  render(<Contacts controller={controller} onBack={vi.fn()} sources={{ picker: async () => pick }}/>);
  await click('Acepto participar');
  expect(request.mock.calls[1]?.slice(2)).toEqual(['PUT', { version: 3 }, undefined, initial.mutationRevision]);
  expect(pick).not.toHaveBeenCalled();
  await click('Elegir del dispositivo'); await click('Seleccionar todos los válidos');
  fireEvent.click(screen.getAllByRole('checkbox')[1]!);
  await click('Confirmar reemplazo');
  expect(await screen.findByText('Selección sincronizada: 1 número distinto.')).toBeVisible();
  expect(request.mock.calls[2]?.slice(2)).toEqual(['PUT', { numbers: [rows[0]!.number] }, undefined, accepted.mutationRevision]);
  expect(JSON.stringify(localStorage)).not.toContain(rows[0]!.number);
});
it.each(['CONTACT_MUTATION_STALE', 'CONTACT_REVISION_REQUIRED', 'CONTACT_REPLACEMENT_LIMIT', 'INVALID_CONTACT_SELECTION', 'CONTACT_BODY_LIMIT', 'CONTACT_CONSENT_REQUIRED', 'CONTACT_IMPORT_DISABLED', 'LEGAL_ACTION_REQUIRED', 'network'])('retires failed writes and reconciles without replay (%s)', async code => {
  const controller = controllerFixture();
  const request = vi.spyOn(controller, 'request').mockResolvedValueOnce(accepted)
    .mockRejectedValueOnce(new ApiError(code === 'network' ? 'network' : 'backend', 409, code)).mockResolvedValue(synced);
  render(<Contacts controller={controller} onBack={vi.fn()} sources={{ picker: async () => async () => rows }}/>);
  await click('Elegir del dispositivo'); await click('Confirmar reemplazo');
  expect(await screen.findByRole('heading', { name: 'Selección sincronizada' })).toBeVisible();
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(request.mock.calls.map(c => c[2] ?? 'GET')).toEqual(['GET', 'PUT', 'GET']);
});
it('discards stale consent and requires a fresh decision', async () => {
  const controller = controllerFixture();
  const request = vi.spyOn(controller, 'request').mockResolvedValueOnce(initial).mockRejectedValueOnce(new ApiError('backend', 409, 'CONTACT_MUTATION_STALE')).mockResolvedValue(initial);
  render(<Contacts controller={controller} onBack={vi.fn()} sources={{ picker: async () => async () => rows }}/>);
  await click('Acepto participar');
  expect(await screen.findByText(/El estado de tus contactos cambió/)).toBeVisible();
  expect(request).toHaveBeenCalledTimes(3);
});
it.each([['Borrar selección', 'selection'], ['Retirar participación', 'consent']])('allows unconditional %s with imports disabled', async (button, path) => {
  const controller = controllerFixture();
  const request = vi.spyOn(controller, 'request').mockResolvedValueOnce({ ...synced, state: 'RESYNC_REQUIRED', importAvailable: false }).mockResolvedValueOnce(undefined).mockResolvedValue(initial);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  render(<Contacts controller={controller} onBack={vi.fn()} sources={{}}/>);
  expect(await screen.findByText('Necesitás volver a sincronizar')).toBeVisible();
  await click(button);
  await waitFor(() => expect(request).toHaveBeenCalledTimes(3));
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
  if (reason === 'cancel') await click('Cancelar');
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
  expect(screen.getByRole('button', { name: 'Confirmar reemplazo' })).toBeDisabled();
  expect(screen.getAllByRole('checkbox')[0]).toBe(box);
  request.mockResolvedValue({ ...accepted, mutationRevision: crypto.randomUUID() });
  await click('Consultar estado');
  await screen.findByText(/El estado de tus contactos cambió/);
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(request.mock.calls.every(call => call[2] === undefined)).toBe(true);
});
it('sends an explicitly confirmed empty Google replacement and discards local names and the region', async () => {
  const controller = controllerFixture();
  const request = vi.spyOn(controller, 'request').mockResolvedValueOnce(accepted).mockResolvedValueOnce({ status: synced, submittedCount: 0, distinctCount: 0 });
  render(<Contacts controller={controller} onBack={vi.fn()} sources={{ google: async () => async () => rows }}/>);
  await click('Preparar Google Contacts'); await click('Elegir cuenta de Google');
  expect((await screen.findAllByRole('checkbox'))[0]).not.toBeChecked();
  await click('Confirmar reemplazo');
  expect(await screen.findByText('Selección sincronizada: 0 números distintos.')).toBeVisible();
  expect(request.mock.calls[1]?.[3]).toEqual({ numbers: [] });
});
