import { useState } from 'react';
import { defaults, fold, genders, genderLabels, intentions, intentionLabels, normalize, preferenceLabels, validate } from './contracts';
import type { Country, Fields, FullProfile } from './contracts';

export function ProfileForm({ profile, catalog, countryError, retryCountries, busy, submit, mode = 'create' }: { profile?: FullProfile; catalog: Country[]; countryError: string; retryCountries: () => void; busy: boolean; submit: (fields: Fields, mode: 'create' | 'details' | 'filters') => void; mode?: 'create' | 'details' | 'filters' }) {
  const [fields, setFields] = useState<Fields>(profile ?? defaults);
  const [search, setSearch] = useState(''), [errors, setErrors] = useState<string[]>([]);
  const change = <K extends keyof Fields>(key: K, value: Fields[K]) => setFields(f => ({ ...f, [key]: value }));
  const text = (key: 'displayName' | 'city' | 'birthDate', label: string, max?: number) => <label>{label}<input type={key === 'birthDate' ? 'date' : 'text'} value={fields[key]} maxLength={max} required onChange={e => change(key,e.target.value)} /></label>;
  return <form aria-label={mode === 'create' ? 'Crear perfil' : mode === 'details' ? 'Datos del perfil' : 'Preferencias de búsqueda'} onSubmit={e => { e.preventDefault(); const clean = normalize(fields); const issues = validate(clean,catalog,mode); setErrors(issues); if (!issues.length) submit(clean,mode); }}>
    <fieldset disabled={busy}>
      {mode !== 'filters' && <>{text('displayName','Nombre visible',100)}{mode === 'create' && <>{text('birthDate','Fecha de nacimiento')}<label>Género<select value={fields.gender} onChange={e => change('gender',e.target.value)}>{genders.map((g,i) => <option key={g} value={g}>{genderLabels[i]}</option>)}</select></label></>}
      {text('city','Ciudad',100)}<label>Buscar país<input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <label>País<select required value={fields.countryCode} onChange={e => change('countryCode',e.target.value)}><option value="">Seleccioná un país</option>{catalog.filter(c => c.code === fields.countryCode || fold(c.displayName + ' ' + c.code).includes(fold(search))).map(c => <option key={c.code} value={c.code}>{c.displayName}</option>)}</select></label>
      {!catalog.length && <p role="status">{countryError || 'Cargando países…'}</p>}{search && !catalog.some(c => fold(c.displayName + ' ' + c.code).includes(fold(search))) && <p>Sin resultados.</p>}{countryError && <button type="button" onClick={retryCountries}>Reintentar carga de países</button>}
      <label>Bio opcional<textarea maxLength={1000} value={fields.bio} onChange={e => change('bio',e.target.value)} /></label></>}
      {mode !== 'details' && <><fieldset><legend>Me interesa conocer</legend>{genders.map((g,i) => <label className="check" key={g}><input type="checkbox" checked={fields.lookingForGenders.includes(g)} onChange={e => change('lookingForGenders',e.target.checked ? [...fields.lookingForGenders,g] : fields.lookingForGenders.filter(x => x !== g))}/>{preferenceLabels[i]}</label>)}</fieldset>
      <label>Intención<select value={fields.intention} onChange={e => change('intention',e.target.value)}>{intentions.map((v,i) => <option value={v} key={v}>{intentionLabels[i]}</option>)}</select></label>
      <label>Edad mínima: {fields.preferredMinAge}<input type="range" min="18" max="99" value={fields.preferredMinAge} onChange={e => change('preferredMinAge',Number(e.target.value))}/></label>
      <label>Edad máxima: {fields.preferredMaxAge}<input type="range" min="18" max="99" value={fields.preferredMaxAge} onChange={e => change('preferredMaxAge',Number(e.target.value))}/></label>
      <label>Distancia máxima: {fields.maxDistanceKm} km<input type="range" min="1" max="100" value={fields.maxDistanceKm} onChange={e => change('maxDistanceKm',Number(e.target.value))}/></label></>}
      {errors.length > 0 && <div role="alert">{errors.map(x => <p key={x}>{x}</p>)}</div>}
      <button type="submit">{busy ? 'Guardando…' : mode === 'create' ? 'Crear perfil' : 'Guardar cambios'}</button>
    </fieldset>
  </form>;
}
