import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { HomeNavigation } from '../../home/useHomeNavigation';
import type { ProfileQuestionsModel, QuestionMutation } from './useProfileQuestions';
import { canSaveAnswer, moveSelection, questionRows, sameSelection, selectedIds, selectionValid, validateAnswer } from './presentation';
import './profile-questions.css';

export const isProfileQuestions = (destination: string) => destination === 'profile-questions' || destination.startsWith('profile-question-');
interface Drafts { identity: string; text: Record<string, string>; selection: string[] | null }
interface Feedback { route: string; message: string; questionId?: string }
export function ProfileQuestions({ model, navigation, onReturn }: { model: ProfileQuestionsModel; navigation: HomeNavigation; onReturn: () => void }) {
  const { destination, profileQuestionId } = navigation;
  const active = isProfileQuestions(destination), route = `${destination}/${profileQuestionId ?? ''}`;
  const { catalog, answers, identity, busy, uncertain, error } = model;
  const [drafts, setDrafts] = useState<Drafts>({ identity, text: {}, selection: null });
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const pendingEditFocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    const id = pendingEditFocus.current;
    pendingEditFocus.current = null;
    if (id && active) editButtons.current.get(id)?.focus({ preventScroll: true });
  }, [editing, active]);
  const editorOrigin = useRef<'profile-questions' | 'profile-question-list'>('profile-question-list');
  const previousDestination = useRef(destination);
  if (previousDestination.current !== destination) {
    if (destination === 'profile-question-editor') editorOrigin.current = previousDestination.current === 'profile-question-list' ? 'profile-question-list' : 'profile-questions';
    previousDestination.current = destination;
  }
  const heading = useRef<HTMLHeadingElement>(null), visit = useRef(0), previous = useRef(route);
  if (previous.current !== route) { previous.current = route; visit.current++; }
  useLayoutEffect(() => { setDrafts({ identity, text: {}, selection: null }); setFeedback(null); setEditing(null); }, [identity]);
  useLayoutEffect(() => {
    setFeedback(null);
    if (active) heading.current?.focus({ preventScroll: true });
  }, [route, active]);
  const rows = catalog ? questionRows(catalog, answers) : [];
  const row = rows.find(r => r.question.id === profileQuestionId);
  useLayoutEffect(() => {
    if (active && catalog && destination === 'profile-question-editor' && !row) navigation.backTo(editorOrigin.current);
  }, [active, catalog, destination, row, navigation]);
  const ownedDrafts = drafts.identity === identity ? drafts : { identity, text: {}, selection: null };
  const confirmedSelection = selectedIds(answers), selection = ownedDrafts.selection ?? confirmedSelection;
  const locked = busy || uncertain;
  const answerText = (row: ReturnType<typeof questionRows>[number]) => ownedDrafts.text[row.question.id] ?? row.answer?.answer ?? '';
  const eligible = rows.filter(r => r.selectable), invalidSelection = selection.filter(id => !eligible.some(r => r.question.id === id));
  const setSelection = (ids: string[]) => setDrafts(d => ({ ...d, identity, selection: ids }));
  const setText = (id: string, value: string) => setDrafts(d => ({ ...d, identity, text: { ...d.text, [id]: value } }));
  const cancelEdit = (id: string) => {
    if (busy) return;
    setDrafts(d => {
      if (d.identity !== identity) return d;
      const text = { ...d.text }; delete text[id];
      return { ...d, text };
    });
    pendingEditFocus.current = id;
    setEditing(null);
  };
  const complete = async (kind: 'upsert' | 'delete' | 'selection', targetId = profileQuestionId) => {
    const row = rows.find(item => item.question.id === targetId);
    if (locked || (kind !== 'selection' && !row)) return;
    const origin = visit.current, submitted = row ? answerText(row) : '';
    const operation: QuestionMutation | null = kind === 'selection' ? { kind, questionIds: selection } : row ? kind === 'delete' ? { kind, questionId: row.question.id } : { kind, questionId: row.question.id, answer: submitted } : null;
    if (!operation) return;
    const questionId = operation.kind === 'selection' ? '' : operation.questionId;
    const result = await model.mutate(operation);
    if (!result) return;
    if (kind === 'delete') setEditing(current => current === questionId ? null : current);
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
    if (kind === 'upsert' && editing === questionId) {
      pendingEditFocus.current = questionId;
      setEditing(current => current === questionId ? null : current);
    }
    if (kind === 'selection') {
      if (destination === 'profile-questions') setFeedback({ route, message: 'Selección guardada' });
      else { pendingSelectionFeedback.current = true; navigation.backTo('profile-questions'); }
    } else {
      setFeedback({ route, questionId, message: kind === 'delete' ? 'Respuesta eliminada' : 'Respuesta guardada' });
      if (kind === 'upsert' && destination === 'profile-question-list') heading.current?.focus({ preventScroll: true });
    }
  };
  const pendingSelectionFeedback = useRef(false);
  useLayoutEffect(() => {
    if (pendingSelectionFeedback.current) {
      pendingSelectionFeedback.current = false;
      if (destination === 'profile-questions') setFeedback({ route, message: 'Selección guardada' });
    }
  }, [destination, route]);
  const renderAnswer = (row: ReturnType<typeof questionRows>[number], inlineEdit = false) => <AnswerForm
    question={row.question} answer={row.answer} current={row.current} text={answerText(row)} busy={busy} locked={locked}
    cancel={inlineEdit ? () => cancelEdit(row.question.id) : undefined}
    touched={Object.hasOwn(ownedDrafts.text, row.question.id)}
    change={value => setText(row.question.id, value)} save={() => void complete('upsert', row.question.id)}
    feedback={feedback?.route === route && feedback.questionId === row.question.id ? feedback.message : ''}
  />;
  const inlineFeedback = feedback?.questionId && rows.some(r => r.question.id === feedback.questionId && (destination === 'profile-question-list' ? !r.answer : destination === 'profile-question-editor' ? r.question.id === profileQuestionId : !!r.answer && editing === r.question.id));
  if (!active) return null;
  const title = destination === 'profile-question-list' ? 'Responder preguntas' : destination === 'profile-question-editor' ? 'Editar respuesta' : destination === 'profile-question-selection' ? 'Preguntas públicas' : 'Preguntas del perfil';
  const back = () => destination === 'profile-questions' ? onReturn() : navigation.backTo(destination === 'profile-question-editor' ? editorOrigin.current : 'profile-questions');
  return <section className="profile-questions" aria-busy={busy}>
    <header className="home-heading"><h2 ref={heading} tabIndex={-1}>{title}</h2><button className="login-button login-outlined" onClick={back}>Volver</button></header>
    {busy && <p className={catalog ? "home-loading-status" : undefined} role="status">{catalog ? 'Actualizando preguntas…' : 'Cargando preguntas…'}</p>}
    {busy && !catalog && <div className="home-placeholder" aria-hidden="true"><div className="home-card home-placeholder-search"><span/><span/><span/></div></div>}
    {error && <p role="alert" className="home-error">{error}</p>}
    {feedback?.route === route && !inlineFeedback && <p role="status">{feedback.message}</p>}
    {(error || uncertain) && <button className="login-button login-outlined" disabled={busy} onClick={() => void model.refresh()}>Reintentar consulta</button>}
    {catalog && <>
      {destination === 'profile-questions' && <div className="home-card question-actions">
        <p>{rows.filter(r => r.answer).length} de {rows.length} respondidas</p>
        {!rows.length && <p>No hay preguntas disponibles por ahora.</p>}
        <button className="login-button login-primary" disabled={busy || !rows.some(r => !r.answer)} onClick={() => navigation.open('profile-question-list')}>Responder nuevas preguntas</button>
      </div>}
      {destination === 'profile-question-list' && <div className="question-list">
        {!rows.some(r => !r.answer) && <p>No hay preguntas nuevas por responder.</p>}
        {rows.filter(r => !r.answer).map(row => <article key={row.question.id} className="home-card question-actions" aria-label={row.question.prompt}>{renderAnswer(row)}</article>)}
      </div>}
      {destination === 'profile-question-editor' && row && <article className="home-card question-actions" aria-label={row.question.prompt}>{renderAnswer(row)}</article>}
      {(destination === 'profile-questions' || destination === 'profile-question-selection') && <div className="question-list">
        <h3>Preguntas públicas</h3><p>Elegí hasta tres respuestas para mostrar en tu perfil. Podés cambiar su orden.</p>
        <p>{selection.length} de 3 elegidas para mostrar</p>
        {!eligible.length && <p>Respondé alguna pregunta actual para poder mostrarla en tu perfil.</p>}
        {invalidSelection.map(id => <div className="home-card" key={id}><p>Una pregunta de la selección dejó de estar disponible. Quitala o actualizá su respuesta antes de guardar.</p><button disabled={locked} onClick={() => setSelection(selection.filter(item => item !== id))}>Quitar pregunta no disponible</button></div>)}
        {[...eligible].sort((a,b) => { const ai=selection.indexOf(a.question.id), bi=selection.indexOf(b.question.id); return (ai<0 ? Infinity : ai)-(bi<0 ? Infinity : bi); }).concat(rows.filter(row => row.answer && !row.selectable)).map(row => {
          const { question, answer } = row;
          const index = selection.indexOf(question.id), selected = row.selectable && index >= 0;
          return <article className="home-card question-actions" data-selected={selected} key={question.id} aria-label={question.prompt}><h3>{question.prompt}</h3>{!row.current && <p>Versión anterior</p>}{editing === question.id ? renderAnswer(row, true) : <p className="question-preview">{answer?.answer}</p>}{selected && <p>Posición {index + 1}</p>}
            {editing !== question.id && <div className="question-controls"><button ref={button => { if (button) editButtons.current.set(question.id, button); else editButtons.current.delete(question.id); }} className="login-button login-outlined" disabled={busy} aria-expanded={editing === question.id} aria-label={`Editar: ${question.prompt}`} onClick={() => setEditing(editing === question.id ? null : question.id)}>{row.current ? 'Editar respuesta' : 'Actualizar respuesta'}</button><button className="login-button login-outlined" disabled={locked} onClick={() => void complete('delete', question.id)}>Eliminar</button>{row.selectable && <><button className="login-button login-outlined" disabled={locked || (!selected && selection.length >= 3)} onClick={() => setSelection(selected ? selection.filter(id => id !== question.id) : [...selection, question.id])}>{selected ? 'Quitar' : 'Agregar'}</button>
              <button className="login-button login-outlined" disabled={locked || index <= 0} onClick={() => setSelection(moveSelection(selection, index, index - 1))}>Subir</button>
              <button className="login-button login-outlined" disabled={locked || !selected || index === selection.length - 1} onClick={() => setSelection(moveSelection(selection, index, index + 1))}>Bajar</button></>}</div>}
          </article>;
        })}

        <button className="login-button login-outlined" disabled={locked || !selection.length} onClick={() => setSelection([])}>Limpiar selección</button>
        <button className="login-button login-primary" disabled={locked || !selectionValid(selection, catalog, answers) || sameSelection(selection, confirmedSelection)} onClick={() => void complete('selection')}>Guardar selección</button>
      </div>}
    </>}
  </section>;
}

function AnswerForm({ question, answer, current, text, busy, locked, touched, change, save, feedback, cancel }: {
  question: ReturnType<typeof questionRows>[number]['question']; answer: ReturnType<typeof questionRows>[number]['answer'];
  current: boolean; text: string; busy: boolean; locked: boolean; touched: boolean; change: (text: string) => void; save: () => void; feedback: string; cancel?: (() => void) | undefined;
}) {
  const id = useId(), validation = validateAnswer(text), showError = touched && !!validation.error;
  const input = useRef<HTMLTextAreaElement>(null), editingSaved = !!answer;
  useLayoutEffect(() => { if (editingSaved) input.current?.focus({ preventScroll: true }); }, [editingSaved]);
  return <form className="question-actions" aria-label={`${answer ? 'Editar' : 'Responder'}: ${question.prompt}`} onSubmit={event => { event.preventDefault(); if (!locked && canSaveAnswer(text, question, answer)) save(); }}>
    {!answer && <h3>{question.prompt}</h3>}
    {answer && !current && <p>Versión anterior. Guardá la respuesta para actualizarla.</p>}
    <label htmlFor={id}>Tu respuesta</label>
    <textarea ref={input} id={id} rows={2} value={text} disabled={busy} aria-invalid={showError || undefined} aria-describedby={`${id}-count${showError ? ` ${id}-error` : ''}`} onChange={event => change(event.target.value)}/>
    <span id={`${id}-count`}>{validation.count}/160</span>
    {showError && <p id={`${id}-error`} className="home-error">{validation.error}</p>}
    <button className="login-button login-primary" disabled={locked || !canSaveAnswer(text, question, answer)} type="submit">Guardar</button>
    {cancel && <button className="login-button login-outlined" type="button" disabled={busy} onClick={cancel}>Cancelar edición</button>}
    {feedback && <p role="status">{feedback}</p>}
  </form>;
}
