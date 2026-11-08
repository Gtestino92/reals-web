import { fireEvent, screen, within } from '@testing-library/react';
export function confirmSignOut() {
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
  fireEvent.click(within(screen.getByRole('dialog', { name: 'Cerrar sesión' })).getByRole('button', { name: 'Cerrar sesión' }));
}
