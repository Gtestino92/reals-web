import { StrictMode } from 'react';
import type { ComponentProps } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ProfileForm } from './ProfileForm';
import { defaults } from './contracts';
import type { FullProfile } from './contracts';

const catalog = [{ code:'ES',displayName:'España' },{ code:'AR',displayName:'Argentina' },{ code:'DE',displayName:'Alemania' }];
const existing: FullProfile = { ...defaults, id:'p',userId:'u',status:'DRAFT',authenticityVerificationStatus:'STALE',displayName:'Ana',city:'Madrid',birthDate:'1990-05-18',countryCode:'ES' };
type Props = ComponentProps<typeof ProfileForm>;
function mount(patch: Partial<Props> = {}) {
  const submit = vi.fn(), retryCountries = vi.fn();
  let props: Props = { catalog, countryError:'',retryCountries,busy:false,submit,...patch };
  const tree = () => <StrictMode><ProfileForm {...props}/></StrictMode>;
  const view = render(tree());
  return { submit,retryCountries,update: (next: Partial<Props>) => { props = { ...props,...next }; view.rerender(tree()); } };
}
function selectBirthDate(year: string, month: string, day: string) {
  for (const [name, value] of [['Año', year], ['Mes', month], ['Día', day]] as const)
    fireEvent.change(screen.getByRole('combobox', { name }), { target: { value } });
}
function fillRequired() {
  fireEvent.change(screen.getByLabelText('Género'),{ target:{ value:'MALE' } });
  fireEvent.change(screen.getByLabelText('Intención'),{ target:{ value:'DATE' } });
  fireEvent.click(screen.getByRole('checkbox',{ name:'Mujeres' }));
  fireEvent.change(screen.getByLabelText('Nombre visible'),{ target:{ value:'Ana' } });
  fireEvent.change(screen.getByLabelText('Ciudad'),{ target:{ value:'Córdoba' } });
  selectBirthDate('1995', '01', '01');
}
const submitForm = () => fireEvent.submit(screen.getByRole('form'));

it('puts creation validation and submit after the distance preference', () => {
  const { submit } = mount();
  const form = screen.getByRole('form', { name: 'Crear perfil' });
  const create = within(form).getByRole('button', { name: 'Crear perfil' });
  const distance = within(form).getByRole('slider', { name: /Distancia máxima/ });
  expect(distance.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(form.lastElementChild).toBe(create);

  fireEvent.click(create);
  const summary = within(form).getByRole('alert');
  expect(summary.nextElementSibling).toBe(create);
  expect(distance.compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const name = within(form).getByLabelText('Nombre visible');
  expect(summary).toHaveFocus();
  expect(name).toHaveAttribute('aria-invalid', 'true');
  expect(summary.querySelector('#' + CSS.escape(name.getAttribute('aria-describedby')!))).not.toBeNull();
  expect(name).toHaveAccessibleDescription(/Nombre visible/);
  expect(submit).not.toHaveBeenCalled();
});

it.each(['create','filters'] as const)('focuses only missing intention in %s while interested genders stay valid', mode => {
  const { submit } = mount(mode === 'create' ? {} : { profile:existing, mode });
  if (mode === 'create') fillRequired();
  const intention = screen.getByLabelText('Intención');
  const checkboxes = screen.getAllByRole('checkbox');
  fireEvent.change(intention,{ target:{ value:'' } });
  submitForm();
  expect(submit).not.toHaveBeenCalled();
  expect(mode === 'create' ? screen.getByRole('alert') : intention).toHaveFocus();
  expect(intention).toHaveAttribute('aria-invalid','true');
  expect(intention).toHaveAccessibleDescription('Elegí una intención válida.');
  for (const checkbox of checkboxes) {
    expect(checkbox).not.toHaveAttribute('aria-invalid');
    expect(checkbox).not.toHaveAttribute('aria-describedby');
  }
  fireEvent.change(intention,{ target:{ value:'DATE' } });
  submitForm();
  if (mode === 'create') expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ intention:'DATE', lookingForGenders:['FEMALE'] }),mode);
  else expect(submit).not.toHaveBeenCalled();
});

it.each(['create','filters'] as const)('focuses only missing interested genders in %s while intention stays valid', mode => {
  const { submit } = mount(mode === 'create' ? {} : { profile:existing, mode });
  if (mode === 'create') fillRequired();
  const intention = screen.getByLabelText('Intención');
  fireEvent.click(screen.getByRole('checkbox',{ name:'Mujeres' }));
  submitForm();
  expect(submit).not.toHaveBeenCalled();
  expect(mode === 'create' ? screen.getByRole('alert') : screen.getByRole('checkbox',{ name:'Hombres' })).toHaveFocus();
  for (const checkbox of screen.getAllByRole('checkbox')) {
    expect(checkbox).toHaveAttribute('aria-invalid','true');
    expect(checkbox).toHaveAccessibleDescription('Elegí al menos un género válido que te interese.');
  }
  expect(intention).not.toHaveAttribute('aria-invalid');
  expect(intention).not.toHaveAttribute('aria-describedby');
  fireEvent.click(screen.getByRole('checkbox',{ name:'Mujeres' }));
  submitForm();
  if (mode === 'create') expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ intention:'DATE', lookingForGenders:['FEMALE'] }),mode);
  else expect(submit).not.toHaveBeenCalled();
});

it('defaults new profiles to catalog-provided Argentina, leaves birth date empty and sorts localized country names', () => {
  const { submit } = mount();
  expect(screen.getByLabelText('País')).toHaveValue('AR');
  for (const name of ['Día', 'Mes', 'Año']) expect(screen.getByRole('combobox', { name })).toHaveValue('');
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  expect(within(screen.getByLabelText('País')).getAllByRole('option').map(o => o.textContent)).toEqual(['Seleccioná un país','Alemania','Argentina','España']);
  expect(screen.getByRole('group',{ name:'Sobre vos' })).toBeInTheDocument();
  expect(screen.getByRole('group',{ name:'Qué estás buscando' })).toBeInTheDocument();
  fillRequired(); submitForm();
  expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ countryCode:'AR',birthDate:'1995-01-01' }),'create');
});
it('does not consider Argentina selected or valid until the catalog contains AR', () => {
  const { submit,update } = mount({ catalog:[] });
  expect(screen.getByRole('status')).toHaveTextContent('Cargando países…');
  expect(screen.getByLabelText('País')).toHaveValue('');
  expect(screen.queryByRole('option',{ name:'Argentina' })).not.toBeInTheDocument();
  fillRequired(); submitForm();
  expect(screen.getByRole('alert')).toHaveTextContent('Seleccioná un país del catálogo');
  expect(submit).not.toHaveBeenCalled();
  update({ catalog });
  expect(screen.getByLabelText('País')).toHaveValue('AR');
  submitForm(); expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ countryCode:'AR' }),'create');
});
it('requires a manual country selection when AR is unavailable and preserves that choice when AR arrives', () => {
  const { submit,update } = mount({ catalog:[catalog[0]!] });
  expect(screen.getByLabelText('País')).toHaveValue('');
  fillRequired(); submitForm(); expect(submit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('País'),{ target:{ value:'ES' } });
  update({ catalog }); expect(screen.getByLabelText('País')).toHaveValue('ES');
  update({ catalog:[...catalog].reverse() }); expect(screen.getByLabelText('País')).toHaveValue('ES');
  submitForm(); expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ countryCode:'ES' }),'create');
});
it('preserves an explicit empty choice on catalog refresh instead of reselecting AR', () => {
  const { submit,update } = mount();
  fireEvent.change(screen.getByLabelText('País'),{ target:{ value:'' } });
  update({ catalog:[...catalog] }); expect(screen.getByLabelText('País')).toHaveValue('');
  fillRequired(); submitForm(); expect(submit).not.toHaveBeenCalled();
});
it('retains an explicitly selected unavailable country but rejects it until the catalog restores it', () => {
  const { submit,update } = mount(); fillRequired();
  fireEvent.change(screen.getByLabelText('País'),{ target:{ value:'ES' } });
  update({ catalog:[{ code:'AR',displayName:'Argentina' }] });
  expect(screen.getByLabelText('País')).toHaveValue('ES');
  expect(screen.getByRole('status')).toHaveTextContent('El país seleccionado no está disponible');
  submitForm(); expect(submit).not.toHaveBeenCalled();
  update({ catalog }); expect(screen.getByLabelText('País')).toHaveValue('ES');
  submitForm(); expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ countryCode:'ES' }),'create');
});
it('preserves existing profile country and birth date while editing, including through catalog loading', () => {
  const { submit,update } = mount({ profile:existing,mode:'details',catalog:[] });
  expect(screen.getByLabelText('País')).toHaveValue('ES');
  expect(screen.getByLabelText('Nombre visible')).toHaveValue('Ana');
  update({ catalog }); expect(screen.getByLabelText('País')).toHaveValue('ES');
  fireEvent.change(screen.getByLabelText('Ciudad'), { target: { value: 'Sevilla' } });
  submitForm(); expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ countryCode:'ES',birthDate:'1990-05-18',city:'Sevilla' }),'details');
});
it('does not default an existing empty country to Argentina', () => {
  const { submit } = mount({ profile:{ ...existing,countryCode:'' },mode:'details' });
  expect(screen.getByLabelText('País')).toHaveValue('');
  submitForm(); expect(submit).not.toHaveBeenCalled();
});
it('preserves country error, empty catalog and retry states', () => {
  const { update,retryCountries } = mount({ catalog:[],countryError:'No se pudo cargar el catálogo de países.' });
  expect(screen.getByRole('status')).toHaveTextContent('No se pudo cargar');
  fireEvent.click(screen.getByRole('button',{ name:'Reintentar carga de países' })); expect(retryCountries).toHaveBeenCalledOnce();
  update({ countryError:'No hay países disponibles.' });
  expect(screen.getByRole('status')).toHaveTextContent('No hay países disponibles.');
  expect(screen.getByLabelText('País')).toHaveValue('');
  update({ catalog,countryError:'' }); expect(screen.getByLabelText('País')).toHaveValue('AR');
});
it('rejects an empty birth date without inventing a default', () => {
  const { submit } = mount(); fillRequired();
  selectBirthDate('', '', '');
  submitForm(); expect(screen.getByRole('alert')).toHaveTextContent('Seleccioná tu fecha de nacimiento.');
  expect(submit).not.toHaveBeenCalled(); expect(screen.getByRole('group', { name: 'Fecha de nacimiento' })).toHaveAttribute('aria-invalid', 'true');
});
it('keeps grouped gender and age controls accessible and retains slider validation limits', () => {
  const { submit } = mount(); fillRequired();
  expect(within(screen.getByRole('group',{ name:'Me interesa conocer' })).getAllByRole('checkbox')).toHaveLength(4);
  fireEvent.click(screen.getByRole('checkbox',{ name:'Hombres' }));
  const ageGroup = screen.getByRole('group',{ name:'Rango de edad' });
  const min = within(ageGroup).getByRole('slider',{ name:/Edad mínima/ });
  const max = within(ageGroup).getByRole('slider',{ name:/Edad máxima/ });
  expect(min).toHaveAttribute('aria-valuemin','18'); expect(max).toHaveAttribute('aria-valuemax','99');
  const distance = screen.getByRole('slider',{ name:/Distancia máxima/ });
  expect(distance).toHaveAttribute('min','1'); expect(distance).toHaveAttribute('max','100');
  fireEvent.keyDown(min,{ key:'End' }); expect(screen.getByText('Edad: 45–45 años')).toBeInTheDocument();
  fireEvent.keyDown(max,{ key:'PageUp' }); submitForm();
  expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ lookingForGenders:['FEMALE','MALE'],preferredMinAge:45,preferredMaxAge:55,maxDistanceKm:50 }),'create');
});
it.each([[18,45],[18,18],[99,99],[32,33]])('preserves persisted age interval %s–%s when editing match filters', (min,max) => {
  const { submit } = mount({ profile:{ ...existing,preferredMinAge:min,preferredMaxAge:max },mode:'filters' });
  expect(screen.getByText(`Edad: ${min}–${max} años`)).toBeInTheDocument();
  expect(screen.getByRole('spinbutton',{ name:'Desde:' })).toHaveValue(min);
  expect(screen.getByRole('spinbutton',{ name:'Hasta:' })).toHaveValue(max);
  fireEvent.change(screen.getByLabelText('Intención'), { target:{ value:'FRIENDSHIP' } });
  submitForm(); expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ preferredMinAge:min,preferredMaxAge:max }),'filters');
});
it.each(['create','filters'] as const)('submits synchronized numeric ages through the existing %s payload', mode => {
  const { submit } = mount(mode === 'create' ? {} : { profile:existing,mode });
  if (mode === 'create') fillRequired();
  const from = screen.getByRole('spinbutton',{ name:'Desde:' }), to = screen.getByRole('spinbutton',{ name:'Hasta:' });
  fireEvent.change(from,{ target:{ value:'33' } }); fireEvent.blur(from);
  fireEvent.change(to,{ target:{ value:'34' } }); fireEvent.blur(to);
  expect(screen.getByText('Edad: 33–34 años')).toBeInTheDocument(); submitForm();
  expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ preferredMinAge:33,preferredMaxAge:34 }),mode);
});

it('requires explicit sensitive choices and focuses the creation summary without writing', () => {
  const { submit, update } = mount();
  expect(screen.getByLabelText('Género')).toHaveValue('');
  expect(screen.getByLabelText('Intención')).toHaveValue('');
  for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).not.toBeChecked();
  submitForm();
  expect(screen.getByRole('alert')).toHaveFocus();
  expect(screen.getByLabelText('Nombre visible')).toHaveAttribute('aria-invalid','true');
  expect(submit).not.toHaveBeenCalled();
  fillRequired(); update({ busy:true }); submitForm(); expect(submit).not.toHaveBeenCalled();
  update({ busy:false }); submitForm(); expect(submit).toHaveBeenCalledOnce();
});

it('places save after editable details, country before city and uses the optional bio label', () => {
  mount({ profile: existing, mode: 'details' });
  const country = screen.getByLabelText('País'), city = screen.getByLabelText('Ciudad'), bio = screen.getByLabelText('Bio (opcional)');
  const save = screen.getByRole('button', { name: 'Guardar cambios' });
  expect(country.compareDocumentPosition(city) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(bio.compareDocumentPosition(save) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Guardar cambios' })).toHaveLength(1);
});
it('keeps sensitive choices empty after filling other fields and links the first error', () => {
  const { submit } = mount();
  fireEvent.change(screen.getByLabelText('Nombre visible'),{ target:{ value:'Ana' } });
  fireEvent.change(screen.getByLabelText('Ciudad'),{ target:{ value:'Córdoba' } });
  selectBirthDate('1995', '01', '01');
  submitForm();
  expect(submit).not.toHaveBeenCalled(); expect(screen.getByRole('alert')).toHaveFocus();
  expect(screen.getByLabelText('Género')).toHaveAccessibleDescription(/Seleccioná un género/);
});

it('blocks normalized unchanged edits and disables again on confirmation without replacing drafts', () => {
  const { submit, update } = mount({ profile:existing, mode:'details' });
  const save = screen.getByRole('button', { name:'Guardar cambios' });
  expect(save).toBeDisabled(); submitForm(); expect(submit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Nombre visible'), { target:{ value:'  Ana  ' } });
  expect(save).toBeDisabled(); submitForm(); expect(submit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Ciudad'), { target:{ value:'  Sevilla  ' } });
  expect(save).toBeEnabled(); submitForm(); expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ city:'Sevilla',displayName:'Ana' }),'details');
  update({ profile:{ ...existing,city:'Sevilla' } });
  expect(save).toBeDisabled(); expect(screen.getByLabelText('Ciudad')).toHaveValue('  Sevilla  ');
  submitForm(); expect(submit).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText('Ciudad'), { target:{ value:'Otro borrador' } });
  update({ profile:{ ...existing,city:'Sevilla',bio:'Servidor' } });
  expect(screen.getByLabelText('Ciudad')).toHaveValue('Otro borrador'); expect(save).toBeEnabled();
  expect(screen.getByLabelText('Bio (opcional)')).toHaveValue('Servidor');
});
it('ignores preference ordering and enables only actual filter changes', () => {
  mount({ profile:{ ...existing,lookingForGenders:['FEMALE','MALE'] },mode:'filters' });
  const save = screen.getByRole('button', { name:'Guardar cambios' }); expect(save).toBeDisabled();
  fireEvent.click(screen.getByRole('checkbox', { name:'Mujeres' })); expect(save).toBeEnabled();
  fireEvent.click(screen.getByRole('checkbox', { name:'Mujeres' })); expect(save).toBeDisabled();
});

it('keeps a stable inline confirmation slot and hides old success while editing', () => {
  const { update } = mount({ profile:existing,mode:'details' });
  const status = screen.getByRole('status'); expect(status).toBeEmptyDOMElement();
  update({ saved:true }); expect(screen.getByRole('status')).toBe(status); expect(status).toHaveTextContent('Cambios guardados.');
  fireEvent.change(screen.getByLabelText('Ciudad'), { target:{ value:'Sevilla' } });
  expect(status).toBeEmptyDOMElement(); update({ busy:true }); expect(screen.getByRole('status')).toBe(status);
  update({ profile:{ ...existing,city:'Sevilla' },busy:false });
  expect(status).toHaveTextContent('Cambios guardados.'); expect(screen.getByRole('button', { name:'Guardar cambios' })).toBeDisabled();
});

it('shows saving only for a profile write, not loading or other busy operations', () => {
  const { update } = mount({ profile:existing,mode:'details',busy:true });
  expect(screen.getByRole('button', { name:'Guardar cambios' })).toBeDisabled();
  expect(screen.queryByText('Guardando\u2026')).toBeNull();
  update({ saving:true }); expect(screen.getByRole('button', { name:'Guardando\u2026' })).toBeDisabled();
  update({ saving:false,busy:false }); expect(screen.getByRole('button', { name:'Guardar cambios' })).toBeDisabled();
});

it('offers only calendar days and clears a day invalidated by month or year', () => {
  const { submit } = mount();
  fillRequired();
  const day = screen.getByRole('combobox', { name: 'Día' });
  const month = screen.getByRole('combobox', { name: 'Mes' });
  const year = screen.getByRole('combobox', { name: 'Año' });
  selectBirthDate('2000', '10', '31');
  fireEvent.change(month, { target: { value: '11' } });
  expect(within(day).queryByRole('option', { name: '31' })).toBeNull();
  expect(day).toHaveValue('');
  submitForm();
  expect(screen.getByRole('alert')).toHaveTextContent('Ingresá una fecha de nacimiento válida.');
  expect(submit).not.toHaveBeenCalled();
  selectBirthDate('2000', '02', '29');
  expect(day).toHaveValue('29');
  fireEvent.change(year, { target: { value: '2001' } });
  expect(within(day).queryByRole('option', { name: '29' })).toBeNull();
  expect(day).toHaveValue('');
  fireEvent.change(day, { target: { value: '28' } });
  fireEvent.change(screen.getByLabelText('Ciudad'), { target: { value: 'Rosario' } });
  expect(day).toHaveValue('28');
  expect(day).not.toHaveAttribute('aria-invalid');
  submitForm();
  expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ birthDate: '2001-02-28', city: 'Rosario' }), 'create');
});
