import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../auth/api';
import type { SessionController } from '../auth/session';
import { countries, fullProfile, hasInteractions, legal, photos } from './contracts';
import type { Country, Fields, FullProfile, LegalDocument, Photo } from './contracts';
import { ProfileForm } from './ProfileForm';
import { CropDialog } from './CropDialog';
import './onboarding.css';

export function onboardingError(error: unknown) {
  const messages: Record<string,string> = {
    EMAIL_NOT_VERIFIED: 'Verificá tu email antes de subir fotos o activar el perfil.',
    PROFILE_PHOTOS_REQUIRED: 'Faltan fotos validadas para activar el perfil.',
    PROFILE_PERSON_PHOTO_REQUIRED: 'Agregá al menos una foto donde se te vea con claridad.',
    PROFILE_FULL_BODY_PHOTO_REQUIRED: 'Agregá al menos una foto de cuerpo completo.',
    PROFILE_PHOTO_MODERATION_NOT_APPROVED: 'Hay fotos pendientes de aprobación o rechazadas. Revisá sus estados.',
    PROFILE_AUTHENTICITY_VERIFICATION_REQUIRED: 'El backend requiere verificar la autenticidad del perfil antes de activarlo.',
    PROFILE_NOT_ACTIVATABLE: 'El perfil no se puede activar en su estado actual. Actualizá el estado.',
    LEGAL_ACTION_REQUIRED: 'Revisá los documentos legales vigentes antes de continuar.',
    INVALID_PROFILE_PHOTO: 'La foto no es válida. Usá JPEG o PNG y revisá el tamaño del archivo.',
    PROFILE_PHOTO_REJECTED: 'La foto fue rechazada. Elegí otra foto que cumpla las normas de la comunidad.',
    PHOTO_POSITION_OCCUPIED: 'La posición de la foto cambió. Actualizá el estado antes de reordenar.',
  };
  return error instanceof ApiError ? messages[error.code] ?? (error.status === 400 && error.kind === 'invalid' ? 'El servidor rechazó los datos. Revisá los campos y usá texto simple, sin etiquetas HTML.' : error.kind === 'invalid' ? 'La respuesta del servidor no es válida. Actualizá el estado antes de continuar.' : error.kind === 'network' ? 'No pudimos confirmar el resultado. Revisá tu conexión y actualizá el estado.' : `No se pudo completar la operación${error.code ? ` (${error.code})` : ''}. Revisá los datos y actualizá el estado.`) : 'No pudimos completar la operación. Actualizá el estado y volvé a intentar.';
}
interface Model { profile: FullProfile | null; photos: Photo[]; legal: { satisfied: boolean; documents: LegalDocument[] }; interactions: boolean }
export function Onboarding({ controller }: { controller: SessionController }) {
  const [model, setModel] = useState<Model | null>(null), [catalog, setCatalog] = useState<Country[]>([]), [countryError,setCountryError] = useState('');
  const [busy, setBusy] = useState(true), [blocked,setBlocked] = useState(true), [error,setError] = useState(''), [message,setMessage] = useState('');
  const [verified,setVerified] = useState(controller.emailVerified), [success,setSuccess] = useState(false);
  const [crop,setCrop] = useState<{ file: File; photo: Photo | undefined; position: number } | null>(null);
  const [sendAt,setSendAt] = useState(0), [checkAt,setCheckAt] = useState(0), [now,setNow] = useState(Date.now());
  const owner = useRef<{ abort: AbortController; locked: boolean } | null>(null);
  const loadCountries = async (signal: AbortSignal) => {
    try { const result = countries(await controller.request('/reference/countries',signal)); if (!signal.aborted) { setCatalog(result); setCountryError(result.length ? '' : 'No hay países disponibles.'); } }
    catch { if (!signal.aborted) setCountryError('No se pudo cargar el catálogo de países.'); }
  };
  const reconcile = async (signal: AbortSignal) => {
    let status = await controller.request('/me/legal-status',signal);
    let current = await controller.request('/legal/documents/current',signal);
    let requirements;
    try { requirements = legal(status,current); }
    catch { status = await controller.request('/me/legal-status',signal); current = await controller.request('/legal/documents/current',signal); requirements = legal(status,current); }
    let profile: FullProfile | null = null;
    const account = controller.snapshot.account;
    if (!account) throw new Error('Sesión no disponible');
    try { profile = fullProfile(await controller.request('/me/profile',signal),account.id); }
    catch (e) { if (!(e instanceof ApiError) || e.code !== 'PROFILE_NOT_FOUND' || e.status !== 404) throw e; }
    const list = profile ? photos(await controller.request('/me/profile/photos',signal)) : [];
    const interactions = profile?.status === 'DRAFT' ? hasInteractions(await controller.request('/me/home',signal)) : false;
    signal.throwIfAborted();
    const result = { profile, photos: list, legal: requirements, interactions };
    setModel(result); controller.installProfile(profile); setBlocked(false); setVerified(controller.emailVerified);
    return result;
  };
  const run = async (task?: (signal: AbortSignal) => Promise<void>, activation = false) => {
    const resource = owner.current;
    if (!resource || resource.locked) return false;
    resource.locked = true; setBusy(true); setError(''); setMessage('');
    const signal = resource.abort.signal;
    let failure: unknown;
    try { if (task) await task(signal); }
    catch (e) { failure = e; }
    try {
      const result = await reconcile(signal);
      if (activation && !failure && result.profile?.status === 'ACTIVE') setSuccess(true);
      if (failure && !signal.aborted) {
        setError(onboardingError(failure));
        // A disconnected mutation may still be finishing server-side. Require an
        // explicit second read before allowing another potentially duplicate write.
        if (failure instanceof ApiError && (failure.kind === 'network' || failure.kind === 'invalid')) setBlocked(true);
      }
    } catch (e) { if (!signal.aborted) { setBlocked(true); setError(onboardingError(failure ?? e)); } }
    finally { if (owner.current === resource && !signal.aborted) { resource.locked = false; setBusy(false); } }
    return true;
  };
  useEffect(() => {
    const resource = { abort: new AbortController(), locked: false }; owner.current = resource;
    queueMicrotask(() => { if (!resource.abort.signal.aborted) { void loadCountries(resource.abort.signal); void run(); } });
    const resume = () => { if (document.visibilityState === 'visible') void run(); };
    document.addEventListener('visibilitychange',resume);
    return () => { resource.abort.abort(); document.removeEventListener('visibilitychange',resume); if (owner.current === resource) owner.current = null; };
    // Controller identity owns this component for its entire mounted lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller]);
  useEffect(() => { if (sendAt <= Date.now() && checkAt <= Date.now()) return; const timer = window.setInterval(() => setNow(Date.now()),1000); return () => clearInterval(timer); },[sendAt,checkAt]);
  const writeProfile = (fields: Fields, mode: 'create' | 'details' | 'filters') => {
    if (blocked) return;
    void run(async signal => {
      const body = mode === 'create' ? fields : mode === 'details' ? { displayName: fields.displayName, city: fields.city, countryCode: fields.countryCode, bio: fields.bio } : { intention: fields.intention, lookingForGenders: fields.lookingForGenders, preferredMinAge: fields.preferredMinAge, preferredMaxAge: fields.preferredMaxAge, maxDistanceKm: fields.maxDistanceKm };
      const raw = await controller.request(mode === 'filters' ? '/me/profile/match-filters' : '/me/profile',signal,mode === 'create' ? 'POST' : mode === 'details' ? 'PATCH' : 'PUT',body);
      const result = fullProfile(raw,controller.snapshot.account?.id ?? '');
      if (mode === 'create' && result.status !== 'DRAFT') throw new ApiError('invalid');
    });
  };
  const mutatePhoto = (path: string, method: string, body?: unknown) => { if (!blocked) void run(async signal => { await controller.request(`/me/profile/photos${path}`,signal,method,body); }); };
  const selectFile = (file: File | undefined, position: number, photo?: Photo) => { if (file && !busy && !blocked) setCrop({ file,position,photo }); };
  const list = model?.photos ?? [];
  const disabled = busy || blocked;
  return <div className="onboarding" aria-busy={busy}>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {busy && <p role="status">Actualizando estado…</p>}
    <button type="button" disabled={busy || !!crop} onClick={() => void run()}>Actualizar estado</button>
    {model && !model.legal.satisfied ? <><h2>Antes de continuar</h2><p>Revisá los documentos vigentes. Algunas acciones de participación requieren que completes la acción indicada.</p>
      {model.legal.documents.map(doc => <article key={doc.type}><h3>{({ TERMS_OF_USE: 'Términos de uso', PRIVACY_NOTICE: 'Aviso de privacidad', COMMUNITY_GUIDELINES: 'Normas de la comunidad' } as Record<string,string>)[doc.type] ?? doc.type}</h3><p>Versión {doc.version} · {doc.requiredAction} · {doc.satisfied ? 'Completado' : 'Pendiente'}</p><a href={doc.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Ver documento</a>{!doc.satisfied && <button disabled={disabled} onClick={() => void run(async signal => { await controller.request('/me/legal-document-actions',signal,'POST',{ documentType: doc.type, documentVersion: doc.version, action: doc.requiredAction }); })}>{doc.requiredAction === 'ACCEPTED' ? 'Aceptar' : 'Confirmar lectura'}</button>}</article>)}
    </> : model && success && model.profile?.status === 'ACTIVE' ? <><h2>Tu perfil está activo</h2><p>Ya podés entrar a Inicio y buscar un chat cuando quieras.</p><p>Tus fotos quedaron guardadas. Si más adelante las cambiás, puede que revisemos tu perfil otra vez.</p><button onClick={() => setSuccess(false)}>Ir a Inicio</button></> : model?.profile?.status === 'ACTIVE' ? <><h2>Inicio</h2><p>Este es un punto de integración temporal. Inicio todavía no está implementado.</p></> : model && !model.profile ? <><h2>Crear perfil</h2><p>Completá tus datos principales. Después vas a poder sumar fotos y activar tu perfil.</p><ProfileForm catalog={catalog} countryError={countryError} retryCountries={() => { const r = owner.current; if (r) void loadCountries(r.abort.signal); }} busy={disabled} submit={writeProfile}/></> : model?.profile ? <>
      <h2>Completá tu perfil</h2><p>Estado: {model.profile.status}</p>
      {model.interactions && <aside><h3>Inicio: interacciones vigentes</h3><p>Tenés interacciones en curso. Se conservan en el backend. Este punto de consulta es de solo lectura; usá Android para continuarlas.</p></aside>}
      <section><h3>Verificá tu email</h3><p>{verified ? 'Email verificado' : 'Abrí el link del correo de verificación y volvé para continuar.'}</p>{!verified && <><button disabled={disabled || sendAt > now} onClick={() => { if (Date.now() < sendAt) return; void run(async () => { await controller.verifyEmail(true); setSendAt(Date.now()+60000); setMessage('Te enviamos un nuevo correo de verificación.'); }); }}>Reenviar correo{sendAt > now ? ` (${Math.ceil((sendAt-now)/1000)} s)` : ''}</button><button disabled={disabled || checkAt > now} onClick={() => { if (Date.now() < checkAt) return; void run(async () => { const value = await controller.verifyEmail(false); setCheckAt(Date.now()+10000); setMessage(value ? 'Email verificado.' : 'Todavía no vemos el email verificado. Abrí el link del correo y volvé a intentar.'); }); }}>Ya verifiqué</button></>}</section>
      <details open><summary>Fotos</summary><p>Hasta nueve fotos. Para la configuración local se suelen requerir cuatro fotos validadas, una de persona y una de cuerpo completo. El servidor decide si podés activar el perfil.</p>
        <div className="photo-grid">{Array.from({ length:9 },(_,i) => { const position = i+1; const photo = list.find(p => p.position === position); return <article key={position}><h4>Foto {position}</h4>{photo && <><img src={photo.url} alt={`Foto ${position} del perfil`} referrerPolicy="no-referrer" onError={e => { e.currentTarget.alt = 'No se pudo cargar la foto. Actualizá el estado o revisá el acceso al almacenamiento.'; }}/><p>Validación: {photo.validationStatus} · Moderación: {photo.moderationStatus}</p><p>Persona: {photo.isPersonPhoto ? 'Sí' : 'No'} · Cuerpo completo: {photo.isFullBody ? 'Sí' : 'No'}</p>{photo.validationStatus !== 'VALIDATED' || photo.moderationStatus !== 'APPROVED' ? <p>Pendiente de revisión o no aprobada. Actualizá el estado; si fue rechazada, reemplazala.</p> : null}</>}
          <label>{photo ? 'Reemplazar' : 'Agregar foto'}<input aria-label={`${photo ? 'Reemplazar' : 'Agregar'} foto ${position}`} type="file" accept="image/jpeg,image/png" disabled={disabled || !verified || !!crop} onChange={e => { selectFile(e.target.files?.[0],position,photo); e.target.value = ''; }}/></label>
          {photo && <><button disabled={disabled || !!crop} onClick={() => { if (window.confirm('¿Eliminar esta foto?')) mutatePhoto(`/${encodeURIComponent(photo.id)}`,'DELETE'); }}>Eliminar foto {position}</button>{[-1,1].map(direction => <button key={direction} disabled={disabled || !!crop || !list[list.indexOf(photo)+direction]} onClick={() => { const ordered = [...list]; const index = ordered.indexOf(photo); const target = ordered[index+direction]; if (!target) return; ordered[index] = target; ordered[index+direction] = photo; mutatePhoto('/reorder','PUT',{ placements: ordered.map((p,index) => ({ photoId:p.id,position:index+1 })) }); }}>{direction < 0 ? 'Mover antes' : 'Mover después'} foto {position}</button>)}</>}
        </article>; })}</div></details>
      {(['details','filters'] as const).map(mode => <details key={mode}><summary>{mode === 'details' ? 'Datos del perfil' : 'Preferencias de búsqueda'}</summary><ProfileForm key={`${model.profile!.id}-${mode}`} profile={model.profile!} catalog={catalog} countryError={countryError} retryCountries={() => { const r = owner.current; if (r) void loadCountries(r.abort.signal); }} busy={disabled || !!crop} mode={mode} submit={writeProfile}/></details>)}
      <section><h3>Activar perfil</h3><p>Autenticidad: {model.profile.authenticityVerificationStatus}</p><button disabled={disabled || !!crop} onClick={() => void run(async signal => { await controller.verifyEmail(false); const result = fullProfile(await controller.request('/me/profile/activation',signal,'POST'),controller.snapshot.account?.id ?? ''); if (result.status !== 'ACTIVE') throw new ApiError('invalid'); },true)}>Activar perfil</button></section>
    </> : null}
    {crop && <CropDialog file={crop.file} onCancel={() => setCrop(null)} onConfirm={async blob => { if (blocked) return; const data = new FormData(); data.append('file',blob,'profile.jpg'); if (!crop.photo) data.append('position',String(crop.position)); const attempted = await run(async signal => { await controller.request(crop.photo ? `/me/profile/photos/${encodeURIComponent(crop.photo.id)}/file` : '/me/profile/photos',signal,crop.photo ? 'PUT' : 'POST',data); }); if (!attempted) throw new Error('Hay una operación en curso. Volvé a intentar.'); if (owner.current && !owner.current.abort.signal.aborted) setCrop(null); }}/ >}
  </div>;
}
