import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../auth/api';
import { errorCode, terminalCodes } from '../auth/errors';
import type { SessionController } from '../auth/session';
import { authenticityLabels, countries, fullProfile, hasInteractions, legal, photos } from './contracts';
import type { Country, Fields, FullProfile, LegalDocument, Photo } from './contracts';
import { ProfileForm } from './ProfileForm';
import { CropDialog } from './CropDialog';
import { PhotoGrid } from './PhotoGrid';
import { photoPlacements } from './photoReorder';
import { photoFileError } from './photoFiles';
import './onboarding.css';
import { SessionLoading } from '../SessionLoading';
import { parseQueue } from '../home/contracts';
import { Home } from '../home/Home';

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
interface Model { profile: FullProfile | null; photos: Photo[]; legal: { satisfied: boolean; documents: LegalDocument[] }; interactions: boolean | null }
export function Onboarding({ controller, management, onBack, onNavigationBlockedChange }: { controller: SessionController; management?: 'details' | 'filters'; onBack?: () => void; onNavigationBlockedChange?: (blocked: boolean) => void }) {
  const [model, setModel] = useState<Model | null>(null), [catalog, setCatalog] = useState<Country[]>([]), [countryError,setCountryError] = useState('');
  const [busy, setBusy] = useState(true), [blocked,setBlocked] = useState(true), [error,setError] = useState(''), [message,setMessage] = useState('');
  const [verified,setVerified] = useState(controller.emailVerified), [success,setSuccess] = useState(false);
  const [crop,setCrop] = useState<{ file: File; photo: Photo | undefined; position: number } | null>(null);
  const cropOwned = useRef(false);
  const [photoError,setPhotoError] = useState('');
  const closeCrop = () => { cropOwned.current = false; setCrop(null); };
  const [sendAt,setSendAt] = useState(0), [checkAt,setCheckAt] = useState(0), [now,setNow] = useState(Date.now());
  const owner = useRef<{ abort: AbortController; locked: boolean } | null>(null);
  const loadCountries = async (signal: AbortSignal) => {
    try { const result = countries(await controller.request('/reference/countries',signal)); if (!signal.aborted) { setCatalog(result); setCountryError(result.length ? '' : 'No hay países disponibles.'); } }
    catch { if (!signal.aborted) setCountryError('No se pudo cargar el catálogo de países.'); }
  };
  const reconcile = async (signal: AbortSignal) => {
    let profile: FullProfile | null = null;
    const account = controller.snapshot.account;
    if (!account) throw new Error('Sesión no disponible');
    try { profile = fullProfile(await controller.request('/me/profile',signal),account.id); }
    catch (e) { if (!(e instanceof ApiError) || e.code !== 'PROFILE_NOT_FOUND' || e.status !== 404) throw e; }
    signal.throwIfAborted();
    controller.installProfile(profile);
    if (management && parseQueue(await controller.request('/matchmaking/queue', signal), account.id)) { signal.throwIfAborted(); onBack?.(); throw new DOMException('Búsqueda activa', 'AbortError'); }
    let status = await controller.request('/me/legal-status',signal);
    let current = await controller.request('/legal/documents/current',signal);
    let requirements;
    try { requirements = legal(status,current); }
    catch { status = await controller.request('/me/legal-status',signal); current = await controller.request('/legal/documents/current',signal); requirements = legal(status,current); }
    const list = profile ? photos(await controller.request('/me/profile/photos',signal)) : [];
    let interactions: boolean | null = false;
    if (profile?.status === 'DRAFT' || profile?.status === 'INACTIVE') {
      try { interactions = hasInteractions(await controller.request('/me/home',signal)); }
      catch (error) {
        if (
          signal.aborted ||
          (error instanceof ApiError && error.kind === 'authorization') ||
          terminalCodes.has(errorCode(error)) ||
          errorCode(error).startsWith('ACCOUNT_')
        ) throw error;
        interactions = null;
      }
    }
    signal.throwIfAborted();
    const result = { profile, photos: list, legal: requirements, interactions };
    setModel(result); setBlocked(false); setVerified(controller.emailVerified);
    return result;
  };
  const run = async (task?: (signal: AbortSignal) => Promise<void>, activation = false) => {
    const resource = owner.current;
    if (!resource || resource.locked) return false;
    resource.locked = true; onNavigationBlockedChange?.(true); setBusy(true); setError(''); setMessage(''); setPhotoError('');
    const signal = resource.abort.signal;
    let failure: unknown;
    try { if (task) await task(signal); }
    catch (e) { failure = e; }
    try {
      const result = await reconcile(signal);
      if (management && task && !failure && !signal.aborted) setMessage('Cambios guardados.');
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
  const reorderPhoto = (photoId: string, target: number) => {
    const resource = owner.current;
    if (!resource || resource.abort.signal.aborted || resource.locked || busy || blocked || cropOwned.current || controller.snapshot.phase !== 'ready' || controller.snapshot.profile?.id !== model?.profile?.id) return;
    const placements = photoPlacements(model?.photos ?? [],photoId,target);
    if (placements) mutatePhoto('/reorder','PUT',{ placements });
  };
  const selectFiles = (files: File[], position: number, photo?: Photo) => {
    const resource = owner.current;
    if (!resource || resource.abort.signal.aborted || resource.locked || busy || blocked || !verified || !controller.emailVerified || cropOwned.current || controller.snapshot.phase !== 'ready' || controller.snapshot.profile?.id !== model?.profile?.id) return;
    if (files.length !== 1) { setPhotoError('Elegí o soltá una sola foto JPEG o PNG por vez. No se admiten carpetas.'); return; }
    const file = files[0];
    if (!file) return;
    const invalid = photoFileError(file);
    if (invalid) { setPhotoError(invalid); return; }
    setPhotoError(''); cropOwned.current = true; setCrop({ file,position,photo });
  };
  const list = model?.photos ?? [];
  const disabled = busy || blocked;
  const uploadGuidance = busy ? 'Estamos actualizando el estado. Esperá un momento para subir fotos.'
    : blocked ? 'No pudimos confirmar el estado. Revisá el error y usá «Actualizar estado» antes de subir fotos.'
    : !verified ? 'Verificá tu email antes de subir fotos. Usá «Reenviar correo» y «Ya verifiqué» en la sección anterior.'
    : crop ? 'Terminá o cancelá el recorte actual antes de elegir otra foto.'
    : 'Elegí o arrastrá una sola foto JPEG o PNG de hasta 15 MB. Podés recortarla antes de subirla.';
  useEffect(() => { onNavigationBlockedChange?.(busy || !!crop); }, [busy, crop, onNavigationBlockedChange]);
  if (!model && busy) return <SessionLoading />;
  return <div className="onboarding" aria-busy={busy}>
    {management && <button type="button" disabled={busy || !!crop} onClick={onBack}>Volver a Inicio</button>}
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {busy && <p role="status">Actualizando estado…</p>}
    <button type="button" disabled={busy || !!crop} onClick={() => void run()}>Actualizar estado</button>
    {model && !model.legal.satisfied ? <><h2>Antes de continuar</h2><p>Revisá los documentos vigentes. Algunas acciones de participación requieren que completes la acción indicada.</p>
      {model.legal.documents.map(doc => <article key={doc.type}><h3>{({ TERMS_OF_USE: 'Términos de uso', PRIVACY_NOTICE: 'Aviso de privacidad', COMMUNITY_GUIDELINES: 'Normas de la comunidad' } as Record<string,string>)[doc.type] ?? doc.type}</h3><p>Versión {doc.version} · {doc.requiredAction} · {doc.satisfied ? 'Completado' : 'Pendiente'}</p><a href={doc.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Ver documento</a>{!doc.satisfied && <button disabled={disabled} onClick={() => void run(async signal => { await controller.request('/me/legal-document-actions',signal,'POST',{ documentType: doc.type, documentVersion: doc.version, action: doc.requiredAction }); })}>{doc.requiredAction === 'ACCEPTED' ? 'Aceptar' : 'Confirmar lectura'}</button>}</article>)}
    </> : model && success && model.profile?.status === 'ACTIVE' ? <><h2>Tu perfil está activo</h2><p>Ya podés entrar a Inicio y buscar un chat cuando quieras.</p><p>Tus fotos quedaron guardadas. Si más adelante las cambiás, puede que revisemos tu perfil otra vez.</p><button onClick={() => setSuccess(false)}>Ir a Inicio</button></> : model?.profile?.status === 'ACTIVE' && !management ? <Home controller={controller} /> : model && !model.profile ? <><h2>Crear perfil</h2><p>Completá tus datos principales. Después vas a poder sumar fotos y activar tu perfil.</p><ProfileForm catalog={catalog} countryError={countryError} retryCountries={() => { const r = owner.current; if (r) void loadCountries(r.abort.signal); }} busy={disabled} submit={writeProfile}/></> : model?.profile ? <>
      {!management && <><h2>Completá tu perfil</h2><p>Estado: {model.profile.status}</p></>}
      {management && model.profile.status !== 'ACTIVE' && <p>Estado: {model.profile.status}</p>}
      {model.interactions === true && <aside><h3>Inicio: interacciones vigentes</h3><p>Tenés interacciones en curso. Se conservan en el backend. Este punto de consulta es de solo lectura; usá Android para continuarlas.</p></aside>}
      {model.interactions === true && <Home controller={controller} />}
      {model.interactions === null && <aside><h3>Inicio no disponible</h3><p>No pudimos consultar tus interacciones. Su estado es desconocido. Podés seguir completando el perfil o consultarlas desde Android.</p><button disabled={disabled || !!crop} onClick={() => void run()}>Reintentar Inicio</button></aside>}
      {!verified && <section id="email-verification" tabIndex={-1}><h3>Verificá tu email</h3><p>Abrí el link del correo de verificación y volvé para continuar.</p><button disabled={disabled || sendAt > now} onClick={() => { if (Date.now() < sendAt) return; void run(async () => { await controller.verifyEmail(true); setSendAt(Date.now()+60000); setMessage('Te enviamos un nuevo correo de verificación.'); }); }}>Reenviar correo{sendAt > now ? ` (${Math.ceil((sendAt-now)/1000)} s)` : ''}</button><button disabled={disabled || checkAt > now} onClick={() => { if (Date.now() < checkAt) return; void run(async () => { const value = await controller.verifyEmail(false); setVerified(value); setCheckAt(Date.now()+10000); setMessage(value ? 'Email verificado.' : 'Todavía no vemos el email verificado. Abrí el link del correo y volvé a intentar.'); }); }}>Ya verifiqué</button></section>}
      {(['details','filters'] as const).filter(mode => management === mode).map(mode => <FormSection key={mode} management={!!management} title={mode === 'details' ? 'Datos del perfil' : 'Preferencias de búsqueda'}><ProfileForm key={`${model.profile!.id}-${mode}`} profile={model.profile!} catalog={catalog} countryError={countryError} retryCountries={() => { const r = owner.current; if (r) void loadCountries(r.abort.signal); }} busy={disabled || !!crop} mode={mode} submit={writeProfile}/></FormSection>)}
      {management !== 'filters' && <details open><summary>Fotos</summary><p>{management ? 'Hasta nueve fotos. Los cambios pueden requerir una nueva revisión del perfil. Revisá los estados de validación y moderación de cada foto.' : 'Hasta nueve fotos. Para la configuración local se suelen requerir cuatro fotos validadas, una de persona y una de cuerpo completo. El servidor decide si podés activar el perfil.'}</p>
        <p id="photo-upload-guidance" role="status">{uploadGuidance}</p>
        {!verified && <p><a href="#email-verification">Ir a la verificación de email</a></p>}
        {photoError && <p role="alert">{photoError}</p>}
        <PhotoGrid photos={list} disabled={disabled || !!crop} uploadsDisabled={disabled || !verified || !!crop} onSelect={selectFiles} onMove={reorderPhoto}
          onDelete={photo => { if (window.confirm('¿Eliminar esta foto?')) mutatePhoto(`/${encodeURIComponent(photo.id)}`,'DELETE'); }}/>
      </details>}

      {(['details','filters'] as const).filter(() => !management).map(mode => <FormSection key={mode} management={!!management} title={mode === 'details' ? 'Datos del perfil' : 'Preferencias de búsqueda'}><ProfileForm key={`${model.profile!.id}-${mode}`} profile={model.profile!} catalog={catalog} countryError={countryError} retryCountries={() => { const r = owner.current; if (r) void loadCountries(r.abort.signal); }} busy={disabled || !!crop} mode={mode} submit={writeProfile}/></FormSection>)}
      {!management && <section><h3>Activar perfil</h3><p>Autenticidad: {authenticityLabels[model.profile.authenticityVerificationStatus] ?? 'Estado no disponible'}</p><p>La validación de fotos revisa cada imagen. La verificación de autenticidad del perfil es un proceso separado. El servidor determina si es necesaria para activar tu perfil.</p>{!verified && <p id="activation-email-guidance">Verificá tu email y presioná «Ya verifiqué» antes de activar el perfil.</p>}<button aria-describedby={!verified ? 'activation-email-guidance' : undefined} disabled={disabled || !!crop || !verified} onClick={() => void run(async signal => { await controller.verifyEmail(false); const result = fullProfile(await controller.request('/me/profile/activation',signal,'POST'),controller.snapshot.account?.id ?? ''); if (result.status !== 'ACTIVE') throw new ApiError('invalid'); },true)}>Activar perfil</button></section>}
    </> : null}
    {crop && <CropDialog file={crop.file} onCancel={closeCrop} onConfirm={async blob => { if (blocked) return; const data = new FormData(); data.append('file',blob,'profile.jpg'); if (!crop.photo) data.append('position',String(crop.position)); const attempted = await run(async signal => { await controller.request(crop.photo ? `/me/profile/photos/${encodeURIComponent(crop.photo.id)}/file` : '/me/profile/photos',signal,crop.photo ? 'PUT' : 'POST',data); }); if (!attempted) throw new Error('Hay una operación en curso. Volvé a intentar.'); if (owner.current && !owner.current.abort.signal.aborted) closeCrop(); }}/ >}
  </div>;
}

function FormSection({ management, title, children }: { management: boolean; title: string; children: React.ReactNode }) {
  return management ? <section aria-label={title}><h3>{title}</h3>{children}</section> : <details><summary>{title}</summary>{children}</details>;
}
