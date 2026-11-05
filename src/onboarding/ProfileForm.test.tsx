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
function fillRequired() {
  fireEvent.change(screen.getByLabelText('Nombre visible'),{ target:{ value:'Ana' } });
  fireEvent.change(screen.getByLabelText('Ciudad'),{ target:{ value:'Córdoba' } });
  fireEvent.change(screen.getByLabelText('Fecha de nacimiento'),{ target:{ value:'1995-01-01' } });
}
const submitForm = () => fireEvent.submit(screen.getByRole('form'));

it('defaults new profiles to catalog-provided Argentina, leaves birth date empty and sorts localized country names', () => {
  const { submit } = mount();
  expect(screen.getByLabelText('País')).toHaveValue('AR');
  expect(screen.getByLabelText('Fecha de nacimiento')).toHaveValue('');
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
  submitForm(); expect(submit).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ countryCode:'ES',birthDate:'1990-05-18',city:'Madrid' }),'details');
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
  fireEvent.change(screen.getByLabelText('Fecha de nacimiento'),{ target:{ value:'' } });
  submitForm(); expect(screen.getByRole('alert')).toHaveTextContent('Fecha de nacimiento');
  expect(submit).not.toHaveBeenCalled(); expect(screen.getByLabelText('Fecha de nacimiento')).toBeRequired();
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
