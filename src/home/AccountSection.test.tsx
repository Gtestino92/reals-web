import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AccountSection } from './AccountSection';
import { controllerFixture } from '../chat/fixtures';
import { ApiError } from '../auth/api';

let controller: ReturnType<typeof controllerFixture>;
const preferences = { activityEnabled: true, remindersEnabled: false, availabilityEnabled: true };
beforeEach(() => { controller = controllerFixture(); vi.spyOn(controller, 'signOut').mockImplementation(() => {}); vi.spyOn(controller, 'request').mockResolvedValue(preferences); });
function mount() { return render(<AccountSection controller={controller} disabled={false}/>); }
function expand() { fireEvent.click(screen.getByRole('button', { name: 'Cuenta' })); }
it('validates password confirmation and excludes duplicate password submits', async () => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } });
  vi.spyOn(controller, 'hasPasswordProvider', 'get').mockReturnValue(true);
  let resolve!: () => void;
  vi.spyOn(controller, 'changePassword').mockImplementation(() => new Promise(done => { resolve = done; }));
  mount(); expand(); fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña de Reals' }));
  const form = screen.getByRole('form', { name: 'Cambiar contraseña de Reals' });
  fireEvent.submit(form); expect(controller.changePassword).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Contraseña actual'), { target: { value: 'current-secret' } });
  fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'next-secret' } });
  fireEvent.change(screen.getByLabelText('Repetir nueva contraseña'), { target: { value: 'next-secret' } });
  fireEvent.submit(form); fireEvent.submit(form);
  expect(controller.changePassword).toHaveBeenCalledExactlyOnceWith('current-secret', 'next-secret');
  await act(async () => resolve()); expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.getByRole('status')).toHaveTextContent('Contraseña actualizada.');
});
it('starts collapsed, exposes only supported password capability and confirms sign-out', () => {
  mount(); expect(screen.queryByRole('button', { name: 'Cerrar sesión' })).toBeNull(); expand();
  expect(screen.getByRole('button', { name: 'Cuenta' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.queryByRole('button', { name: 'Cambiar contraseña de Reals' })).toBeNull();
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' })); expect(controller.signOut).not.toHaveBeenCalled();
  confirm.mockReturnValue(true); fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' })); expect(controller.signOut).toHaveBeenCalledOnce();
});
it('loads and saves all notification fields once, installing the server response', async () => {
  mount(); expand(); fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
  const activity = await screen.findByRole('checkbox', { name: 'Actividad' });
  let resolve!: (value: unknown) => void;
  vi.mocked(controller.request).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  fireEvent.click(activity); fireEvent.click(activity);
  expect(controller.request).toHaveBeenCalledTimes(2); expect(activity).toBeDisabled();
  expect(controller.request).toHaveBeenLastCalledWith('/me/notification-preferences', expect.any(AbortSignal), 'PUT', { ...preferences, activityEnabled: false });
  await act(async () => resolve({ ...preferences, activityEnabled: false })); expect(activity).not.toBeChecked(); expect(activity).toBeEnabled();
});
it('blocks uncertain notification writes until an explicit authoritative read', async () => {
  mount(); expand(); fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
  const activity = await screen.findByRole('checkbox', { name: 'Actividad' });
  vi.mocked(controller.request).mockRejectedValueOnce(new ApiError('network'));
  fireEvent.click(activity); await screen.findByRole('alert'); expect(activity).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar notificaciones' })); await waitFor(() => expect(activity).toBeEnabled());
  expect(controller.request).toHaveBeenCalledTimes(3);
});
it('deletes recoverably once and signs out only after success', async () => {
  mount(); expand(); vi.spyOn(window, 'confirm').mockReturnValue(true);
  let resolve!: (value: unknown) => void;
  vi.mocked(controller.request).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const button = screen.getByRole('button', { name: 'Eliminar cuenta' }); fireEvent.click(button); fireEvent.click(button);
  expect(controller.request).toHaveBeenCalledExactlyOnceWith('/me', expect.any(AbortSignal), 'DELETE'); expect(controller.signOut).not.toHaveBeenCalled();
  await act(async () => resolve(undefined)); expect(controller.signOut).toHaveBeenCalledOnce();
});
it('never repeats an uncertain deletion, including after notification recovery', async () => {
  mount(); expand(); vi.spyOn(window, 'confirm').mockReturnValue(true); vi.mocked(controller.request).mockRejectedValueOnce(new ApiError('network'));
  const button = screen.getByRole('button', { name: 'Eliminar cuenta' }); fireEvent.click(button); await screen.findByRole('alert'); fireEvent.click(button);
  expect(button).toBeDisabled(); expect(controller.request).toHaveBeenCalledOnce(); expect(controller.signOut).not.toHaveBeenCalled();
});
it('rejects late read installation after unmount', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(controller.request).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const view = mount(); expand(); fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
  const signal = vi.mocked(controller.request).mock.calls[0]![1]; view.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => resolve(preferences)); expect(screen.queryByRole('checkbox')).toBeNull();
});
