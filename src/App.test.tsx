import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { App } from './App';

it('renders login and reports unavailable integrations without claiming success', () => {
  render(<App />);

  expect(screen.getByRole('main')).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1, name: 'Reals' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Ingresar' }));
  expect(screen.getByRole('alert')).toHaveTextContent('La autenticación todavía no está disponible.');
  fireEvent.click(screen.getByRole('button', { name: '¿No tenés cuenta? Crear cuenta' }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
  expect(screen.getByRole('alert')).toHaveTextContent('La autenticación todavía no está disponible.');
  fireEvent.click(screen.getByRole('button', { name: 'Continuar con Google' }));
  expect(screen.getByRole('alert')).toHaveTextContent('El inicio de sesión con Google todavía no está disponible.');
  fireEvent.click(screen.getByRole('button', { name: '¿Ya tenés cuenta? Ingresar' }));
  fireEvent.click(screen.getByRole('button', { name: 'Olvidé mi contraseña' }));
  expect(screen.getByRole('alert')).toHaveTextContent('La recuperación de contraseña todavía no está disponible.');
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
