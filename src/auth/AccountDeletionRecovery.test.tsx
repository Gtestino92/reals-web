import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { OperationalApp } from '../App';
import { ApiClient } from './api';
import type { AuthService, Identity } from './firebase';
import { SessionController } from './session';
import { TabOwnershipManager } from '../tabs/TabOwnershipManager';
vi.mock('../onboarding/Onboarding', () => ({ Onboarding: ({ controller }: { controller: SessionController }) => <p>Perfil confirmado: {controller.snapshot.profile?.status}</p> }));
const deleted = { id: 'u', status: 'DELETED', deletedAt: '2026-11-01T00:00:00Z', deletionFinalizesAt: '2026-12-01T00:00:00Z' };
const active = { id: 'u', status: 'ACTIVE' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
let observer: (user: Identity | null) => void, user: Identity, auth: AuthService, fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  user = { uid: 'f', emailVerified: true, reload: vi.fn(), getIdToken: vi.fn().mockResolvedValue('synthetic') };
  auth = { observe: vi.fn(next => { observer = next; return () => {}; }), signIn: vi.fn(), signUp: vi.fn(), google: vi.fn(), verify: vi.fn(), signOut: vi.fn().mockResolvedValue(undefined) };
  fetcher = vi.fn<typeof fetch>();
});
async function mount(value: unknown = deleted) {
  fetcher.mockResolvedValueOnce(json(value));
  render(<StrictMode><OperationalApp firebase={{ service: auth, localVerification: false }} api={new ApiClient(fetcher)}/></StrictMode>);
  act(() => observer(user));
  await screen.findByRole('heading', { name: 'Cuenta pendiente de eliminación' });
}
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
it('preserves valid dates, focuses recovery, never loads normal screens or profile', async () => {
  await mount(); expect(screen.getByRole('heading', { name: 'Cuenta pendiente de eliminación' })).toHaveFocus();
  expect(screen.getByText(/hasta el/)).toHaveTextContent('2026'); expect(screen.getByText(/conexiones activas anteriores/)).toBeVisible();
  expect(fetcher).toHaveBeenCalledOnce(); expect(screen.queryByText(/Perfil confirmado/)).toBeNull();
});
it('reactivates once and performs a fresh GET bootstrap with server DRAFT', async () => {
  await mount(); fetcher.mockResolvedValueOnce(json(active)).mockResolvedValueOnce(json(active)).mockResolvedValueOnce(json({ id: 'p', userId: 'u', status: 'DRAFT' }));
  click('Reactivar cuenta'); click('Reactivar cuenta');
  await screen.findByText('Perfil confirmado: DRAFT');
  expect(fetcher.mock.calls.map(([url, options]) => [url, options?.method])).toEqual([['/api/me','GET'],['/api/me/reactivation','POST'],['/api/me','GET'],['/api/me/profile','GET']]);
});
it('keep deletion only signs out', async () => {
  await mount(); click('Mantener eliminación'); await screen.findByRole('button', { name: 'Ingresar' });
  expect(auth.signOut).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce();
});
it('confirms finalization accessibly, focuses cancellation and signs out only after authoritative success', async () => {
  await mount(); fetcher.mockResolvedValueOnce(json({ ...deleted, deletionFinalizesAt: null }));
  click('Eliminar definitivamente ahora'); const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus(); expect(dialog).toHaveAccessibleDescription(/no se puede deshacer/);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Eliminar definitivamente' }));
  await screen.findByRole('button', { name: 'Ingresar' }); expect(auth.signOut).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[1]?.[0]).toBe('/api/me/deletion/finalization');
});
it.each(['cancel','back','escape'])('dismisses %s without writing and restores trigger focus', async mode => {
  await mount(); const trigger = screen.getByRole('button', { name: 'Eliminar definitivamente ahora' }); trigger.focus(); fireEvent.click(trigger);
  if (mode === 'cancel') click('Cancelar'); else if (mode === 'back') fireEvent.popState(window); else fireEvent(screen.getByRole('dialog'), new Event('cancel', { cancelable: true }));
  expect(screen.queryByRole('dialog')).toBeNull(); expect(trigger).toHaveFocus(); expect(fetcher).toHaveBeenCalledOnce();
});
it('does not infer terminal expiry from the browser clock; server conflict is terminal', async () => {
  await mount({ ...deleted, deletedAt: '2020-01-01T00:00:00Z', deletionFinalizesAt: '2020-02-01T00:00:00Z' });
  fetcher.mockResolvedValueOnce(json({ code: 'ACCOUNT_DELETION_FINALIZED' },409)); click('Reactivar cuenta');
  expect(await screen.findByRole('alert')).toHaveTextContent('La cuenta ya no puede recuperarse');
  expect(screen.getByRole('button', { name: 'Reactivar cuenta' })).toBeDisabled(); expect(auth.signOut).not.toHaveBeenCalled();
});
it.each([{}, { deletionFinalizesAt: null }, { deletionFinalizesAt: 'bad' }, { deletionFinalizesAt: '2026-02-31T00:00:00Z' }, { deletedAt: null }, { deletedAt: '2027-01-01T00:00:00Z' }])('handles invalid recovery metadata %j safely', async fields => {
  await mount(Object.keys(fields).length ? { ...deleted, ...fields } : { id:'u',status:'DELETED' });
  expect(screen.getByRole('button', { name: 'Reactivar cuenta' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Consultar estado de la cuenta' })).toBeEnabled();
  expect(screen.getByText(/No pudimos obtener/)).toBeVisible(); expect(fetcher).toHaveBeenCalledOnce();
});
it.each(['reactivate','finalize'])('reconciles uncertain %s using GET only, including failed reads', async operation => {
  await mount(); fetcher.mockRejectedValueOnce(new TypeError('offline'));
  if (operation === 'reactivate') click('Reactivar cuenta'); else { click('Eliminar definitivamente ahora'); click('Eliminar definitivamente'); }
  await screen.findByRole('alert'); expect(screen.getByRole('button', { name: 'Reactivar cuenta' })).toBeDisabled();
  fetcher.mockRejectedValueOnce(new TypeError('offline')); click('Consultar estado de la cuenta');
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('No pudimos conectar'));
  expect(screen.getByRole('button', { name: 'Reactivar cuenta' })).toBeDisabled();
  fetcher.mockResolvedValueOnce(json(active)).mockResolvedValueOnce(json(active)).mockResolvedValueOnce(json({ id:'p',userId:'u',status:'DRAFT' }));
  click('Consultar estado de la cuenta'); await screen.findByText('Perfil confirmado: DRAFT');
  expect(fetcher.mock.calls.filter(([,options]) => options?.method === 'POST')).toHaveLength(1);
});
it.each([['signout','reactivate'],['replace','reactivate'],['signout','finalize'],['replace','finalize']])('rejects a late write after %s during %s and aborts its signal', async (mode, operation) => {
  await mount(); let done!: (value: Response) => void;
  fetcher.mockImplementationOnce(() => new Promise(resolve => { done = resolve; }));
  if (operation === 'reactivate') click('Reactivar cuenta'); else { click('Eliminar definitivamente ahora'); click('Eliminar definitivamente'); }
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2)); const signal = fetcher.mock.calls[1]?.[1]?.signal;
  if (mode === 'signout') act(() => observer(null)); else { fetcher.mockResolvedValueOnce(json({ code:'RATE_LIMIT_EXCEEDED' },429)); act(() => observer({ ...user,uid:'other' })); }
  expect(signal?.aborted).toBe(true); await act(async () => done(json(active)));
  expect(screen.queryByText(/Perfil confirmado/)).toBeNull(); expect(fetcher.mock.calls.filter(([,o]) => o?.method === 'POST')).toHaveLength(1);
});
it('restricts arbitrary requests and rejects pending results after tab lease revocation', async () => {
  const ownership = new TabOwnershipManager(); vi.spyOn(ownership,'getSnapshot').mockReturnValue('active'); vi.spyOn(ownership,'assert').mockImplementation(() => {});
  const controller = new SessionController(auth, new ApiClient(fetcher).withOwnership(ownership), false, ownership);
  const unsubscribe = controller.subscribe(() => {}); fetcher.mockResolvedValueOnce(json(deleted)); observer(user);
  await waitFor(() => expect(controller.snapshot.phase).toBe('deletionRecovery'));
  await expect(controller.request('/me/profile', new AbortController().signal)).rejects.toMatchObject({ name:'AbortError' });
  let done!: (value: Response) => void; fetcher.mockImplementationOnce(() => new Promise(resolve => { done = resolve; }));
  const pending = controller.recoverDeletion('reactivate'); void controller.recoverDeletion('finalize');
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2)); ownership.stop(); done(json(active)); await pending;
  expect(controller.snapshot.account).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(2); unsubscribe();
});
it.each([401,429,503])('does not retry a recovery mutation after HTTP %s or misclassify it as finalized', async status => {
  await mount(); fetcher.mockResolvedValueOnce(json({ code:status===401?'INVALID_TOKEN':status===429?'RATE_LIMIT_EXCEEDED':'UNAVAILABLE' },status)); click('Reactivar cuenta');
  await screen.findByRole('alert'); expect(fetcher).toHaveBeenCalledTimes(2); expect(auth.signOut).not.toHaveBeenCalled(); expect(screen.queryByText(/ya no puede recuperarse/)).toBeNull();
});
it('rejects malformed finalization success without signing out', async () => {
  await mount(); fetcher.mockResolvedValueOnce(json({ id:'u',status:'DELETED' })); click('Eliminar definitivamente ahora'); click('Eliminar definitivamente');
  await screen.findByRole('alert'); expect(auth.signOut).not.toHaveBeenCalled(); expect(screen.getByRole('button',{name:'Reactivar cuenta'})).toBeDisabled();
});

it('retains confirmed deleted metadata after failed refresh, then unlocks only after a valid read', async () => {
  await mount(); fetcher.mockRejectedValueOnce(new TypeError()); click('Reactivar cuenta'); await screen.findByRole('alert');
  const refreshed={...deleted,deletionFinalizesAt:'2026-12-02T00:00:00Z'};
  fetcher.mockResolvedValueOnce(json(refreshed)); click('Consultar estado de la cuenta');
  await waitFor(() => expect(screen.getByRole('button',{name:'Reactivar cuenta'})).toBeEnabled());
  expect(screen.getByText(/hasta el/)).toHaveTextContent(new Date(refreshed.deletionFinalizesAt).toLocaleString('es-AR')); expect(fetcher).toHaveBeenCalledTimes(3);
});
it('refreshes on resume and removes its listener after leaving recovery', async () => {
  await mount(); fetcher.mockResolvedValueOnce(json(deleted)); fireEvent(document,new Event('visibilitychange'));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  click('Mantener eliminación'); await screen.findByRole('button',{name:'Ingresar'}); fireEvent(document,new Event('visibilitychange'));
  expect(fetcher).toHaveBeenCalledTimes(2);
});
