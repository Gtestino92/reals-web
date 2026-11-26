import { useMemo, useState } from 'react';
import { getCountries, parsePhoneNumberFromString } from 'libphonenumber-js/max';
import type { ContactRow } from './providers';

const countries = getCountries();
const names = new Intl.DisplayNames(['es'], { type: 'region' });
export function Selection({ rows, native, disabled, confirm, cancel }: { disabled: boolean; rows: ContactRow[]; native: boolean;
  confirm: (numbers: string[], region?: string) => void; cancel: () => void }) {
  const [region, setRegion] = useState('');
  const [chosen, setChosen] = useState(() => new Set(native ? rows.map((_, i) => i) : []));
  const country = countries.find(code => code === region);
  const eligible = useMemo(() => rows.map(({ number }) => {
    if (number.length > 64 || !/^\+?[0-9(][0-9 ().-]*$/.test(number)) return undefined;
    const parsed = parsePhoneNumberFromString(number, { ...(country ? { defaultCountry: country } : {}), extract: false });
    return parsed?.isValid() ? parsed.number : undefined;
  }), [country, rows]);
  const indices = rows.map((_, i) => i).filter(i => eligible[i] && chosen.has(i));
  const tooMany = new Set(indices.map(i => eligible[i])).size > 2000;
  return <section className="home-card"><h3>Revisá la selección</h3>
    <p>Cada teléfono cuenta por separado. Al confirmar vas a reemplazar toda la selección anterior, incluso si elegís cero números.</p>
    {rows.some(row => !row.number.startsWith('+')) && <label>País de los números sin prefijo internacional
      <select value={region} onChange={e => setRegion(e.target.value)}><option value="">Elegí un país</option>{countries.map(code =>
        <option key={code} value={code}>{names.of(code)} ({code})</option>)}</select>
      Para agendas mixtas, excluí los números nacionales de otros países.</label>}
    <button onClick={() => setChosen(new Set(rows.map((_, i) => i).filter(i => eligible[i])))}>Seleccionar todos los válidos</button>
    <div className="contact-rows">{rows.map((row, i) => <label key={i}><input type="checkbox" disabled={!eligible[i]} checked={!!eligible[i] && chosen.has(i)}
      onChange={e => { const next = new Set(chosen); if (e.target.checked) next.add(i); else next.delete(i); setChosen(next); }}/>
      <span>{row.name || 'Sin nombre'} · {row.number}{!eligible[i] && ' · Revisá el formato o el país'}</span></label>)}</div>
    <p role="status">{indices.length} números seleccionados{tooMany && ' · Reducí la selección a 2000 números distintos.'}</p>
    <button disabled={disabled || tooMany} onClick={() => confirm(indices.map(i => rows[i]!.number), indices.some(i => !rows[i]!.number.startsWith('+')) ? region : undefined)}>Confirmar reemplazo</button>
    <button onClick={cancel}>Cancelar selección</button>
  </section>;
}
