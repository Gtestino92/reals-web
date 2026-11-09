import { confirmSignOut } from '../test/signOut';
import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AccountSection } from './AccountSection';
import { controllerFixture } from '../chat/fixtures';
import { ApiError } from '../auth/api';

let controller: ReturnType<typeof controllerFixture>;
const preferences = { activityEnabled: true, remindersEnabled: false, availabilityEnabled: true };
beforeEach(() => { controller = controllerFixture(); vi.spyOn(controller, 'signOut').mockImplementation(() => {}); vi.spyOn(controller, 'request').mockResolvedValue(preferences); });
function Harness() { const [notifications, setNotifications] = useState(false); return <AccountSection controller={controller} disabled={false} notificationsOpen={notifications} onNotificationsOpen={() => setNotifications(true)} onBack={() => setNotifications(false)}/>; }
function mount() { return render(<Harness/>); }
it('validates password confirmation and excludes duplicate password submits', async () => {
  vi.spyOn(controller, 'hasPasswordProvider', 'get').mockReturnValue(true);
  let resolve!: () => void;
  vi.spyOn(controller, 'changePassword').mockImplementation(() => new Promise(done => { resolve = done; }));
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña de Reals' }));
  const form = screen.getByRole('form', { name: 'Cambiar contraseña de Reals' });
  fireEvent.submit(form); expect(controller.changePassword).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Contraseña actual'), { target: { value: 'current-secret' } });
  fireEvent.change(screen.getByLabelText('Nueva contraseña'), { target: { value: 'next-secret' } });
  fireEvent.change(screen.getByLabelText('Repetir nueva contraseña'), { target: { value: 'next-secret' } });
  fireEvent.submit(form); fireEvent.submit(form);
  expect(controller.changePassword).toHaveBeenCalledExactlyOnceWith('current-secret', 'next-secret');
  await act(async () => resolve()); expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.getByRole('status')).toHaveTextContent('Contraseña actualizada.');
});
it('dismisses an idle password dialog on browser Back without sending a mutation', () => {
  vi.spyOn(controller, 'hasPasswordProvider', 'get').mockReturnValue(true);
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña de Reals' }));
  expect(screen.getByRole('dialog')).toBeVisible();
  act(() => window.dispatchEvent(new PopStateEvent('popstate')));
  expect(screen.queryByRole('dialog')).toBeNull(); expect(controller.request).not.toHaveBeenCalled();
});
it('shows standalone account actions and confirms sign-out', () => {
  mount(); expect(screen.getByRole('button', { name: 'Volver a Inicio' }).parentElement?.tagName).toBe('HEADER');
  expect(screen.queryByRole('button', { name: 'Cuenta' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Cambiar contraseña de Reals' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' })); expect(controller.signOut).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' })); confirmSignOut(); expect(controller.signOut).toHaveBeenCalledOnce();
});
it.each([['activityEnabled', 'Actividad'], ['remindersEnabled', 'Recordatorios'], ['availabilityEnabled', 'Disponibilidad']] as const)('loads and saves %s once, installing every server-confirmed field', async (key, label) => {
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
  const toggle = await screen.findByRole('switch', { name: label });
  expect(screen.getAllByRole('switch')).toHaveLength(3); expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.getByRole('switch', { name: 'Actividad' })).toBeChecked();
  expect(screen.getByRole('switch', { name: 'Recordatorios' })).not.toBeChecked();
  expect(screen.getByRole('switch', { name: 'Disponibilidad' })).toBeChecked();
  let resolve!: (value: unknown) => void;
  vi.mocked(controller.request).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  fireEvent.click(toggle); fireEvent.click(toggle);
  expect(controller.request).toHaveBeenCalledTimes(2); screen.getAllByRole('switch').forEach(input => expect(input).toBeDisabled());
  expect(screen.getByRole('region', { name: 'Notificaciones' })).toHaveAttribute('data-saving', 'true');
  expect(toggle).toHaveProperty('checked', preferences[key]); expect(screen.getByRole('status')).toHaveTextContent('Guardando preferencias…');
  expect(controller.request).toHaveBeenLastCalledWith('/me/notification-preferences', expect.any(AbortSignal), 'PUT', { ...preferences, [key]: !preferences[key] });
  await act(async () => resolve({ activityEnabled: true, remindersEnabled: true, availabilityEnabled: false }));
  expect(screen.getByRole('switch', { name: 'Actividad' })).toBeChecked(); expect(screen.getByRole('switch', { name: 'Recordatorios' })).toBeChecked(); expect(screen.getByRole('switch', { name: 'Disponibilidad' })).not.toBeChecked(); expect(toggle).toBeEnabled();
  expect(screen.getByRole('status')).toBeEmptyDOMElement();
  expect(screen.getByRole('region', { name: 'Notificaciones' })).toHaveAttribute('data-saving', 'false');
  expect(screen.queryByText('Preferencias guardadas.')).toBeNull();
});
it('associates one switch with each complete label and description, including row clicks', async () => {
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' })); await screen.findByRole('switch', { name: 'Actividad' });
  expect(screen.getByRole('switch', { name: 'Actividad' })).toHaveAccessibleDescription('Nuevos chats y cambios importantes en tus interacciones.');
  expect(screen.getByRole('switch', { name: 'Recordatorios' })).toHaveAccessibleDescription('Avisos sobre revisiones pendientes y próximas segundas charlas.');
  expect(screen.getByRole('switch', { name: 'Disponibilidad' })).toHaveAccessibleDescription('Avisame cuando pueda volver a buscar a alguien nuevo.');
  expect(screen.getByText(/Estos ajustes se aplican actualmente/)).toHaveTextContent('notificaciones push de Android');
  expect(screen.getByText(/Estos ajustes se aplican actualmente/)).toHaveTextContent('Las notificaciones del navegador se configurarán por separado');
  fireEvent.click(screen.getByText('Nuevos chats y cambios importantes en tus interacciones.'));
  await waitFor(() => expect(controller.request).toHaveBeenCalledTimes(2));
  expect(controller.request).toHaveBeenLastCalledWith('/me/notification-preferences', expect.any(AbortSignal), 'PUT', { ...preferences, activityEnabled: false });
});
it('describes initial loading and read failure, then retries without a write and restores entry focus', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(controller.request).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
  expect(screen.getByRole('status')).toHaveTextContent('Cargando notificaciones…'); expect(screen.queryByRole('switch')).toBeNull();
  expect(screen.getByRole('button', { name: 'Volver a Cuenta' })).toBeDisabled();
  await act(async () => resolve({ activityEnabled: null }));
  expect(screen.getByRole('alert')).toHaveTextContent('No pudimos cargar las preferencias.');
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar notificaciones' })); await screen.findByRole('switch', { name: 'Actividad' });
  expect(vi.mocked(controller.request).mock.calls.every(call => call[2] === undefined)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Volver a Cuenta' })); expect(screen.getByRole('button', { name: 'Notificaciones' })).toHaveFocus();
});
it('blocks uncertain notification writes until an explicit authoritative read', async () => {
  mount(); fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
  const activity = await screen.findByRole('switch', { name: 'Actividad' });
  vi.mocked(controller.request).mockRejectedValueOnce(new ApiError('network'));
  fireEvent.click(activity); await screen.findByRole('alert'); expect(activity).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('No pudimos confirmar el cambio.');
  screen.getAllByRole('switch').forEach(input => expect(input).toBeDisabled());
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar notificaciones' })); await waitFor(() => expect(activity).toBeEnabled());
  expect(controller.request).toHaveBeenCalledTimes(3);
});
it('deletes recoverably once and signs out only after success', async () => {
  mount();
  let resolve!: (value: unknown) => void;
  vi.mocked(controller.request).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const button = screen.getByRole('button', { name: 'Eliminar cuenta' }); fireEvent.click(button); fireEvent.click(screen.getByRole('button', { name: 'Programar eliminación' })); fireEvent.click(button);
  expect(controller.request).toHaveBeenCalledExactlyOnceWith('/me', expect.any(AbortSignal), 'DELETE'); expect(controller.signOut).not.toHaveBeenCalled();
  await act(async () => resolve(undefined)); expect(controller.signOut).toHaveBeenCalledOnce();
});
it('never repeats an uncertain deletion or bypasses its lock through Notifications', async () => {
  mount(); vi.mocked(controller.request).mockRejectedValueOnce(new ApiError('network'));
  const button = screen.getByRole('button', { name: 'Eliminar cuenta' }); fireEvent.click(button); fireEvent.click(screen.getByRole('button', { name: 'Programar eliminación' })); await screen.findByRole('alert'); fireEvent.click(button);
  expect(button).toBeDisabled(); expect(controller.request).toHaveBeenCalledOnce(); expect(controller.signOut).not.toHaveBeenCalled();
  // Notifications cannot bypass a pending-deletion recovery lock.
  fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' })); expect(controller.request).toHaveBeenCalledOnce();
});
it('rejects late read installation after unmount', async () => {
  let resolve!: (value: unknown) => void;
  vi.mocked(controller.request).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const view = mount(); fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
  const signal = vi.mocked(controller.request).mock.calls[0]![1]; view.unmount(); expect(signal.aborted).toBe(true);
  await act(async () => resolve(preferences)); expect(screen.queryByRole('switch')).toBeNull();
});
