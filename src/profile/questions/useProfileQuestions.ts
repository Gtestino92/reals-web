import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ApiError } from '../../auth/api';
import type { SessionController } from '../../auth/session';
import { parseQuestionAnswers, parseQuestionCatalog } from './contracts';
import type { QuestionCatalog, SavedAnswer } from './contracts';
import { canSaveAnswer, sameSelection, selectedIds, selectionValid, validateAnswer } from './presentation';

export type QuestionMutation = { kind: 'upsert'; questionId: string; answer: string } | { kind: 'delete'; questionId: string } | { kind: 'selection'; questionIds: string[] };
interface State { identity: string; catalog: QuestionCatalog | null; answers: SavedAnswer[]; busy: boolean; uncertain: boolean; error: string }
interface Owner { identity: string; lifetime: AbortController; read: AbortController | null; serial: number; mutation: boolean; uncertain: boolean }
const empty: State = { identity: '', catalog: null, answers: [], busy: false, uncertain: false, error: '' };

export function useProfileQuestions(controller: SessionController, active: boolean) {
  const session = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const identity = session.phase === 'ready' && (session.profile?.status === 'DRAFT' || session.profile?.status === 'ACTIVE') ? `${session.account?.id}/${session.profile.id}` : '';
  const [state, setState] = useState(empty), latest = useRef(empty), owner = useRef<Owner | null>(null);
  const install = (next: State) => { latest.current = next; setState(next); };
  const valid = (r: Owner, serial: number) => owner.current === r && !r.lifetime.signal.aborted && r.serial === serial && controller.snapshot.phase === 'ready' && `${controller.snapshot.account?.id}/${controller.snapshot.profile?.id}` === r.identity;
  const refresh = async () => {
    const r = owner.current;
    if (!r || r.mutation || r.read || !valid(r, r.serial)) return;
    const read = new AbortController(), serial = ++r.serial;
    r.read = read;
    const signal = AbortSignal.any([read.signal, r.lifetime.signal]);
    install({ ...latest.current, busy: true, error: '' });
    try {
      const [catalog, answers] = await Promise.all([
        controller.request('/reference/profile-questions', signal).then(parseQuestionCatalog),
        controller.request('/me/profile/question-answers', signal).then(parseQuestionAnswers),
      ]);
      if (valid(r, serial)) { r.uncertain = false; install({ identity: r.identity, catalog, answers, busy: false, uncertain: false, error: '' }); }
    } catch {
      if (valid(r, serial)) install({ ...latest.current, busy: false, error: 'No pudimos actualizar las preguntas. Revisá tu conexión y reintentá la consulta.' });
    } finally { if (r.read === read) r.read = null; }
  };
  useLayoutEffect(() => {
    install({ ...empty, identity });
    if (!identity) return;
    const r: Owner = { identity, lifetime: new AbortController(), read: null, serial: 0, mutation: false, uncertain: false };
    owner.current = r;
    return () => { r.lifetime.abort(); r.read?.abort(); if (owner.current === r) owner.current = null; };
  }, [controller, identity]);
  useEffect(() => {
    if (!active || !identity) return;
    void refresh();
    const resume = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', resume);
    return () => document.removeEventListener('visibilitychange', resume);
  }, [active, identity, controller]);
  const mutate = async (operation: QuestionMutation): Promise<SavedAnswer[] | null> => {
    const r = owner.current, snapshot = latest.current;
    if (!r || r.mutation || r.uncertain || !snapshot.catalog || !valid(r, r.serial)) return null;
    let path = '/me/profile/question-selections', method = 'PUT', body: unknown;
    if (operation.kind === 'selection') {
      if (!selectionValid(operation.questionIds, snapshot.catalog, snapshot.answers)) return null;
      if (sameSelection(operation.questionIds, selectedIds(snapshot.answers))) return snapshot.answers;
      body = { questionIds: [...operation.questionIds] };
    } else {
      const q = snapshot.catalog.questions.find(q => q.id === operation.questionId), saved = snapshot.answers.find(a => a.questionId === operation.questionId);
      if (!q) return null;
      path = `/me/profile/question-answers/${encodeURIComponent(q.id)}`;
      if (operation.kind === 'delete') { if (!saved) return snapshot.answers; method = 'DELETE'; }
      else {
        if (!validateAnswer(operation.answer).valid) return null;
        if (!canSaveAnswer(operation.answer, q, saved)) return snapshot.answers;
        body = { answer: validateAnswer(operation.answer).normalized };
      }
    }
    r.mutation = true; r.read?.abort(); r.read = null;
    const serial = ++r.serial;
    install({ ...snapshot, busy: true, error: '' });
    try {
      const answers = parseQuestionAnswers(await controller.request(path, r.lifetime.signal, method, body));
      if (!valid(r, serial)) return null;
      install({ ...latest.current, answers, busy: false, uncertain: false, error: '' });
      return answers;
    } catch (error) {
      if (valid(r, serial)) {
        r.uncertain = !(error instanceof ApiError && error.kind !== 'invalid' && error.status >= 400 && error.status < 500);
        const message = error instanceof ApiError && error.code === 'LEGAL_ACTION_REQUIRED' ? 'Revisá los documentos legales vigentes en tu perfil antes de continuar.'
          : r.uncertain ? 'No pudimos confirmar el cambio. Conservamos tu borrador. Reintentá la consulta antes de guardar otra vez.'
          : 'El servidor rechazó el cambio. Actualizá las preguntas y revisá tu respuesta o selección.';
        install({ ...latest.current, busy: false, uncertain: r.uncertain, error: message });
      }
      return null;
    } finally { r.mutation = false; }
  };
  return { ...(state.identity === identity ? state : { ...empty, identity }), refresh, mutate };
}
export type ProfileQuestionsModel = ReturnType<typeof useProfileQuestions>;
