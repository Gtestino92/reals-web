import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { App } from './App';

it('renders the POC entry point with a landmark and Spanish copy', () => {
  render(<App />);

  expect(screen.getByRole('main')).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1, name: 'Reals' })).toBeVisible();
  expect(screen.getByText('Prueba de concepto web en preparación.')).toBeVisible();
});
