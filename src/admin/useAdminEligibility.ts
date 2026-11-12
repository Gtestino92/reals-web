import { useEffect, useState, useSyncExternalStore } from 'react';
import type { SessionController } from '../auth/session';

// A UI hint only. It never installs a grant or loads privileged resources.
export function useAdminEligibility(controller: SessionController, active: boolean) {
  const session = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [confirmation, setConfirmation] = useState<{ owner: SessionController; accountId: string; version: number; eligible: boolean } | null>(null);
  const version = session.authContextVersion ?? 0;
  const ready = active && session.phase === 'ready' && session.account?.status === 'ACTIVE';
  useEffect(() => {
    setConfirmation(null);
    if (!ready) return;
    let owner: AbortController | undefined;
    const check = () => {
      owner?.abort(); const request = new AbortController(); owner = request;
      setConfirmation(null);
      void controller.checkAdminEligibility(request.signal).then(value => {
        if (!request.signal.aborted && session.account) setConfirmation({ owner: controller, accountId: session.account.id, version, eligible: value });
      }).catch(() => { if (!request.signal.aborted) setConfirmation(null); });
    };
    check();
    const visible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', visible);
    return () => { owner?.abort(); document.removeEventListener('visibilitychange', visible); };
  }, [controller, ready, session.account?.id, version]);
  return ready && confirmation?.owner === controller && confirmation.accountId === session.account?.id && confirmation.version === version && confirmation.eligible;
}
