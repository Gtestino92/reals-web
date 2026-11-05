import seal from '../assets/reals-seal.png';
import type { SearchPhase } from './useHome';

const copy: Record<SearchPhase, { title: string; body: string }> = {
  idle: { title: 'Preparando búsqueda', body: 'Estamos consultando tu estado actual.' },
  locating: { title: 'Obteniendo tu ubicación', body: 'Permití el acceso a tu ubicación para buscar personas cerca. Todavía no ingresaste a la búsqueda.' },
  admitting: { title: 'Iniciando búsqueda', body: 'Estamos solicitando tu lugar en la búsqueda. Esperá la confirmación.' },
  queued: { title: 'Buscando chat', body: 'Estamos buscando alguien compatible. Cuando haya una conversación, te mostraremos la actividad en Inicio.' },
  canceling: { title: 'Cancelando búsqueda', body: 'Esperamos cualquier solicitud pendiente y confirmamos tu salida de la búsqueda.' },
  reconciling: { title: 'Confirmando tu estado', body: 'Estamos consultando el resultado de la operación.' },
  failed: { title: 'Revisá tu búsqueda', body: 'No pudimos confirmar todos los pasos. Revisá el mensaje y actualizá el estado antes de continuar.' },
};
export function SearchingScreen({ phase, error, busy, blocked, inQueue, onCancel, onRefresh, onBack }: {
  phase: SearchPhase; error: string; busy: boolean; blocked: boolean; inQueue: boolean;
  onCancel: () => void; onRefresh: () => void; onBack: () => void;
}) {
  const content = copy[phase];
  const canCancel = phase === 'locating' || phase === 'admitting' || (inQueue && !busy && !blocked);
  return <div className="home search-screen" aria-busy={busy}>
    <img src={seal} width="64" height="64" alt="Reals" />
    <div className={`search-dots${phase === 'failed' ? ' search-dots-paused' : ''}`} aria-hidden="true"><span/><span/><span/></div>
    <h2>{content.title}</h2>
    <div className="brand-divider" aria-hidden="true"><span/></div>
    <p role="status">{content.body}</p>
    {error && <p role="alert" className="home-error">{error}</p>}
    {(canCancel || busy || inQueue) && <button className="login-button login-primary" disabled={!canCancel} onClick={onCancel}>Cancelar búsqueda</button>}
    {(error || phase === 'failed') && <button className="login-button login-outlined" disabled={busy} onClick={onRefresh}>Actualizar</button>}
    {phase === 'failed' && !inQueue && !busy && !blocked && <button className="login-button login-outlined" onClick={onBack}>Volver a Inicio</button>}
    {inQueue && phase === 'failed' && <p>El servidor todavía informa una búsqueda activa.</p>}
  </div>;
}
