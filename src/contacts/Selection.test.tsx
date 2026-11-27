import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { it, expect, vi } from 'vitest';
import { Selection } from './Selection';

function mount(countryCode: string | undefined, numbers: string[]) {
  const confirm = vi.fn();
  render(<Selection countryCode={countryCode} rows={numbers.map((number, i) => ({ number, name: i === 1 ? 'Alias' : 'Ejemplo' }))}
    mode="REPLACE" initial disabled={false} confirm={confirm} cancel={() => {}}/>);
  return confirm;
}
const button = (name: string | RegExp) => screen.getByRole('button', { name });
async function choose(name: string) {
  fireEvent.click(button(/País de los números locales/));
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: name } });
  fireEvent.click(button(name));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}
it('groups Argentine mobile aliases with domestic 15 and preserves distinct phones with identical names', () => {
  const confirm = mount('AR', ['011 15-2345-6789', '+54 9 11 2345-6789', '011 4321-1234', '+12025550100', 'malformado']);
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.getAllByRole('checkbox')).toHaveLength(4);
  expect(screen.queryByText(/Alias/)).toBeNull();
  expect(screen.getByText('Teléfonos sin incluir (1)')).toBeVisible();
  fireEvent.click(button('Importar contactos'));
  expect(confirm).toHaveBeenCalledWith(['+5491123456789', '+541143211234', '+12025550100']);
});
it.each([undefined, 'XX'])('asks for a reference region when %s is unavailable', async region => {
  mount(region, ['2025550100', '+12025550101']);
  expect(screen.getAllByRole('checkbox')).toHaveLength(2);
  await choose('Estados Unidos');
  expect(screen.getAllByRole('checkbox')).toHaveLength(3);
  expect(screen.getByText('2 teléfonos seleccionados')).toBeVisible();
});
it('keeps excluded rows and canonical groups excluded through splits and merges', async () => {
  mount('US', ['2025550100', '+12025550100', '+492025550100']);
  fireEvent.click(screen.getByRole('checkbox', { name: /12025550100/ }));
  await choose('Alemania');
  expect(screen.getByRole('checkbox', { name: /492025550100/ })).not.toBeChecked();
  expect(button('Importar contactos')).toBeDisabled();
  await choose('Estados Unidos');
  expect(screen.getByRole('checkbox', { name: /12025550100/ })).not.toBeChecked();
  fireEvent.click(screen.getByRole('checkbox', { name: /Seleccionar todos/ }));
  expect(screen.getByText('2 teléfonos seleccionados')).toBeVisible();
});

it('keeps unresolved rows excluded after clearing all, then selects eligible groups from mixed', async () => {
  mount(undefined, ['2025550100', '+12025550101']);
  const master = screen.getByRole('checkbox', { name: /Deseleccionar todos/ });
  expect(master).toBeChecked();
  fireEvent.click(master);
  await choose('Estados Unidos');
  expect(master).not.toBeChecked();
  expect(button('Importar contactos')).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name: /12025550100/ }));
  expect(master).toBePartiallyChecked();
  fireEvent.click(master);
  expect(master).toBeChecked();
});
it('locks the region and bulk controls during submission', () => {
  render(<Selection countryCode="AR" pending disabled rows={[{ name: 'Ejemplo', number: '011 4321-1234' }]}
    mode="REPLACE" initial={false} confirm={vi.fn()} cancel={vi.fn()}/>);
  expect(button(/País de los números locales/)).toBeDisabled();
  expect(screen.getByRole('checkbox', { name: /Deseleccionar todos/ })).toBeDisabled();
});
