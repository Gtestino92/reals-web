import seal from '../assets/reals-seal.png';
import type { SearchPhase } from './useHome';

const searching = { title: 'Buscando chat', body: 'Estamos buscando a alguien compatible. Te avisaremos cuando encontremos una persona para conversar.' };
const copy: Record<SearchPhase, { title: string; body: string }> = {
  idle: { title: 'Preparando búsqueda', body: 'Estamos consultando tu estado actual.' },
  locating: searching,
  admitting: searching,
  queued: searching,
  canceling: { title: 'Cancelando búsqueda', body: 'Esperamos cualquier solicitud pendiente y confirmamos tu salida de la búsqueda.' },
  reconciling: searching,
  failed: { title: 'Revisá tu búsqueda', body: 'No pudimos confirmar todos los pasos. Revisá el mensaje y actualizá el estado antes de continuar.' },
};
export function SearchingScreen({ phase, error, busy, blocked, inQueue, onCancel, onRefresh, onBack, canRetryLocation, onRetryLocation }: {
  phase: SearchPhase; error: string; busy: boolean; blocked: boolean; inQueue: boolean;
  onCancel: () => void; onRefresh: () => void; onBack: () => void; canRetryLocation: boolean; onRetryLocation: () => void;
}) {
  const content = canRetryLocation ? { title: 'No pudimos obtener tu ubicación', body: 'Todavía no solicitamos tu ingreso a la búsqueda. Revisá el mensaje y reintentá la ubicación.' } : copy[phase];
  const canCancel = phase === 'locating' || phase === 'admitting' || phase === 'reconciling' || (inQueue && !busy && !blocked);
  return <div className="home search-screen" aria-busy={busy}>
    <img src={seal} width="64" height="64" alt="Reals" />
    <div className={`search-dots${phase === 'failed' ? ' search-dots-paused' : ''}`} aria-hidden="true"><span/><span/><span/></div>
    <h2>{content.title}</h2>
    <div className="brand-divider" aria-hidden="true"><span/></div>
    <p role="status" aria-label={phase === 'queued' ? 'Búsqueda confirmada' : ['locating', 'admitting', 'reconciling'].includes(phase) ? 'Preparando búsqueda; ingreso todavía no confirmado' : undefined}>{content.body}</p>
    {error && <p role="alert" className="home-error">{error}</p>}
    {(canCancel || busy || inQueue) && <button className="login-button login-primary" disabled={!canCancel} onClick={onCancel}>Cancelar búsqueda</button>}
    {canRetryLocation ? <button className="login-button login-primary" onClick={onRetryLocation}>Reintentar ubicación</button> : (error || phase === 'failed') && <button className="login-button login-outlined" disabled={busy} onClick={onRefresh}>Actualizar</button>}
    {phase === 'failed' && !inQueue && !busy && !blocked && <button className="login-button login-outlined" onClick={onBack}>Volver a Inicio</button>}
    {inQueue && phase === 'failed' && <p>El servidor todavía informa una búsqueda activa.</p>}
  </div>;
}
