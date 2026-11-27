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
  return <aside className="home-card contact-invite"><h3><svg aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 4 5"/></svg> Descubrí conocidos en común</h3>
    <p>Encontrá personas con vínculos sociales en común. Si querés participar, elegís qué contactos compartir.</p>
    <div className="contact-bulk"><button className="contact-primary" onClick={() => { dismiss(); open(); }}>Importar mis contactos</button><button onClick={dismiss}>Descartar invitación</button></div></aside>;
}
