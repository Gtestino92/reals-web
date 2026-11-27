import { useEffect, useState } from 'react';
import type { SessionController } from '../auth/session';
import { contactStatus, ownerPath } from './contracts';
import { providers } from './providers';

export function ContactInvitation({ controller, open }: { controller: SessionController; open: () => void }) {
  const key = 'reals.contacts.invitation.' + controller.snapshot.account?.id;
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (dismissed || (!providers.google && !providers.picker)) return;
    try { if (localStorage.getItem(key)) return; } catch { /* Storage is optional. */ }
    let request: AbortController | undefined;
    const check = async () => {
      request?.abort();
      const task = new AbortController();
      request = task;
      try {
        if (!providers.google && !(await providers.picker?.())) return;
        task.signal.throwIfAborted();
        const status = contactStatus(await controller.request(ownerPath, task.signal));
        if (!task.signal.aborted) setVisible(status.importAvailable && status.acceptedConsentVersion === null);
      } catch { if (!task.signal.aborted) setVisible(false); }
    };
    const resume = () => { if (document.visibilityState === 'visible') void check(); };
    void check();
    document.addEventListener('visibilitychange', resume);
    return () => { request?.abort(); document.removeEventListener('visibilitychange', resume); };
  }, [controller, key, dismissed]);
  if (!visible) return null;
  function dismiss() {
    setDismissed(true); setVisible(false);
    try { localStorage.setItem(key, 'dismissed'); } catch { /* Current view still honors dismissal. */ }
  }
  return <aside className="home-card contact-invite"><h3>Contactos en común</h3>
    <p>Si querés, podés elegir contactos para encontrar coincidencias durante un primer chat.</p>
    <button onClick={() => { dismiss(); open(); }}>Ver Contactos</button><button onClick={dismiss}>Descartar invitación</button></aside>;
}
