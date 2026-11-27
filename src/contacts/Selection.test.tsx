import { fireEvent, render, screen } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import { Selection } from './Selection';

function mount(countryCode: string | undefined, numbers: string[]) {
  const confirm = vi.fn();
  render(<Selection countryCode={countryCode} rows={numbers.map((number, i) => ({ number, name: i === 1 ? 'Alias' : 'Ejemplo' }))}
    updating={false} disabled={false} confirm={confirm} cancel={() => {}}/>);
  return confirm;
}
const button = (name: string | RegExp) => screen.getByRole('button', { name });
it('groups Argentine mobile aliases with domestic 15 and preserves distinct phones with identical names', () => {
  const confirm = mount('AR', ['011 15-2345-6789', '+54 9 11 2345-6789', '011 4321-1234', '+12025550100', 'malformado']);
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.getAllByRole('checkbox')).toHaveLength(3);
  expect(screen.queryByText(/Alias/)).toBeNull();
  expect(screen.getByText('Teléfonos sin incluir (1)')).toBeVisible();
  fireEvent.click(button('Importar contactos'));
  expect(confirm).toHaveBeenCalledWith(['+5491123456789', '+541143211234', '+12025550100']);
});
it.each([undefined, 'XX'])('asks for a reference region when %s is unavailable', region => {
  mount(region, ['2025550100', '+12025550101']);
  expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'US' } });
  expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  expect(screen.getByText('2 teléfonos seleccionados')).toBeVisible();
});
it('keeps excluded rows and canonical groups excluded through splits and merges', () => {
  mount('US', ['2025550100', '+12025550100', '+492025550100']);
  fireEvent.click(screen.getByRole('checkbox', { name: /12025550100/ }));
  fireEvent.click(button(/País de los números locales/));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'DE' } });
  expect(screen.getByRole('checkbox', { name: /492025550100/ })).not.toBeChecked();
  expect(button('Importar contactos')).toBeDisabled();
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'US' } });
  expect(screen.getByRole('checkbox', { name: /12025550100/ })).not.toBeChecked();
  fireEvent.click(button('Seleccionar todos'));
  expect(screen.getByText('2 teléfonos seleccionados')).toBeVisible();
});
