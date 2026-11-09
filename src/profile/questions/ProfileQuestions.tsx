import { useLayoutEffect, useRef, useState } from 'react';
import type { HomeNavigation } from '../../home/useHomeNavigation';
import type { ProfileQuestionsModel, QuestionMutation } from './useProfileQuestions';
import { canSaveAnswer, moveSelection, questionRows, sameSelection, selectedIds, selectionValid, validateAnswer } from './presentation';
import './profile-questions.css';

export const isProfileQuestions = (destination: string) => destination === 'profile-questions' || destination.startsWith('profile-question-');
interface Drafts { identity: string; text: Record<string, string>; selection: string[] | null }
interface Feedback { route: string; message: string }
export function ProfileQuestions({ model, navigation, onReturn }: { model: ProfileQuestionsModel; navigation: HomeNavigation; onReturn: () => void }) {
  const { destination, profileQuestionId } = navigation;
  const active = isProfileQuestions(destination), route = `${destination}/${profileQuestionId ?? ''}`;
  const { catalog, answers, identity, busy, uncertain, error } = model;
  const [drafts, setDrafts] = useState<Drafts>({ identity, text: {}, selection: null });
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const heading = useRef<HTMLHeadingElement>(null), visit = useRef(0), previous = useRef(route);
  if (previous.current !== route) { previous.current = route; visit.current++; }
  useLayoutEffect(() => { setDrafts({ identity, text: {}, selection: null }); setFeedback(null); }, [identity]);
  useLayoutEffect(() => {
    setFeedback(null);
    if (active) heading.current?.focus({ preventScroll: true });
  }, [route, active]);
  const rows = catalog ? questionRows(catalog, answers) : [];
  const row = rows.find(r => r.question.id === profileQuestionId);
  useLayoutEffect(() => {
    if (active && catalog && destination === 'profile-question-editor' && !row) navigation.backTo('profile-question-list');
  }, [active, catalog, destination, row, navigation]);
  const ownedDrafts = drafts.identity === identity ? drafts : { identity, text: {}, selection: null };
  const text = profileQuestionId ? ownedDrafts.text[profileQuestionId] ?? row?.answer?.answer ?? '' : '';
  const confirmedSelection = selectedIds(answers), selection = ownedDrafts.selection ?? confirmedSelection;
  const validation = validateAnswer(text), locked = busy || uncertain;
  const eligible = rows.filter(r => r.selectable), invalidSelection = selection.filter(id => !eligible.some(r => r.question.id === id));
  const setSelection = (ids: string[]) => setDrafts(d => ({ ...d, identity, selection: ids }));
  const setText = (value: string) => { if (profileQuestionId) setDrafts(d => ({ ...d, identity, text: { ...d.text, [profileQuestionId]: value } })); };
  const complete = async (kind: 'upsert' | 'delete' | 'selection') => {
    if (locked || (kind !== 'selection' && !row)) return;
    const origin = visit.current, submitted = text;
    const operation: QuestionMutation | null = kind === 'selection' ? { kind, questionIds: selection } : row ? kind === 'delete' ? { kind, questionId: row.question.id } : { kind, questionId: row.question.id, answer: submitted } : null;
    if (!operation) return;
    const questionId = operation.kind === 'selection' ? '' : operation.questionId;
    const result = await model.mutate(operation);
    if (!result) return;
    // A later visit may contain newer typing. Only retire the draft that was submitted.
    setDrafts(d => {
      if (d.identity !== identity) return d;
      if (kind === 'selection') return d.selection === selection ? { ...d, selection: null } : d;
      const id = questionId;
      if (d.text[id] !== submitted) return d;
      const next = { ...d.text }; delete next[id];
      return { ...d, text: next };
    });
    if (origin !== visit.current) return;
    if (kind === 'selection') {
      pendingSelectionFeedback.current = true;
      navigation.backTo('profile-questions');
    } else setFeedback({ route, message: kind === 'delete' ? 'Respuesta eliminada' : 'Respuesta guardada' });
  };
  const pendingSelectionFeedback = useRef(false);
  useLayoutEffect(() => {
    if (pendingSelectionFeedback.current) {
      pendingSelectionFeedback.current = false;
      if (destination === 'profile-questions') setFeedback({ route, message: 'Selección guardada' });
    }
  }, [destination, route]);
  if (!active) return null;
  const title = destination === 'profile-question-list' ? 'Responder preguntas' : destination === 'profile-question-editor' ? 'Editar respuesta' : destination === 'profile-question-selection' ? 'Preguntas públicas' : 'Preguntas del perfil';
  const back = () => destination === 'profile-questions' ? onReturn() : navigation.backTo(destination === 'profile-question-editor' ? 'profile-question-list' : 'profile-questions');
  const openSelection = () => { setSelection(confirmedSelection); navigation.open('profile-question-selection'); };
  return <section className="profile-questions" aria-busy={busy}>
    <header className="home-heading"><h2 ref={heading} tabIndex={-1}>{title}</h2><button className="login-button login-outlined" onClick={back}>Volver</button></header>
    {busy && <p role="status">{catalog ? 'Actualizando preguntas…' : 'Cargando preguntas…'}</p>}
    {error && <p role="alert" className="home-error">{error}</p>}
    {feedback?.route === route && <p role="status">{feedback.message}</p>}
    <button className="login-button login-outlined" disabled={busy} onClick={() => void model.refresh()}>{error || uncertain ? 'Reintentar consulta' : 'Actualizar preguntas'}</button>
    {catalog && <>
      {destination === 'profile-questions' && <div className="home-card question-actions">
        <p>{rows.filter(r => r.answer).length} de {rows.length} respondidas</p><p>{confirmedSelection.length} de 3 elegidas para mostrar</p>
        {!rows.length && <p>No hay preguntas disponibles por ahora.</p>}
        <button className="login-button login-primary" disabled={busy || !rows.length} onClick={() => navigation.open('profile-question-list')}>Responder o editar preguntas</button>
        <button className="login-button login-outlined" disabled={busy || (!eligible.length && !confirmedSelection.length)} onClick={openSelection}>Elegir preguntas públicas</button>
      </div>}
      {destination === 'profile-question-list' && <div className="question-list">{!rows.length && <p>No hay preguntas disponibles por ahora.</p>}{rows.map(({ question, answer, current, selectedPosition }) => <article key={question.id} className="home-card question-actions"><h3>{question.prompt}</h3>
        {answer ? <><p className="question-preview">{answer.answer}</p>{!current ? <p className="home-error">Versión anterior</p> : selectedPosition !== null && <p>Visible en posición {selectedPosition}</p>}</> : <p>Sin responder</p>}
        <button className="login-button login-outlined" disabled={busy} aria-label={`Abrir: ${question.prompt}`} onClick={() => navigation.openProfileQuestion(question.id)}>Abrir</button>
      </article>)}</div>}
      {destination === 'profile-question-editor' && row && <form className="home-card question-actions" onSubmit={e => { e.preventDefault(); if (canSaveAnswer(text, row.question, row.answer)) void complete('upsert'); }}>
        <h3>{row.question.prompt}</h3>{row.answer && !row.current && <p>Versión anterior. Guardá la respuesta para actualizarla.</p>}
        <label htmlFor="profile-question-answer">Tu respuesta</label>
        <textarea id="profile-question-answer" rows={2} value={text} disabled={busy} aria-invalid={!validation.valid} aria-describedby="profile-question-count profile-question-validation" onChange={e => setText(e.target.value)}/>
        <span id="profile-question-count">{validation.count}/160</span><p id="profile-question-validation" className={validation.error ? 'home-error' : undefined}>{validation.error || 'Una sola línea de texto simple.'}</p>
        <div className="question-controls"><button className="login-button login-primary" disabled={locked || !canSaveAnswer(text, row.question, row.answer)} type="submit">Guardar</button><button className="login-button login-outlined" disabled={locked || !row.answer} type="button" onClick={() => void complete('delete')}>Eliminar</button></div>
      </form>}
      {destination === 'profile-question-selection' && <div className="question-list">
        <p>{selection.length} de 3 elegidas para mostrar</p>
        {!eligible.length && <p>Respondé alguna pregunta actual para poder mostrarla en tu perfil.</p>}
        {invalidSelection.map(id => <div className="home-card" key={id}><p>Una pregunta de la selección dejó de estar disponible. Quitala o actualizá su respuesta antes de guardar.</p><button disabled={locked} onClick={() => setSelection(selection.filter(item => item !== id))}>Quitar pregunta no disponible</button></div>)}
        {eligible.map(({ question, answer }) => {
          const index = selection.indexOf(question.id), selected = index >= 0;
          return <article className="home-card question-actions" key={question.id} aria-label={question.prompt}><h3>{question.prompt}</h3><p className="question-preview">{answer?.answer}</p>{selected && <p>Posición {index + 1}</p>}
            <div className="question-controls"><button className="login-button login-outlined" disabled={locked || (!selected && selection.length >= 3)} onClick={() => setSelection(selected ? selection.filter(id => id !== question.id) : [...selection, question.id])}>{selected ? 'Quitar' : 'Agregar'}</button>
              <button className="login-button login-outlined" disabled={locked || index <= 0} onClick={() => setSelection(moveSelection(selection, index, index - 1))}>Subir</button>
              <button className="login-button login-outlined" disabled={locked || !selected || index === selection.length - 1} onClick={() => setSelection(moveSelection(selection, index, index + 1))}>Bajar</button></div>
          </article>;
        })}
        <button className="login-button login-outlined" disabled={locked || !selection.length} onClick={() => setSelection([])}>Limpiar selección</button>
        <button className="login-button login-primary" disabled={locked || !selectionValid(selection, catalog, answers) || sameSelection(selection, confirmedSelection)} onClick={() => void complete('selection')}>Guardar selección</button>
      </div>}
    </>}
  </section>;
}
