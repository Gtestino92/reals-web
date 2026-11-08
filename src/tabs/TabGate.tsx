import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { TabOwnershipManager } from './TabOwnershipManager';
export function TabGate({ children, manager: supplied }: { children: (manager: TabOwnershipManager) => ReactNode; manager?: TabOwnershipManager | undefined }) {
  const [manager] = useState(() => supplied ?? new TabOwnershipManager());
  const state = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
  useEffect(() => { manager.start(); return manager.stop; }, [manager]);
  if (state === 'active') return children(manager);
  const pending = state === 'initializing' || state === 'requesting-transfer';
  return <main className="login-page"><section className="login-panel" aria-labelledby="tab-heading" aria-busy={pending}>
    <h1 id="tab-heading">{pending ? 'Activando Reals…' : state === 'unsupported' ? 'Este navegador no es compatible' : 'Reals está activo en otra pestaña.'}</h1>
    <p>Para continuar, usá Reals en una sola pestaña de este navegador.</p>
    {pending && <p role="status">Esperando el control de la aplicación…</p>}
    {state === 'unsupported' ? <p role="alert">Abrí Reals en un navegador actualizado con HTTPS o localhost. Se requieren Web Locks y BroadcastChannel.</p> : <>
      {state === 'error' && <p role="alert">No pudimos activar esta pestaña. Cerrá la otra pestaña si no responde y volvé a intentar.</p>}
      <button className="login-button login-primary" disabled={pending} onClick={manager.request}>{pending ? 'Activando…' : 'Usar Reals acá'}</button>
    </>}
  </section></main>;
}
