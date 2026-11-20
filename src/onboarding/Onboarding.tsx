import { MyProfilePreview } from '../profile/MyProfilePreview';
import { useCallback, useId, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '../auth/api';
import { errorCode, terminalCodes, verificationErrorMessage, verificationRateLimited } from '../auth/errors';
import { resendVerificationCooldownMs } from '../auth/session';
import type { SessionController } from '../auth/session';
import { countries, fullProfile, hasInteractions, legal, photos } from './contracts';
import type { Country, Fields, FullProfile, LegalDocument, Photo } from './contracts';
import { ProfileForm } from './ProfileForm';
import { CropDialog } from './CropDialog';
import { PhotoGrid } from './PhotoGrid';
import { photoPlacements } from './photoReorder';
import { photoFileError } from './photoFiles';
import './onboarding.css';
import { SessionLoading } from '../SessionLoading';
import { parseQueue } from '../home/contracts';
import type { Home as HomeComponent } from '../home/Home';
import { AccountSection } from '../home/AccountSection';
import { useHomeNavigation } from '../home/useHomeNavigation';
import type { HomeNavigation } from '../home/useHomeNavigation';
import { ProfileQuestions, isProfileQuestions } from '../profile/questions/ProfileQuestions';
import { useProfileQuestions } from '../profile/questions/useProfileQuestions';

const photoRequirements = {
  PROFILE_PHOTOS_REQUIRED: ['photos', 'foto validada', 'fotos validadas'],
  PROFILE_PERSON_PHOTO_REQUIRED: ['person photos', 'foto validada donde se te vea con claridad', 'fotos validadas donde se te vea con claridad'],
  PROFILE_FULL_BODY_PHOTO_REQUIRED: ['full-body photos', 'foto validada de cuerpo completo', 'fotos validadas de cuerpo completo'],
} as const;

export function onboardingError(error: unknown, activation = false) {
  if (error instanceof ApiError && error.kind === 'backend' && error.status === 409) {
    const requirement = Object.entries(photoRequirements).find(([code]) => code === error.code)?.[1];
    const detail = error.detail.message;
    if (requirement && detail) {
      const [suffix, singular, plural] = requirement;
      const match = /^Profile must have at least ([1-9][0-9]*) validated (photos|person photos|full-body photos)$/.exec(detail);
      const count = Number(match?.[1]);
      if (match?.[0] === detail && match?.[2] === suffix && Number.isSafeInteger(count)) {
        return `Necesitás al menos ${count} ${count === 1 ? singular : plural}.`;
      }
    }
  }
  const messages: Record<string,string> = {
    EMAIL_NOT_VERIFIED: activation ? 'Verificá tu email antes de activar el perfil.' : 'Verificá tu email antes de subir fotos o activar el perfil.',
    PROFILE_PHOTOS_REQUIRED: 'Necesitás más fotos validadas para activar el perfil.',
    PROFILE_PERSON_PHOTO_REQUIRED: 'Necesitás más fotos validadas donde se te vea con claridad.',
    PROFILE_FULL_BODY_PHOTO_REQUIRED: 'Necesitás más fotos validadas de cuerpo completo.',
    PROFILE_PHOTO_MODERATION_NOT_APPROVED: 'Hay fotos pendientes de aprobación o rechazadas. Revisá sus estados.',
    PROFILE_AUTHENTICITY_VERIFICATION_REQUIRED: 'Se requiere verificar la autenticidad de tu perfil antes de activarlo.',
    PROFILE_NOT_ACTIVATABLE: 'El perfil no se puede activar en su estado actual. Actualizá el estado.',
    LEGAL_ACTION_REQUIRED: 'Revisá los documentos legales vigentes antes de continuar.',
    INVALID_PROFILE_PHOTO: 'La foto no es válida. Usá JPEG o PNG y revisá el tamaño del archivo.',
    PROFILE_PHOTO_REJECTED: 'La foto fue rechazada. Elegí otra foto que cumpla las normas de la comunidad.',
    PHOTO_POSITION_OCCUPIED: 'La posición de la foto cambió. Actualizá el estado antes de reordenar.',
  };
  if (!(error instanceof ApiError)) return 'No pudimos completar la operación. Consultá el estado y volvé a intentar.';
  if (Object.hasOwn(messages, error.code)) return messages[error.code]!;
  if (!activation && error.status === 400 && error.kind === 'invalid') return 'El servidor rechazó los datos. Revisá los campos y usá texto simple, sin etiquetas HTML.';
  if (error.kind === 'invalid') return 'La respuesta del servidor no es válida. Consultá el estado antes de continuar.';
  if (error.kind === 'network') return 'No pudimos confirmar el resultado. Revisá tu conexión y actualizá el estado.';
  if (activation) return 'No pudimos activar tu perfil. Consultá el estado y volvé a intentar.';
  return `No se pudo completar la operación${error.code ? ` (${error.code})` : ''}. Revisá los datos y actualizá el estado.`;
}
interface Model { profile: FullProfile | null; photos: Photo[]; legal: { satisfied: boolean; documents: LegalDocument[] }; interactions: boolean | null }
export function Onboarding({ Home, active = true, controller, management, navigation: providedNavigation, onBack, onNavigationBlockedChange, onAccountAvailableChange, onAdminNavigationBlockedChange }: { Home: typeof HomeComponent; active?: boolean; onAdminNavigationBlockedChange?: ((blocked: boolean) => void) | undefined; controller: SessionController; management?: 'details' | 'filters'; navigation?: HomeNavigation; onAccountAvailableChange?: (available: boolean) => void; onBack?: () => void; onNavigationBlockedChange?: (blocked: boolean) => void }) {
  const [model, setModel] = useState<Model | null>(null), [catalog, setCatalog] = useState<Country[]>([]), [countryError,setCountryError] = useState('');
  const previousProfile = useRef<string | null | undefined>(undefined);
  useLayoutEffect(() => {
    const id = model?.profile?.id;
    if (!management && previousProfile.current === null && id) window.scrollTo(0, 0);
    if (model) previousProfile.current = id ?? null;
  }, [model, management]);
  const [busy, setBusy] = useState(true), [blocked,setBlocked] = useState(true);
  const [error, setError] = useState<{ message: string; activation: boolean } | null>(null);
  const activationErrorId = useId();
  const [savingProfile, setSavingProfile] = useState<'create' | 'details' | 'filters' | null>(null);
  const [feedback, setFeedback] = useState<{ message: string; profileMode: 'create' | 'details' | 'filters' | null }>({ message: '', profileMode: null });
  const { message, profileMode: feedbackProfile } = feedback;
  const setMessage = (message: string) => setFeedback({ message, profileMode: null });
  const [verified,setVerified] = useState(controller.emailVerified), [success,setSuccess] = useState(false);
  const [crop,setCrop] = useState<{ file: File; photo: Photo | undefined; position: number } | null>(null);
  const cropOwned = useRef(false);
  const [photoError,setPhotoError] = useState('');
  const closeCrop = () => { cropOwned.current = false; setCrop(null); };
  const [sendAt,setSendAt] = useState(() => controller.snapshot.verificationDeliveryError?.resendAt ?? 0), [checkAt,setCheckAt] = useState(0), [now,setNow] = useState(Date.now());
  const [verificationFeedback, setVerificationFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const owner = useRef<{ abort: AbortController; locked: boolean; background: boolean; operation: AbortController | null; creationNeedsCheck: boolean; activationNeedsCheck: boolean } | null>(null);
  const accountLocked = useRef(false);
  const [dirtyForms, setDirtyForms] = useState({ create: false, details: false, filters: false });
  const formDirty = Object.values(dirtyForms).some(Boolean);
  const reportFormDirty = useMemo(() => {
    const report = (mode: 'create' | 'details' | 'filters') => (dirty: boolean) => setDirtyForms(current => current[mode] === dirty ? current : { ...current, [mode]: dirty });
    return { create: report('create'), details: report('details'), filters: report('filters') };
  }, []);
  useLayoutEffect(() => { onAdminNavigationBlockedChange?.(formDirty); return () => onAdminNavigationBlockedChange?.(false); }, [formDirty, onAdminNavigationBlockedChange]);
  const [accountBusy, setAccountBusy] = useState(false);
  const nestedHomeLock = useRef(false);
  const [nestedHomeBlocked, setNestedHomeBlocked] = useState(false), [nestedManagement, setNestedManagement] = useState(false);
  const reportNestedHomeLock = useCallback((value: boolean) => { nestedHomeLock.current = value; setNestedHomeBlocked(value); onNavigationBlockedChange?.(value || (!!owner.current?.locked && !owner.current.background) || cropOwned.current || accountLocked.current); }, [onNavigationBlockedChange]);
  const setupNavigationEnabled = !management && model?.profile?.status !== 'ACTIVE';
  const setupNavigation = useHomeNavigation(() => (!owner.current?.locked || owner.current.background) && !cropOwned.current && !accountLocked.current && !nestedHomeLock.current, setupNavigationEnabled && !providedNavigation);
  const navigation = providedNavigation ?? setupNavigation;
  const previewActive = navigation.destination === 'my-profile-preview';
  const previewEntry = useRef<HTMLButtonElement>(null), previewScroll = useRef(0), wasPreview = useRef(false);
  useLayoutEffect(() => {
    if (wasPreview.current && !previewActive) { previewEntry.current?.focus({ preventScroll: true }); window.scrollTo(0, previewScroll.current); }
    wasPreview.current = previewActive;
  }, [previewActive]);
  const questionsActive = isProfileQuestions(navigation.destination);
  const questions = useProfileQuestions(controller, active && questionsActive);
  useLayoutEffect(() => {
    if (questionsActive) setMessage('');
    if (questionsActive && !questions.identity) navigation.backTo(management ? 'profile' : 'home');
  }, [questionsActive, questions.identity, management, navigation]);
  const questionsEntry = useRef<HTMLButtonElement>(null), parentScroll = useRef(0), wasQuestions = useRef(false);
  useLayoutEffect(() => {
    if (wasQuestions.current && !questionsActive) {
      questionsEntry.current?.focus({ preventScroll: true });
      window.scrollTo(0, parentScroll.current);
    }
    wasQuestions.current = questionsActive;
  }, [questionsActive]);
  const openQuestions = () => {
    if (!owner.current || (owner.current.locked && !owner.current.background) || cropOwned.current || accountLocked.current || nestedHomeLock.current || nestedManagement || busy || blocked || !model?.legal.satisfied || !['DRAFT', 'ACTIVE'].includes(model.profile?.status ?? '')) return;
    parentScroll.current = window.scrollY;
    navigation.open('profile-questions');
  };
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
    if (management && parseQueue(await controller.request('/matchmaking/queue', signal), account.id)) { signal.throwIfAborted(); onNavigationBlockedChange?.(false); onBack?.(); throw new DOMException('Búsqueda activa', 'AbortError'); }
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
    controller.installProfile(profile);
    setModel(result); setVerified(controller.emailVerified);
    return result;
  };
  const run = async (task?: (signal: AbortSignal) => Promise<void>, activation = false, background = false, profileMode?: 'create' | 'details' | 'filters') => {
    const resource = owner.current;
    if (!resource || resource.abort.signal.aborted || accountLocked.current) return false;
    if (resource.locked) {
      if (background || !resource.background) return false;
      resource.operation?.abort();
    }
    const operation = new AbortController();
    resource.operation = operation; resource.locked = true; resource.background = background;
    if (!background) { onNavigationBlockedChange?.(true); setBusy(true); setSavingProfile(profileMode ?? null); setError(null); setMessage(''); setPhotoError(''); }
    const signal = AbortSignal.any([resource.abort.signal, operation.signal]);
    let failure: unknown;
    try { if (task) await task(signal); }
    catch (e) { failure = e; }
    try {
      signal.throwIfAborted();
      const result = await reconcile(signal);
      signal.throwIfAborted();
      const activated = result.profile?.status === 'ACTIVE';
      if (!failure && ((profileMode === 'create' && !result.profile) || (activation && !activated))) failure = new ApiError('invalid');
      const uncertain = failure instanceof ApiError && (failure.kind === 'network' || failure.kind === 'invalid' || (activation && failure.status >= 500));
      // A background 404 can arrive while a disconnected POST is still finishing.
      // Only a foreground check or a confirmed profile releases the creation gate.
      if (result.profile || !background) resource.creationNeedsCheck = false;
      if (profileMode === 'create' && !result.profile && (uncertain || errorCode(failure) === 'PROFILE_ALREADY_EXISTS')) resource.creationNeedsCheck = true;
      if (activated || !background) resource.activationNeedsCheck = false;
      if (activation && !activated && uncertain) resource.activationNeedsCheck = true;
      setBlocked(resource.creationNeedsCheck || resource.activationNeedsCheck || (uncertain && profileMode !== 'create' && !activation));
      if (activated && !management) setError(current => current?.activation ? null : current);
      if (management && task && !failure && !signal.aborted) setFeedback({ message: 'Cambios guardados.', profileMode: profileMode ?? null });
      if (activation && !failure && activated) setSuccess(true);
      if (failure && (profileMode !== 'create' || !result.profile) && (!activation || !activated)) {
        setError({ message: onboardingError(failure, activation), activation });
      }
    } catch (e) {
      if (!signal.aborted) {
        if (profileMode === 'create') resource.creationNeedsCheck = true;
        if (activation) resource.activationNeedsCheck = true;
        const activationFeedback = resource.activationNeedsCheck;
        setBlocked(true); setError({ message: onboardingError(failure ?? e, activationFeedback), activation: activationFeedback });
      }
    }
    finally { if (owner.current === resource && !signal.aborted) { if (resource.operation === operation) { resource.locked = false; resource.background = false; resource.operation = null; setBusy(false); setSavingProfile(null); } } }
    return true;
  };
  const foreground = useRef(active); foreground.current = active;
  const wasActive = useRef(active);
  useLayoutEffect(() => {
    if (active && !wasActive.current) { setBlocked(true); void run(); }
    wasActive.current = active;
  }, [active]);
  useEffect(() => {
    const resource = { abort: new AbortController(), locked: false, background: false, operation: null as AbortController | null, creationNeedsCheck: false, activationNeedsCheck: false }; owner.current = resource;
    queueMicrotask(() => { if (!resource.abort.signal.aborted) { void loadCountries(resource.abort.signal); void run(); } });
    const resume = () => { if (foreground.current && document.visibilityState === 'visible') void run(undefined, false, true); };
    document.addEventListener('visibilitychange',resume);
    return () => { resource.abort.abort(); document.removeEventListener('visibilitychange',resume); if (owner.current === resource) owner.current = null; };
    // Controller identity owns this component for its entire mounted lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [controller]);
  useEffect(() => { if (sendAt <= Date.now() && checkAt <= Date.now()) return; const timer = window.setInterval(() => setNow(Date.now()),1000); return () => clearInterval(timer); },[sendAt,checkAt]);
  const verifyEmail = (send: boolean) => {
    if (busy || blocked || accountBusy || Date.now() < (send ? sendAt : checkAt)) return;
    void run(async signal => {
      setVerificationFeedback(null);
      let value: boolean;
      try {
        value = await controller.verifyEmail(send, signal);
        signal.throwIfAborted();
      } catch (failure) {
        if (signal.aborted || (failure instanceof DOMException && failure.name === 'AbortError')) return;
        if (verificationRateLimited(failure)) {
          const at = Date.now();
          setNow(at);
          if (send) setSendAt(at + resendVerificationCooldownMs);
          else setCheckAt(at + 10_000);
        }
        setVerificationFeedback({ message: verificationErrorMessage(failure, send), error: true });
        return;
      }
      const at = Date.now();
      setNow(at);
      if (send) {
        setSendAt(at + resendVerificationCooldownMs);
        setVerificationFeedback({ message: 'Te enviamos un nuevo correo de verificación.', error: false });
      } else {
        setVerified(value);
        setCheckAt(at + 10_000);
        if (value) setMessage('Email verificado.');
        else setVerificationFeedback({ message: 'Todavía no vemos el email verificado. Abrí el link del correo y volvé a intentar.', error: false });
      }
    });
  };
  const writeProfile = (fields: Fields, mode: 'create' | 'details' | 'filters') => {
    if (blocked || (mode === 'create' && owner.current?.creationNeedsCheck)) return;
    void run(async signal => {
      const body = mode === 'create' ? fields : mode === 'details' ? { displayName: fields.displayName, city: fields.city, countryCode: fields.countryCode, bio: fields.bio } : { intention: fields.intention, lookingForGenders: fields.lookingForGenders, preferredMinAge: fields.preferredMinAge, preferredMaxAge: fields.preferredMaxAge, maxDistanceKm: fields.maxDistanceKm };
      const raw = await controller.request(mode === 'filters' ? '/me/profile/match-filters' : '/me/profile',signal,mode === 'create' ? 'POST' : mode === 'details' ? 'PATCH' : 'PUT',body);
      const result = fullProfile(raw,controller.snapshot.account?.id ?? '');
      if (mode === 'create' && result.status !== 'DRAFT') throw new ApiError('invalid');
    }, false, false, mode);
  };
  const mutatePhoto = (path: string, method: string, body?: unknown) => { if (!blocked) void run(async signal => { await controller.request(`/me/profile/photos${path}`,signal,method,body); }); };
  const reorderPhoto = (photoId: string, target: number) => {
    const resource = owner.current;
    if (!resource || resource.abort.signal.aborted || (resource.locked && !resource.background) || accountLocked.current || busy || blocked || cropOwned.current || controller.snapshot.phase !== 'ready' || controller.snapshot.profile?.id !== model?.profile?.id) return;
    const placements = photoPlacements(model?.photos ?? [],photoId,target);
    if (placements) mutatePhoto('/reorder','PUT',{ placements });
  };
  const selectFiles = (files: File[], position: number, photo?: Photo) => {
    const resource = owner.current;
    if (!resource || resource.abort.signal.aborted || (resource.locked && !resource.background) || accountLocked.current || busy || blocked || !verified || !controller.emailVerified || cropOwned.current || controller.snapshot.phase !== 'ready' || controller.snapshot.profile?.id !== model?.profile?.id) return;
    if (files.length !== 1) { setPhotoError('Elegí o soltá una sola foto JPEG o PNG por vez. No se admiten carpetas.'); return; }
    const file = files[0];
    if (!file) return;
    const invalid = photoFileError(file);
    if (invalid) { setPhotoError(invalid); return; }
    setPhotoError(''); cropOwned.current = true; setCrop({ file,position,photo });
  };
  const list = model?.photos ?? [];
  const disabled = busy || blocked || accountBusy;
  const activationDisabled = disabled || !!crop || !verified || nestedHomeBlocked || nestedManagement;
  const activate = () => {
    if (activationDisabled || cropOwned.current || nestedHomeLock.current || owner.current?.activationNeedsCheck) return;
    void run(async signal => {
      const emailVerified = await controller.verifyEmail(false, signal);
      signal.throwIfAborted();
      if (!emailVerified) throw new ApiError('backend', 409, 'EMAIL_NOT_VERIFIED');
      const result = fullProfile(await controller.request('/me/profile/activation', signal, 'POST'), controller.snapshot.account?.id ?? '');
      if (result.status !== 'ACTIVE' || result.id !== model?.profile?.id) throw new ApiError('invalid');
    }, true);
  };
  const uploadGuidance = blocked ? 'No pudimos confirmar el estado. Revisá el error y usá «Consultar estado» antes de subir fotos.'
    : !verified ? 'Verificá tu email antes de subir fotos. Usá «Reenviar correo» y «Ya verifiqué» en la sección anterior.'
    : crop ? 'Terminá o cancelá el recorte actual antes de elegir otra foto.'
    : 'Elegí o arrastrá una sola foto JPEG o PNG de hasta 15 MB. Podés recortarla antes de subirla.';
  useEffect(() => { onNavigationBlockedChange?.(active && (busy || !!crop || accountBusy || nestedHomeBlocked)); }, [active, busy, crop, accountBusy, nestedHomeBlocked, onNavigationBlockedChange]);
  const accountAvailable = !management && !!model && model.profile?.status !== 'ACTIVE';
  useLayoutEffect(() => { onAccountAvailableChange?.(accountAvailable); return () => onAccountAvailableChange?.(false); }, [accountAvailable, onAccountAvailableChange]);
  const creating = !!model?.legal.satisfied && !model.profile;
  const initialDeliveryError = !verified ? controller.snapshot.verificationDeliveryError?.message : undefined;
  const activationInline = !!error?.activation && !management && model?.legal.satisfied && !!model.profile && model.profile.status !== 'ACTIVE';
  const errorAlert = error && <p id={activationInline ? activationErrorId : undefined} role="alert">{error.message}</p>;
  const checkStatus = (error || blocked) && !busy && <button type="button" aria-describedby={activationInline ? activationErrorId : undefined} disabled={!!crop || ((creating || activationInline) && accountBusy) || (activationInline && (nestedHomeBlocked || nestedManagement))} onClick={() => void run()}>Consultar estado</button>;
  const questionsSection = management !== 'filters' && ['DRAFT', 'ACTIVE'].includes(model?.profile?.status ?? '') && <section className="home-card profile-question-entry"><h3>Preguntas del perfil</h3><p>Son opcionales y públicas. Podés responder varias y elegir hasta tres para mostrar en tu perfil.</p><button ref={questionsEntry} type="button" className="login-button login-primary" disabled={disabled || !!crop || nestedHomeBlocked || nestedManagement} onClick={openQuestions}>Responder o editar</button></section>;
  if (!model && busy && !management) return <SessionLoading />;
  return <><div className="onboarding" hidden={questionsActive || previewActive} aria-busy={busy}>
    {management && <header className="home-heading"><h2>{management === 'details' ? 'Tu perfil' : 'Preferencias'}</h2><button type="button" className="login-button login-outlined" disabled={busy || !!crop} onClick={onBack}>Volver a Inicio</button></header>}
    {management && !model && busy && <><p className="home-loading-status" role="status">Cargando {management === 'details' ? 'perfil' : 'preferencias'}…</p><div className="home-placeholder management-placeholder" aria-hidden="true"><div className="home-card">{Array.from({ length: 4 }, (_, i) => <div className="placeholder-field" key={i}><span/><span/></div>)}</div>{management === 'details' && <div className="home-card home-placeholder-search"><span/><span/><span/></div>}</div></> }
    {!creating && !activationInline && errorAlert}{message && !feedbackProfile && <p role="status">{message}</p>}
    {busy && (!management || !!model) && <p className="home-loading-status" role="status">Actualizando estado…</p>}
    {!creating && !activationInline && checkStatus}
    {model && !model.legal.satisfied ? <><h2>Antes de continuar</h2><p>Revisá los documentos vigentes. Algunas acciones de participación requieren que completes la acción indicada.</p>
      {model.legal.documents.map(doc => <article key={doc.type}><h3>{({ TERMS_OF_USE: 'Términos de uso', PRIVACY_NOTICE: 'Aviso de privacidad', COMMUNITY_GUIDELINES: 'Normas de la comunidad' } as Record<string,string>)[doc.type] ?? doc.type}</h3><p>Versión {doc.version} · {doc.requiredAction} · {doc.satisfied ? 'Completado' : 'Pendiente'}</p><a href={doc.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Ver documento</a>{!doc.satisfied && <button disabled={disabled} onClick={() => void run(async signal => { await controller.request('/me/legal-document-actions',signal,'POST',{ documentType: doc.type, documentVersion: doc.version, action: doc.requiredAction }); })}>{doc.requiredAction === 'ACCEPTED' ? 'Aceptar' : 'Confirmar lectura'}</button>}</article>)}
    </> : model && success && model.profile?.status === 'ACTIVE' ? <><h2>Tu perfil está activo</h2><p>Ya podés entrar a Inicio y buscar un chat cuando quieras.</p><p>Tus fotos quedaron guardadas. Si más adelante las cambiás, puede que revisemos tu perfil otra vez.</p><button onClick={() => setSuccess(false)}>Ir a Inicio</button></> : model && !model.profile ? <>
      <h2>Crear perfil</h2><p>Completá tus datos principales. Después vas a poder sumar fotos y activar tu perfil.</p>
      {initialDeliveryError && <p role="alert">{initialDeliveryError} Podés crear tu perfil y pedir otro correo desde la sección de verificación.</p>}
      <ProfileForm onDirtyChange={reportFormDirty.create} catalog={catalog} countryError={countryError} retryCountries={() => { const r = owner.current; if (r) void loadCountries(r.abort.signal); }} busy={disabled} saving={savingProfile === 'create'} submit={writeProfile} creationFeedback={<>{errorAlert}{checkStatus}</>} />
    </> : model?.profile ? <>
      {!management && <><h2>Completá tu perfil</h2><p>{model.profile.status === 'DRAFT' ? 'Tu perfil está en borrador' : 'Tu perfil está inactivo'}</p></>}
      {management && model.profile.status !== 'ACTIVE' && <p>Estado: {model.profile.status}</p>}
      {model.interactions === true && <aside><h3>Inicio: interacciones vigentes</h3><p>Tenés interacciones en curso. Podés consultarlas y continuarlas desde Actividad.</p></aside>}
      {model.interactions === true && <Home delegateProfileQuestions controller={controller} navigation={setupNavigationEnabled ? navigation : undefined} onNavigationBlockedChange={reportNestedHomeLock} onManagementActiveChange={setNestedManagement} />}
      {model.interactions === null && <aside><h3>Inicio no disponible</h3><p>No pudimos consultar tus interacciones. Su estado es desconocido. Podés seguir completando el perfil o reintentar la consulta de Inicio.</p><button disabled={disabled || !!crop} onClick={() => void run()}>Reintentar Inicio</button></aside>}
      {!verified && <section id="email-verification" aria-label="Verificá tu email" tabIndex={-1}>
        <h3>Verificá tu email</h3>
        <p>Abrí el link del correo de verificación y volvé para continuar.</p>
        <button type="button" disabled={disabled || sendAt > now} onClick={() => verifyEmail(true)}>Reenviar correo{sendAt > now ? ` (${Math.ceil((sendAt-now)/1000)} s)` : ''}</button>
        <button type="button" disabled={disabled || checkAt > now} onClick={() => verifyEmail(false)}>Ya verifiqué</button>
        {verificationFeedback ? <p role={verificationFeedback.error ? 'alert' : 'status'}>{verificationFeedback.message}</p> : initialDeliveryError && <p role="alert">{initialDeliveryError}</p>}
      </section>}
      {(['details','filters'] as const).filter(mode => management === mode).map(mode => <FormSection key={mode} management={!!management} title={mode === 'details' ? 'Datos del perfil' : 'Preferencias de búsqueda'}><ProfileForm saving={savingProfile === mode} saved={feedbackProfile === mode} onDirtyChange={reportFormDirty[mode]} key={`${model.profile!.id}-${mode}`} profile={model.profile!} catalog={catalog} countryError={countryError} retryCountries={() => { const r = owner.current; if (r) void loadCountries(r.abort.signal); }} busy={disabled || !!crop} mode={mode} submit={writeProfile}/></FormSection>)}
      {management && questionsSection}
      {management !== 'filters' && <PhotoSection>{management && <p>Hasta nueve fotos. Los cambios pueden requerir una nueva revisión del perfil. Revisá los estados de validación y moderación de cada foto.</p>}
        <p id="photo-upload-guidance" role="status">{uploadGuidance}</p>
        {!verified && <p><a href="#email-verification">Ir a la verificación de email</a></p>}
        {photoError && <p role="alert">{photoError}</p>}
        <PhotoGrid photos={list} disabled={disabled || !!crop} uploadsDisabled={disabled || !verified || !!crop} onSelect={selectFiles} onMove={reorderPhoto}
          onDelete={photo => { if (window.confirm('¿Eliminar esta foto?')) mutatePhoto(`/${encodeURIComponent(photo.id)}`,'DELETE'); }}/>
      </PhotoSection>}

      {!management && questionsSection}
      {(['details','filters'] as const).filter(() => !management).map(mode => <FormSection key={mode} management={!!management} title={mode === 'details' ? 'Datos del perfil' : 'Preferencias de búsqueda'}><ProfileForm saving={savingProfile === mode} saved={feedbackProfile === mode} onDirtyChange={reportFormDirty[mode]} key={`${model.profile!.id}-${mode}`} profile={model.profile!} catalog={catalog} countryError={countryError} retryCountries={() => { const r = owner.current; if (r) void loadCountries(r.abort.signal); }} busy={disabled || !!crop} mode={mode} submit={writeProfile}/></FormSection>)}
      {management !== 'filters' && ['DRAFT', 'ACTIVE'].includes(model.profile.status) && <section className="home-card profile-question-entry"><button ref={previewEntry} type="button" className="login-button login-outlined" disabled={disabled || !!crop || nestedHomeBlocked || nestedManagement} onClick={() => { previewScroll.current = window.scrollY; navigation.open('my-profile-preview'); }}>Vista previa de mi perfil</button><p>{management ? 'Así se ven tus datos públicos confirmados. Los cambios sin guardar no se muestran.' : 'La vista previa es privada. Solo muestra los datos guardados y no activa ni publica tu perfil.'}</p></section>}
      {!management && <section aria-label="Activación del perfil">
        {!verified && <p id="activation-email-guidance">Verificá tu email y presioná «Ya verifiqué» antes de activar el perfil.</p>}
        {activationInline && errorAlert}
        {activationInline && checkStatus}
        <button type="button" className="profile-submit" aria-describedby={[!verified && 'activation-email-guidance', activationInline && activationErrorId].filter(Boolean).join(' ') || undefined} disabled={activationDisabled} onClick={activate}>Activar perfil</button>
      </section>}
    </> : null}
    {!management && model && model.profile?.status !== 'ACTIVE' && <AccountSection controller={controller} disabled={busy || !!crop} setup onNavigationBlockedChange={value => { accountLocked.current = value; setAccountBusy(value); onNavigationBlockedChange?.(value || (!!owner.current?.locked && !owner.current.background) || cropOwned.current || nestedHomeLock.current); }} />}
    {crop && <CropDialog file={crop.file} onCancel={closeCrop} onConfirm={async blob => { if (blocked) return; const data = new FormData(); data.append('file',blob,'profile.jpg'); if (!crop.photo) data.append('position',String(crop.position)); const attempted = await run(async signal => { await controller.request(crop.photo ? `/me/profile/photos/${encodeURIComponent(crop.photo.id)}/file` : '/me/profile/photos',signal,crop.photo ? 'PUT' : 'POST',data); }); if (!attempted) throw new Error('Hay una operación en curso. Volvé a intentar.'); if (owner.current && !owner.current.abort.signal.aborted) closeCrop(); }}/ >}
  </div>{previewActive && active && <MyProfilePreview controller={controller} onBack={() => navigation.backTo(management ? 'profile' : 'home')}/>}<ProfileQuestions model={questions} navigation={navigation} onReturn={() => navigation.backTo(management ? 'profile' : 'home')}/></>;
}

function FormSection({ management, title, children }: { management: boolean; title: string; children: React.ReactNode }) {
  return management ? <section aria-label={title}><h3>{title}</h3>{children}</section> : <details><summary>{title}</summary>{children}</details>;
}

function PhotoSection({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(true);
  const id = useId();
  return <section className="photo-section">
    <h3><button type="button" className="photo-section-toggle" aria-expanded={expanded} aria-controls={id} onClick={() => setExpanded(value => !value)}><span>Fotos</span><span className="photo-section-chevron" aria-hidden="true">⌄</span></button></h3>
    <div id={id} className="photo-section-expansion" data-expanded={expanded} inert={!expanded}><div className="photo-section-content">{children}</div></div>
  </section>;
}
