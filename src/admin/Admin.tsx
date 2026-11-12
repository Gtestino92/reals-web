import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SessionController } from '../auth/session';
import { SignOutButton } from '../auth/SignOutButton';
import { AdminStore } from './store';
import { mediaUrl, payload, record, sources, statuses } from './model';
import type { Action, Row, Section } from './model';
import './admin.css';
const sections: Section[] = ['photos','reports','appeals','diagnostics'];
const labels: Record<Section,string> = { photos: 'Fotografías', reports: 'Reportes', appeals: 'Apelaciones', diagnostics: 'Diagnóstico' };
const actions: Record<Action,string> = { APPROVED: 'Aprobar fotografía', REJECTED: 'Rechazar fotografía', dismissal: 'Desestimar reporte', 'abusive-dismissal': 'Desestimar por abusivo o injustificado', TEMPORARY_BAN: 'Aplicar suspensión temporal', PERMANENT_BAN: 'Aplicar suspensión permanente', APPROVE: 'Aprobar apelación', REJECT: 'Rechazar apelación' };
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : typeof value === 'boolean' ? (value ? 'Sí' : 'No') : '—';
function Fields({ row }: { row: Row }) { return <dl>{Object.entries(row).filter(([key,value]) => !['readUrl','url','messages','audio','report'].includes(key) && (value === null || typeof value !== 'object')).map(([key,value]) => <div key={key}><dt>{key}</dt><dd>{text(value)}</dd></div>)}</dl>; }
function AudioEvidence({ url, onRetry }: { url: string; onRetry: () => void }) {
  const slot = useRef<HTMLDivElement>(null);
  const [error,setError] = useState(false);
  const player = useRef<HTMLAudioElement | null>(null);
  useLayoutEffect(() => {
    const clear = () => { const node = player.current; if (node) { node.pause(); node.removeAttribute('src'); node.load(); node.remove(); player.current = null; } };
    const hide = () => { if (document.visibilityState !== 'visible') clear(); };
    document.addEventListener('visibilitychange',hide); return () => { clear(); document.removeEventListener('visibilitychange',hide); };
  },[url]);
  return <div><button onClick={() => { if (player.current) return; const node = document.createElement('audio'); node.controls = true; node.preload = 'none'; node.setAttribute('referrerpolicy','no-referrer'); node.onerror = () => setError(true); node.src = url; slot.current?.append(node); player.current = node; }}>Habilitar audio</button><div ref={slot} />{error && <p role="alert">El audio no está disponible. <button onClick={onRetry}>Consultar estado</button></p>}</div>;
}
function Confirmation({ action, target, body, onCancel, onConfirm }: { action: Action; target: string; body: unknown; onCancel: () => void; onConfirm: () => void }) {
  const node = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null), claimed = useRef(false);
  useLayoutEffect(() => { const previous = document.activeElement; node.current?.showModal(); cancel.current?.focus(); const pop = () => onCancel(); window.addEventListener('popstate',pop); return () => { node.current?.close(); window.removeEventListener('popstate',pop); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); }; },[onCancel]);
  return <dialog ref={node} aria-labelledby="admin-confirm-title" onCancel={e => { e.preventDefault(); onCancel(); }}><h2 id="admin-confirm-title">{actions[action]}</h2><p>Usuario destinatario: <strong>{target}</strong></p>{action === 'abusive-dismissal' && <p>Esta operación puede afectar la confiabilidad del denunciante. No equivale a una desestimación ordinaria.</p>}<Fields row={record(body)} /><button ref={cancel} onClick={onCancel}>Cancelar</button><button onClick={() => { if (claimed.current) return; claimed.current = true; onConfirm(); }}>Confirmar decisión</button></dialog>;
}
function Review({ store, row, section }: { store: AdminStore; row: Row; section: Section }) {
  const [notes,setNotes] = useState(''), [reason,setReason] = useState(''), [hours,setHours] = useState('24');
  const [mediaError,setMediaError] = useState(false);
  const [error,setError] = useState(''), [confirmation,setConfirmation] = useState<{ action: Action; body: unknown } | null>(null);
  const report = section === 'reports' ? record(row.report) : row;
  const target = section === 'reports' ? text(record(report.reported).userId) : text(row.userId);
  const available: Action[] = section === 'photos' ? ['APPROVED','REJECTED'] : section === 'appeals' ? ['APPROVE','REJECT'] : report.status === 'PENDING' ? ['dismissal','abusive-dismissal','TEMPORARY_BAN','PERMANENT_BAN'] : [];
  const url = mediaUrl(row.readUrl);
  return <section aria-label="Detalle"><h2>Detalle</h2>{url && <img className="admin-preview" src={url} referrerPolicy="no-referrer" alt="Fotografía en revisión" onError={e => { e.currentTarget.hidden = true; setMediaError(true); }} />}{mediaError && <p role="alert">No se pudo cargar la fotografía. <button onClick={() => void store.load()}>Consultar estado</button></p>}<Fields row={report} />
    {section === 'reports' && <><h3>Denunciante</h3>{report.reporter ? <Fields row={record(report.reporter)} /> : <p>Sin denunciante</p>}<h3>Usuario reportado</h3><Fields row={record(report.reported)} /><p className="admin-text">{text(row.details)}</p><p>{text(row.verdictNotes)}</p>{row.evidence != null && <><h3>Evidencia</h3><Fields row={record(row.evidence)} /></>}{row.penalty != null && <><h3>Sanción existente</h3><Fields row={record(row.penalty)} /></>}{Array.isArray(row.messages) && row.messages.map((message: unknown,index) => { const m = record(message); const audio = m.audio == null ? null : record(m.audio); const source = mediaUrl(audio?.url); return <article key={index}><Fields row={m} />{source && <AudioEvidence url={source} onRetry={() => void store.load()} />}</article>; })}</>}
    {section === 'appeals' && typeof row.sourceReportId === 'string' && <button onClick={() => store.sourceReport(String(row.sourceReportId))}>Ver reporte de origen</button>}
    {available.length > 0 && <><label>Notas{section === 'appeals' ? ' (obligatorias)' : ' (opcionales)'}<textarea maxLength={1000} value={notes} onChange={e => setNotes(e.target.value)} /></label>{section === 'reports' && <><label>Motivo de la sanción<input maxLength={255} value={reason} onChange={e => setReason(e.target.value)} /></label><label>Duración temporal (horas)<input inputMode="numeric" value={hours} onChange={e => setHours(e.target.value)} /></label></>}{available.map(action => <button key={action} onClick={() => { try { setConfirmation({ action, body: payload(action,notes,reason,hours,row) }); setError(''); } catch (e) { setError(e instanceof Error ? e.message : 'Revisá los campos.'); } }}>{actions[action]}</button>)}</>}
    {error && <p role="alert">{error}</p>}{confirmation && <Confirmation action={confirmation.action} body={confirmation.body} target={target} onCancel={() => setConfirmation(null)} onConfirm={() => { const c = confirmation; setConfirmation(null); void store.decide(c.action,c.body); }} />}
  </section>;
}
function Filters({ apply }: { apply: (query: string) => void }) {
  const [status,setStatus] = useState('PENDING'), [source,setSource] = useState(''), [reported,setReported] = useState(''), [reporter,setReporter] = useState('');
  return <form onSubmit={e => { e.preventDefault(); const params = new URLSearchParams({ status }); if (source) params.set('source',source); if (reported) params.set('reportedUserId',reported); if (reporter) params.set('reporterUserId',reporter); apply(params.toString()); }}><label>Estado<select value={status} onChange={e => setStatus(e.target.value)}>{statuses.map(s => <option key={s}>{s}</option>)}</select></label><label>Origen<select value={source} onChange={e => setSource(e.target.value)}><option value="">Todos</option>{sources.map(s => <option key={s}>{s}</option>)}</select></label><label>ID de usuario reportado<input value={reported} onChange={e => setReported(e.target.value)} /></label><label>ID de denunciante<input value={reporter} onChange={e => setReporter(e.target.value)} /></label><button>Filtrar reportes</button></form>;
}
export default function Admin({ controller, onReturn, onNavigationBlockedChange }: { controller: SessionController; onReturn?: () => void; onNavigationBlockedChange?: ((blocked: boolean) => void) | undefined }) {
  const [store] = useState(() => new AdminStore(controller));
  const s = useSyncExternalStore(store.subscribe,store.getSnapshot);
  const [page,setPage] = useState(0);
  useLayoutEffect(() => {
    // Also covers full-document navigation and bfcache; restore must reauthorize.
    const meta = document.createElement('meta'); meta.name = 'referrer'; meta.content = 'no-referrer'; document.head.append(meta);
    const hide = () => store.dispose(), show = (event: PageTransitionEvent) => { if (event.persisted) store.start(); };
    const resume = () => { if (document.visibilityState === 'visible') void store.load(true); };
    document.addEventListener('visibilitychange', resume); window.addEventListener('pagehide',hide); window.addEventListener('pageshow',show); store.start();
    return () => { store.dispose(); meta.remove(); document.removeEventListener('visibilitychange', resume); window.removeEventListener('pagehide',hide); window.removeEventListener('pageshow',show); };
  },[store]);
  useLayoutEffect(() => { setPage(p => Math.min(p, Math.max(0, Math.ceil(s.rows.length / 20) - 1))); },[s.rows]);
  useLayoutEffect(() => { onNavigationBlockedChange?.(s.busy && s.blocked); return () => onNavigationBlockedChange?.(false); }, [s.busy, s.blocked, onNavigationBlockedChange]);
  const revoke = () => { void controller.revokeAdminAccess(); };
  return <main className="admin"><header><h1>Reals Admin</h1><button disabled={s.busy && s.blocked} onClick={onReturn}>Volver a Reals</button><button disabled={s.busy} onClick={revoke}>Cerrar acceso administrativo</button><SignOutButton onConfirm={controller.signOut} /></header>
    {s.access === 'denied' ? <p role="status">Acceso no disponible para esta sesión.</p> : s.access === 'checking' ? <p role="status">Verificando acceso…</p> : s.access === 'error' ? <><p role="alert">No se pudo verificar el acceso.</p><button onClick={store.authorize}>Reintentar verificación</button></> : <>
      <nav aria-label="Secciones de administración">{sections.map(key => <button key={key} aria-current={s.section === key ? 'page' : undefined} disabled={s.busy} onClick={() => store.navigate(key)}>{labels[key]}</button>)}</nav>
      <h2>{labels[s.section]}</h2>{(s.error || s.blocked) && !s.busy && <button onClick={() => void store.load()}>Consultar estado</button>}
      {s.notice && <p role="status">{s.notice}</p>}{s.error && <p role="alert">{s.error}</p>}{s.busy && <p role="status">Cargando…</p>}
      {s.section === 'reports' && s.sourceReportId === null && <fieldset disabled={s.busy}><Filters apply={query => store.navigate('reports',query)} /></fieldset>}
      {s.sourceReportId !== null ? <><h3>Reporte de origen de la apelación</h3><button disabled={s.busy && s.blocked} onClick={() => store.navigate('appeals')}>Volver a Apelaciones</button>{s.selected && !s.busy && !s.blocked && <Review key={s.sourceReportId} store={store} row={s.selected} section="reports" />}</> : s.section === 'diagnostics' ? !s.busy && s.diagnostics && <Fields row={s.diagnostics} /> : <><p>{s.section === 'photos' ? 'Máximo 100 fotografías, de más antiguas a más nuevas. ' : 'Lista completa recibida del servidor. '}Paginación local de 20: no reduce el trabajo de red ni de base de datos.</p>
      <div className="admin-panels"><section aria-label="Lista">{!s.busy && !s.error && s.rows.length === 0 && <p>No hay elementos.</p>}{s.rows.slice(page*20,page*20+20).map((row,index) => <button className="admin-item" disabled={s.busy || s.blocked} key={index} onClick={() => void store.select(row)}>{row.priorityReview === true && <strong>Prioritario · </strong>}{s.section === 'photos' && mediaUrl(row.readUrl) && <img className="admin-thumbnail" src={mediaUrl(row.readUrl) ?? undefined} loading="lazy" referrerPolicy="no-referrer" alt="" />}{text(row.displayName ?? row.id ?? row.penaltyId)}{s.section === 'photos' && <span> · Posición {text(row.position)}</span>}</button>)}<div><button disabled={page === 0 || s.busy} onClick={() => setPage(p => p-1)}>Anterior</button><span> Página {page+1} de {Math.max(1,Math.ceil(s.rows.length/20))} </span><button disabled={(page+1)*20 >= s.rows.length || s.busy} onClick={() => setPage(p => p+1)}>Siguiente</button></div></section>{s.selected && !s.busy && !s.blocked && <Review key={text(s.selected.photoId ?? s.selected.penaltyId ?? record(s.selected.report).id)} store={store} row={s.selected} section={s.section} />}</div></>}
    </>}
  </main>;
}
