import { useId, useLayoutEffect, useRef, useState } from 'react';
import { defaults, genders, genderLabels, intentions, intentionLabels, normalize, preferenceLabels, validate } from './contracts';
import type { Country, Fields, FullProfile } from './contracts';
import { AgeRangeSlider } from './AgeRangeSlider';

export function ProfileForm({ profile, catalog, countryError, retryCountries, busy, submit, mode = 'create', onDirtyChange }: { onDirtyChange?: ((dirty: boolean) => void) | undefined; profile?: FullProfile; catalog: Country[]; countryError: string; retryCountries: () => void; busy: boolean; submit: (fields: Fields, mode: 'create' | 'details' | 'filters') => void; mode?: 'create' | 'details' | 'filters' }) {
  const form = useRef<HTMLFormElement>(null);
  const errorId = useId();
  const initial = { ...defaults, gender: '', lookingForGenders: [], intention: '' };
  // null means automatic country selection for a new profile, never an API value.
  const [fields, setFields] = useState<Omit<Fields, 'countryCode'> & { countryCode: string | null }>(() => ({
    ...(profile ?? initial), countryCode: profile?.countryCode ?? (mode === 'create' ? null : ''),
  }));
  const detailKeys = ['displayName', 'birthDate', 'gender', 'city', 'countryCode', 'bio'] as const;
  const filterKeys = ['lookingForGenders', 'intention', 'preferredMinAge', 'preferredMaxAge', 'maxDistanceKm'] as const;
  const keys = mode === 'create' ? [...detailKeys, ...filterKeys] : mode === 'details' ? detailKeys : filterKeys;
  const baseline = profile ?? { ...initial, countryCode: mode === 'create' ? null : '' };
  const dirty = keys.some(key => JSON.stringify(fields[key]) !== JSON.stringify(baseline[key]));
  useLayoutEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  const [errors, setErrors] = useState<string[]>([]);
  useLayoutEffect(() => {
    if (errors.length) form.current?.querySelector<HTMLElement>('[aria-invalid=true]')?.focus();
  }, [errors]);
  const invalidField = (key: keyof Fields) => {
    const prefixes: Partial<Record<keyof Fields, string>> = { displayName: 'Nombre visible:', birthDate: 'Fecha de nacimiento:', city: 'Ciudad:', countryCode: 'Seleccioná un país', bio: 'Bio:', gender: 'Seleccioná un género', intention: 'Elegí una intención', lookingForGenders: 'Elegí al menos un género', preferredMinAge: 'Elegí edades', maxDistanceKm: 'Elegí edades' };
    const invalid = errors.some(error => prefixes[key] && error.startsWith(prefixes[key]));
    return { name: key, 'aria-invalid': invalid || undefined, 'aria-describedby': invalid ? errorId : undefined };
  };
  const countryCode = fields.countryCode ?? (catalog.some(c => c.code === 'AR') ? 'AR' : '');
  const countryAvailable = catalog.some(c => c.code === countryCode);
  const sortedCountries = [...catalog].sort((a,b) => a.displayName.localeCompare(b.displayName, 'es', { sensitivity: 'base' }));
  const change = <K extends keyof Fields>(key: K, value: Fields[K]) => setFields(f => ({ ...f, [key]: value }));
  const text = (key: 'displayName' | 'city' | 'birthDate', label: string, max?: number, wide = false) => <label className={wide ? 'field-wide' : undefined}>{label}<input {...invalidField(key)} type={key === 'birthDate' ? 'date' : 'text'} value={fields[key]} maxLength={max} required onChange={e => change(key,e.target.value)} /></label>;
  return <form ref={form} noValidate className="profile-form" aria-label={mode === 'create' ? 'Crear perfil' : mode === 'details' ? 'Datos del perfil' : 'Preferencias de búsqueda'} onSubmit={e => {
    e.preventDefault();
    if (busy) return;
    const clean = normalize({ ...fields, countryCode });
    const issues = validate(clean,catalog,mode);
    setErrors(issues);
    if (!issues.length) submit(clean,mode);
  }}>
    <fieldset className="form-controls" disabled={busy}>
      <button className="profile-submit" type="submit">{busy ? 'Guardando…' : mode === 'create' ? 'Crear perfil' : 'Guardar cambios'}</button>
      {errors.length > 0 && <div id={errorId} role="alert">{errors.map(x => <p key={x}>{x}</p>)}</div>}
      {mode !== 'filters' && <fieldset className="profile-group">
        <legend>Sobre vos</legend>
        <div className="profile-fields">
          {text('displayName','Nombre visible',100,true)}
          {mode === 'create' && <>
            {text('birthDate','Fecha de nacimiento')}
            <label>Género<select {...invalidField('gender')} value={fields.gender} onChange={e => change('gender',e.target.value)}><option value="">Seleccioná tu género</option>{genders.map((g,i) => <option key={g} value={g}>{genderLabels[i]}</option>)}</select></label>
          </>}
          {text('city','Ciudad',100)}
          <label>País<select {...invalidField('countryCode')} required value={countryCode} onChange={e => change('countryCode',e.target.value)}>
            <option value="">Seleccioná un país</option>
            {countryCode && !countryAvailable && <option value={countryCode} disabled>{countryCode} (no disponible)</option>}
            {sortedCountries.map(c => <option key={c.code} value={c.code}>{c.displayName}</option>)}
          </select></label>
          {(!catalog.length || countryError || (countryCode && !countryAvailable)) && <div className="field-wide country-feedback">
            <p role="status">{countryError || (!catalog.length ? 'Cargando países…' : 'El país seleccionado no está disponible en el catálogo.')}</p>
            {countryError && <button type="button" onClick={retryCountries}>Reintentar carga de países</button>}
          </div>}
          <label className="field-wide">Bio opcional<textarea {...invalidField('bio')} maxLength={1000} rows={3} value={fields.bio} onChange={e => change('bio',e.target.value)} /></label>
        </div>
      </fieldset>}
      {mode !== 'details' && <fieldset className="profile-group">
        <legend>Qué estás buscando</legend>
        <fieldset className="gender-preferences"><legend>Me interesa conocer</legend>
          <div className="preference-options">{genders.map((g,i) => <label className="check" key={g}>
            <input {...invalidField('lookingForGenders')} type="checkbox" checked={fields.lookingForGenders.includes(g)} onChange={e => change('lookingForGenders',e.target.checked ? [...fields.lookingForGenders,g] : fields.lookingForGenders.filter(x => x !== g))}/>{preferenceLabels[i]}
          </label>)}</div>
        </fieldset>
        <label>Intención<select {...invalidField('intention')} value={fields.intention} onChange={e => change('intention',e.target.value)}><option value="">Seleccioná tu intención</option>{intentions.map((v,i) => <option value={v} key={v}>{intentionLabels[i]}</option>)}</select></label>
        <fieldset className="age-preference"><legend>Rango de edad</legend>
          <AgeRangeSlider minAge={fields.preferredMinAge} maxAge={fields.preferredMaxAge} disabled={busy} onChange={(min,max) => setFields(f => ({ ...f,preferredMinAge:min,preferredMaxAge:max }))}/>
        </fieldset>
        <label><span>Distancia máxima: <strong>{fields.maxDistanceKm} km</strong></span><input {...invalidField('maxDistanceKm')} type="range" min="1" max="100" value={fields.maxDistanceKm} onChange={e => change('maxDistanceKm',Number(e.target.value))}/></label>
      </fieldset>}

    </fieldset>
  </form>;
}
