import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { SessionController } from '../auth/session';
import { errorCode } from '../auth/errors';
import { AccountSection } from '../home/AccountSection';
import { fingerprint, readRequirements } from './requirements';
import type { LegalDocument } from '../onboarding/contracts';
import { SessionLoading } from '../SessionLoading';
import './legal.css';
import seal from '../assets/reals-seal.png';

const completedStates: Record<string, string> = { ACCEPTED: 'Aceptado', ACKNOWLEDGED: 'Lectura confirmada' };
const titles: Record<string, string> = {
  TERMS_OF_USE: 'Términos de uso', PRIVACY_NOTICE: 'Aviso de privacidad', COMMUNITY_GUIDELINES: 'Normas de la comunidad',
};
function actionLabel(action: string) {
  if (action === 'ACCEPTED') return 'Aceptar';
  if (action === 'ACKNOWLEDGED') return 'Confirmar lectura';
  return null;
}
export function LegalSession({ controller, children }: { controller: SessionController; children: ReactNode }) {
  const [entered, setEntered] = useState(false);
  const [visible, setVisible] = useState(true);
  const [fromAccount, setFromAccount] = useState(false);
  const [documents, setDocuments] = useState<LegalDocument[]>([]);
  const [busy, setBusy] = useState(true), [submitting, setSubmitting] = useState('');
  const [error, setError] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);
  const operation = useRef<AbortController | null>(null);
  const quietRead = useRef<AbortController | null>(null);
  const [stale, setStale] = useState(false);
  const showing = useRef(true);
  const deferred = useRef('');
  const returnTo = useRef<{ element: Element | null; scroll: number } | null>(null);
  const [historyOwner] = useState(() => crypto.randomUUID());
  const overlay = useRef<HTMLDialogElement>(null);
  const focusOnOpen = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const resume = useCallback(() => {
    if (history.state?.legalOwner === historyOwner) history.back();
    quietRead.current?.abort(); showing.current = false;
    setAccountBusy(false); setEntered(true); setVisible(false);
  }, [historyOwner]);
  const load = useCallback(async (openedFromAccount: boolean, doc?: LegalDocument) => {
    if (operation.current || (doc && (doc.satisfied || !actionLabel(doc.requiredAction)))) return;
    quietRead.current?.abort(); showing.current = true; setStale(false);
    const request = new AbortController();
    operation.current = request;
    const signal = request.signal;
    setVisible(true); setFromAccount(openedFromAccount); setBusy(true); setSubmitting(doc?.type ?? ''); setError('');
    if (!doc) setDocuments([]);
    try {
      let notice = '';
      if (doc) {
        try {
          await controller.request('/me/legal-document-actions', signal, 'POST', {
            documentType: doc.type, documentVersion: doc.version, action: doc.requiredAction,
          });
        } catch (failure) {
          signal.throwIfAborted();
          notice = errorCode(failure) === 'LEGAL_DOCUMENT_VERSION_NOT_CURRENT'
            ? 'La versión cambió. Revisá el documento vigente.'
            : 'No pudimos confirmar la acción. Revisá el estado actualizado.';
        }
      }
      const result = await readRequirements(controller, signal);
      signal.throwIfAborted();
      setDocuments(result.documents); setError(notice);
      if (!openedFromAccount && result.satisfied) resume();
    } catch {
      if (!signal.aborted) {
        setDocuments([]);
        setError('No pudimos verificar los documentos vigentes. La respuesta del servidor no es válida o no hay conexión.');
      }
    } finally {
      request.abort();
      if (operation.current === request) { operation.current = null; setBusy(false); setSubmitting(''); }
    }
  }, [controller, resume]);
  useLayoutEffect(() => {
    const capture = () => {
      if (returnTo.current) return;
      returnTo.current = { element: document.activeElement, scroll: window.scrollY };
      history.pushState({ ...history.state, legalOwner: historyOwner }, '');
    };
    const required = () => { if (!showing.current) { capture(); void load(false); } };
    const inspect = () => { if (!showing.current) { capture(); void load(true); } };
    const pending = (event: Event) => { if (event instanceof CustomEvent && event.detail !== deferred.current) required(); };
    controller.legalEvents.addEventListener('required', required);
    controller.legalEvents.addEventListener('inspect', inspect);
    controller.legalEvents.addEventListener('pending', pending);
    void load(false);
    return () => {
      controller.legalEvents.removeEventListener('required', required);
      controller.legalEvents.removeEventListener('inspect', inspect);
      controller.legalEvents.removeEventListener('pending', pending);
      operation.current?.abort(); operation.current = null;
    };
  }, [controller, load, historyOwner]);
  useLayoutEffect(() => {
    if (visible && !busy && !accountBusy && focusOnOpen.current && heading.current) {
      heading.current.focus({ preventScroll: true }); focusOnOpen.current = false;
    }
    if (!visible) focusOnOpen.current = true;
    if (!visible && returnTo.current) {
      const { element, scroll } = returnTo.current;
      if (element instanceof HTMLElement && element.isConnected) element.focus({ preventScroll: true });
      if (window.scrollY !== scroll) window.scrollTo(0, scroll);
      returnTo.current = null;
    }
  }, [visible, busy, accountBusy]);
  useLayoutEffect(() => {
    if (!visible || !entered) return;
    const back = (event: PopStateEvent) => {
      if (!showing.current || !returnTo.current || history.state?.legalOwner === historyOwner) return;
      if (busy || accountBusy) {
        history.pushState({ ...history.state, legalOwner: historyOwner }, '');
        if (!overlay.current?.querySelector('dialog[open]')) event.stopImmediatePropagation();
        return;
      }
      event.stopImmediatePropagation();
      if (documents.some(doc => !doc.satisfied)) deferred.current = fingerprint(documents);
      resume();
    };
    window.addEventListener('popstate', back, true);
    return () => window.removeEventListener('popstate', back, true);
  }, [visible, entered, busy, accountBusy, documents, historyOwner, resume]);

  // Only a visible legal screen owns this revalidation. Ordinary tab return in a
  // chat does not open a gate. An explicit write supersedes the background read.
  useLayoutEffect(() => {
    if (!visible || busy || accountBusy || !documents.length) return;
    const refresh = async () => {
      if (document.hidden || operation.current || quietRead.current) return;
      const request = new AbortController();
      quietRead.current = request;
      try {
        const result = await readRequirements(controller, request.signal);
        request.signal.throwIfAborted();
        setDocuments(result.documents); setStale(false); setError('');
        if (!fromAccount && result.satisfied) resume();
      } catch {
        if (!request.signal.aborted) { setStale(true); setError('No pudimos actualizar los documentos. Reintentá antes de continuar.'); }
      } finally { request.abort(); if (quietRead.current === request) quietRead.current = null; }
    };
    document.addEventListener('visibilitychange', refresh);
    return () => { document.removeEventListener('visibilitychange', refresh); quietRead.current?.abort(); quietRead.current = null; };
  }, [controller, visible, busy, accountBusy, fromAccount, documents.length, resume]);

  useLayoutEffect(() => {
    const dialog = overlay.current;
    if (visible && entered) dialog?.showModal();
    return () => dialog?.close();
  }, [visible, entered]);
  const defer = () => {
    if (busy || accountBusy) return;
    if (documents.some(doc => !doc.satisfied)) deferred.current = fingerprint(documents);
    resume();
  };
  const content = visible && <main className="login-page"><section className="login-panel" aria-label="Documentos legales">
      <header className="login-header"><div className="login-brand"><img src={seal} className="login-seal" alt="" width="54" height="54"/><h1>Reals</h1></div></header>
      {busy && !documents.length ? <SessionLoading/> : <div className="legal-requirements">
        <h2 ref={heading} tabIndex={-1}>{fromAccount ? 'Documentos vigentes' : 'Antes de continuar'}</h2>
        {!fromAccount && <p>Revisá los documentos vigentes. Algunas acciones de participación requieren que completes la acción indicada.</p>}
        {fromAccount && !documents.length && !error && <p>No hay documentos vigentes.</p>}
        {documents.map(doc => {
          const title = Object.hasOwn(titles, doc.type) ? titles[doc.type] : doc.type.replaceAll('_', ' ').toLocaleLowerCase('es');
          const label = actionLabel(doc.requiredAction);
          const state = doc.satisfied ? (Object.hasOwn(completedStates, doc.requiredAction) ? completedStates[doc.requiredAction] : 'Completado') : 'Pendiente';
          return <article className="home-card" key={doc.type}><h3>{title}</h3>
            <p className={doc.satisfied ? 'legal-completed' : 'legal-pending'}>Versión {doc.version} · {state}</p>
            <a href={doc.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`Ver documento: ${title} (se abre en otra pestaña)`}>Ver documento</a>
            {!doc.satisfied && !label && <p>Actualizá la app para completar esta acción.</p>}
            {!doc.satisfied && label && <button className="login-button login-primary" disabled={busy || accountBusy || stale} onClick={() => void load(fromAccount, doc)}>{submitting === doc.type ? 'Guardando…' : label}</button>}
          </article>;
        })}
        {error && <><p role="alert">{error}</p><button className="login-button login-outlined" disabled={busy || accountBusy} onClick={() => void load(fromAccount)}>Reintentar</button></>}
        <button className="login-button login-outlined" disabled={busy || accountBusy} onClick={defer}>{fromAccount ? 'Volver a Cuenta' : 'Ahora no'}</button>
      </div>}
      {!fromAccount && <AccountSection legalOnly deletionDisabled={busy} controller={controller} disabled={!!submitting} onNavigationBlockedChange={setAccountBusy}/>}
    </section></main>;
  return <>
    {entered && <div hidden={visible} inert={visible}>{children}</div>}
    {entered && visible ? <dialog className="legal-overlay" ref={overlay} aria-label="Documentos legales" onCancel={event => { event.preventDefault(); defer(); }}>{content}</dialog> : content}
  </>;
}
