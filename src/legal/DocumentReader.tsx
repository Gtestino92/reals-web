import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { LegalDocument } from '../onboarding/contracts';
import { loadDocument, publicationUrl } from './documentContent';

export function DocumentReader({ doc, title, action, disabled, status, onClose, onSubmit }: {
  doc: LegalDocument; title: string; action: string | null; disabled: boolean; status?: string | undefined; onClose: () => void; onSubmit: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const href = publicationUrl(doc.url);
  const [attempt, setAttempt] = useState(0);
  const [content, setContent] = useState<ReactNode>(null);
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    const node = dialog.current;
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    node?.showModal();
    return () => {
      node?.close();
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const request = new AbortController();
    void loadDocument(doc.url, request.signal).then(result => {
      if (!request.signal.aborted) setContent(result);
    }, () => { if (!request.signal.aborted) setFailed(true); });
    return () => request.abort();
  }, [doc.url, attempt]);
  return <dialog ref={dialog} className="legal-reader" aria-labelledby={id} onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
    <header>
      <div className="legal-reader-heading">
        <h2 id={id}>{title}</h2>
        <div className="legal-reader-meta">
          <small>Versión {doc.version}</small>
          {href && <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Abrir en navegador</a>}
        </div>
      </div>
      <button className="login-button login-outlined" onClick={onClose}>Cerrar</button>
    </header>
    <div className="legal-reader-body" tabIndex={0} role="region" aria-label="Contenido del documento">
      {content ?? (failed ? <><p role="alert">No pudimos cargar este documento de forma segura.</p>
        <button className="login-button login-outlined" onClick={() => { setFailed(false); setAttempt(n => n + 1); }}>Reintentar lectura</button></> :
        <p role="status">Cargando documento…</p>)}
    </div>
    {status && <p className="legal-reader-status" role="status">{status}</p>}
    {action && !doc.satisfied && <footer>
      <button className="login-button login-primary" disabled={!content || disabled} onClick={onSubmit}>{action}</button>
    </footer>}
  </dialog>;
}
