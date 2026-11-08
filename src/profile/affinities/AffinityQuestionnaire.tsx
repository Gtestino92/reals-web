import { useLayoutEffect, useRef, useState } from 'react';
import type { HomeDestination } from '../../home/useHomeNavigation';
import type { AffinityModel } from './useAffinityQuestionnaire';
import type { QuestionContext } from './presentation';
import { nextQuestion, presentation, validAnswer } from './presentation';
import './affinities.css';
type Navigation = { destination: HomeDestination; question?: QuestionContext | undefined; open: (d: HomeDestination, q?: QuestionContext, replace?: boolean) => void; backTo: (d: HomeDestination) => void };
export function AffinityQuestionnaire({ model, navigation }: { model: AffinityModel; navigation: Navigation }) {
  const { catalog, answers, busy, uncertain, error } = model;
  const { destination, question: context } = navigation;
  const active = destination === 'affinities' || destination.startsWith('affinity-');
  const route = `${active}/${destination}/${context?.questionId}/${context?.source}/${context?.categoryId}/${context?.reviewAll}`;
  const current = useRef(route); current.current = route;
  const visit = useRef(0), previous = useRef(route);
  if (previous.current !== route) { previous.current = route; visit.current++; }
  const [draft, setDraft] = useState<{ identity: string; questionId: string; semanticVersion: number; code: string } | null>(null);
  useLayoutEffect(() => { setDraft(null); }, [model.identity]);
  const heading = useRef<HTMLHeadingElement>(null);
  const p = catalog ? presentation(catalog, answers) : null;
  const q = p?.questions.find(q => q.id === context?.questionId);
  const parent: HomeDestination = context?.source === 'category' ? 'affinity-categories' : context?.source === 'review' ? 'affinity-review' : 'affinities';
  useLayoutEffect(() => { if (active) heading.current?.focus({ preventScroll: true }); }, [route, active]);
  useLayoutEffect(() => {
    if (destination === 'affinity-question' && catalog && (!q || (context?.source === 'category' && q.categoryId !== context.categoryId) || (context?.source === 'review' && !validAnswer(q, answers)))) navigation.backTo(parent);
  }, [destination, catalog, q, answers, context, parent, navigation]);
  if (!active) return null;
  const saved = q ? validAnswer(q, answers)?.answerCode : undefined;
  const selected = draft?.identity === model.identity && draft.questionId === q?.id && draft.semanticVersion === q.semanticVersion && q.options.some(o => o.code === draft.code) ? draft.code : saved;
  const blocked = busy || uncertain;
  const openQuestion = (questionId: string, source: QuestionContext['source'], categoryId = '', reviewAll = false) => {
    setDraft(null); navigation.open('affinity-question', { questionId, source, categoryId, reviewAll });
  };
  const start = () => { const first = p?.questions.find(q => !validAnswer(q, answers)); if (first) openQuestion(first.id, 'continue'); };
  const advance = (confirmed = answers) => {
    if (!catalog || !context) return;
    const next = nextQuestion(catalog, confirmed, context);
    setDraft(null);
    if (next) navigation.open('affinity-question', { ...context, questionId: next.id }, true);
    else navigation.backTo(parent);
  };
  const save = async (remove = false) => {
    if (!q || blocked || (!remove && !selected)) return;
    const captured = visit.current;
    const result = await model.mutate(q.id, remove ? null : selected ?? null);
    if (result && captured === visit.current && current.current === route) {
      setDraft(null);
      if (remove) { if (context?.source === 'review') navigation.backTo(parent); }
      else advance(result);
    }
  };
  const title = destination === 'affinity-categories' ? 'Explorar por categoría' : destination === 'affinity-review' ? 'Mis respuestas' : q && destination === 'affinity-question' ? catalog?.categories.find(c => c.id === q.categoryId)?.title ?? 'Preguntas de afinidad' : 'Preguntas de afinidad';
  return <section className="affinities" aria-busy={busy}>
    <header className="home-heading"><h2 ref={heading} tabIndex={-1}>{title}</h2><button className="login-button login-outlined" onClick={() => navigation.backTo(destination === 'affinities' ? 'home' : destination === 'affinity-question' ? parent : 'affinities')}>{destination === 'affinities' ? 'Volver a Inicio' : 'Volver'}</button></header>
    {busy && <p role="status">{catalog ? 'Actualizando afinidades…' : 'Cargando preguntas…'}</p>}
    {error && <p role="alert" className="home-error">{error}</p>}
    <button className="login-button login-outlined" disabled={busy} onClick={() => void model.refresh()}>{error || uncertain ? 'Reintentar' : 'Actualizar preguntas'}</button>
    {p && <>
      <p>{p.answered} de {p.total} respondidas</p>
      <progress aria-label="Progreso de afinidades" value={p.answered} max={p.total || 1}/>
      {destination === 'affinities' && <div className="home-card affinity-actions">
        <p>Tus respuestas son opcionales y privadas. Otras personas no ven tus respuestas concretas. Reals puede usarlas para mejorar afinidades, proponer temas de conversación y mostrar categorías generales compartidas.</p>
        {!p.total ? <p>No hay preguntas disponibles por ahora.</p> : <><button className="login-button login-primary" onClick={p.complete ? () => navigation.open('affinity-review') : start}>{p.action}</button><button className="login-button login-outlined" onClick={() => navigation.open('affinity-categories')}>Explorar por categoría</button></>}
        {!p.answered ? <p>Todavía no hay respuestas para revisar.</p> : !p.complete && <button className="login-button login-outlined" onClick={() => navigation.open('affinity-review')}>Revisar mis respuestas</button>}
      </div>}
      {destination === 'affinity-categories' && <div className="home-grid">{p.groups.map(({ category, questions }) => {
        const count = questions.filter(q => validAnswer(q, answers)).length, reviewAll = count === questions.length;
        const first = questions.find(q => reviewAll || !validAnswer(q, answers));
        return <article className="home-card affinity-actions" key={category.id}><h3>{category.title}</h3>{category.description && <p>{category.description}</p>}<p>{count} de {questions.length} respondidas</p><button className="login-button login-primary" onClick={() => first && openQuestion(first.id, 'category', category.id, reviewAll)}>{reviewAll ? 'Revisar categoría' : count ? 'Continuar categoría' : 'Empezar categoría'}</button></article>;
      })}</div>}
      {destination === 'affinity-review' && <>{!p.answered && <><p>Todavía no hay respuestas para revisar.</p>{p.total > 0 && <button className="login-button login-primary" onClick={start}>Empezar a responder</button>}</>}{p.groups.map(({ category, questions }) => {
        const rows = questions.filter(q => validAnswer(q, answers));
        return rows.length > 0 && <section key={category.id}><h3>{category.title}</h3>{rows.map(q => <article className="home-card affinity-review-row" key={q.id}><h4>{q.prompt}</h4><p>{q.options.find(o => o.code === validAnswer(q, answers)?.answerCode)?.label}</p><button className="login-button login-outlined" aria-label={`Editar: ${q.prompt}`} onClick={() => openQuestion(q.id, 'review')}>Editar respuesta</button></article>)}</section>;
      })}</>}
      {destination === 'affinity-question' && q && <div className="home-card affinity-actions">
        {context?.source !== 'review' && <p>Pregunta {p.questions.filter(item => context?.source !== 'category' || item.categoryId === context.categoryId).findIndex(item => item.id === q.id) + 1} de {p.questions.filter(item => context?.source !== 'category' || item.categoryId === context.categoryId).length}</p>}
        <fieldset disabled={blocked}><legend>{q.prompt}</legend>{q.options.map(o => <label className="affinity-option" key={o.code}><input type="radio" name={q.id} checked={selected === o.code} onChange={() => setDraft({ identity: model.identity, questionId: q.id, semanticVersion: q.semanticVersion, code: o.code })}/><span>{o.label}</span></label>)}</fieldset>
        {saved && <button disabled={blocked} className="login-button login-outlined" onClick={() => void save(true)}>Quitar respuesta</button>}
        {!selected && context?.source !== 'review' && <button className="login-button login-outlined" disabled={busy} onClick={() => advance()}>Omitir</button>}
        <button className="login-button login-primary" disabled={blocked || !selected} onClick={() => context?.source === 'review' && selected === saved ? navigation.backTo(parent) : void save()}>{busy ? 'Guardando…' : context?.source === 'review' ? selected !== saved ? 'Guardar cambios' : 'Volver a mis respuestas' : 'Siguiente'}</button>
      </div>}
    </>}
  </section>;
}
