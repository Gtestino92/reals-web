import { createContext, useCallback, useContext, useLayoutEffect, useState, type ReactNode } from 'react';
import seal from './assets/reals-seal.png';
import './auth/login.css';

const Startup = createContext<(() => void) | null>(null);

export function StartupBoundary({ children }: { children: ReactNode }) {
  const [starting, setStarting] = useState(true);
  const finish = useCallback(() => setStarting(false), []);
  return <Startup.Provider value={starting ? finish : null}>
    {starting && <StartupLoading />}
    <div hidden={starting}>{children}</div>
  </Startup.Provider>;
}

/** Only the owner of the resolved destination releases the initial presentation. */
export function useStartupDestination(ready: boolean) {
  const finish = useContext(Startup);
  useLayoutEffect(() => { if (ready) finish?.(); }, [finish, ready]);
  return finish !== null;
}

export function StartupLoading() {
  return <main className="login-page startup-loading"><section className="login-panel">
    <header className="login-header login-brand">
      <img className="login-seal" src={seal} alt="" width="54" height="54" />
      <h1>Reals</h1>
      <div className="brand-divider" aria-hidden="true"><span /></div>
    </header>
    <SessionLoading />
    <div className="startup-indicator" aria-hidden="true" />
  </section></main>;
}

export function SessionLoading() {
  return <p className="session-loading" role="status" aria-atomic="true">Preparando Reals…</p>;
}
