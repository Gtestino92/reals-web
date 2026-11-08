import { StrictMode } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SignOutButton } from './SignOutButton';
const label = 'Cerrar sesión';
it.each(['cancel', 'escape', 'back'])('dismisses %s, restores trigger focus and never signs out', action => {
  const confirm = vi.fn();
  render(<StrictMode><SignOutButton onConfirm={confirm} /></StrictMode>);
  const trigger = screen.getByRole('button', { name: label }); fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: label });
  expect(dialog).toHaveAccessibleDescription('Vas a cerrar tu sesión en este dispositivo.');
  expect(within(dialog).getByRole('button', { name: 'Cancelar' })).toHaveFocus();
  if (action === 'cancel') fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
  else if (action === 'escape') fireEvent(dialog, new Event('cancel', { cancelable: true }));
  else act(() => window.dispatchEvent(new PopStateEvent('popstate')));
  expect(screen.queryByRole('dialog')).toBeNull(); expect(trigger).toHaveFocus(); expect(confirm).not.toHaveBeenCalled();
});
it('confirms once, blocks duplicate actions and permits recovery after a pending failure', () => {
  const confirm = vi.fn(); const view = render(<SignOutButton onConfirm={confirm} />);
  fireEvent.click(screen.getByRole('button', { name: label }));
  const button = within(screen.getByRole('dialog')).getByRole('button', { name: label }); fireEvent.click(button); fireEvent.click(button);
  expect(confirm).toHaveBeenCalledOnce(); expect(screen.getByRole('button', { name: label })).toBeDisabled();
  view.rerender(<SignOutButton onConfirm={confirm} disabled />); view.rerender(<SignOutButton onConfirm={confirm} />);
  expect(screen.getByRole('button', { name: label })).toBeEnabled();
});
it('blocks confirmation and dismissal when relevant operations are pending; removes resources on unmount', () => {
  const confirm = vi.fn(), notify = vi.fn(); const view = render(<SignOutButton onConfirm={confirm} onOpenChange={notify} />);
  fireEvent.click(screen.getByRole('button', { name: label })); const dialog = screen.getByRole('dialog');
  view.rerender(<SignOutButton onConfirm={confirm} onOpenChange={notify} disabled />);
  fireEvent(dialog, new Event('cancel', { cancelable: true })); act(() => window.dispatchEvent(new PopStateEvent('popstate')));
  expect(screen.getByRole('dialog')).toBeVisible(); expect(within(dialog).getByRole('button', { name: label })).toBeDisabled();
  view.unmount(); expect(dialog).not.toHaveAttribute('open'); expect(notify).toHaveBeenLastCalledWith(false); expect(confirm).not.toHaveBeenCalled();
});
