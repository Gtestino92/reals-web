import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ApiError } from '../auth/api';
import type { SessionController } from '../auth/session';
import { contactStatus, importResult, ownerPath, type ContactStatus } from './contracts';
import { ProviderError, providers, syntheticContacts, type Providers, type PickContacts, type ContactRow } from './providers';
import { ContactHeader, ContactSkeleton } from './ContactLoading';
import { Selection } from './Selection';
import './contacts.css';

const changed = 'El estado de tus contactos cambió. Revisalo y volvé a elegir si querés continuar.';
function writeError(error: unknown) {
  const code = error instanceof ApiError ? error.code : '';
  switch (code) {
    case 'CONTACT_MUTATION_STALE': case 'CONTACT_REVISION_REQUIRED': return changed;
    case 'CONTACT_CONSENT_REQUIRED': return 'Revisá y aceptá la versión vigente del consentimiento.';
    case 'CONTACT_IMPORT_DISABLED': return 'La importación está deshabilitada temporalmente.';
    case 'CONTACT_REPLACEMENT_LIMIT': return 'Alcanzaste el máximo de reemplazos en 24 horas. Probá más tarde.';
    case 'INVALID_CONTACT_SELECTION': return 'Revisá el país y excluí los teléfonos con formato inválido antes de volver a confirmar.';
    case 'CONTACT_INPUT_LIMIT': case 'CONTACT_BODY_LIMIT': case 'CONTACT_SET_LIMIT': return 'La selección supera el límite. Elegí menos números.';
    case 'LEGAL_ACTION_REQUIRED': return 'Revisá los documentos vigentes para continuar.';
    default: return 'No pudimos confirmar el resultado. Consultá el estado actualizado antes de decidir si querés repetir la acción.';
  }
}
interface Intent { revision: string; rows: ContactRow[] }
export default function Contacts({ controller, onBack, sources = providers }: {
  controller: SessionController; onBack: () => void; sources?: Providers;
}) {
  const [status, setStatus] = useState<ContactStatus | null>(null);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [phase, setPhase] = useState<'idle' | 'provider' | 'writing'>('idle');
  const [stale, setStale] = useState(false);
  const [notice, setNotice] = useState('');
  const [picker, setPicker] = useState<PickContacts | null>(null);
  const [google, setGoogle] = useState<PickContacts | null>(null);
  const [probeFailed, setProbeFailed] = useState(false);
  const [probing, setProbing] = useState(!!sources.picker);
  const root = useRef<HTMLElement>(null);
  const [mutation, setMutation] = useState('');
  const lifetime = useRef<AbortSignal | null>(null);
  const read = useRef<AbortController | null>(null);
  const operation = useRef<AbortController | null>(null);
  const writing = useRef(false);
  const revision = useRef('');
  const installedRevision = useRef('');
  function install(next: ContactStatus | null) {
    installedRevision.current = next?.mutationRevision ?? '';
    setStatus(next);
  }
  function release() {
    operation.current?.abort(); operation.current = null;
    setMutation(''); writing.current = false; revision.current = '';
    setIntent(null); setPhase('idle');
  }
  async function refresh(message?: string) {
    if (!lifetime.current || lifetime.current.aborted || writing.current) return;
    read.current?.abort();
    const request = new AbortController();
    read.current = request;
    const signal = AbortSignal.any([request.signal, lifetime.current]);
    const timeout = !installedRevision.current ? window.setTimeout(() => {
      if (!signal.aborted) {
        request.abort(); setStale(true); setNotice('La consulta está demorando. Reintentá la consulta.');
      }
    }, 20000) : undefined;
    try {
      const next = contactStatus(await controller.request(ownerPath, signal));
      signal.throwIfAborted();
      if (revision.current && (next.mutationRevision !== revision.current || !next.importAvailable || next.requiredConsentVersion !== next.acceptedConsentVersion)) {
        release(); setNotice(changed);
      } else if (message !== undefined) setNotice(message);
      else if (installedRevision.current && next.mutationRevision !== installedRevision.current) setNotice(changed);
      setStale(false); install(next);
    } catch (error) {
      if (!signal.aborted) {
        if (error instanceof ApiError && (error.kind === 'authorization' || error.kind === 'invalid')) {
          release(); install(null);
        }
        setStale(true); setNotice([message, 'No pudimos consultar el estado. Reintentá la consulta.'].filter(Boolean).join(' '));
      }
    } finally { window.clearTimeout(timeout); }
  }
  useLayoutEffect(() => {
    root.current?.querySelector('h2')?.focus({ preventScroll: true });
    const owner = new AbortController();
    const session = controller.sessionSignal;
    const signal = AbortSignal.any([owner.signal, session]);
    lifetime.current = signal;
    const reset = () => { read.current?.abort(); release(); install(null); setNotice(''); setGoogle(null); };
    const resume = () => { if (document.visibilityState === 'visible') void refresh(); };
    signal.addEventListener('abort', reset, { once: true });
    window.addEventListener('pagehide', reset); window.addEventListener('pageshow', resume);
    document.addEventListener('visibilitychange', resume);
    void refresh();
    return () => {
      owner.abort(); window.removeEventListener('pagehide', reset); window.removeEventListener('pageshow', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [controller]);
  const available = !!status?.importAvailable;
  useEffect(() => {
    if (!available || !sources.picker) { setPicker(null); setProbing(!!sources.picker); return; }
    let live = true;
    setProbeFailed(false); setProbing(true);
    const fail = () => { if (live) { setPicker(null); setProbeFailed(true); setProbing(false); live = false; } };
    const timeout = window.setTimeout(fail, 10000);
    Promise.resolve().then(() => sources.picker?.()).then(result => {
      if (live) { setPicker(() => result ?? null); setProbing(false); }
    }, fail).finally(() => window.clearTimeout(timeout));
    return () => { live = false; window.clearTimeout(timeout); };
  }, [available, sources]);
  function begin(next: 'writing' | 'provider') {
    if (!lifetime.current || lifetime.current.aborted || operation.current) return null;
    read.current?.abort();
    const task = new AbortController();
    operation.current = task; writing.current = next === 'writing';
    setPhase(next); setNotice('');
    return AbortSignal.any([lifetime.current, task.signal]);
  }
  async function pick(source: PickContacts) {
    if (!status || !available || status.acceptedConsentVersion !== status.requiredConsentVersion) return;
    const signal = begin('provider');
    if (!signal) return;
    revision.current = status.mutationRevision;
    try {
      const rows = await source(signal);
      signal.throwIfAborted();
      if (rows.length) setIntent({ rows, revision: status.mutationRevision });
      else { revision.current = ''; setNotice('No se eligieron teléfonos. Tu selección anterior sigue vigente.'); }
    } catch (e) {
      if (!signal.aborted) {
        revision.current = '';
        const cancelled = e instanceof DOMException && e.name === 'AbortError';
        const denied = e instanceof DOMException && (e.name === 'SecurityError' || e.name === 'NotAllowedError');
        setNotice(e instanceof ProviderError ? e.message : cancelled ? 'Cancelaste la selección.' : denied ?
          'El navegador no permitió el acceso a tus contactos.' : 'No se completó la selección. Podés volver a abrir el proveedor.');
      }
    } finally { if (!signal.aborted) { operation.current = null; setPhase('idle'); } }
  }
  async function loadGoogle() {
    if (!sources.google || !status) return;
    const signal = begin('provider');
    if (!signal) return;
    revision.current = status.mutationRevision;
    try {
      const select = await sources.google();
      signal.throwIfAborted(); setGoogle(() => select);
    } catch { if (!signal.aborted) setNotice('No se pudo cargar Google. Volvé a intentarlo.'); }
    finally { if (!signal.aborted) release(); }
  }
  async function mutate(path: 'selection' | 'consent', method: 'PUT' | 'DELETE', body?: unknown, expected?: string, submitted?: number) {
    const signal = begin('writing');
    if (!signal) return;
    if (submitted === undefined) setIntent(null);
    setMutation(method + path);
    let message = '';
    let reconcile = false;
    try {
      const raw = await controller.request(ownerPath + '/' + path, signal, method, body, undefined, expected);
      signal.throwIfAborted();
      if (method === 'DELETE') { reconcile = true; message = path === 'consent' ? 'Deshabilitaste los contactos en común.' : 'Borraste los contactos compartidos. Tu consentimiento sigue vigente.'; }
      else if (submitted !== undefined) {
        const result = importResult(raw, submitted); install(result.status);
        message = `Sincronizaste ${result.distinctCount} ${result.distinctCount === 1 ? 'teléfono' : 'teléfonos'}.`;
      } else {
        const next = contactStatus(raw);
        if (next.acceptedConsentVersion !== next.requiredConsentVersion) throw new ApiError('invalid');
        install(next); message = 'Consentimiento registrado. Ahora podés elegir tus contactos.';
      }
    } catch (error) { if (!signal.aborted) { message = writeError(error); reconcile = true; } }
    finally {
      if (!signal.aborted) {
        release(); setNotice(message);
        if (reconcile) { install(null); void refresh(message); }
      }
    }
  }
  const consent = status && status.acceptedConsentVersion === status.requiredConsentVersion;
  const canImport = !stale && available && (!!picker || !!sources.google);
  const busy = phase !== 'idle';
  const discovering = available && probing && !sources.google;
  const initialLoading = (!status && !notice) || (discovering && status?.acceptedConsentVersion === null);
  return <section ref={root} className="home-account contacts"><ContactHeader onBack={onBack}/>
    {initialLoading && <ContactSkeleton/>}
    {notice && <p role="status">{notice}</p>}
    {status && stale && <button onClick={() => void refresh('')}>Consultar estado</button>}
    {!status && notice && <button onClick={() => void refresh('')}>Consultar estado</button>}
    {status && !initialLoading && <><section className="home-card">
      <h3>{status.acceptedConsentVersion === null ? 'Compartí tus contactos' : status.state === 'SYNCED' ? 'Contactos sincronizados' :
        status.state === 'RESYNC_REQUIRED' ? 'Necesitás volver a sincronizar' : 'Todavía no importaste contactos'}</h3>
      {status.syncedAt && <p>Última sincronización: <time dateTime={status.syncedAt}>{new Date(status.syncedAt).toLocaleString('es-AR')}</time></p>}
      {!stale && !canImport && !discovering && <p>{!available ? 'Las importaciones están pausadas por el momento.' : !sources.picker && !sources.google ? 'Por ahora no hay fuentes de contactos habilitadas.' :
        probeFailed ? 'No pudimos comprobar el selector. Volvé a entrar en Contactos para reintentar.' : 'Este navegador no ofrece el selector de contactos del dispositivo.'}</p>}
      {discovering && <ContactSkeleton/>}
      {!canImport && !discovering && status.state === 'SYNCED' && <p>Tus contactos compartidos siguen sincronizados con tu cuenta. Podés borrarlos desde este dispositivo.</p>}
      {!consent && <><p>Participar es opcional. Los teléfonos que elijas ayudan a priorizar personas compatibles. Durante el primer chat ambas personas pueden ver un rango de contactos en común. Nadie ve los nombres ni los números de la otra agenda.</p>
      <p>Los nombres se usan solo en tu dispositivo. Los números seleccionados se envían a Reals y se transforman en identificadores protegidos. Reals no conserva los números originales. Podés reemplazar o borrar la selección y retirar tu consentimiento. Una coincidencia no verifica identidad ni garantiza seguridad.</p>
      <button onClick={() => controller.legalEvents.dispatchEvent(new Event('inspect'))}>Consultar los documentos vigentes de Reals</button>
      {canImport && <button className="contact-primary" aria-busy={mutation === 'PUTconsent'} disabled={busy} onClick={() => void mutate('consent', 'PUT', { version: status.requiredConsentVersion }, status.mutationRevision)}>Acepto participar</button>}
      <button disabled={busy} onClick={onBack}>Ahora no</button></>}
      {consent && canImport && !intent && <><p>{status.state === 'NOT_CONFIGURED' ? 'Elegí de dónde importar tus contactos. Después podés revisar los teléfonos.' : 'Al confirmar una nueva importación, los teléfonos elegidos reemplazarán los que compartiste antes.'}</p>
        {picker && <button disabled={busy} onClick={() => void pick(picker)}>{syntheticContacts ? 'Elegir contactos sintéticos' : 'Elegir del dispositivo'}</button>}
        {sources.google && <><p>Google muestra los contactos guardados en la cuenta que elijas. Tu dispositivo o iCloud pueden tener otros contactos.</p>
        <button disabled={busy} onClick={() => google ? void pick(google) : void loadGoogle()}>{google ? 'Elegir cuenta de Google' : 'Preparar Google Contacts'}</button></>}</>}
      {phase === 'provider' && <button onClick={release}>Cancelar</button>}
    </section>
    {intent && <Selection pending={phase === 'writing'} disabled={stale || busy} rows={intent.rows} countryCode={controller.snapshot.profile?.countryCode} updating={status.state !== 'NOT_CONFIGURED'} cancel={release} confirm={numbers => void mutate('selection', 'PUT', { numbers }, intent.revision, numbers.length)}/>}
    {status.acceptedConsentVersion !== null && <section className="home-card"><h3>Administrar participación</h3>
      {status.state !== 'NOT_CONFIGURED' && <button aria-busy={mutation === 'DELETEselection'} disabled={busy} onClick={() => { if (window.confirm('¿Borrar la selección actual y conservar tu consentimiento?')) void mutate('selection', 'DELETE'); }}>Borrar contactos compartidos</button>}
      <button aria-busy={mutation === 'DELETEconsent'} disabled={busy} onClick={() => { if (window.confirm('¿Querés deshabilitar los contactos en común? Se borrarán los teléfonos compartidos y retirarás tu consentimiento para priorizar encuentros y mostrar coincidencias. Para volver a usar la función tendrás que aceptar e importar tus contactos nuevamente.')) void mutate('consent', 'DELETE'); }}>Deshabilitar contactos en común</button></section>}</>}
  </section>;
}
