import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { defaults, genders, genderLabels, intentions, intentionLabels, normalize, preferenceLabels, profileIssues } from './contracts';
import type { Country, Fields, FullProfile } from './contracts';
import { AgeRangeSlider } from './AgeRangeSlider';

type DraftFields = Omit<Fields, 'countryCode'> & { countryCode: string | null };
const detailKeys = ['displayName', 'birthDate', 'gender', 'city', 'countryCode', 'bio'] as const;
const filterKeys = ['lookingForGenders', 'intention', 'preferredMinAge', 'preferredMaxAge', 'maxDistanceKm'] as const;

function mergeConfirmedFields(draft: DraftFields, previous: FullProfile, profile: FullProfile, saved: boolean) {
  const next = { ...draft };
  const same = (key: keyof Fields) => JSON.stringify(draft[key]) === JSON.stringify(previous[key]);
  const merge = <K extends keyof Fields>(key: K) => { if (saved || same(key)) next[key] = profile[key]; };
  for (const key of detailKeys) merge(key);
  for (const key of ['lookingForGenders', 'intention', 'maxDistanceKm'] as const) merge(key);
  if (saved || (same('preferredMinAge') && same('preferredMaxAge'))) {
    next.preferredMinAge = profile.preferredMinAge;
    next.preferredMaxAge = profile.preferredMaxAge;
  }
  return next;
}

export function ProfileForm({ profile, catalog, countryError, retryCountries, busy, submit, mode = 'create', onDirtyChange, saved = false, saving = false, creationFeedback }: { creationFeedback?: ReactNode; saving?: boolean; saved?: boolean; onDirtyChange?: ((dirty: boolean) => void) | undefined; profile?: FullProfile; catalog: Country[]; countryError: string; retryCountries: () => void; busy: boolean; submit: (fields: Fields, mode: 'create' | 'details' | 'filters') => void; mode?: 'create' | 'details' | 'filters' }) {
  const [saveDismissed, setSaveDismissed] = useState(false);
  useLayoutEffect(() => { setSaveDismissed(false); }, [saved, busy]);
  const form = useRef<HTMLFormElement>(null), summary = useRef<HTMLDivElement>(null);
  const errorId = useId();
  const initial = { ...defaults, gender: '', lookingForGenders: [], intention: '' };
  // null means automatic country selection for a new profile, never an API value.
  const [fields, setFields] = useState<DraftFields>(() => ({
    ...(profile ?? initial), countryCode: profile?.countryCode ?? (mode === 'create' ? null : ''),
  }));
  const [confirmedProps, setConfirmedProps] = useState({ profile, saved });
  if (profile !== confirmedProps.profile || saved !== confirmedProps.saved) {
    setConfirmedProps({ profile, saved });
    const previous = confirmedProps.profile;
    if (profile && previous) {
      const confirmed = saved && !confirmedProps.saved;
      setFields(current => mergeConfirmedFields(current, previous, profile, confirmed));
    }
  }
  const keys = mode === 'create' ? [...detailKeys, ...filterKeys] : mode === 'details' ? detailKeys : filterKeys;
  const baseline = profile ?? { ...initial, countryCode: mode === 'create' ? null : '' };
  const dirty = keys.some(key => JSON.stringify(fields[key]) !== JSON.stringify(baseline[key]));
  useLayoutEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false); }, [dirty, onDirtyChange]);
  const [attempts, setAttempts] = useState(0);
  const countryCode = fields.countryCode ?? (catalog.some(c => c.code === 'AR') ? 'AR' : '');
  const clean = normalize({ ...fields, countryCode });
  const errors = attempts ? profileIssues(clean, catalog, mode) : {};
  const messages = Object.entries(errors);
  const validationSummary = messages.length > 0 && <div ref={summary} className="profile-validation" role="alert" tabIndex={-1}>{messages.map(([key, message]) => <p id={`${errorId}-${key}`} key={key}>{message}</p>)}</div>;
  useLayoutEffect(() => {
    if (mode === 'create') summary.current?.focus({ preventScroll: true });
    else form.current?.querySelector<HTMLElement>(':is(input, select, textarea, [role=slider])[aria-invalid=true]')?.focus({ preventScroll: true });
  }, [attempts, mode]);
  const invalidField = (key: keyof Fields) => ({
    name: key,
    'aria-invalid': !!errors[key] || undefined,
    'aria-describedby': errors[key] ? `${errorId}-${key}` : undefined,
  });
  const confirmed = normalize({ ...baseline, countryCode: baseline.countryCode ?? countryCode });
  const changed = keys.some(key => {
    const value = clean[key], saved = confirmed[key];
    return JSON.stringify(Array.isArray(value) ? [...value].sort() : value) !== JSON.stringify(Array.isArray(saved) ? [...saved].sort() : saved);
  });
  const countryAvailable = catalog.some(c => c.code === countryCode);
  const sortedCountries = [...catalog].sort((a,b) => a.displayName.localeCompare(b.displayName, 'es', { sensitivity: 'base' }));
  const change = <K extends keyof Fields>(key: K, value: Fields[K]) => { setSaveDismissed(true); setFields(f => ({ ...f, [key]: value })); };
  const text = (key: 'displayName' | 'city', label: string, max: number, wide = false) => <label className={wide ? 'field-wide' : undefined}>{label}<input {...invalidField(key)} value={fields[key]} maxLength={max} required onChange={e => change(key,e.target.value)} /></label>;
  return <form ref={form} noValidate className="profile-form" aria-label={mode === 'create' ? 'Crear perfil' : mode === 'details' ? 'Datos del perfil' : 'Preferencias de búsqueda'} onSubmit={e => {
    e.preventDefault();
    if (busy || (mode !== 'create' && !changed)) return;
    if (Object.keys(profileIssues(clean, catalog, mode)).length) setAttempts(value => value + 1);
    else { setAttempts(0); submit(clean, mode); }
  }}>
    <fieldset className="form-controls" disabled={busy}>
      {mode !== 'create' && validationSummary}
      {mode !== 'filters' && <fieldset className="profile-group">
        <legend>Sobre vos</legend>
        <div className="profile-fields">
          {text('displayName','Nombre visible',100,true)}
          {mode === 'create' && <>
            <BirthDateFields value={fields.birthDate} onChange={value => change('birthDate', value)} {...invalidField('birthDate')}/>
            <label>Género<select {...invalidField('gender')} value={fields.gender} onChange={e => change('gender',e.target.value)}><option value="">Seleccioná tu género</option>{genders.map((g,i) => <option key={g} value={g}>{genderLabels[i]}</option>)}</select></label>
          </>}
          <label>País<select {...invalidField('countryCode')} required value={countryCode} onChange={e => change('countryCode',e.target.value)}>
            <option value="">Seleccioná un país</option>
            {countryCode && !countryAvailable && <option value={countryCode} disabled>{countryCode} (no disponible)</option>}
            {sortedCountries.map(c => <option key={c.code} value={c.code}>{c.displayName}</option>)}
          </select></label>
          {(!catalog.length || countryError || (countryCode && !countryAvailable)) && <div className="field-wide country-feedback">
            <p role="status">{countryError || (!catalog.length ? 'Cargando países…' : 'El país seleccionado no está disponible en el catálogo.')}</p>
            {countryError && <button type="button" onClick={retryCountries}>Reintentar carga de países</button>}
          </div>}
          {text('city','Ciudad',100)}
          <label className="field-wide">Bio (opcional)<textarea {...invalidField('bio')} maxLength={1000} rows={3} value={fields.bio} onChange={e => change('bio',e.target.value)} /></label>
        </div>
      </fieldset>}
      {mode !== 'details' && <fieldset className="profile-group">
        <legend>Qué estás buscando</legend>
        <fieldset className="gender-preferences" {...invalidField('lookingForGenders')}><legend>Me interesa conocer</legend>
          <div className="preference-options">{genders.map((g,i) => <label className="check" key={g}>
            <input {...invalidField('lookingForGenders')} type="checkbox" checked={fields.lookingForGenders.includes(g)} onChange={e => change('lookingForGenders',e.target.checked ? [...fields.lookingForGenders,g] : fields.lookingForGenders.filter(x => x !== g))}/>{preferenceLabels[i]}
          </label>)}</div>
        </fieldset>
        <label>Intención<select {...invalidField('intention')} value={fields.intention} onChange={e => change('intention',e.target.value)}><option value="">Seleccioná tu intención</option>{intentions.map((v,i) => <option value={v} key={v}>{intentionLabels[i]}</option>)}</select></label>
        <fieldset className="age-preference" {...invalidField('preferredMinAge')}><legend>Rango de edad</legend>
          <AgeRangeSlider minAge={fields.preferredMinAge} maxAge={fields.preferredMaxAge} disabled={busy} errorId={invalidField('preferredMinAge')['aria-describedby']} onChange={(min,max) => { setSaveDismissed(true); setFields(f => ({ ...f,preferredMinAge:min,preferredMaxAge:max })); }}/>
        </fieldset>
        <label><span>Distancia máxima: <strong>{fields.maxDistanceKm} km</strong></span><input {...invalidField('maxDistanceKm')} type="range" min="1" max="100" value={fields.maxDistanceKm} onChange={e => change('maxDistanceKm',Number(e.target.value))}/></label>
      </fieldset>}

      {mode !== 'create' && <><button className="profile-submit" type="submit" disabled={!changed}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
        <p className="profile-save-feedback" role="status">{saved && !busy && !saveDismissed && <><span aria-hidden="true">✓ </span>Cambios guardados.</>}</p>
      </>}
    </fieldset>
    {mode === 'create' && <>
      {validationSummary}
      {creationFeedback}
      <button className="profile-submit" type="submit" disabled={busy}>{saving ? 'Guardando…' : 'Crear perfil'}</button>
    </>}
  </form>;
}

const birthMonths = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const twoDigits = (value: number) => String(value).padStart(2, '0');
function daysInBirthMonth(year: string, month: string) {
  if (!year || !month) return 0;
  return new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
}
function BirthDateFields({ value, onChange, ...invalid }: {
  value: string; onChange: (value: string) => void;
  'aria-invalid': boolean | undefined; 'aria-describedby': string | undefined;
}) {
  const [year = '', month = '', day = ''] = value.split('-');
  const currentYear = new Date().getFullYear();
  const update = (nextYear: string, nextMonth: string, nextDay: string) => {
    const validDay = Number(nextDay) <= daysInBirthMonth(nextYear, nextMonth) ? nextDay : '';
    onChange(nextYear || nextMonth || validDay ? [nextYear, nextMonth, validDay].join('-') : '');
  };
  return <fieldset className="profile-birth-date field-wide" {...invalid}>
    <legend>Fecha de nacimiento</legend>
    <div className="profile-date-selects">
      <label>Mes<select {...invalid} name="birthMonth" required autoComplete="bday-month" value={month} onChange={e => update(year, e.target.value, day)}>
        <option value="">Mes</option>
        {birthMonths.map((name, index) => <option key={name} value={twoDigits(index + 1)}>{name}</option>)}
      </select></label>
      <label>Año<select {...invalid} name="birthYear" required autoComplete="bday-year" value={year} onChange={e => update(e.target.value, month, day)}>
        <option value="">Año</option>
        {Array.from({ length: 121 }, (_, index) => <option key={index} value={currentYear - index}>{currentYear - index}</option>)}
      </select></label>
      <label>Día<select {...invalid} name="birthDay" required disabled={!year || !month} autoComplete="bday-day" value={day} onChange={e => update(year, month, e.target.value)}>
        <option value="">Día</option>
        {Array.from({ length: daysInBirthMonth(year, month) }, (_, index) => <option key={index} value={twoDigits(index + 1)}>{index + 1}</option>)}
      </select></label>
    </div>
  </fieldset>;
}
