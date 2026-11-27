import { useMemo, useState } from 'react';
import { getCountries, parsePhoneNumberFromString } from 'libphonenumber-js/max';
import type { CountryCode } from 'libphonenumber-js';
import type { ContactRow } from './providers';

const countries = getCountries();
const names = new Intl.DisplayNames(['es'], { type: 'region' });
interface Group { number: string; name: string; indices: number[] }

function review(rows: ContactRow[], country: CountryCode | undefined) {
  const groups = new Map<string, Group>();
  const invalid: ContactRow[] = [];
  rows.forEach((row, index) => {
    const international = row.number.startsWith('+');
    const parsed = (international || country) && row.number.length <= 64 && /^\+?[0-9(][0-9 ().-]*$/.test(row.number)
      ? parsePhoneNumberFromString(row.number, { ...(!international && country ? { defaultCountry: country } : {}), extract: false }) : undefined;
    if (!parsed?.isValid()) { invalid.push(row); return; }
    const group = groups.get(parsed.number) ?? { number: parsed.number, name: '', indices: [] };
    if (!group.name && row.name.trim()) group.name = row.name.trim();
    group.indices.push(index);
    groups.set(parsed.number, group);
  });
  return { groups: [...groups.values()], invalid };
}

export function Selection({ rows, countryCode, updating, disabled, confirm, cancel }: {
  disabled: boolean; rows: ContactRow[]; countryCode: string | null | undefined; updating: boolean;
  confirm: (numbers: string[]) => void; cancel: () => void;
}) {
  const [region, setRegion] = useState(() => countries.find(code => code === countryCode) ?? '');
  const [adjusting, setAdjusting] = useState(!region);
  const [excluded, setExcluded] = useState({ rows: new Set<number>(), numbers: new Set<string>() });
  const country = countries.find(code => code === region);
  const { groups, invalid } = useMemo(() => review(rows, country), [rows, country]);
  const selected = groups.filter(g => !excluded.numbers.has(g.number) && !g.indices.some(i => excluded.rows.has(i)));
  const numbers = new Set(selected.map(g => g.number));
  function toggle(items: Group[], checked: boolean) {
    const next = { rows: new Set(excluded.rows), numbers: new Set(excluded.numbers) };
    for (const group of items) {
      if (checked) next.numbers.delete(group.number); else next.numbers.add(group.number);
      for (const i of group.indices) { if (checked) next.rows.delete(i); else next.rows.add(i); }
    }
    setExcluded(next);
  }
  return <section className="home-card"><h3>Revisá tus contactos</h3>
    <p>Cada teléfono cuenta una vez, aunque esté guardado con varios nombres.</p>
    {rows.some(row => !row.number.startsWith('+')) && <div>
      <button className="contact-region" aria-expanded={adjusting} onClick={() => setAdjusting(!adjusting)}>{country ? 'País de los números locales: ' + names.of(country) : 'Elegir país para números locales'}</button>
      {adjusting && <label>País de los números sin prefijo internacional
        <select value={region} onChange={e => setRegion(e.target.value)}><option value="">Elegí un país</option>{countries.map(code =>
          <option key={code} value={code}>{names.of(code)} ({code})</option>)}</select>
        Si tenés números locales de varios países, desmarcá los que no correspondan al país elegido.</label>}
    </div>}
    <div className="contact-bulk"><button onClick={() => toggle(groups, true)}>Seleccionar todos</button>
      <button onClick={() => setExcluded({ rows: new Set(rows.map((_, i) => i)), numbers: new Set([...excluded.numbers, ...groups.map(g => g.number)]) })}>Deseleccionar todos</button></div>
    <div className="contact-rows">{groups.map(group => <label key={group.number}><input type="checkbox" checked={numbers.has(group.number)}
      onChange={e => toggle([group], e.target.checked)}/><span>{group.name || 'Sin nombre'} · {group.number}</span></label>)}</div>
    {!!invalid.length && <details><summary>Teléfonos sin incluir ({invalid.length})</summary><p>Revisá el país o el formato en tu agenda.</p>
      {invalid.map((row, i) => <p key={i}>{row.name || 'Sin nombre'} · {row.number}</p>)}</details>}
    <p role="status">{numbers.size} {numbers.size === 1 ? 'teléfono seleccionado' : 'teléfonos seleccionados'}{numbers.size > 2000 && ' · Elegí hasta 2000 teléfonos.'}</p>
    <button className="contact-primary" disabled={disabled || !numbers.size || numbers.size > 2000} onClick={() => confirm([...numbers])}>{updating ? 'Actualizar contactos' : 'Importar contactos'}</button>
    <button onClick={cancel}>Cancelar selección</button>
  </section>;
}
