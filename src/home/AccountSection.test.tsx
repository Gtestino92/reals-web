import { confirmSignOut } from '../test/signOut';
import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AccountSection } from './AccountSection';
import { controllerFixture } from '../chat/fixtures';
import { ApiError } from '../auth/api';
import { ActivityNotifications, useActivityNotifications } from '../notifications/useActivityNotifications';

let controller: ReturnType<typeof controllerFixture>;
beforeEach(() => { controller = controllerFixture(); vi.spyOn(controller, 'signOut').mockImplementation(() => {}); vi.spyOn(controller, 'request').mockResolvedValue(undefined); });
afterEach(() => localStorage.clear());
function Harness({ disabled = false }: { disabled?: boolean }) {
  const [notifications, setNotifications] = useState(false);
  const web = useActivityNotifications(controller, 'me', false);
  return <ActivityNotifications.Provider value={web}><AccountSection controller={controller} disabled={disabled}
    notificationsOpen={notifications} onNotificationsOpen={() => setNotifications(true)} onBack={() => setNotifications(false)}/></ActivityNotifications.Provider>;
}
function mount() { return render(<Harness/>); }
const open = () => fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' }));
const labels = [
  'Primer chat disponible', 'Revisión visual disponible', 'Coordinación disponible',
  'Horario del segundo chat confirmado', 'Entrada al segundo chat disponible',
];
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
it.each(labels)('toggles only %s from the Web settings', label => {
  mount(); open();
  const toggles = screen.getAllByRole('switch');
  expect(toggles).toHaveLength(5);
  expect(screen.queryByRole('group', { name: 'Plataforma' })).toBeNull();
  expect(screen.queryByRole('button', { name: /^(Android|Web)$/ })).toBeNull();
  expect(screen.queryByRole('switch', { name: /^(Actividad|Recordatorios|Disponibilidad)$/ })).toBeNull();
  expect(screen.getByRole('heading', { name: 'Notificaciones' })).toHaveFocus();
  const selected = screen.getByRole('switch', { name: label });
  expect(selected).toHaveAccessibleDescription();
  fireEvent.click(selected);
  for (const toggle of toggles) expect(toggle).toHaveProperty('checked', toggle !== selected);
  fireEvent.click(selected);
  expect(selected).toBeChecked();
  expect(controller.request).not.toHaveBeenCalled();
});

it('keeps local switches read-only under the account guard and restores entry focus on Back', () => {
  const view = mount(); open();
  view.rerender(<Harness disabled/>);
  for (const toggle of screen.getAllByRole('switch')) expect(toggle).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Volver a Cuenta' }));
  expect(screen.getByRole('button', { name: 'Notificaciones' })).toBeDisabled();
  view.rerender(<Harness/>); open();
  fireEvent.click(screen.getByText('Cuando ya podés empezar un primer chat.'));
  expect(screen.getByRole('switch', { name: 'Primer chat disponible' })).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: 'Volver a Cuenta' }));
  expect(screen.getByRole('button', { name: 'Notificaciones' })).toHaveFocus();
  expect(controller.request).not.toHaveBeenCalled();
});

it('retains the local choice and explains when the browser cannot save it', () => {
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota', 'QuotaExceededError'); });
  try {
    mount(); open();
    const toggle = screen.getByRole('switch', { name: 'Primer chat disponible' });
    fireEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(screen.getByRole('status')).toHaveTextContent('Se mantienen durante esta sesión.');
    fireEvent.click(screen.getByRole('button', { name: 'Volver a Cuenta' })); open();
    expect(screen.getByRole('switch', { name: 'Primer chat disponible' })).not.toBeChecked();
    expect(controller.request).not.toHaveBeenCalled();
  } finally { write.mockRestore(); }
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
it('shows the development Cafecito link with the voluntary copy and external-link protections', () => {
  mount();
  expect(screen.getByRole('region', { name: 'Apoyar Reals' })).toHaveTextContent('aporte voluntario. No te da beneficios dentro de la app.');
  const link = screen.getByRole('link', { name: 'Apoyar en Cafecito' });
  expect(link).toHaveAttribute('href', 'https://cafecito.app/reals-app');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
});
