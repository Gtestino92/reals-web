import { useState } from 'react';
import { defaults, genders, genderLabels, intentions, intentionLabels, normalize, preferenceLabels, validate } from './contracts';
import type { Country, Fields, FullProfile } from './contracts';

export function ProfileForm({ profile, catalog, countryError, retryCountries, busy, submit, mode = 'create' }: { profile?: FullProfile; catalog: Country[]; countryError: string; retryCountries: () => void; busy: boolean; submit: (fields: Fields, mode: 'create' | 'details' | 'filters') => void; mode?: 'create' | 'details' | 'filters' }) {
  // null means automatic country selection for a new profile, never an API value.
  const [fields, setFields] = useState<Omit<Fields, 'countryCode'> & { countryCode: string | null }>(() => ({
    ...(profile ?? defaults), countryCode: profile?.countryCode ?? (mode === 'create' ? null : ''),
  }));
  const [errors, setErrors] = useState<string[]>([]);
  const countryCode = fields.countryCode ?? (catalog.some(c => c.code === 'AR') ? 'AR' : '');
  const countryAvailable = catalog.some(c => c.code === countryCode);
  const sortedCountries = [...catalog].sort((a,b) => a.displayName.localeCompare(b.displayName, 'es', { sensitivity: 'base' }));
  const change = <K extends keyof Fields>(key: K, value: Fields[K]) => setFields(f => ({ ...f, [key]: value }));
  const text = (key: 'displayName' | 'city' | 'birthDate', label: string, max?: number, wide = false) => <label className={wide ? 'field-wide' : undefined}>{label}<input type={key === 'birthDate' ? 'date' : 'text'} value={fields[key]} maxLength={max} required onChange={e => change(key,e.target.value)} /></label>;
  return <form className="profile-form" aria-label={mode === 'create' ? 'Crear perfil' : mode === 'details' ? 'Datos del perfil' : 'Preferencias de búsqueda'} onSubmit={e => {
    e.preventDefault();
    const clean = normalize({ ...fields, countryCode });
    const issues = validate(clean,catalog,mode);
    setErrors(issues);
    if (!issues.length) submit(clean,mode);
  }}>
    <fieldset className="form-controls" disabled={busy}>
      {mode !== 'filters' && <fieldset className="profile-group">
        <legend>Sobre vos</legend>
        <div className="profile-fields">
          {text('displayName','Nombre visible',100,true)}
          {mode === 'create' && <>
            {text('birthDate','Fecha de nacimiento')}
            <label>Género<select value={fields.gender} onChange={e => change('gender',e.target.value)}>{genders.map((g,i) => <option key={g} value={g}>{genderLabels[i]}</option>)}</select></label>
          </>}
          {text('city','Ciudad',100)}
          <label>País<select required value={countryCode} onChange={e => change('countryCode',e.target.value)}>
            <option value="">Seleccioná un país</option>
            {countryCode && !countryAvailable && <option value={countryCode} disabled>{countryCode} (no disponible)</option>}
            {sortedCountries.map(c => <option key={c.code} value={c.code}>{c.displayName}</option>)}
          </select></label>
          {(!catalog.length || countryError || (countryCode && !countryAvailable)) && <div className="field-wide country-feedback">
            <p role="status">{countryError || (!catalog.length ? 'Cargando países…' : 'El país seleccionado no está disponible en el catálogo.')}</p>
            {countryError && <button type="button" onClick={retryCountries}>Reintentar carga de países</button>}
          </div>}
          <label className="field-wide">Bio opcional<textarea maxLength={1000} rows={3} value={fields.bio} onChange={e => change('bio',e.target.value)} /></label>
        </div>
      </fieldset>}
      {mode !== 'details' && <fieldset className="profile-group">
        <legend>Qué estás buscando</legend>
        <fieldset className="gender-preferences"><legend>Me interesa conocer</legend>
          <div className="preference-options">{genders.map((g,i) => <label className="check" key={g}>
            <input type="checkbox" checked={fields.lookingForGenders.includes(g)} onChange={e => change('lookingForGenders',e.target.checked ? [...fields.lookingForGenders,g] : fields.lookingForGenders.filter(x => x !== g))}/>{preferenceLabels[i]}
          </label>)}</div>
        </fieldset>
        <label>Intención<select value={fields.intention} onChange={e => change('intention',e.target.value)}>{intentions.map((v,i) => <option value={v} key={v}>{intentionLabels[i]}</option>)}</select></label>
        <fieldset className="age-preference"><legend>Rango de edad</legend>
          <div className="age-controls">
            <label><span>Edad mínima: <strong>{fields.preferredMinAge}</strong></span><input type="range" min="18" max="99" value={fields.preferredMinAge} onChange={e => change('preferredMinAge',Number(e.target.value))}/></label>
            <label><span>Edad máxima: <strong>{fields.preferredMaxAge}</strong></span><input type="range" min="18" max="99" value={fields.preferredMaxAge} onChange={e => change('preferredMaxAge',Number(e.target.value))}/></label>
          </div>
        </fieldset>
        <label><span>Distancia máxima: <strong>{fields.maxDistanceKm} km</strong></span><input type="range" min="1" max="100" value={fields.maxDistanceKm} onChange={e => change('maxDistanceKm',Number(e.target.value))}/></label>
      </fieldset>}
      {errors.length > 0 && <div role="alert">{errors.map(x => <p key={x}>{x}</p>)}</div>}
      <button className="profile-submit" type="submit">{busy ? 'Guardando…' : mode === 'create' ? 'Crear perfil' : 'Guardar cambios'}</button>
    </fieldset>
  </form>;
}
