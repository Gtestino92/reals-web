import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { SessionController } from '../../auth/session';
import { ApiError } from '../../auth/api';
import { parseAnswers, parseCatalog } from './contracts';
import type { Answer, Catalog } from './contracts';
import { answerable, validAnswer } from './presentation';
interface State { catalog: Catalog | null; answers: Answer[]; busy: boolean; uncertain: boolean; error: string }
interface Owner { identity: string; lifetime: AbortController; read: AbortController | null; serial: number; mutation: boolean; uncertain: boolean }
const empty: State = { catalog: null, answers: [], busy: false, uncertain: false, error: '' };
export function useAffinityQuestionnaire(controller: SessionController) {
  const session = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const identity = session.phase === 'ready' ? `${session.account?.id}/${session.profile?.id}` : '';
  const [state, setState] = useState(empty), latest = useRef(empty), owner = useRef<Owner | null>(null);
  const install = (next: State) => { latest.current = next; setState(next); };
  const valid = (r: Owner, serial: number) => owner.current === r && !r.lifetime.signal.aborted && serial === r.serial && controller.snapshot.phase === 'ready' && `${controller.snapshot.account?.id}/${controller.snapshot.profile?.id}` === r.identity;
  const refresh = async () => {
    const r = owner.current;
    if (!r || r.mutation || r.read) return;
    const read = new AbortController(), serial = ++r.serial;
    r.read = read;
    const signal = AbortSignal.any([read.signal, r.lifetime.signal]);
    install({ ...latest.current, busy: true, error: '' });
    try {
      const [catalog, answers] = await Promise.all([controller.request('/reference/affinity-questions', signal).then(parseCatalog), controller.request('/me/profile/affinity-answers', signal).then(parseAnswers)]);
      if (valid(r, serial)) { r.uncertain = false; install({ catalog, answers, busy: false, uncertain: false, error: '' }); }
    } catch {
      if (valid(r, serial)) install({ ...latest.current, busy: false, error: 'No pudimos actualizar tus afinidades. Revisá tu conexión y reintentá.' });
    } finally { if (r.read === read) r.read = null; }
  };
  useEffect(() => {
    install(empty);
    if (!identity || !controller.snapshot.profile) return;
    const r: Owner = { identity, lifetime: new AbortController(), read: null, serial: 0, mutation: false, uncertain: false };
    owner.current = r; void refresh();
    const resume = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', resume);
    return () => { document.removeEventListener('visibilitychange', resume); r.lifetime.abort(); r.read?.abort(); if (owner.current === r) owner.current = null; };
  }, [controller, identity]); // Each identity owns all reads and writes; no polling.
  const mutate = async (questionId: string, answerCode: string | null): Promise<Answer[] | null> => {
    const r = owner.current, snapshot = latest.current;
    if (!r || r.mutation || r.uncertain || !snapshot.catalog || !valid(r, r.serial)) return null;
    const q = answerable(snapshot.catalog).find(q => q.id === questionId);
    if (!q || (answerCode !== null && !q.options.some(o => o.code === answerCode))) return null;
    if (answerCode === validAnswer(q, snapshot.answers)?.answerCode) return snapshot.answers;
    r.mutation = true; r.read?.abort(); r.read = null;
    const serial = ++r.serial;
    install({ ...snapshot, busy: true, error: '' });
    try {
      const answers = parseAnswers(await controller.request(`/me/profile/affinity-answers${answerCode === null ? `/${encodeURIComponent(questionId)}` : ''}`, r.lifetime.signal, answerCode === null ? 'DELETE' : 'PATCH', answerCode === null ? undefined : { answers: [{ questionId, answerCode }] }));
      if (!valid(r, serial)) return null;
      install({ ...latest.current, answers, busy: false, uncertain: false, error: '' });
      return answers;
    } catch (error) {
      if (valid(r, serial)) {
        r.uncertain = !(error instanceof ApiError && error.kind !== 'invalid' && error.status >= 400 && error.status < 500);
        install({ ...latest.current, busy: false, uncertain: r.uncertain, error: r.uncertain ? 'No pudimos confirmar el cambio. Conservamos tu selección. Reintentá la consulta antes de guardar otra vez.' : 'No se pudo guardar el cambio. Actualizá las preguntas y revisá tu selección.' });
      }
      return null;
    } finally { r.mutation = false; }
  };
  return { ...state, identity, refresh, mutate };
}
export type AffinityModel = ReturnType<typeof useAffinityQuestionnaire>;
