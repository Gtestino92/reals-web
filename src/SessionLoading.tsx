import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';
import seal from './assets/reals-seal.png';
import './auth/login.css';

const Startup = createContext<(() => void) | null>(null);

export function StartupBoundary({ attempt = 0, slowRecovery, children }: { attempt?: number; slowRecovery?: ReactNode; children: ReactNode }) {
  const [completed, setCompleted] = useState(-1);
  const [slowAttempt, setSlowAttempt] = useState(-1);
  const starting = attempt > completed;
  const finish = useCallback(() => setCompleted(previous => Math.max(previous, attempt)), [attempt]);
  useEffect(() => {
    if (!starting) return;
    const timer = setTimeout(() => setSlowAttempt(attempt), 30000);
    return () => clearTimeout(timer);
  }, [attempt, starting]);
  return <Startup.Provider value={starting ? finish : null}>
    {starting && <StartupLoading>{slowAttempt === attempt && slowRecovery}</StartupLoading>}
    <div hidden={starting}>{children}</div>
  </Startup.Provider>;
}

/** Only the owner of the resolved destination releases the initial presentation. */
export function useStartupDestination(ready: boolean) {
  const finish = useContext(Startup);
  useLayoutEffect(() => { if (ready) finish?.(); }, [finish, ready]);
  return finish !== null;
}

export function StartupLoading({ children }: { children?: ReactNode }) {
  return <main className="login-page startup-loading"><section className="login-panel">
    <header className="login-header login-brand">
      <img className="login-seal" src={seal} alt="" width="54" height="54" />
      <h1>Reals</h1>
      <div className="brand-divider" aria-hidden="true"><span /></div>
    </header>
    <SessionLoading />
    <div className="startup-indicator" aria-hidden="true" />
    {children}
  </section></main>;
}

export function SessionLoading() {
  return <p className="session-loading" role="status" aria-atomic="true">Preparando Reals…</p>;
}
