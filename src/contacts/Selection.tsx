import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getCountries, parsePhoneNumberFromString } from 'libphonenumber-js/max';
import type { CountryCode } from 'libphonenumber-js';
import type { ContactRow } from './providers';
import type { ImportMode } from './contracts';

const countries = getCountries();
const names = new Intl.DisplayNames(['es'], { type: 'region' });
const countryList = countries.map(code => ({ code, name: names.of(code) ?? code }))
  .sort((a, b) => a.name.localeCompare(b.name, 'es'));
const normalize = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
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

export type RegisterContactDialog = (close: () => void) => () => void;

export function Selection({ rows, countryCode, mode, initial, disabled, pending = false, registerContactDialog, confirm, cancel }: {
  registerContactDialog?: RegisterContactDialog | undefined; pending?: boolean; disabled: boolean; rows: ContactRow[]; countryCode: string | null | undefined; mode: ImportMode; initial: boolean;
  confirm: (numbers: string[]) => void; cancel: () => void;
}) {
  const [region, setRegion] = useState(() => countries.find(code => code === countryCode) ?? '');
  const [adjusting, setAdjusting] = useState(false);
  const [query, setQuery] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (!adjusting) return;
    const node = dialog.current;
    node?.showModal();
    const viewport = window.visualViewport;
    const resize = () => node?.style.setProperty('--country-viewport', viewport?.height + 'px');
    if (viewport) resize();
    viewport?.addEventListener('resize', resize);
    const release = registerContactDialog?.(() => setAdjusting(false));
    return () => {
      release?.();
      viewport?.removeEventListener('resize', resize);
      node?.close();
      trigger.current?.focus({ preventScroll: true });
    };
  }, [adjusting, registerContactDialog]);
  function closeSelector() { setAdjusting(false); }
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
  const search = normalize(query);
  const matches = countryList.filter(item => normalize(item.name).includes(search) || item.code.toLowerCase() === search);
  const action = initial ? 'Importar contactos' : mode === 'ADD' ? 'Agregar contactos' : 'Reemplazar selección';
  return <fieldset disabled={pending} className="home-card"><h3>{initial ? 'Revisá tus contactos' : action}</h3>
    {mode === 'ADD' && <p>Los contactos que ya compartiste siguen sincronizados. Los teléfonos repetidos se ignoran.</p>}
    {!initial && mode === 'REPLACE' && <p>Se quitarán los teléfonos compartidos que no incluyas en esta selección.</p>}
    {mode === 'REPLACE' && <p>Cada teléfono cuenta una vez, aunque esté guardado con varios nombres.</p>}
    {rows.some(row => !row.number.startsWith('+')) && <div>
      <button ref={trigger} className="contact-region" aria-haspopup="dialog" onClick={() => {
        setQuery('');
        setAdjusting(true);
      }}><span><small>País de los números locales</small><strong>{country ? names.of(country) : 'Elegí un país'}</strong></span><span aria-hidden="true">›</span></button>
      <p className="contact-hint">Solo se aplica a números sin prefijo internacional.</p>
      {adjusting && <dialog ref={dialog} className="country-dialog" aria-label="Elegí un país" onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSelector(); } }} onCancel={e => { e.preventDefault(); closeSelector(); }}>
        <header><h3>Elegí un país</h3><button aria-label="Cerrar" onClick={closeSelector}>×</button></header>
        <input autoFocus type="search" aria-label="Buscar país" placeholder="Buscar país" value={query} onChange={e => setQuery(e.target.value)}/>
        <div className="country-list">{matches.map(item =>
          <button key={item.code} aria-pressed={item.code === country} onClick={() => { setRegion(item.code); closeSelector(); }}>
            {item.name}{item.code === country && <span aria-hidden="true">✓</span>}</button>)}
          {!matches.length && <p role="status">Sin resultados</p>}
        </div>
      </dialog>}
    </div>}
    <label className="contact-bulk"><input type="checkbox" disabled={!groups.length} checked={!!groups.length && numbers.size === groups.length}
      ref={input => { if (input) input.indeterminate = numbers.size > 0 && numbers.size < groups.length; }}
      onChange={e => { if (e.target.checked) toggle(groups, true);
        else setExcluded({ rows: new Set(rows.map((_, i) => i)), numbers: new Set([...excluded.numbers, ...groups.map(g => g.number)]) }); }}/>
      {groups.length && numbers.size === groups.length ? 'Deseleccionar todos' : 'Seleccionar todos'} <small>{numbers.size}/{groups.length}</small></label>
    <div className="contact-rows">{groups.map(group => <label key={group.number}><input type="checkbox" checked={numbers.has(group.number)}
      onChange={e => toggle([group], e.target.checked)}/><span>{group.name || 'Sin nombre'} · {group.number}</span></label>)}</div>
    {!!invalid.length && <details><summary>Teléfonos sin incluir ({invalid.length})</summary><p>Revisá el país o el formato en tu agenda.</p>
      {invalid.map((row, i) => <p key={i}>{row.name || 'Sin nombre'} · {row.number}</p>)}</details>}
    <p role="status">{numbers.size} {numbers.size === 1 ? 'teléfono seleccionado' : 'teléfonos seleccionados'}{numbers.size > 2000 && ' · Elegí hasta 2000 teléfonos.'}</p>
    <button className="contact-primary" aria-busy={pending} disabled={disabled || !numbers.size || numbers.size > 2000} onClick={() => confirm([...numbers])}>{action}</button>
    <button onClick={cancel}>Cancelar selección</button>
  </fieldset>;
}
