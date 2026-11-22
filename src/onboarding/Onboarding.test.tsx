import { confirmSignOut } from '../test/signOut';
import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OperationalApp as App } from '../App';
import { ApiClient, object } from '../auth/api';
import { questionCatalog, savedAnswer } from '../profile/questions/fixtures';
import type { SavedAnswer } from '../profile/questions/contracts';
import type { AuthService, Identity } from '../auth/firebase';
import { defaults } from './contracts';
import { emptyHome, homeStatus } from '../home/fixtures';
// Real canvas/export/cleanup behavior is covered in CropDialog tests.
vi.mock('./CropDialog', () => ({ CropDialog: ({ file, onConfirm, onCancel }: { file: File; onConfirm: (blob: Blob) => Promise<void>; onCancel: () => void }) => <div role="dialog" aria-label={file.name}><button onClick={() => void onConfirm(new Blob(['jpeg'],{ type:'image/jpeg' }))}>Confirmar recorte</button><button onClick={onCancel}>Cancelar recorte</button></div> }));
const initialProfile = { ...defaults, birthDate:'1995-01-01',displayName:'Ana',city:'Córdoba',countryCode:'AR',id:'p',userId:'u',status:'DRAFT',authenticityVerificationStatus:'STALE' };
const initialPhoto = { id:'photo',url:'http://localhost:9000/photo',position:1,validationStatus:'VALIDATED',moderationStatus:'APPROVED',isPersonPhoto:true,isFullBody:true };
let profile: typeof initialProfile | null, list: typeof initialPhoto[], satisfied: boolean, version: string;
let user: Identity, auth: AuthService;
let observer: (user: Identity | null) => void;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
const json = (body: unknown,status = 200) => new Response(JSON.stringify(body),{ status });
const document = () => ({ type:'PRIVACY_NOTICE',version,requiredAction:'ACKNOWLEDGED',satisfied,url:'https://example.com/privacy' });
beforeEach(() => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  profile = null; list = []; satisfied = true; version = 'v1';
  user = { uid:'f',emailVerified:true,getIdToken:vi.fn().mockResolvedValue('token'),reload:vi.fn().mockResolvedValue(undefined) };
  auth = { observe:vi.fn(next => { observer = next; next(user); return vi.fn(); }),signIn:vi.fn(),signUp:vi.fn(),google:vi.fn(),verify:vi.fn().mockResolvedValue(undefined),signOut:vi.fn().mockResolvedValue(undefined) };
  fetcher = vi.fn<typeof fetch>().mockImplementation(async (input,options) => {
    const path = String(input), method = options?.method ?? 'GET';
    if (path === '/api/matchmaking/queue') return json({ userId:'u', inQueue:false });
    if (path === '/api/me') return json({ id:'u',status:'ACTIVE' });
    if (path === '/api/reference/countries') return json([{ code:'AR',displayName:'Argentina' },{ code:'ES',displayName:'España' }]);
    if (path === '/api/me/legal-status') return json({ requirementsSatisfied:satisfied,documents:[document()] });
    if (path === '/api/legal/documents/current') return json({ documents:[document()] });
    if (path === '/api/me/legal-document-actions') { const body = JSON.parse(String(options?.body)); if (body.documentVersion !== version) return json({ code:'LEGAL_DOCUMENT_VERSION_MISMATCH' },409); satisfied = true; return json({}); }
    if (path === '/api/me/profile' && method !== 'GET') { const body = JSON.parse(String(options?.body)); profile = { ...(profile ?? initialProfile),...body }; return json(profile,method === 'POST' ? 201 : 200); }
    if (path === '/api/me/profile') return profile ? json(profile) : json({ code:'PROFILE_NOT_FOUND' },404);
    if (path === '/api/me/profile/photos' && method === 'GET') return json(list);
    if (path === '/api/me/home/status') return json(homeStatus());
    if (path === '/api/me/home') return json({ ...emptyHome(), profileStatus:profile?.status ?? null, pendingActions:[],nextSteps:[],passiveNotices:[],activeInteractionsSummary:{ hasPendingSchedulingConnection:false,activeInitialCount:0,activeConnectionCount:0,actionableConnectionCount:0 } });
    if (path === '/api/me/profile/match-filters') { profile = { ...initialProfile,...profile,...JSON.parse(String(options?.body)) }; return json(profile); }
    if (path === '/api/me/profile/activation') { profile = { ...initialProfile,status:'ACTIVE' }; return json(profile); }
    if (path.endsWith('/photos/reorder')) { const placements: { photoId:string; position:number }[] = JSON.parse(String(options?.body)).placements; list = list.map(p => ({ ...p,position:placements.find(x => x.photoId === p.id)?.position ?? p.position })); return json(list); }
    if (method === 'DELETE') { list = list.filter(x => !path.endsWith(x.id)); return json(profile); }
    throw new Error(`Unexpected test endpoint: ${method} ${path}`);
  });
});
function mount(localVerification = false) { return render(<StrictMode><App firebase={{ service:auth,localVerification }} api={new ApiClient(fetcher)}/></StrictMode>); }
it('creates once, preserves the setup editor through history, and restores photos and activation after reload', async () => {
  const original = mount();
  fireEvent.submit(await createForm());
  const edit = await screen.findByRole('button',{name:'Editar datos y preferencias'});
  expect(screen.queryByRole('form',{name:'Crear perfil'})).toBeNull();
  fireEvent.click(edit);
  const form = screen.getByRole('form',{name:'Datos del perfil'});
  const city = within(form).getByLabelText('Ciudad');
  fireEvent.change(city,{target:{value:'Rosario'}});
  expect(screen.queryByRole('button',{name:'Activar perfil'})).toBeNull();
  act(()=>history.back());
  await waitFor(()=>expect(edit).toHaveFocus());
  act(()=>history.forward());
  expect(await screen.findByRole('heading',{name:'Datos y preferencias'})).toHaveFocus();
  expect(city).toHaveValue('Rosario');
  fireEvent.submit(form);
  await screen.findByText('Cambios guardados.');
  expect(writes('PATCH')).toHaveLength(1);
  expect(writes('POST')).toHaveLength(1);
  original.unmount();
  mount();
  fireEvent.click(await screen.findByRole('button',{name:'Editar datos y preferencias'}));
  expect(within(screen.getByRole('form',{name:'Datos del perfil'})).getByLabelText('Ciudad')).toHaveValue('Rosario');
  expect(writes('POST')).toHaveLength(1);
});
it.each(['DRAFT', 'INACTIVE'])('reuses confirmed recoverable deletion in %s setup and excludes duplicate/coupled writes', async status => {
  profile = { ...initialProfile, status };
  let finish!: (value: Response) => void;
  const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url, options) => url === '/api/me' && options?.method === 'DELETE' ? new Promise(resolve => { finish = resolve; }) : base(url, options));
  mount(); await screen.findByRole('heading', { name: 'Completá tu perfil' });
  expect(screen.queryByRole('button', { name: 'Cerrar sesión' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Cuenta' }));
  const remove = screen.getByRole('button', { name: 'Eliminar cuenta' }); fireEvent.click(remove); expect(writes('DELETE')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' })); fireEvent.click(remove); fireEvent.click(screen.getByRole('button', { name: 'Programar eliminación' })); fireEvent.click(remove);
  await waitFor(() => expect(writes('DELETE')).toHaveLength(1)); expect(auth.signOut).not.toHaveBeenCalled();
  const details = screen.getByRole('form', { name: 'Datos del perfil', hidden: true }); fireEvent.submit(details); expect(writes('PATCH')).toHaveLength(0);
  await act(async () => finish(new Response(null, { status: 200 })));
  await screen.findByRole('button', { name: 'Ingresar' }); expect(auth.signOut).toHaveBeenCalledOnce();
});
it('keeps uncertain setup deletion blocked and offers authoritative account reconciliation', async () => {
  profile = { ...initialProfile }; const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url, options) => url === '/api/me' && options?.method === 'DELETE' ? Promise.reject(new TypeError('offline')) : base(url, options));
  mount(); await screen.findByRole('heading', { name: 'Completá tu perfil' }); fireEvent.click(screen.getByRole('button', { name: 'Cuenta' }));
  const remove = screen.getByRole('button', { name: 'Eliminar cuenta' }); fireEvent.click(remove); fireEvent.click(screen.getByRole('button', { name: 'Programar eliminación' }));
  await screen.findByRole('alert'); expect(remove).toBeDisabled(); fireEvent.click(remove); expect(writes('DELETE')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Consultar estado de la cuenta' })).toBeEnabled(); expect(auth.signOut).not.toHaveBeenCalled();
});
function reorderWithKeyboard(source: number,target: number) {
  const handle = screen.getByRole('button',{ name:`Reordenar foto ${source}` });
  fireEvent.keyDown(handle,{ key:' ' }); fireEvent.keyDown(handle,{ key:'Home' });
  for (let i=1; i<target; i++) fireEvent.keyDown(handle,{ key:'ArrowRight' });
  fireEvent.keyDown(handle,{ key:'Enter' });
}
const writes = (method: string) => fetcher.mock.calls.filter(x => x[1]?.method === method);
afterEach(() => vi.useRealTimers());
async function openManagement(name: string) {
  profile = { ...initialProfile, status:'ACTIVE', preferredMinAge:27, preferredMaxAge:43, maxDistanceKm:62 };
  mount();
  const entry = await screen.findByRole('button', { name });
  await waitFor(() => expect(entry).toBeEnabled()); fireEvent.click(entry);
}
function installQuestions(initial: SavedAnswer[] = []) {
  let answers = initial;
  const catalog = questionCatalog(), base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (input, options) => {
    const path = String(input), method = options?.method ?? 'GET';
    if (path === '/api/reference/profile-questions') return json(catalog);
    if (!path.startsWith('/api/me/profile/question-')) return base(input, options);
    const body: unknown = options?.body ? JSON.parse(String(options.body)) : null;
    if (method === 'PUT' && path.endsWith('/question-selections')) {
      if (!object(body) || !Array.isArray(body.questionIds)) throw new Error('Invalid test selection');
      const ids = body.questionIds; answers = answers.map(a => ({ ...a, selectedPosition: ids.includes(a.questionId) ? ids.indexOf(a.questionId) + 1 : null }));
    } else if (method === 'PUT') {
      if (!object(body) || typeof body.answer !== 'string') throw new Error('Invalid test answer');
      const id = path.split('/').at(-1)!;
      answers = [...answers.filter(a => a.questionId !== id), savedAnswer(id, { answer: body.answer, selectedPosition: answers.find(a => a.questionId === id)?.selectedPosition ?? null })];
    } else if (method === 'DELETE') {
      answers = answers.filter(a => !path.endsWith(`/${a.questionId}`));
      const selected = answers.filter(a => a.selectedPosition !== null).sort((a,b) => (a.selectedPosition ?? 0) - (b.selectedPosition ?? 0));
      answers = answers.map(a => ({ ...a, selectedPosition: selected.includes(a) ? selected.indexOf(a) + 1 : null }));
    }
    return json({ answers });
  });
  return { catalog };
}
async function openProfileQuestions() {
  const entry = await screen.findByRole('button', { name: 'Responder o editar' });
  await waitFor(() => expect(entry).toBeEnabled()); fireEvent.click(entry);
  await screen.findByRole('button', { name: 'Responder nuevas preguntas' });
}
it('keeps profile focus and drafts on resume, supersedes a quiet read when saving and rejects its late snapshot', async () => {
  await openManagement('Tu perfil');
  const bio = await screen.findByLabelText('Bio (opcional)');
  fireEvent.change(bio, { target: { value: 'Borrador con ñ' } }); bio.focus();
  const base = fetcher.getMockImplementation()!;
  let finish!: (response: Response) => void;
  let held = false;
  fetcher.mockImplementation((path, options) => {
    if (!held && path === '/api/me/profile' && (!options?.method || options.method === 'GET')) { held = true; return new Promise(resolve => { finish = resolve; }); }
    return base(path, options);
  });
  const before = fetcher.mock.calls.length;
  refreshView(); await waitFor(() => expect(finish).toBeDefined());
  const signal = fetcher.mock.calls.slice(before).find(([path]) => path === '/api/me/profile')![1]!.signal!;
  expect(bio).toHaveFocus(); expect(bio).toBeEnabled(); expect(bio).toHaveValue('Borrador con ñ');
  expect(screen.queryByText('Guardando…')).toBeNull(); expect(screen.queryByText('Actualizando estado…')).toBeNull();
  expect(writes('PATCH')).toHaveLength(0);
  fetcher.mockImplementation(base);
  fireEvent.submit(screen.getByRole('form', { name: 'Datos del perfil' }));
  await screen.findByText('Cambios guardados.'); expect(signal.aborted).toBe(true);
  await act(async () => finish(json({ ...initialProfile, status: 'ACTIVE', bio: 'Obsoleto' })));
  expect(bio).toHaveValue('Borrador con ñ'); expect(writes('PATCH')).toHaveLength(1);
});
it('does not interrupt a foreground mutation on repeated visibility events', async () => {
  await openManagement('Tu perfil');
  const bio = await screen.findByLabelText('Bio (opcional)');
  const guidance = window.document.getElementById('photo-upload-guidance')!;
  const guidanceText = guidance.textContent;
  fireEvent.change(bio, { target: { value: 'Cambio explícito' } });
  const base = fetcher.getMockImplementation()!;
  let signal: AbortSignal | undefined, finish!: (response: Response) => void;
  fetcher.mockImplementation((path, options) => path === '/api/me/profile' && options?.method === 'PATCH' ? new Promise(resolve => { signal = options.signal!; finish = resolve; }) : base(path, options));
  fireEvent.submit(screen.getByRole('form', { name: 'Datos del perfil' }));
  await waitFor(() => expect(finish).toBeDefined());
  expect(guidance).toHaveTextContent(guidanceText!);
  expect(screen.getByLabelText('Bio (opcional)')).toBeDisabled();
  const count = fetcher.mock.calls.length;
  act(() => { window.document.dispatchEvent(new Event('visibilitychange')); window.document.dispatchEvent(new Event('visibilitychange')); });
  fireEvent.submit(screen.getByRole('form', { name: 'Datos del perfil' }));
  expect(fetcher).toHaveBeenCalledTimes(count); expect(signal!.aborted).toBe(false);
  expect(screen.getByRole('button', { name: 'Volver a Inicio' })).toBeDisabled();
  await act(async () => finish(json(profile)));
  await screen.findByText('Cambios guardados.'); expect(bio).toHaveValue('Cambio explícito');
  expect(writes('PATCH')).toHaveLength(1);
  installQuestions([]); await openProfileQuestions();
  fireEvent.click(screen.getByRole('button', { name:'Volver' }));
  await screen.findByRole('heading', { name:'Tu perfil' });
  expect(screen.queryByText('Cambios guardados.')).toBeNull();
  expect(guidance).toHaveTextContent(guidanceText!);
});
it.each(['success', 'failure'] as const)('supersedes a pending background read from the enabled retry button and preserves %s feedback', async outcome => {
  await openManagement('Tu perfil');
  const bio = await screen.findByLabelText('Bio (opcional)');
  fireEvent.change(bio, { target: { value: 'Mi borrador con ñ' } });
  const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((path, options) => path === '/api/me/profile' ? Promise.reject(new TypeError('offline')) : base(path, options));
  act(() => window.document.dispatchEvent(new Event('visibilitychange')));
  await screen.findByRole('alert');
  const retry = screen.getByRole('button', { name: 'Consultar estado' });
  expect(retry).toBeEnabled(); retry.focus();

  const reads: { signal: AbortSignal; finish: (response: Response) => void }[] = [];
  fetcher.mockImplementation((path, options) => path === '/api/me/profile' ? new Promise(resolve => { reads.push({ signal: options!.signal!, finish: resolve }); }) : base(path, options));
  act(() => window.document.dispatchEvent(new Event('visibilitychange')));
  await waitFor(() => expect(reads).toHaveLength(1));
  act(() => { window.document.dispatchEvent(new Event('visibilitychange')); window.document.dispatchEvent(new Event('visibilitychange')); });
  expect(reads).toHaveLength(1); expect(reads[0]!.signal.aborted).toBe(false);
  expect(retry).toBeEnabled(); expect(retry).toHaveFocus(); expect(screen.getByRole('alert')).toBeVisible();
  fireEvent.click(retry);
  expect(reads[0]!.signal.aborted).toBe(true);
  await waitFor(() => expect(reads).toHaveLength(2));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('Actualizando estado…')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Volver a Inicio' })).toBeDisabled();
  act(() => window.document.dispatchEvent(new Event('visibilitychange')));
  expect(reads).toHaveLength(2); expect(reads[1]!.signal.aborted).toBe(false);
  await act(async () => reads[1]!.finish(outcome === 'success' ? json(profile) : json({ code: 'TEMPORARILY_UNAVAILABLE' }, 503)));
  if (outcome === 'failure') {
    expect(screen.getByRole('alert')).toBeVisible(); expect(screen.getByRole('button', { name: 'Consultar estado' })).toBeEnabled();
  } else {
    expect(screen.queryByRole('alert')).toBeNull(); expect(screen.queryByRole('button', { name: 'Consultar estado' })).toBeNull();
  }
  await act(async () => reads[0]!.finish(json({ ...initialProfile, status: 'DRAFT' })));
  expect(screen.queryByText('Estado: DRAFT')).toBeNull();
  expect(bio).toHaveValue('Mi borrador con ñ'); expect(bio).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Volver a Inicio' })).toBeEnabled();
  expect(writes('PATCH')).toHaveLength(0); expect(writes('PUT')).toHaveLength(0); expect(writes('POST')).toHaveLength(0);
  if (outcome === 'failure') {
    expect(screen.getByRole('alert')).toBeVisible(); fetcher.mockImplementation(base);
    fireEvent.click(screen.getByRole('button', { name: 'Consultar estado' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await waitFor(() => expect(bio).toBeEnabled());
  }
});
it('shows public answers and selection on entry, reserves the extra list for unanswered questions and defers pristine errors', async () => {
  installQuestions([savedAnswer('A', { selectedPosition: 1 }), savedAnswer('B')]); await openManagement('Tu perfil'); await openProfileQuestions();
  expect(screen.getByRole('article', { name: 'Pregunta A' })).toHaveTextContent('Posición 1');
  expect(screen.getByRole('article', { name: 'Pregunta B' })).toHaveTextContent('Respuesta B');
  fireEvent.click(screen.getByRole('button', { name: 'Responder nuevas preguntas' }));
  expect(screen.queryByRole('button', { name: 'Editar: Pregunta A' })).toBeNull();
  const text = within(screen.getByRole('article', { name: 'Pregunta C' })).getByLabelText('Tu respuesta');
  expect(text).not.toHaveAttribute('aria-invalid', 'true');
  expect(screen.queryByText('Escribí una respuesta para guardar.')).toBeNull();
  expect(screen.queryByText('Una sola línea de texto simple.')).toBeNull();
  text.focus(); fireEvent.change(text, { target: { value: 'Mi borrador' } });
  const before = writes('PUT').length;
  refreshView();
  await waitFor(() => expect(screen.queryByText('Actualizando preguntas…')).toBeNull());
  expect(text).toHaveFocus(); expect(text).toBeEnabled(); expect(text).toHaveValue('Mi borrador'); expect(writes('PUT')).toHaveLength(before);
  fireEvent.change(text, { target: { value: 'dos\nlíneas' } });
  expect(screen.getByText('La respuesta debe escribirse en una sola línea.')).toBeVisible();
});
it('answers directly in the list, preserves independent drafts and saves only the addressed question', async () => {
  installQuestions(); await openManagement('Tu perfil'); await openProfileQuestions();
  fireEvent.click(screen.getByRole('button', { name: 'Responder nuevas preguntas' }));
  const first = within(screen.getByRole('form', { name: 'Responder: Pregunta A' })), second = within(screen.getByRole('form', { name: 'Responder: Pregunta B' }));
  expect(screen.queryByRole('button', { name: /Abrir/ })).toBeNull(); expect(screen.queryByRole('button', { name: 'Eliminar' })).toBeNull();
  const secondText = second.getByLabelText('Tu respuesta');
  fireEvent.change(first.getByLabelText('Tu respuesta'), { target: { value: 'Respuesta nueva ñ' } });
  fireEvent.change(secondText, { target: { value: 'Otro borrador' } });
  fireEvent.click(first.getByRole('button', { name: 'Guardar' })); await screen.findByText('Respuesta guardada');
  expect(writes('PUT')).toHaveLength(1); expect(String(writes('PUT')[0]?.[0])).toContain('/question-answers/A');
  expect(screen.getByRole('heading', { name: 'Responder preguntas' })).toHaveFocus();
  expect(screen.queryByRole('form', { name: 'Responder: Pregunta A' })).toBeNull();
  expect(secondText).toHaveValue('Otro borrador');
  secondText.focus(); act(() => window.document.dispatchEvent(new Event('visibilitychange')));
  await waitFor(() => expect(screen.queryByText('Actualizando preguntas…')).toBeNull());
  expect(secondText).toHaveFocus(); expect(secondText).toHaveValue('Otro borrador');
  fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
  await screen.findByRole('heading', { name: 'Preguntas del perfil' });
  const saved = within(screen.getByRole('article', { name: 'Pregunta A' }));
  expect(saved.getByText('Respuesta nueva ñ')).toBeVisible();
  fireEvent.click(saved.getByRole('button', { name: 'Editar: Pregunta A' }));
  expect(saved.getByLabelText('Tu respuesta')).toHaveFocus();
  expect(history.state.trail.at(-1)).toBe('profile-questions');
  fireEvent.click(screen.getByRole('button', { name: 'Responder nuevas preguntas' }));
  expect(within(screen.getByRole('form', { name: 'Responder: Pregunta B' })).getByLabelText('Tu respuesta')).toHaveValue('Otro borrador');
});
it('keeps late inline saves on the current screen without discarding another question draft', async () => {
  installQuestions(); await openManagement('Tu perfil'); await openProfileQuestions();
  fireEvent.click(screen.getByRole('button', { name: 'Responder nuevas preguntas' }));
  const first = within(screen.getByRole('form', { name: 'Responder: Pregunta A' })), second = within(screen.getByRole('form', { name: 'Responder: Pregunta B' }));
  fireEvent.change(first.getByLabelText('Tu respuesta'), { target: { value: 'Nueva A' } }); fireEvent.change(second.getByLabelText('Tu respuesta'), { target: { value: 'Borrador B' } });
  const base = fetcher.getMockImplementation()!; let finish!: (response: Response) => void;
  fetcher.mockImplementation((path, options) => String(path).endsWith('/question-answers/A') && options?.method === 'PUT' ? new Promise(resolve => { finish = resolve; }) : base(path, options));
  fireEvent.click(first.getByRole('button', { name: 'Guardar' })); await waitFor(() => expect(finish).toBeDefined());
  expect(second.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Volver' })); await screen.findByRole('heading', { name: 'Preguntas del perfil' });
  await act(async () => finish(json({ answers: [savedAnswer('A', { answer: 'Nueva A' })] })));
  expect(screen.getByRole('heading', { name: 'Preguntas del perfil' })).toBeVisible(); expect(screen.queryByText('Respuesta guardada')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Responder nuevas preguntas' }));
  expect(within(screen.getByRole('form', { name: 'Responder: Pregunta B' })).getByLabelText('Tu respuesta')).toHaveValue('Borrador B');
});
it('keeps photo disclosure mounted and makes collapsed controls inert', async () => {
  await openManagement('Tu perfil'); const toggle = await screen.findByRole('button', { name: 'Fotos' });
  const content = window.document.getElementById(toggle.getAttribute('aria-controls')!)!;
  const picker = screen.getByLabelText('Agregar foto 1');
  fireEvent.click(toggle); expect(toggle).toHaveAttribute('aria-expanded', 'false'); expect(content).toHaveAttribute('inert'); expect(picker).toBeInTheDocument();
  fireEvent.click(toggle); expect(toggle).toHaveAttribute('aria-expanded', 'true'); expect(content).not.toHaveAttribute('inert'); expect(picker).toBe(screen.getByLabelText('Agregar foto 1'));
});
it('keeps setup question navigation available after a quiet profile refresh', async () => {
  installQuestions(); profile = { ...initialProfile }; mount();
  const entry = await screen.findByRole('button', { name: 'Responder o editar' });
  await waitFor(() => expect(entry).toBeEnabled());
  const base = fetcher.getMockImplementation()!;
  let finish!: (response: Response) => void;
  fetcher.mockImplementation((path, options) => path === '/api/me/profile/photos' ? new Promise(resolve => { finish = resolve; }) : base(path, options));
  refreshView(); await waitFor(() => expect(finish).toBeDefined());
  await act(async () => finish(json([])));
  await openProfileQuestions(); expect(screen.getByRole('heading', { name: 'Preguntas del perfil' })).toBeVisible();
});
it.each(['ACTIVE', 'DRAFT'])('preserves unsaved profile details, bio and filters through nested questions and history for %s', async status => {
  installQuestions();
  if (status === 'ACTIVE') await openManagement('Tu perfil');
  else { profile = { ...initialProfile }; mount(); fireEvent.click(await screen.findByRole('button', { name:'Editar datos y preferencias' })); }
  const form = await screen.findByRole('form', { name: 'Datos del perfil' });
  const bio = within(form).getByLabelText('Bio (opcional)'), name = within(form).getByLabelText('Nombre visible');
  fireEvent.change(bio, { target: { value: 'Mi bio sin guardar ñ' } }); fireEvent.change(name, { target: { value: 'Borrador' } });
  const filters = status === 'DRAFT' ? screen.getByRole('form', { name: 'Preferencias de búsqueda' }) : null;
  if (filters) fireEvent.change(within(filters).getByLabelText('Intención'), { target: { value: 'FRIENDSHIP' } });
  if (status === 'DRAFT') { fireEvent.click(screen.getByRole('button', { name:'Volver a fotos y activación' })); await screen.findByRole('heading', { name:'Completá tu perfil' }); }
  await openProfileQuestions(); expect(screen.queryByRole('form', { name: 'Datos del perfil' })).toBeNull();
  expect(history.state.trail).toEqual(status === 'ACTIVE' ? ['home', 'profile', 'profile-questions'] : ['home', 'profile-questions']);
  expect(fetcher.mock.calls.filter(([path]) => path === '/api/reference/profile-questions')).toHaveLength(1);
  expect(fetcher.mock.calls.filter(([path]) => path === '/api/me/profile/question-answers')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Responder nuevas preguntas' }));
  const editor = within(screen.getByRole('article', { name: 'Pregunta A' })).getByLabelText('Tu respuesta'); fireEvent.change(editor, { target: { value: 'Borrador privado' } });
  expect(JSON.stringify(history.state)).not.toContain('Borrador privado');
  act(() => history.back()); await screen.findByRole('heading', { name: 'Preguntas del perfil' }); act(() => history.forward()); await screen.findByRole('heading', { name: 'Responder preguntas' }); expect(within(screen.getByRole('article', { name: 'Pregunta A' })).getByLabelText('Tu respuesta')).toHaveValue('Borrador privado');
  fireEvent.click(screen.getByRole('button', { name: 'Volver' })); await screen.findByRole('heading', { name: 'Preguntas del perfil' }); fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Responder o editar' })).toHaveFocus()); expect(bio).toHaveValue('Mi bio sin guardar ñ'); expect(name).toHaveValue('Borrador'); expect(form).toBeInTheDocument();
  if (filters) expect(within(filters).getByLabelText('Intención')).toHaveValue('FRIENDSHIP');
  expect(writes('PATCH')).toHaveLength(0); expect(writes('PUT')).toHaveLength(0);
});
it('edits and resaves outdated answers, orders public selection, clears it, deletes and keeps authoritative feedback', async () => {
  installQuestions([savedAnswer('A', { current: false }), savedAnswer('B'), savedAnswer('C'), savedAnswer('D')]); await openManagement('Tu perfil'); await openProfileQuestions();
  expect(screen.getByText('4 de 4 respondidas')).toBeVisible(); expect(screen.getByText('Versión anterior')).toBeVisible(); fireEvent.click(screen.getByRole('button', { name: 'Editar: Pregunta A' }));
  expect(screen.getByLabelText('Tu respuesta')).toHaveValue('Respuesta A'); fireEvent.click(screen.getByRole('button', { name: 'Guardar' })); await screen.findByText('Respuesta guardada'); expect(screen.queryByLabelText('Tu respuesta')).toBeNull(); expect(screen.getByRole('button', { name: 'Editar: Pregunta A' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Editar: Pregunta A' }));
  fireEvent.change(screen.getByLabelText('Tu respuesta'), { target: { value: '<texto>\nsegunda línea' } }); expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled(); expect(screen.getByText('La respuesta debe escribirse en una sola línea.')).toBeVisible();
  fireEvent.change(screen.getByLabelText('Tu respuesta'), { target: { value: '  Respuesta actualizada  ' } }); fireEvent.click(screen.getByRole('button', { name: 'Guardar' })); await waitFor(() => expect(screen.queryByLabelText('Tu respuesta')).toBeNull()); expect(screen.getByText('Respuesta actualizada')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Guardar selección' })).toBeDisabled();
  for (const id of ['A','B','C']) fireEvent.click(within(screen.getByRole('article', { name: `Pregunta ${id}` })).getByRole('button', { name: 'Agregar' }));
  fireEvent.click(within(screen.getByRole('article', { name: 'Pregunta C' })).getByRole('button', { name: 'Quitar' }));
  fireEvent.click(within(screen.getByRole('article', { name: 'Pregunta C' })).getByRole('button', { name: 'Agregar' }));
  expect(within(screen.getByRole('article', { name: 'Pregunta D' })).getByRole('button', { name: 'Agregar' })).toBeDisabled();
  fireEvent.click(within(screen.getByRole('article', { name: 'Pregunta C' })).getByRole('button', { name: 'Subir' })); fireEvent.click(within(screen.getByRole('article', { name: 'Pregunta A' })).getByRole('button', { name: 'Bajar' }));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar selección' })); await screen.findByText('Selección guardada'); expect(screen.getByText('3 de 3 elegidas para mostrar')).toBeVisible();
  const selectionCall = writes('PUT').find(([path]) => String(path).endsWith('/question-selections')); expect(JSON.parse(String(selectionCall?.[1]?.body))).toEqual({ questionIds: ['C','A','B'] });
  fireEvent.click(screen.getByRole('button', { name: 'Limpiar selección' })); fireEvent.click(screen.getByRole('button', { name: 'Guardar selección' })); await screen.findByRole('heading', { name: 'Preguntas del perfil' }); expect(screen.getByText('0 de 3 elegidas para mostrar')).toBeVisible();
  fireEvent.click(within(screen.getByRole('article', { name: 'Pregunta A' })).getByRole('button', { name: 'Eliminar' })); await screen.findByText('Respuesta eliminada'); expect(screen.queryByRole('article', { name: 'Pregunta A' })).toBeNull();
});
it('cancels only the addressed edit, restores latest saved text and focus without requests', async () => {
  installQuestions([savedAnswer(), savedAnswer('B')]); await openManagement('Tu perfil'); await openProfileQuestions();
  const card = within(screen.getByRole('article', { name: 'Pregunta A' }));
  fireEvent.click(card.getByRole('button', { name: 'Agregar' }));
  fireEvent.click(screen.getByRole('button', { name: 'Editar: Pregunta B' }));
  fireEvent.change(screen.getByLabelText('Tu respuesta'), { target: { value: 'Borrador B' } });
  fireEvent.click(card.getByRole('button', { name: 'Editar: Pregunta A' }));
  expect(card.getByLabelText('Tu respuesta')).toHaveFocus();
  expect(card.getAllByRole('button').map(button => button.textContent)).toEqual(['Guardar', 'Cancelar edición']);
  expect(card.getByText('Posición 1')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Editar: Pregunta B' })).toBeEnabled();
  fireEvent.change(card.getByLabelText('Tu respuesta'), { target: { value: 'Descartar A' } });
  const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((path, options) => String(path).endsWith('/question-answers') && (!options?.method || options.method === 'GET') ? Promise.resolve(json({ answers: [savedAnswer('A', { answer: 'Última guardada' }), savedAnswer('B')] })) : base(path, options));
  await act(async () => refreshView());
  expect(card.getByLabelText('Tu respuesta')).toHaveValue('Descartar A');
  const calls = fetcher.mock.calls.length;
  fireEvent.click(card.getByRole('button', { name: 'Cancelar edición' }));
  expect(fetcher).toHaveBeenCalledTimes(calls);
  expect(card.queryByLabelText('Tu respuesta')).toBeNull();
  expect(card.getByRole('button', { name: 'Editar: Pregunta A' })).toHaveFocus();
  expect(card.getByText('Última guardada')).toBeVisible(); expect(card.getByText('Posición 1')).toBeVisible();
  fireEvent.click(card.getByRole('button', { name: 'Editar: Pregunta A' })); expect(card.getByLabelText('Tu respuesta')).toHaveValue('Última guardada');
  fireEvent.click(screen.getByRole('button', { name: 'Editar: Pregunta B' })); expect(screen.getByLabelText('Tu respuesta')).toHaveValue('Borrador B');
});
it.each([200, 400, 500])('blocks cancellation during writes and closes only on confirmed success (%s)', async status => {
  installQuestions([savedAnswer()]); await openManagement('Tu perfil'); await openProfileQuestions();
  fireEvent.click(screen.getByRole('button', { name: 'Editar: Pregunta A' }));
  fireEvent.change(screen.getByLabelText('Tu respuesta'), { target: { value: 'Borrador enviado' } });
  const base = fetcher.getMockImplementation()!; let finish!: (response: Response) => void;
  fetcher.mockImplementation((path, options) => String(path).endsWith('/question-answers/A') && options?.method === 'PUT' ? new Promise(resolve => { finish = resolve; }) : base(path, options));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar' })); await waitFor(() => expect(finish).toBeDefined());
  expect(screen.getByRole('button', { name: 'Cancelar edición' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar edición' })); expect(screen.getByLabelText('Tu respuesta')).toHaveValue('Borrador enviado');
  await act(async () => finish(json(status === 200 ? { answers: [savedAnswer('A', { answer: 'Respuesta del servidor' })] } : { code: 'REJECTED' }, status)));
  if (status === 200) {
    expect(screen.queryByLabelText('Tu respuesta')).toBeNull(); expect(screen.getByText('Respuesta del servidor')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Editar: Pregunta A' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Editar: Pregunta A' })); expect(screen.getByLabelText('Tu respuesta')).toHaveValue('Respuesta del servidor');
  } else {
    expect(screen.getByRole('alert')).toBeVisible(); expect(screen.getByLabelText('Tu respuesta')).toHaveValue('Borrador enviado');
    expect(screen.getByRole('button', { name: 'Cancelar edición' })).toBeEnabled();
    if (status === 500) expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
    if (status === 400) expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled();
  }
});
it('retains answer and selection drafts after uncertain writes and does not redirect late completion', async () => {
  installQuestions([savedAnswer(), savedAnswer('B')]); await openManagement('Tu perfil'); await openProfileQuestions();
  const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((path, options) => options?.method === 'PUT' && String(path).includes('/question-') ? Promise.reject(new TypeError('offline')) : base(path, options));
  fireEvent.click(screen.getByRole('button', { name: 'Editar: Pregunta A' })); fireEvent.change(screen.getByLabelText('Tu respuesta'), { target: { value: 'Mi cambio' } }); fireEvent.click(screen.getByRole('button', { name: 'Guardar' })); await screen.findByRole('alert'); expect(screen.getByLabelText('Tu respuesta')).toHaveValue('Mi cambio'); expect(screen.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar consulta' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled());
  fireEvent.click(within(screen.getByRole('article', { name: 'Pregunta B' })).getByRole('button', { name: 'Agregar' })); fireEvent.click(screen.getByRole('button', { name: 'Guardar selección' })); await screen.findByRole('alert'); expect(screen.getByText('Posición 1')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar consulta' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar selección' })).toBeEnabled());
  let finish!: (r: Response) => void; fetcher.mockImplementation((path, options) => String(path).endsWith('/question-selections') && options?.method === 'PUT' ? new Promise(resolve => { finish = resolve; }) : base(path, options));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar selección' })); await waitFor(() => expect(finish).toBeDefined()); fireEvent.click(screen.getByRole('button', { name: 'Volver' })); await screen.findByRole('heading', { name: 'Tu perfil' });
  await act(async () => finish(json({ answers: [savedAnswer('B', { selectedPosition: 1 })] }))); expect(screen.getByRole('heading', { name: 'Tu perfil' })).toBeVisible(); expect(screen.queryByText('Selección guardada')).toBeNull();
});
it('returns to the list when the active question disappears and retains text on a semantic refresh', async () => {
  const { catalog } = installQuestions([savedAnswer()]); await openManagement('Tu perfil'); await openProfileQuestions(); fireEvent.click(screen.getByRole('button', { name: 'Editar: Pregunta A' }));
  const originalAnswerField = screen.getByLabelText('Tu respuesta'); originalAnswerField.focus();
  fireEvent.change(originalAnswerField, { target: { value: 'Mi borrador' } }); catalog.questions[0]!.semanticVersion = 2; refreshView(); await screen.findByText('Versión anterior. Guardá la respuesta para actualizarla.'); expect(screen.getByLabelText('Tu respuesta')).toBe(originalAnswerField); expect(originalAnswerField).toHaveFocus(); expect(originalAnswerField).toHaveValue('Mi borrador');
  catalog.questions = catalog.questions.filter(q => q.id !== 'A'); refreshView(); await screen.findByRole('heading', { name: 'Preguntas del perfil' }); expect(screen.queryByRole('button', { name: 'Editar: Pregunta A' })).toBeNull();
});
it('does not enter questions during profile writes or a photo crop', async () => {
  installQuestions(); await openManagement('Tu perfil'); await screen.findByRole('form', { name: 'Datos del perfil' });
  fireEvent.change(screen.getByLabelText('Agregar foto 1'), { target: { files: [new File(['image'], 'photo.jpg', { type: 'image/jpeg' })] } });
  await screen.findByRole('dialog'); expect(screen.getByRole('button', { name: 'Responder o editar' })).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: 'Responder o editar' })); expect(history.state.trail.at(-1)).toBe('profile'); fireEvent.click(screen.getByText('Cancelar recorte'));
  const base = fetcher.getMockImplementation()!; let finish!: (r: Response) => void;
  fetcher.mockImplementation((path, options) => path === '/api/me/profile' && options?.method === 'PATCH' ? new Promise(resolve => { finish = resolve; }) : base(path, options));
  fireEvent.change(screen.getByLabelText('Ciudad'), { target:{ value:'Rosario' } });
  fireEvent.submit(screen.getByRole('form', { name: 'Datos del perfil' })); await waitFor(() => expect(finish).toBeDefined()); expect(screen.getByRole('button', { name: 'Responder o editar' })).toBeDisabled(); fireEvent.click(screen.getByRole('button', { name: 'Responder o editar' })); expect(history.state.trail.at(-1)).toBe('profile');
  await act(async () => finish(json(profile))); await screen.findByText('Cambios guardados.');
});
it('shares one history owner with the existing DRAFT interaction Home', async () => {
  installQuestions(); profile = { ...initialProfile }; const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (path, options) => {
    if (path === '/api/me/home') return json({ ...emptyHome(), profileStatus: 'DRAFT', activeInteractionsSummary: { activeInitialCount: 1, activeConnectionCount: 0, actionableConnectionCount: 0, hasPendingSchedulingConnection: false } });
    return base(path, options);
  });
  mount(); await screen.findByRole('heading', { name: 'Inicio: interacciones vigentes' }); await waitFor(() => expect(screen.getByRole('button', { name: 'Responder o editar' })).toBeEnabled());
  const owner = history.state.owner; await openProfileQuestions(); expect(history.state.owner).toBe(owner); expect(fetcher.mock.calls.filter(([path]) => path === '/api/reference/profile-questions')).toHaveLength(1);
  act(() => history.back()); await screen.findByRole('heading', { name: 'Completá tu perfil' }); act(() => history.forward()); await screen.findByRole('heading', { name: 'Preguntas del perfil' }); expect(history.state.owner).toBe(owner);
});
it('offers compact management entries and ACTIVE profile editing with photos and a focused return', async () => {
  profile = { ...initialProfile, status:'ACTIVE' }; mount();
  for (const name of ['Tu perfil','Preferencias','Afinidades','Cuenta']) expect(await screen.findByRole('button',{ name })).toBeVisible();
  const entry = screen.getByRole('button',{ name:'Tu perfil' }); await waitFor(() => expect(entry).toBeEnabled()); fireEvent.click(entry);
  const form = await screen.findByRole('form',{ name:'Datos del perfil' });
  expect(form.compareDocumentPosition(screen.getByRole('button', { name: 'Fotos' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole('heading',{ name:'Tu perfil' })).toHaveFocus();
  expect(screen.getByLabelText('Agregar foto 1')).toBeInTheDocument();
  expect(screen.queryByRole('button',{ name:'Activar perfil' })).toBeNull();
  expect(screen.queryByRole('form',{ name:'Preferencias de búsqueda' })).toBeNull();
  fireEvent.change(within(form).getByLabelText('Bio (opcional)'),{ target:{ value:'Una bio nueva' } }); fireEvent.submit(form);
  const confirmation = await within(form).findByText('Cambios guardados.');
  expect(confirmation).toHaveAttribute('role', 'status');
  expect(screen.getAllByText('Cambios guardados.')).toHaveLength(1); expect(profile?.bio).toBe('Una bio nueva');
  fireEvent.click(screen.getByRole('button',{ name:'Volver a Inicio' }));
  await screen.findByRole('heading',{ name:'Inicio' }); expect(screen.getByRole('heading',{ name:'Inicio' })).toHaveFocus();
});
it('loads saved preferences and saves only the filter contract, surviving a remount', async () => {
  await openManagement('Preferencias');
  const form = await screen.findByRole('form',{ name:'Preferencias de búsqueda' });
  expect(form.closest('details')).toBeNull();
  expect(within(form).getByRole('slider',{ name:'Edad mínima' })).toHaveAttribute('aria-valuenow','27');
  expect(within(form).getByRole('slider',{ name:'Edad máxima' })).toHaveAttribute('aria-valuenow','43');
  expect(within(form).getByLabelText(/Distancia máxima/)).toHaveValue('62');
  expect(screen.queryByLabelText('Agregar foto 1')).toBeNull();
  fireEvent.change(within(form).getByLabelText('Intención'),{ target:{ value:'FRIENDSHIP' } }); fireEvent.submit(form);
  await screen.findByText('Cambios guardados.');
  expect(JSON.parse(String(writes('PUT')[0]?.[1]?.body))).toEqual({ intention:'FRIENDSHIP', lookingForGenders:profile?.lookingForGenders, preferredMinAge:27, preferredMaxAge:43, maxDistanceKm:62 });
  const back = screen.getByRole('button',{ name:'Volver a Inicio' });
  await waitFor(() => expect(back).toBeEnabled()); fireEvent.click(back);
  await screen.findByRole('heading', { name: 'Inicio' });
  const entry = await screen.findByRole('button',{ name:'Preferencias' }); await waitFor(() => expect(entry).toBeEnabled()); fireEvent.click(entry);
  await screen.findByRole('form',{ name:'Preferencias de búsqueda' }); expect(screen.getByLabelText('Intención')).toHaveValue('FRIENDSHIP');
});
it.each(['PATCH','DELETE','PUT'])('routes authoritative INACTIVE after ACTIVE mutation %s', async method => {
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (input, options) => {
    const response = await original(input, options);
    if (options?.method === method && profile) profile = { ...profile, status:'INACTIVE' };
    return response;
  });
  list = [initialPhoto]; vi.spyOn(window,'confirm').mockReturnValue(true);
  await openManagement(method === 'PUT' ? 'Preferencias' : 'Tu perfil');
  await screen.findByRole('form',{ name:method === 'PUT' ? 'Preferencias de búsqueda' : 'Datos del perfil' });
  if (method === 'DELETE') fireEvent.click(screen.getByRole('button',{ name:'Eliminar foto 1' }));
  else {
    const form = screen.getByRole('form',{ name:method === 'PUT' ? 'Preferencias de búsqueda' : 'Datos del perfil' });
    fireEvent.change(within(form).getByLabelText(method === 'PUT' ? 'Intención' : 'Ciudad'), { target:{ value:method === 'PUT' ? 'FRIENDSHIP' : 'Rosario' } });
    fireEvent.submit(form);
  }
  await screen.findByText('Estado: INACTIVE');
  expect(screen.getByRole('form',{name:method === 'PUT' ? 'Preferencias de búsqueda' : 'Datos del perfil'})).toBeVisible();
  await waitFor(() => expect(screen.getByRole('button',{name:'Volver a Inicio'})).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{name:'Volver a Inicio'}));
  await screen.findByRole('heading',{name:'Completá tu perfil'});
});
it('blocks back navigation during a pending mutation and retains input on failure', async () => {
  const original = fetcher.getMockImplementation()!; let finish: ((response:Response) => void) | undefined;
  fetcher.mockImplementation((input, options) => options?.method === 'PATCH' ? new Promise(resolve => { finish = resolve; }) : original(input, options));
  await openManagement('Tu perfil'); const form = await screen.findByRole('form',{ name:'Datos del perfil' });
  fireEvent.change(within(form).getByLabelText('Ciudad'),{ target:{ value:'Rosario' } }); fireEvent.submit(form);
  await waitFor(() => expect(finish).toBeDefined()); expect(screen.getByRole('button',{ name:'Volver a Inicio' })).toBeDisabled();
  fireEvent(window,new PopStateEvent('popstate')); expect(form).toBeInTheDocument();
  await act(async () => finish?.(json({ code:'INVALID_PROFILE_COUNTRY' },400)));
  await screen.findByRole('alert'); expect(screen.getByLabelText('Ciudad')).toHaveValue('Rosario');
  expect(screen.getByRole('button',{ name:'Volver a Inicio' })).toBeEnabled(); expect(writes('PATCH')).toHaveLength(1);
});
it.each([false,true])('ACTIVE photos reuse crop and add/replace contracts (replace=%s)', async replace => {
  if (replace) list = [initialPhoto]; const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (input,options) => {
    if (options?.body instanceof FormData) { expect(String(input)).toBe(replace ? '/api/me/profile/photos/photo/file' : '/api/me/profile/photos'); list = [initialPhoto]; return json(initialPhoto); }
    return original(input,options);
  });
  await openManagement('Tu perfil'); await screen.findByRole('form',{ name:'Datos del perfil' });
  fireEvent.change(screen.getByLabelText(`${replace ? 'Reemplazar' : 'Agregar'} foto 1`),{ target:{ files:[new File(['jpeg'],'photo.jpg',{ type:'image/jpeg' })] } });
  expect(screen.getByRole('button',{ name:'Volver a Inicio' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{ name:'Confirmar recorte' })); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(list).toHaveLength(1); expect(screen.getByRole('button',{ name:'Eliminar foto 1' })).toBeEnabled();
  const confirmation = await screen.findByText('Cambios guardados.');
  expect(confirmation).toHaveAttribute('role', 'status'); expect(confirmation.closest('form')).toBeNull();
  expect(within(screen.getByRole('form', { name:'Datos del perfil' })).getByRole('status')).toBeEmptyDOMElement();
});
it('ACTIVE photos retain keyboard reordering', async () => {
  list = [initialPhoto,{ ...initialPhoto,id:'second',position:2 }]; await openManagement('Tu perfil');
  await screen.findByRole('form',{ name:'Datos del perfil' }); reorderWithKeyboard(1,2);
  const confirmation = await screen.findByText('Cambios guardados.'); expect(list[0]?.position).toBe(2);
  expect(confirmation.closest('form')).toBeNull();
  expect(within(screen.getByRole('form', { name:'Datos del perfil' })).getByRole('status')).toBeEmptyDOMElement();
});
it('returns to waiting if the editor admission read finds an active queue', async () => {
  const original = fetcher.getMockImplementation()!; let queued = false;
  fetcher.mockImplementation(async (input,options) => {
    if (String(input).endsWith('/queue')) { queued = true; return json({ userId:'u',inQueue:true }); }
    if (String(input).endsWith('/home') && queued) return json({ ...emptyHome(),matchmaking:{ canSearch:false,inQueue:true,blockedReason:null } });
    return original(input,options);
  });
  await openManagement('Tu perfil'); await screen.findByRole('heading',{ name:'Buscando chat' });
  expect(screen.queryByRole('form')).toBeNull(); expect(writes('DELETE')).toHaveLength(0);
});
it('opens affinity recovery and signs out once from Account', async () => {
  await openManagement('Afinidades'); expect(screen.getByRole('heading',{ name:'Preguntas de afinidad' })).toBeVisible();
  expect(screen.queryByRole('progressbar')).toBeNull(); expect(screen.queryByRole('link')).toBeNull();
  fireEvent.click(screen.getByRole('button',{ name:'Volver a Inicio' })); const entry = await screen.findByRole('button',{ name:'Cuenta' });
  await waitFor(() => expect(entry).toBeEnabled()); fireEvent.click(entry);
  expect(screen.getByRole('button',{ name:'Notificaciones' })).toBeVisible();
  vi.spyOn(window,'confirm').mockReturnValue(true);
  confirmSignOut();
  await screen.findByRole('button',{ name:'Ingresar' }); expect(auth.signOut).toHaveBeenCalledOnce();
});
it('stops Home polling while editing and reconciles on resume', async () => {
  await openManagement('Preferencias'); await screen.findByRole('form',{ name:'Preferencias de búsqueda' });
  vi.useFakeTimers(); fetcher.mockClear();
  await act(async () => { await vi.advanceTimersByTimeAsync(15000); }); expect(fetcher).not.toHaveBeenCalled();
  vi.useRealTimers(); profile = { ...profile!, status:'DRAFT' };
  fireEvent(window.document,new Event('visibilitychange'));
  await screen.findByText('Estado: DRAFT');
  expect(screen.getByRole('form',{name:'Preferencias de búsqueda'})).toBeVisible();
});
it('does not expose password changes for Google-only identities', async () => {
  user = { ...user, providerData:[{ providerId:'google.com',uid:'g',displayName:null,email:null,phoneNumber:null,photoURL:null }] };
  await openManagement('Cuenta');
  expect(screen.queryByRole('heading',{ name:'Cambiar contraseña' })).toBeNull();
  expect(screen.queryByRole('button',{ name:'Cambiar contraseña de Reals' })).toBeNull();
});
it('rejects pending editor reads after sign-out', async () => {
  const original = fetcher.getMockImplementation()!; let finish: ((value:Response) => void) | undefined;
  fetcher.mockImplementation((input,options) => String(input).endsWith('/photos') ? new Promise(resolve => { finish = resolve; }) : original(input,options));
  await openManagement('Tu perfil'); await waitFor(() => expect(finish).toBeDefined());
  act(() => observer(null)); await screen.findByRole('button',{ name:'Ingresar' });
  await act(async () => finish?.(json([]))); expect(screen.queryByRole('form',{ name:'Datos del perfil' })).toBeNull();
});
async function createForm() { await screen.findByRole('heading',{ name:'Crear perfil' }); const form = screen.getByRole('form',{ name:'Crear perfil' }); fireEvent.change(within(form).getByLabelText('Nombre visible'),{ target:{ value:'Ana' } }); fireEvent.change(within(form).getByLabelText('Ciudad'),{ target:{ value:'Córdoba' } }); fireEvent.change(within(form).getByLabelText('Fecha de nacimiento'),{ target:{ value:'1995-01-01' } }); fireEvent.change(within(form).getByLabelText('Género'),{ target:{ value:'MALE' } }); fireEvent.change(within(form).getByLabelText('Intención'),{ target:{ value:'DATE' } }); fireEvent.click(within(form).getByRole('checkbox',{ name:'Mujeres' })); return form; }
it('creates once under StrictMode and duplicate submit, restores DRAFT and activates through backend', async () => {
  mount(); const form = await createForm(); fireEvent.submit(form); fireEvent.submit(form);
  await screen.findByRole('heading',{ name:'Completá tu perfil' }); expect(writes('POST')).toHaveLength(1); expect(profile?.status).toBe('DRAFT');
  fireEvent.click(screen.getByRole('button',{ name:'Activar perfil' })); await screen.findByRole('button',{ name:'Buscar chat' }); expect(user.reload).toHaveBeenCalledOnce(); expect(user.getIdToken).toHaveBeenCalledWith(true);
  expect(screen.getByRole('heading',{ name:'Inicio' })).toBeInTheDocument();
});
it.each(['DRAFT','INACTIVE','ACTIVE'])('restores %s after reload', async status => { profile = { ...initialProfile,status }; mount(); await screen.findByRole('heading',{ name:status === 'ACTIVE' ? 'Inicio' : 'Completá tu perfil' }); expect(writes('POST')).toHaveLength(0); });
it('records exactly the required legal action and version', async () => { satisfied = false; mount(); await screen.findByRole('heading',{ name:'Antes de continuar' }); fireEvent.click(screen.getByRole('button',{ name:'Confirmar lectura' })); await screen.findByRole('heading',{ name:'Crear perfil' }); expect(JSON.parse(String(writes('POST')[0]?.[1]?.body))).toEqual({ documentType:'PRIVACY_NOTICE',documentVersion:'v1',action:'ACKNOWLEDGED' }); });
it('recovers a stale legal version without silently accepting the new version', async () => { satisfied = false; mount(); await screen.findByRole('heading',{ name:'Antes de continuar' }); version = 'v2'; fireEvent.click(screen.getByRole('button',{ name:'Confirmar lectura' })); await screen.findByText(/Versión v2/); expect(satisfied).toBe(false); expect(screen.getByRole('button',{ name:'Confirmar lectura' })).toBeEnabled(); });
it('uses a single country dropdown and validates without a mutation', async () => { mount(); const form = await createForm(); expect(within(form).queryByLabelText('Buscar país')).not.toBeInTheDocument(); expect(within(form).getByLabelText('País')).toHaveValue('AR'); expect(within(form).getByRole('option',{ name:'España' })).toBeInTheDocument(); fireEvent.change(within(form).getByLabelText('Nombre visible'),{ target:{ value:'x' } }); fireEvent.submit(form); expect(await screen.findByRole('alert')).toHaveTextContent('Nombre visible'); expect(writes('POST')).toHaveLength(0); });
it('updates details and filters using separate contracts', async () => { profile = { ...initialProfile }; mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' });
  fireEvent.click(screen.getByRole('button',{ name:'Editar datos y preferencias' })); const details = screen.getByRole('form',{ name:'Datos del perfil' }); fireEvent.change(within(details).getByLabelText('Ciudad'),{ target:{ value:'Rosario' } }); fireEvent.submit(details); await waitFor(() => expect(profile?.city).toBe('Rosario')); await waitFor(() => expect(window.document.querySelector('.onboarding')).toHaveAttribute('aria-busy', 'false')); expect(JSON.parse(String(writes('PATCH')[0]?.[1]?.body))).not.toHaveProperty('intention');
  const filters = screen.getByRole('form',{ name:'Preferencias de búsqueda' }); fireEvent.change(within(filters).getByLabelText('Intención'),{ target:{ value:'FRIENDSHIP' } }); fireEvent.submit(filters); await waitFor(() => expect(profile?.intention).toBe('FRIENDSHIP')); expect(JSON.parse(String(writes('PUT')[0]?.[1]?.body))).not.toHaveProperty('city');
});
it('reorders all placements and deletes by ID with confirmation', async () => { profile = { ...initialProfile }; list = [initialPhoto,{ ...initialPhoto,id:'second',position:2 }]; vi.spyOn(window,'confirm').mockReturnValue(true); mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' }); reorderWithKeyboard(1,2); await waitFor(() => expect(list[0]?.position).toBe(2)); await waitFor(() => expect(window.document.querySelector('.onboarding')).toHaveAttribute('aria-busy', 'false')); expect(JSON.parse(String(writes('PUT')[0]?.[1]?.body)).placements).toEqual([{ photoId:'second',position:1 },{ photoId:'photo',position:2 }]); fireEvent.click(screen.getByRole('button',{ name:'Eliminar foto 2' })); await waitFor(() => expect(list).toHaveLength(1)); expect(writes('DELETE')[0]?.[0]).toBe('/api/me/profile/photos/photo'); });
it.each([
  ['PROFILE_PHOTOS_REQUIRED', 'Profile must have at least 2 validated photos', 'Necesitás al menos 2 fotos validadas.'],
  ['PROFILE_PHOTOS_REQUIRED', 'Profile must have at least 6 validated photos', 'Necesitás al menos 6 fotos validadas.'],
  ['PROFILE_PERSON_PHOTO_REQUIRED', 'Profile must have at least 1 validated person photos', 'Necesitás al menos 1 foto validada donde se te vea con claridad.'],
  ['PROFILE_FULL_BODY_PHOTO_REQUIRED', 'Profile must have at least 3 validated full-body photos', 'Necesitás al menos 3 fotos validadas de cuerpo completo.'],
  ['PROFILE_PHOTOS_REQUIRED', 'Profile must have at least 9 validated person photos', 'Necesitás más fotos validadas para activar el perfil.'],
  ['PROFILE_PHOTOS_REQUIRED', 'Profile must have at least 9007199254740992 validated photos', 'Necesitás más fotos validadas para activar el perfil.'],
  ['PROFILE_PHOTOS_REQUIRED', '<b>3 fotos</b>', 'Necesitás más fotos validadas para activar el perfil.'],
  ['PROFILE_PERSON_PHOTO_REQUIRED', undefined, 'Necesitás más fotos validadas donde se te vea con claridad.'],
  ['PROFILE_FULL_BODY_PHOTO_REQUIRED', undefined, 'Necesitás más fotos validadas de cuerpo completo.'],
  ['PROFILE_PHOTO_MODERATION_NOT_APPROVED', undefined, 'Hay fotos pendientes de aprobación o rechazadas. Revisá sus estados.'],
  ['EMAIL_NOT_VERIFIED', undefined, 'Verificá tu email antes de activar el perfil.'],
  ['PROFILE_AUTHENTICITY_VERIFICATION_REQUIRED', undefined, 'Se requiere verificar la autenticidad de tu perfil antes de activarlo.'],
  ['LEGAL_ACTION_REQUIRED', undefined, 'Revisá los documentos legales vigentes antes de continuar.'],
  ['PROFILE_NOT_ACTIVATABLE', undefined, 'El perfil no se puede activar en su estado actual. Actualizá el estado.'],
  ['UNEXPECTED_CODE', '<i>server detail</i>', 'No pudimos activar tu perfil. Consultá el estado y volvé a intentar.'],
])('shows activation rejection %s (%s) once in the final section', async (code, message, expected) => {
  profile = { ...initialProfile };
  const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((path, options) => path === '/api/me/profile/activation' ? Promise.resolve(json({ code, message }, 409)) : base(path, options));
  mount();
  const section = await screen.findByRole('region', { name: 'Activación del perfil' });
  const activate = within(section).getByRole('button', { name: 'Activar perfil' });
  expect(activate).toBeEnabled();
  fireEvent.click(activate);
  const alert = await within(section).findByRole('alert');
  expect(screen.getAllByRole('alert')).toEqual([alert]);
  expect(alert).toHaveTextContent(expected);
  expect(activate).toHaveAccessibleDescription(expected);
  expect(within(section).getByRole('button', { name: 'Consultar estado' })).toBeEnabled();
  expect(screen.queryByRole('heading', { name: 'Verificá tu email' })).toBeNull();
  expect(writes('POST')).toHaveLength(1);
  expect(profile.status).toBe('DRAFT');
});

it.each(['network', 'malformed', 'server failure'] as const)('requires reconciliation after an uncertain activation (%s)', async outcome => {
  profile = { ...initialProfile };
  const base = fetcher.getMockImplementation()!;
  let finish!: (response: Response) => void;
  fetcher.mockImplementation((path, options) => path === '/api/me/profile/activation'
    ? outcome === 'network' ? Promise.reject(new TypeError('offline')) : Promise.resolve(outcome === 'malformed' ? json({ unexpected: true }) : json({ code: 'UNAVAILABLE' }, 503))
    : base(path, options));
  mount();
  const section = await screen.findByRole('region', { name: 'Activación del perfil' });
  const activate = within(section).getByRole('button', { name: 'Activar perfil' });
  fireEvent.click(activate);
  await within(section).findByRole('alert');
  const check = within(section).getByRole('button', { name: 'Consultar estado' });
  expect(activate).toBeDisabled();
  check.focus();
  await act(async () => window.document.dispatchEvent(new Event('visibilitychange')));
  expect(activate).toBeDisabled();
  expect(check).toHaveFocus();
  fireEvent.click(activate);
  expect(writes('POST')).toHaveLength(1);

  let lateSignal: AbortSignal | null | undefined;
  fetcher.mockImplementation((path, options) => path === '/api/me/profile' ? new Promise(resolve => { finish = resolve; lateSignal = options?.signal; }) : base(path, options));
  act(() => window.document.dispatchEvent(new Event('visibilitychange')));
  await waitFor(() => expect(finish).toBeDefined());
  fetcher.mockImplementation(base);
  fireEvent.click(check);
  expect(lateSignal?.aborted).toBe(true);
  await waitFor(() => expect(activate).toBeEnabled());
  await act(async () => finish(json({ ...initialProfile, status: 'ACTIVE' })));
  expect(screen.getByRole('region', { name: 'Activación del perfil' })).toBe(section);
  expect(within(section).queryByRole('alert')).toBeNull();
  expect(writes('POST')).toHaveLength(1);
});

it('accepts an active profile discovered after a lost activation response without reposting', async () => {
  profile = { ...initialProfile, status: 'INACTIVE' };
  const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((path, options) => {
    if (path !== '/api/me/profile/activation') return base(path, options);
    profile = { ...initialProfile, status: 'ACTIVE' };
    return Promise.reject(new TypeError('offline after write'));
  });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Activar perfil' }));
  await screen.findByRole('heading', { name: 'Inicio' });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(writes('POST')).toHaveLength(1);
});

it('retains failed activation recovery through resume and drops it on account replacement', async () => {
  profile = { ...initialProfile };
  const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((path, options) => path === '/api/me/profile/activation' ? Promise.reject(new TypeError('offline')) : base(path, options));
  mount();
  const section = await screen.findByRole('region', { name: 'Activación del perfil' });
  const activate = within(section).getByRole('button', { name: 'Activar perfil' });
  fireEvent.click(activate);
  await within(section).findByRole('alert');
  const check = within(section).getByRole('button', { name: 'Consultar estado' });
  const photos = screen.getByRole('button', { name: 'Fotos' });
  fireEvent.click(photos);
  check.focus();

  fetcher.mockImplementation((path, options) => path === '/api/me/profile' ? Promise.resolve(json({ code: 'UNAVAILABLE' }, 503)) : base(path, options));
  await act(async () => window.document.dispatchEvent(new Event('visibilitychange')));
  expect(screen.getByRole('button', { name: 'Fotos' })).toBe(photos);
  expect(photos).toHaveAttribute('aria-expanded', 'false');
  expect(check).toHaveFocus();
  expect(activate).toBeDisabled();
  expect(screen.getAllByRole('alert')).toEqual([within(section).getByRole('alert')]);

  let finish!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  fetcher.mockImplementation((path, options) => path === '/api/me/profile' ? new Promise(resolve => { finish = resolve; signal = options?.signal; }) : base(path, options));
  fireEvent.click(check);
  await waitFor(() => expect(finish).toBeDefined());
  act(() => observer(null));
  await screen.findByRole('button', { name: 'Ingresar' });
  profile = { ...initialProfile, id: 'other-profile', userId: 'other' };
  fetcher.mockImplementation((path, options) => path === '/api/me' ? Promise.resolve(json({ id: 'other', status: 'ACTIVE' })) : base(path, options));
  act(() => observer({ ...user, uid: 'other-firebase-user' }));
  const replacement = await screen.findByRole('region', { name: 'Activación del perfil' });
  await act(async () => finish(json({ ...initialProfile, status: 'ACTIVE' })));
  expect(signal?.aborted).toBe(true);
  expect(replacement).not.toBe(section);
  expect(within(replacement).getByRole('button', { name: 'Activar perfil' })).toBeEnabled();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(writes('POST')).toHaveLength(1);
});

it('honors Firebase when verification changes during the activation token refresh', async () => {
  profile = { ...initialProfile };
  vi.mocked(user.reload).mockImplementation(async () => { Object.defineProperty(user, 'emailVerified', { value: false }); });
  mount();
  const activate = await screen.findByRole('button', { name: 'Activar perfil' });
  fireEvent.click(activate);
  expect(await within(screen.getByRole('region', { name: 'Activación del perfil' })).findByRole('alert')).toHaveTextContent('Verificá tu email antes de activar el perfil.');
  expect(screen.getByRole('heading', { name: 'Verificá tu email' })).toBeVisible();
  expect(user.getIdToken).toHaveBeenCalledWith(true);
  expect(activate).toBeDisabled();
  expect(writes('POST')).toHaveLength(0);
});
it('email resend and reload use Firebase with cooldown', async () => { profile = { ...initialProfile }; Object.defineProperty(user,'emailVerified',{ value:false,configurable:true }); mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' }); fireEvent.click(screen.getByRole('button',{ name:'Reenviar correo' })); await waitFor(() => expect(screen.getByRole('button',{ name:/Reenviar correo/ })).toBeDisabled()); expect(auth.verify).toHaveBeenCalledOnce(); vi.mocked(user.reload).mockImplementation(async () => { Object.defineProperty(user,'emailVerified',{ value:true,configurable:true }); }); fireEvent.click(screen.getByRole('button',{ name:'Ya verifiqué' })); await screen.findByText('Email verificado.'); expect(screen.queryByRole('heading',{ name:'Verificá tu email' })).not.toBeInTheDocument(); });

it.each(['auth/network-request-failed', 'auth/too-many-requests'])('continues signup after initial email failure %s and carries recovery into the draft', async code => {
  user = { ...user, emailVerified: false };
  auth.observe = vi.fn(next => { observer = next; next(null); return vi.fn(); });
  vi.mocked(auth.signUp).mockResolvedValue(user);
  vi.mocked(auth.verify).mockRejectedValueOnce({ code, message: 'private Firebase diagnostic' });
  mount();
  fireEvent.click(await screen.findByRole('button', { name: '¿No tenés cuenta? Crear cuenta' }));
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'test@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'test-password' } });
  fireEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));
  const form = await createForm();
  const initialError = screen.getByRole('alert');
  expect(initialError).toHaveTextContent('Podés crear tu perfil');
  expect(initialError).not.toHaveTextContent('private Firebase diagnostic');
  expect(screen.queryByText(/Te enviamos un email/)).toBeNull();
  fireEvent.submit(form);
  const verification = await screen.findByRole('region', { name: 'Verificá tu email' });
  expect(within(verification).getByRole('alert')).toBeVisible();
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  const resend = within(verification).getByRole('button', { name: /Reenviar correo/ });
  expect(auth.verify).toHaveBeenCalledOnce();
  if (code === 'auth/too-many-requests') {
    expect(resend).toBeDisabled();
    expect(within(verification).getByRole('alert')).toHaveTextContent('demasiadas solicitudes');
  } else {
    fireEvent.click(resend);
    await within(verification).findByText('Te enviamos un nuevo correo de verificación.');
    expect(auth.verify).toHaveBeenCalledTimes(2);
  }
});

it('shows resend errors inline and throttles Firebase rate-limit responses', async () => {
  profile = { ...initialProfile };
  user = { ...user, emailVerified: false };
  vi.mocked(auth.verify)
    .mockRejectedValueOnce({ code: 'auth/network-request-failed', message: 'private Firebase diagnostic' })
    .mockRejectedValueOnce({ code: 'auth/too-many-requests' });
  mount();
  const verification = await screen.findByRole('region', { name: 'Verificá tu email' });
  const resend = within(verification).getByRole('button', { name: /Reenviar correo/ });
  fireEvent.click(resend);
  expect(await within(verification).findByRole('alert')).toHaveTextContent('Revisá tu conexión');
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.queryByText(/private Firebase diagnostic|Te enviamos/)).toBeNull();
  await waitFor(() => expect(resend).toBeEnabled());
  fireEvent.click(resend);
  expect(await within(verification).findByRole('alert')).toHaveTextContent('demasiadas solicitudes');
  expect(resend).toBeDisabled();
  expect(resend).toHaveAccessibleName(/Reenviar correo \(60 s\)/);
  await waitFor(() => expect(within(verification).getByRole('button', { name: 'Ya verifiqué' })).toBeEnabled());
  fireEvent.click(resend);
  expect(auth.verify).toHaveBeenCalledTimes(2);
});

it('keeps the check available when Firebase reload succeeds but forced token refresh fails', async () => {
  profile = { ...initialProfile };
  user = { ...user, emailVerified: false };
  vi.mocked(user.reload).mockImplementation(async () => { Object.defineProperty(user, 'emailVerified', { value: true }); });
  let fail = true;
  vi.mocked(user.getIdToken).mockImplementation(async force => {
    if (force && fail) throw { code: 'auth/network-request-failed', message: 'private Firebase diagnostic' };
    return 'token';
  });
  mount();
  const verification = await screen.findByRole('region', { name: 'Verificá tu email' });
  const check = within(verification).getByRole('button', { name: 'Ya verifiqué' });
  fireEvent.click(check);
  expect(await within(verification).findByRole('alert')).toHaveTextContent('No pudimos comprobar la verificación');
  expect(screen.getByRole('button', { name: 'Activar perfil' })).toBeDisabled();
  expect(screen.queryByText('Email verificado.')).toBeNull();
  await waitFor(() => expect(check).toBeEnabled());
  fail = false;
  fireEvent.click(check);
  await screen.findByText('Email verificado.');
  expect(screen.queryByRole('region', { name: 'Verificá tu email' })).toBeNull();
  expect(user.reload).toHaveBeenCalledTimes(2);
  expect(vi.mocked(user.getIdToken).mock.calls.filter(([force]) => force)).toHaveLength(2);
});

it('does not refresh a stale identity token or publish a late check result', async () => {
  profile = { ...initialProfile };
  user = { ...user, emailVerified: false };
  const stale = user;
  let finish!: () => void;
  vi.mocked(stale.reload).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Ya verifiqué' }));
  await waitFor(() => expect(finish).toBeDefined());
  act(() => observer(null));
  await screen.findByRole('button', { name: 'Ingresar' });
  await act(async () => finish());
  expect(stale.getIdToken).not.toHaveBeenCalledWith(true);
  expect(screen.queryByText('Email verificado.')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
});
it('rejects stale domain results after sign-out', async () => { let finish: ((value: Response) => void) | undefined; const original = fetcher.getMockImplementation()!; fetcher.mockImplementation((input,options) => String(input).endsWith('/legal-status') ? new Promise(resolve => { finish = resolve; }) : original(input,options)); mount(); await waitFor(() => expect(finish).toBeDefined()); confirmSignOut(); await screen.findByRole('button',{ name:'Ingresar' }); await act(async () => { finish?.(json({ requirementsSatisfied:true,documents:[] })); }); expect(screen.queryByRole('heading',{ name:'Crear perfil' })).not.toBeInTheDocument(); });
it('shows a definitive backend rejection once by the creation submit and allows correction', async () => {
  const base = fetcher.getMockImplementation()!;
  let finish!: (response: Response) => void;
  fetcher.mockImplementation((path, options) => path === '/api/me/profile' && options?.method === 'POST' ? new Promise(resolve => { finish = resolve; }) : base(path, options));
  mount();
  const form = await createForm();
  const create = within(form).getByRole('button', { name: 'Crear perfil' });
  fireEvent.click(create);
  await waitFor(() => expect(finish).toBeDefined());
  expect(within(form).getByRole('button', { name: 'Guardando…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cuenta' })).toBeDisabled();
  fireEvent.submit(form);
  await act(async () => finish(json({ code: 'VALIDATION_ERROR', message: 'Untrusted response text' }, 400)));

  const alert = within(form).getByRole('alert');
  const check = within(form).getByRole('button', { name: 'Consultar estado' });
  expect(screen.getAllByRole('alert')).toEqual([alert]);
  expect(alert).toHaveTextContent('VALIDATION_ERROR');
  expect(alert).not.toHaveTextContent('Untrusted response text');
  expect(alert.nextElementSibling).toBe(check);
  expect(check.nextElementSibling).toBe(create);
  expect(create).toBeEnabled();
  expect(within(form).getByLabelText('Nombre visible')).toHaveValue('Ana');
  expect(writes('POST')).toHaveLength(1);

  fetcher.mockImplementation(base);
  fireEvent.change(within(form).getByLabelText('Ciudad'), { target: { value: 'Rosario' } });
  fireEvent.click(create);
  await screen.findByRole('heading', { name: 'Completá tu perfil' });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(writes('POST')).toHaveLength(2);
});

it.each([
  ['network loss', () => Promise.reject(new TypeError('offline')), 'No pudimos confirmar el resultado'],
  ['malformed response', () => Promise.resolve(json({ unexpected: true }, 201)), 'La respuesta del servidor no es válida'],
  ['unconfirmed success', () => Promise.resolve(json(initialProfile, 201)), 'La respuesta del servidor no es válida'],
  ['profile conflict', () => Promise.resolve(json({ code: 'PROFILE_ALREADY_EXISTS' }, 409)), 'PROFILE_ALREADY_EXISTS'],
] as const)('keeps %s inline and requires an explicit check before another creation attempt', async (_scenario, post, message) => {
  const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((path, options) => path === '/api/me/profile' && options?.method === 'POST' ? post() : base(path, options));
  mount();
  const form = await createForm();
  const create = within(form).getByRole('button', { name: 'Crear perfil' });
  fireEvent.click(create);
  const alert = await within(form).findByRole('alert');
  const check = within(form).getByRole('button', { name: 'Consultar estado' });
  expect(alert).toHaveTextContent(message);
  expect(screen.getAllByRole('alert')).toEqual([alert]);
  expect(alert.nextElementSibling).toBe(check);
  expect(check.nextElementSibling).toBe(create);
  expect(create).toBeDisabled();
  expect(check).toBeEnabled();

  // A successful silent read confirming absence must not release the write gate.
  await act(async () => window.document.dispatchEvent(new Event('visibilitychange')));
  expect(create).toBeDisabled();
  expect(within(form).getByRole('button', { name: 'Consultar estado' })).toBe(check);
  fireEvent.submit(form);
  expect(writes('POST')).toHaveLength(1);

  fetcher.mockImplementation(base);
  fireEvent.click(check);
  await waitFor(() => expect(create).toBeEnabled());
  expect(within(form).queryByRole('alert')).toBeNull();
  expect(within(form).getByLabelText('Nombre visible')).toHaveValue('Ana');
  expect(writes('POST')).toHaveLength(1);
});

it('keeps the draft through a failed resume and supersedes a late resume with an explicit creation check', async () => {
  const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((path, options) => path === '/api/me/profile' && options?.method === 'POST' ? Promise.reject(new TypeError('offline')) : base(path, options));
  mount();
  const form = await createForm();
  fireEvent.click(within(form).getByRole('button', { name: 'Crear perfil' }));
  await within(form).findByRole('alert');
  const check = within(form).getByRole('button', { name: 'Consultar estado' });
  const name = within(form).getByLabelText('Nombre visible');
  const reads: { signal: AbortSignal; resolve: (response: Response) => void }[] = [];
  fetcher.mockImplementation((path, options) => path === '/api/me/profile' && options?.method === 'GET' ? new Promise(resolve => { reads.push({ signal: options.signal!, resolve }); }) : base(path, options));

  check.focus();
  act(() => window.document.dispatchEvent(new Event('visibilitychange')));
  await waitFor(() => expect(reads).toHaveLength(1));
  expect(check).toHaveFocus();
  expect(screen.queryByText('Actualizando estado…')).toBeNull();
  await act(async () => reads[0]!.resolve(json({ code: 'TEMPORARILY_UNAVAILABLE' }, 503)));
  expect(within(form).getByRole('alert')).toHaveTextContent('TEMPORARILY_UNAVAILABLE');
  expect(check).toHaveFocus();
  expect(within(form).getByLabelText('Nombre visible')).toBe(name);
  expect(name).toHaveValue('Ana');
  expect(within(form).getByRole('button', { name: 'Crear perfil' })).toBeDisabled();

  act(() => window.document.dispatchEvent(new Event('visibilitychange')));
  await waitFor(() => expect(reads).toHaveLength(2));
  fireEvent.click(check);
  expect(reads[1]!.signal.aborted).toBe(true);
  await waitFor(() => expect(reads).toHaveLength(3));
  fireEvent.submit(form);
  expect(writes('POST')).toHaveLength(1);
  profile = { ...initialProfile };
  fetcher.mockImplementation(base);
  await act(async () => reads[2]!.resolve(json(profile)));
  await act(async () => reads[1]!.resolve(json({ code: 'PROFILE_NOT_FOUND' }, 404)));
  await screen.findByRole('heading', { name: 'Completá tu perfil' });
  expect(screen.queryByRole('form', { name: 'Crear perfil' })).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(writes('POST')).toHaveLength(1);
});

it('reconciles a successful creation whose first status read failed without reposting', async () => {
  const base = fetcher.getMockImplementation()!;
  let failNextRead = false;
  fetcher.mockImplementation((path, options) => {
    if (path === '/api/me/profile' && options?.method === 'POST') failNextRead = true;
    else if (path === '/api/me/profile' && failNextRead) {
      failNextRead = false;
      return Promise.reject(new TypeError('offline'));
    }
    return base(path, options);
  });
  mount();
  const form = await createForm();
  fireEvent.click(within(form).getByRole('button', { name: 'Crear perfil' }));
  expect(await within(form).findByRole('alert')).toHaveTextContent('No pudimos confirmar el resultado');
  expect(within(form).getByRole('button', { name: 'Crear perfil' })).toBeDisabled();
  fireEvent.click(within(form).getByRole('button', { name: 'Consultar estado' }));
  await screen.findByRole('heading', { name: 'Completá tu perfil' });
  expect(writes('POST')).toHaveLength(1);
});

it('drops an obsolete creation recovery and draft when the account changes', async () => {
  const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((path, options) => path === '/api/me/profile' && options?.method === 'POST' ? Promise.reject(new TypeError('offline')) : base(path, options));
  mount();
  const form = await createForm();
  fireEvent.submit(form);
  await within(form).findByRole('alert');
  let finish!: (response: Response) => void;
  let signal: AbortSignal | null | undefined;
  fetcher.mockImplementation((path, options) => path === '/api/me/profile' ? new Promise(resolve => { finish = resolve; signal = options?.signal; }) : base(path, options));
  fireEvent.click(within(form).getByRole('button', { name: 'Consultar estado' }));
  await waitFor(() => expect(finish).toBeDefined());
  act(() => observer(null));
  await screen.findByRole('button', { name: 'Ingresar' });

  fetcher.mockImplementation((path, options) => path === '/api/me' ? Promise.resolve(json({ id: 'other', status: 'ACTIVE' })) : base(path, options));
  act(() => observer({ ...user, uid: 'other-firebase-user' }));
  const replacement = await screen.findByRole('form', { name: 'Crear perfil' });
  await act(async () => finish(json(initialProfile)));
  expect(signal?.aborted).toBe(true);
  expect(replacement).not.toBe(form);
  expect(within(replacement).getByLabelText('Nombre visible')).toHaveValue('');
  expect(within(replacement).getByRole('button', { name: 'Crear perfil' })).toBeEnabled();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(writes('POST')).toHaveLength(1);
});

it.each([
  ['Cerrar sesión', 'Cerrar sesión'],
  ['Eliminar cuenta', 'Programar eliminación'],
])('keeps Cuenta below creation, collapsed until opened, and confirms %s', async (action, confirm) => {
  const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((path, options) => path === '/api/me' && options?.method === 'DELETE' ? Promise.resolve(new Response(null, { status: 200 })) : base(path, options));
  mount();
  const form = await createForm();
  const account = screen.getByRole('region', { name: 'Cuenta' });
  const entry = within(account).getByRole('button', { name: 'Cuenta' });
  expect(form.compareDocumentPosition(account) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(entry).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('button', { name: 'Cerrar sesión' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Eliminar cuenta' })).toBeNull();

  fireEvent.click(entry);
  expect(entry).toHaveAttribute('aria-expanded', 'true');
  const trigger = within(account).getByRole('button', { name: action });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole('dialog', { name: action });
  const cancel = within(dialog).getByRole('button', { name: 'Cancelar' });
  expect(cancel).toHaveFocus();
  fireEvent.click(cancel);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(trigger).toHaveFocus();
  expect(auth.signOut).not.toHaveBeenCalled();
  expect(writes('DELETE')).toHaveLength(0);

  fireEvent.click(trigger);
  fireEvent.click(within(screen.getByRole('dialog', { name: action })).getByRole('button', { name: confirm }));
  await screen.findByRole('button', { name: 'Ingresar' });
  expect(auth.signOut).toHaveBeenCalledOnce();
  expect(writes('DELETE')).toHaveLength(action === 'Eliminar cuenta' ? 1 : 0);
  expect(writes('POST')).toHaveLength(0);
});
it.each([false,true])('uploads cropped multipart with add/replace contract (replace=%s)', async replace => {
  profile = { ...initialProfile }; if (replace) list = [initialPhoto];
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (input,options) => {
    if (options?.body instanceof FormData) {
      expect(options.headers).toEqual({ Authorization:'Bearer token' });
      expect(options.body.get('file')).toBeInstanceOf(File);
      expect(options.body.get('position')).toBe(replace ? null : '1');
      expect(String(input)).toBe(replace ? '/api/me/profile/photos/photo/file' : '/api/me/profile/photos');
      list = [initialPhoto]; return json(initialPhoto,replace ? 200 : 201);
    }
    return original(input,options);
  });
  mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' });
  fireEvent.change(screen.getByLabelText(`${replace ? 'Reemplazar' : 'Agregar'} foto 1`),{ target:{ files:[new File(['jpeg'],'photo.jpg',{ type:'image/jpeg' })] } });
  fireEvent.click(screen.getByRole('button',{ name:'Confirmar recorte' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument()); expect(list).toHaveLength(1);
  expect(fetcher.mock.calls.filter(x => x[1]?.body instanceof FormData)).toHaveLength(1);
});
it('keeps authoritative order on failed reorder and refreshes before retry', async () => {
  profile = { ...initialProfile }; list = [initialPhoto,{ ...initialPhoto,id:'second',position:2 }]; const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((input,options) => String(input).endsWith('/reorder') ? Promise.resolve(json({ code:'PHOTO_POSITION_OCCUPIED' },409)) : original(input,options));
  mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' }); reorderWithKeyboard(1,2); await screen.findByRole('alert'); expect(list[0]?.id).toBe('photo'); expect(screen.getByRole('button',{ name:'Reordenar foto 1' })).toBeEnabled();
});
it('blocks malformed backend responses and permits retry without losing Firebase', async () => {
  profile = { ...initialProfile }; const original = fetcher.getMockImplementation()!; let malformed = true;
  fetcher.mockImplementation((input,options) => String(input).endsWith('/photos') && malformed ? Promise.resolve(json({ wrong:true })) : original(input,options));
  mount(); await screen.findByRole('alert'); expect(auth.signOut).not.toHaveBeenCalled(); malformed = false; refreshView(); await screen.findByRole('heading',{ name:'Completá tu perfil' });
});
it('routes an empty legal catalog directly to creation', async () => {
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((input,options) => String(input).endsWith('/legal-status') ? Promise.resolve(json({ requirementsSatisfied:true,documents:[] })) : String(input).endsWith('/documents/current') ? Promise.resolve(json({ documents:[] })) : original(input,options));
  mount(); await screen.findByRole('heading',{ name:'Crear perfil' }); expect(screen.queryByRole('heading',{ name:'Antes de continuar' })).not.toBeInTheDocument();
});
it('reloads stale catalog metadata before offering a legal action', async () => {
  satisfied = false; const original = fetcher.getMockImplementation()!; let catalogs = 0;
  fetcher.mockImplementation((input,options) => String(input).endsWith('/documents/current') && ++catalogs === 1 ? Promise.resolve(json({ documents:[{ ...document(),version:'old' }] })) : original(input,options));
  mount(); await screen.findByRole('heading',{ name:'Antes de continuar' }); expect(catalogs).toBe(2); expect(writes('POST')).toHaveLength(0);
});
it('offers country retry and recovers catalog loading failure', async () => {
  const original = fetcher.getMockImplementation()!; let failing = true;
  fetcher.mockImplementation((input,options) => String(input).endsWith('/countries') && failing ? Promise.reject(new TypeError()) : original(input,options));
  mount(); await screen.findByRole('heading',{ name:'Crear perfil' }); fireEvent.click(screen.getByRole('button',{ name:'Reintentar carga de países' })); failing = false;
  await waitFor(() => expect(screen.getByRole('option',{ name:'Argentina' })).toBeInTheDocument());
});
it('retains existing DRAFT interactions as a read-only Home checkpoint', async () => {
  profile = { ...initialProfile }; const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((input,options) => String(input).endsWith('/home') ? Promise.resolve(json({ pendingActions:[{}],nextSteps:[],passiveNotices:[],activeInteractionsSummary:{ hasPendingSchedulingConnection:false,activeInitialCount:1,activeConnectionCount:0,actionableConnectionCount:0 } })) : original(input,options));
  mount(); await screen.findByRole('heading',{ name:'Inicio: interacciones vigentes' }); expect(writes('DELETE')).toHaveLength(0);
});
it('serializes competing photo writes and rejects the response after sign-out', async () => {
  profile = { ...initialProfile }; list = [initialPhoto,{ ...initialPhoto,id:'second',position:2 }]; let finish: ((value: Response) => void) | undefined;
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((input,options) => String(input).endsWith('/reorder') ? new Promise(resolve => { finish = resolve; }) : original(input,options));
  mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' }); reorderWithKeyboard(1,2); reorderWithKeyboard(1,2);
  await waitFor(() => expect(finish).toBeDefined()); expect(writes('PUT')).toHaveLength(1); expect(screen.getByRole('button',{ name:'Eliminar foto 1' })).toBeDisabled();
  act(() => observer(null)); await screen.findByRole('button',{ name:'Ingresar' }); await act(async () => finish?.(json(list))); expect(screen.queryByRole('heading',{ name:'Completá tu perfil' })).not.toBeInTheDocument();
});
it('fails closed on inconsistent legal status and recovers only after authoritative refresh', async () => {
  let inconsistent = true;
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((input,options) => inconsistent && String(input).endsWith('/legal-status') ? Promise.resolve(json({ requirementsSatisfied:false,documents:[] })) : original(input,options));
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('La respuesta del servidor no es válida');
  expect(fetcher.mock.calls.filter(x => String(x[0]).endsWith('/legal-status'))).toHaveLength(2);
  expect(screen.queryByRole('form',{ name:'Crear perfil' })).not.toBeInTheDocument();
  expect(writes('POST')).toHaveLength(0);
  expect(auth.signOut).not.toHaveBeenCalled();
  inconsistent = false;
  refreshView();
  await screen.findByRole('form',{ name:'Crear perfil' });
});
it.each(['network','server','malformed'])('allows DRAFT completion and updates when auxiliary Home fails: %s', async failure => {
  profile = { ...initialProfile };
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((input,options) => {
    if (String(input).endsWith('/home')) {
      if (failure === 'network') return Promise.reject(new TypeError('offline'));
      return Promise.resolve(failure === 'server' ? json({ code:'INTERNAL_ERROR' },503) : json({ invalid:true }));
    }
    return original(input,options);
  });
  mount();
  await screen.findByRole('heading',{ name:'Completá tu perfil' });
  expect(screen.getByRole('heading',{ name:'Inicio no disponible' })).toBeInTheDocument();
  expect(screen.getByText(/Su estado es desconocido/)).toBeInTheDocument();
  expect(screen.queryByRole('heading',{ name:'Inicio: interacciones vigentes' })).not.toBeInTheDocument();
  expect(screen.getByRole('button',{ name:'Activar perfil' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button',{ name:'Editar datos y preferencias' }));
  const form = screen.getByRole('form',{ name:'Datos del perfil' });
  fireEvent.change(within(form).getByLabelText('Ciudad'),{ target:{ value:'Rosario' } });
  fireEvent.submit(form);
  await waitFor(() => expect(profile?.city).toBe('Rosario'));
  const back = screen.getByRole('button',{ name:'Volver a fotos y activación' });
  await waitFor(() => expect(back).toBeEnabled()); fireEvent.click(back);
  await waitFor(() => expect(screen.getByRole('button',{ name:'Reintentar Inicio' })).toBeEnabled());
  expect(writes('PATCH')).toHaveLength(1);
  expect(auth.signOut).not.toHaveBeenCalled();
});
it('creation reaches completion even when the new DRAFT Home read fails', async () => {
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((input,options) => String(input).endsWith('/home') ? Promise.reject(new TypeError('offline')) : original(input,options));
  mount(); const form = await createForm(); fireEvent.submit(form);
  await screen.findByRole('heading',{ name:'Completá tu perfil' });
  expect(screen.getByRole('heading',{ name:'Inicio no disponible' })).toBeInTheDocument();
  expect(profile?.status).toBe('DRAFT');
  expect(writes('POST')).toHaveLength(1);
  expect(screen.getByRole('button',{ name:'Activar perfil' })).toBeEnabled();
});
it.each([false,true])('Home retry installs only authoritative interaction state (existing=%s)', async existing => {
  profile = { ...initialProfile }; let unavailable = true;
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((input,options) => {
    if (String(input).endsWith('/home')) {
      if (unavailable) return Promise.reject(new TypeError('offline'));
      if (existing) return Promise.resolve(json({ pendingActions:[{}],nextSteps:[],passiveNotices:[],activeInteractionsSummary:{ hasPendingSchedulingConnection:false,activeInitialCount:1,activeConnectionCount:0,actionableConnectionCount:0 } }));
    }
    return original(input,options);
  });
  mount(); await screen.findByRole('heading',{ name:'Inicio no disponible' });
  unavailable = false; fireEvent.click(screen.getByRole('button',{ name:'Reintentar Inicio' }));
  await waitFor(() => expect(screen.queryByRole('heading',{ name:'Inicio no disponible' })).not.toBeInTheDocument());
  expect(!!screen.queryByRole('heading',{ name:'Inicio: interacciones vigentes' })).toBe(existing);
  expect(writes('POST')).toHaveLength(0);
  if (existing) await waitFor(() => expect(window.document.querySelector('.home')).toHaveAttribute('aria-busy', 'false'));
  unavailable = true; act(() => window.document.dispatchEvent(new Event('visibilitychange')));
  await screen.findByRole('heading',{ name:'Inicio no disponible' });
  expect(screen.queryByRole('heading',{ name:'Inicio: interacciones vigentes' })).not.toBeInTheDocument();
  expect(screen.getByRole('button',{ name:'Activar perfil' })).toBeEnabled();
});
it.each(['ACCOUNT_TEMPORARILY_BANNED','INVALID_TOKEN'])('does not mask session/account errors from Home: %s', async code => {
  profile = { ...initialProfile }; let restricted = false;
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((input,options) => {
    const path = String(input);
    if (path.endsWith('/home')) restricted = true;
    if (restricted && (path.endsWith('/home') || path === '/api/me')) return Promise.resolve(json({ code },code === 'INVALID_TOKEN' ? 401 : 403));
    return original(input,options);
  });
  mount(); if (code === 'ACCOUNT_TEMPORARILY_BANNED') await screen.findByRole('heading', { name: 'Cuenta suspendida temporalmente' }); else await screen.findByRole('alert');
  expect(screen.queryByRole('heading',{ name:'Inicio no disponible' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{ name:'Activar perfil' })).not.toBeInTheDocument();
  if (code === 'INVALID_TOKEN') { await screen.findByRole('button',{ name:'Ingresar' }); expect(auth.signOut).toHaveBeenCalledOnce(); }
  else { expect(screen.getByRole('heading', { name: 'Cuenta suspendida temporalmente' })).toBeVisible(); expect(auth.signOut).not.toHaveBeenCalled(); }
});
it.each([401,403])('propagates Home authorization HTTP %s with a nonterminal code and permits explicit recovery', async status => {
  profile = { ...initialProfile }; let denied = true;
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((input,options) => denied && String(input).endsWith('/home') ? Promise.resolve(json({ code:'ACCESS_DENIED' },status)) : original(input,options));
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('ACCESS_DENIED');
  expect(screen.queryByRole('heading',{ name:'Inicio no disponible' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading',{ name:'Completá tu perfil' })).not.toBeInTheDocument();
  expect(writes('POST')).toHaveLength(0);
  expect(auth.signOut).not.toHaveBeenCalled();
  expect(fetcher.mock.calls.filter(x => String(x[0]).endsWith('/home'))).toHaveLength(1);
  denied = false;
  refreshView();
  await screen.findByRole('heading',{ name:'Completá tu perfil' });
  expect(screen.getByRole('button',{ name:'Activar perfil' })).toBeEnabled();
});
it('serializes Home retry and rejects its late response after sign-out', async () => {
  profile = { ...initialProfile }; let finish: ((value: Response) => void) | undefined; let retrying = false;
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((input,options) => String(input).endsWith('/home') ? retrying ? new Promise(resolve => { finish = resolve; }) : Promise.reject(new TypeError('offline')) : original(input,options));
  mount(); await screen.findByRole('heading',{ name:'Inicio no disponible' });
  retrying = true; const retry = screen.getByRole('button',{ name:'Reintentar Inicio' }); fireEvent.click(retry); fireEvent.click(retry);
  await waitFor(() => expect(finish).toBeDefined());
  expect(fetcher.mock.calls.filter(x => String(x[0]).endsWith('/home'))).toHaveLength(2);
  act(() => observer(null)); await screen.findByRole('button',{ name:'Ingresar' });
  await act(async () => finish?.(json({ invalid:true })));
  expect(screen.queryByRole('heading',{ name:'Completá tu perfil' })).not.toBeInTheDocument();
});
it.each(['DRAFT','INACTIVE'])('disables activation for an unverified email on %s', async status => {
  profile = { ...initialProfile,status }; Object.defineProperty(user,'emailVerified',{ value:false,configurable:true });
  mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' });
  const activate = screen.getByRole('button',{ name:'Activar perfil' });
  expect(activate).toBeDisabled(); expect(activate).toHaveAccessibleDescription('Verificá tu email y presioná «Ya verifiqué» antes de activar el perfil.');
  fireEvent.click(activate); expect(writes('POST')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button',{ name:'Reenviar correo' }));
  await waitFor(() => expect(auth.verify).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByRole('button',{ name:'Ya verifiqué' })).toBeEnabled());
  expect(activate).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{ name:'Ya verifiqué' }));
  await screen.findByText(/Todavía no vemos el email verificado/);
  expect(activate).toBeDisabled(); expect(writes('POST')).toHaveLength(0);
});
it('enables activation after Firebase reload confirms email verification', async () => {
  profile = { ...initialProfile }; Object.defineProperty(user,'emailVerified',{ value:false,configurable:true });
  vi.mocked(user.reload).mockImplementation(async () => { Object.defineProperty(user,'emailVerified',{ value:true,configurable:true }); });
  mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' });
  expect(screen.getByRole('button',{ name:'Activar perfil' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{ name:'Ya verifiqué' }));
  await waitFor(() => expect(screen.getByRole('button',{ name:'Activar perfil' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button',{ name:'Activar perfil' }));
  await screen.findByRole('heading',{ name:'Inicio' });
  expect(user.getIdToken).toHaveBeenCalledWith(true);
  expect(fetcher.mock.calls.filter(x => String(x[0]).endsWith('/activation'))).toHaveLength(1);
});
const technicalStatus = /Firebase autenticado|Comprobando sesión de Firebase|Cargando sesión del backend|Sesión del backend lista|La sesión del backend no está lista/i;
function expectPreparing() {
  expect(screen.getByRole('status').textContent).toMatch(/Preparando (Reals|tu sesión(?: de forma segura)?)…/);
  expect(screen.getByRole('heading',{ name:'Reals',level:1 })).toBeVisible();
  const login = screen.queryByRole('button',{ name:'Ingresar' });
  if (login) expect(login).toBeDisabled();
  expect(screen.queryByRole('button',{ name:'Consultar estado' })).not.toBeInTheDocument();
  expect(screen.queryByText('Actualizando estado…')).not.toBeInTheDocument();
  expect(screen.getByRole('main').textContent).not.toMatch(technicalStatus);
}
it.each([
  { status:null,legalSatisfied:true,heading:'Crear perfil' },
  { status:'DRAFT',legalSatisfied:true,heading:'Completá tu perfil' },
  { status:'INACTIVE',legalSatisfied:true,heading:'Completá tu perfil' },
  { status:'ACTIVE',legalSatisfied:true,heading:'Inicio' },
  { status:null,legalSatisfied:false,heading:'Antes de continuar' },
])('keeps a coherent branded loading state through restoration/bootstrap to $heading ($status)', async ({ status,legalSatisfied,heading }) => {
  if (status) profile = { ...initialProfile,status };
  satisfied = legalSatisfied;
  let restore: ((identity: Identity | null) => void) | undefined;
  let finishBootstrap: ((response: Response) => void) | undefined;
  let finishOnboarding: ((response: Response) => void) | undefined;
  auth.observe = vi.fn(next => { restore = next; return vi.fn(); });
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((input,options) => String(input) === '/api/me' ? new Promise(resolve => { finishBootstrap = resolve; }) : String(input).endsWith('/legal-status') ? new Promise(resolve => { finishOnboarding = resolve; }) : original(input,options));
  const visibleFrames: string[] = [];
  const observed = new MutationObserver(() => visibleFrames.push(window.document.body.textContent ?? ''));
  observed.observe(window.document.body,{ childList:true,subtree:true,characterData:true });
  try {
    mount(); expectPreparing();
    const statusElement = screen.getByRole('status');
    act(() => restore?.(user));
    await waitFor(() => expect(finishBootstrap).toBeDefined()); expectPreparing();
    expect(screen.getByRole('status')).toBe(statusElement);
    await act(async () => finishBootstrap?.(json({ id:'u',status:'ACTIVE' })));
    if (status !== 'ACTIVE') { await waitFor(() => expect(finishOnboarding).toBeDefined()); expectPreparing(); }
    if (status !== 'ACTIVE') expect(screen.getByRole('button',{ name:'Cerrar sesión' })).toBeEnabled();
    await act(async () => finishOnboarding?.(json({ requirementsSatisfied:satisfied,documents:[document()] })));
    await screen.findByRole('heading',{ name:heading });
    expect(screen.queryByText('Preparando Reals…')).not.toBeInTheDocument();
    expect(screen.queryByRole('button',{ name:'Ingresar' })).not.toBeInTheDocument();
    expect(screen.getByRole('main').textContent).not.toMatch(technicalStatus);
    expect(visibleFrames.length).toBeGreaterThan(0);
    for (const frame of visibleFrames) { expect(frame).not.toMatch(technicalStatus); expect(frame).toContain('Reals'); }
  } finally { observed.disconnect(); }
});
it.each(['signIn','signUp','google'] as const)('navigates from %s without exposing technical authenticated checkpoints', async operation => {
  auth.observe = vi.fn(next => { next(null); return vi.fn(); });
  auth.signIn = vi.fn().mockResolvedValue(user); auth.signUp = vi.fn().mockResolvedValue(user); auth.google = vi.fn().mockResolvedValue(user);
  let finish: ((response: Response) => void) | undefined;
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((input,options) => String(input).endsWith('/legal-status') ? new Promise(resolve => { finish = resolve; }) : original(input,options));
  mount(); await screen.findByRole('button',{ name:'Ingresar' });
  if (operation === 'google') fireEvent.click(screen.getByRole('button',{ name:'Continuar con Google' }));
  else {
    fireEvent.change(screen.getByLabelText('Email'),{ target:{ value:'disposable@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'),{ target:{ value:'test-password' } });
    if (operation === 'signUp') fireEvent.click(screen.getByRole('button',{ name:'¿No tenés cuenta? Crear cuenta' }));
    fireEvent.click(screen.getByRole('button',{ name:operation === 'signUp' ? 'Crear cuenta' : 'Ingresar' }));
  }
  await waitFor(() => expect(finish).toBeDefined()); expectPreparing();
  await act(async () => finish?.(json({ requirementsSatisfied:true,documents:[] })));
  await screen.findByRole('heading',{ name:'Crear perfil' });
  expect(screen.getByRole('main').textContent).not.toMatch(technicalStatus);
});
it('replaces initial onboarding loading with a recoverable error and restores loading during retry', async () => {
  let offline = true; let finish: ((response: Response) => void) | undefined;
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((input,options) => String(input).endsWith('/legal-status') ? offline ? Promise.reject(new TypeError('offline')) : new Promise(resolve => { finish = resolve; }) : original(input,options));
  mount(); await screen.findByRole('alert');
  expect(screen.queryByText('Preparando Reals…')).not.toBeInTheDocument();
  expect(screen.getByRole('button',{ name:'Cerrar sesión' })).toBeEnabled();
  offline = false; refreshView();
  await waitFor(() => expect(finish).toBeDefined()); expectPreparing();
  await act(async () => finish?.(json({ requirementsSatisfied:true,documents:[] })));
  await screen.findByRole('heading',{ name:'Crear perfil' });
});
it('keeps loading sign-out accessible and rejects a late initial onboarding response', async () => {
  let finish: ((response: Response) => void) | undefined;
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((input,options) => String(input).endsWith('/legal-status') ? new Promise(resolve => { finish = resolve; }) : original(input,options));
  mount(); await waitFor(() => expect(finish).toBeDefined()); expectPreparing();
  confirmSignOut();
  await screen.findByRole('button',{ name:'Ingresar' });
  await act(async () => finish?.(json({ requirementsSatisfied:true,documents:[] })));
  expect(screen.queryByRole('heading',{ name:'Crear perfil' })).not.toBeInTheDocument();
  expect(screen.queryByText('Preparando Reals…')).not.toBeInTheDocument();
});
const droppedFile = (name = 'drop.jpg', type = 'image/jpeg') => new File(['image'],name,{ type });
function dropPhoto(position: number, files: File[]) {
  const event = new Event('drop',{ bubbles:true,cancelable:true });
  Object.defineProperty(event,'dataTransfer',{ value:{ types:['Files'],files } });
  fireEvent(screen.getByRole('article',{ name:`Foto ${position}` }),event);
  return event;
}
it('explains email restrictions and enables picker/drop immediately after verification succeeds', async () => {
  profile = { ...initialProfile }; Object.defineProperty(user,'emailVerified',{ value:false,configurable:true });
  mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' });
  expect(screen.getByRole('button',{ name:'Agregar en posición 1' })).toBeDisabled();
  expect(screen.getByLabelText('Agregar foto 1')).toBeDisabled();
  expect(screen.getByRole('button',{ name:'Agregar en posición 1' })).toHaveAccessibleDescription(/Verificá tu email antes de subir fotos/);
  expect(screen.getByRole('link',{ name:'Ir a la verificación de email' })).toHaveAttribute('href','#email-verification');
  expect(dropPhoto(1,[droppedFile()]).defaultPrevented).toBe(true);
  fireEvent.change(screen.getByLabelText('Agregar foto 1'),{ target:{ files:[droppedFile()] } });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  vi.mocked(user.reload).mockImplementation(async () => { Object.defineProperty(user,'emailVerified',{ value:true,configurable:true }); });
  fireEvent.click(screen.getByRole('button',{ name:'Ya verifiqué' }));
  await waitFor(() => expect(screen.getByRole('button',{ name:'Agregar en posición 1' })).toBeEnabled());
  dropPhoto(1,[droppedFile()]); await screen.findByRole('dialog',{ name:'drop.jpg' });
  expect(fetcher.mock.calls.filter(x => x[1]?.body instanceof FormData)).toHaveLength(0);
});
it.each([false,true])('drops through crop and existing multipart add/replace flow (replace=%s)', async replace => {
  profile = { ...initialProfile }; if (replace) list = [initialPhoto];
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (input,options) => {
    if (options?.body instanceof FormData) {
      expect(String(input)).toBe(replace ? '/api/me/profile/photos/photo/file' : '/api/me/profile/photos');
      expect(options.method).toBe(replace ? 'PUT' : 'POST');
      expect(options.body.get('position')).toBe(replace ? null : '3');
      expect(options.body.get('file')).toBeInstanceOf(File);
      expect(options.headers).toEqual({ Authorization:'Bearer token' });
      list = [{ ...initialPhoto,position:replace ? 1 : 3 }]; return json(list[0]);
    }
    return original(input,options);
  });
  mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' });
  expect(dropPhoto(replace ? 1 : 3,[droppedFile('original.png','image/png')]).defaultPrevented).toBe(true);
  await screen.findByRole('dialog',{ name:'original.png' });
  expect(fetcher.mock.calls.filter(x => x[1]?.body instanceof FormData)).toHaveLength(0);
  fireEvent.click(screen.getByRole('button',{ name:'Confirmar recorte' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(fetcher.mock.calls.filter(x => x[1]?.body instanceof FormData)).toHaveLength(1);
  expect(fetcher.mock.calls.filter(x => String(x[0]).endsWith('/reorder'))).toHaveLength(0);
});
it.each(['unsupported','multiple','oversized','empty','directory'])('rejects invalid dropped selection: %s', async kind => {
  profile = { ...initialProfile }; mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' });
  let files = [droppedFile()];
  if (kind === 'unsupported') files = [droppedFile('photo.heic','image/heic')];
  if (kind === 'multiple') files.push(droppedFile('second.png','image/png'));
  if (kind === 'oversized') Object.defineProperty(files[0],'size',{ value:15*1024*1024+1 });
  if (kind === 'empty') files = [new File([],'empty.png',{ type:'image/png' })];
  if (kind === 'directory') files = [];
  expect(dropPhoto(1,files).defaultPrevented).toBe(true);
  const message = kind === 'unsupported' ? 'formato no es compatible' : ['oversized','empty'].includes(kind) ? 'hasta 15 MB' : 'una sola foto';
  expect(screen.getByRole('alert')).toHaveTextContent(message);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(writes('POST')).toHaveLength(0);
});
it('uses the same validation for file selection and lets a canceled crop release ownership', async () => {
  profile = { ...initialProfile }; mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' });
  const input = screen.getByLabelText('Agregar foto 1');
  expect(input).toHaveAttribute('hidden'); const click = vi.spyOn(input,'click');
  fireEvent.click(screen.getByRole('button',{ name:'Agregar en posición 1' })); expect(click).toHaveBeenCalledOnce();
  fireEvent.change(input,{ target:{ files:[droppedFile('bad.gif','image/gif')] } });
  expect(screen.getByRole('alert')).toHaveTextContent('formato no es compatible');
  fireEvent.change(input,{ target:{ files:[droppedFile('picker.jpg')] } });
  await screen.findByRole('dialog',{ name:'picker.jpg' });
  fireEvent.click(screen.getByRole('button',{ name:'Cancelar recorte' }));
  dropPhoto(1,[droppedFile('next.png','image/png')]); await screen.findByRole('dialog',{ name:'next.png' });
});
it('prevents competing selections before the first crop renders', async () => {
  profile = { ...initialProfile }; mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' });
  act(() => { dropPhoto(1,[droppedFile('first.jpg')]); dropPhoto(2,[droppedFile('second.jpg')]); });
  expect(screen.getByRole('dialog',{ name:'first.jpg' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog',{ name:'second.jpg' })).not.toBeInTheDocument();
});
it('keeps quiet refresh stable and shows an actionable error after it fails', async () => {
  profile = { ...initialProfile }; const original = fetcher.getMockImplementation()!;
  let finish: ((response: Response) => void) | undefined; let refreshing = false;
  fetcher.mockImplementation((input,options) => refreshing && String(input).endsWith('/photos') ? new Promise(resolve => { finish = resolve; }) : original(input,options));
  mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' });
  refreshing = true; refreshView();
  await waitFor(() => expect(finish).toBeDefined());
  expect(screen.getByRole('button',{ name:'Agregar en posición 1' })).toBeEnabled();
  expect(screen.queryByText('Actualizando estado…')).toBeNull();
  dropPhoto(1,[droppedFile()]); expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar recorte' }));
  await act(async () => finish?.(json({ invalid:true })));
  expect(screen.getByRole('button',{ name:'Agregar en posición 1' })).toHaveAccessibleDescription(/No pudimos confirmar el estado/);
  expect(screen.getByRole('alert')).toHaveTextContent('respuesta del servidor no es válida');
  dropPhoto(1,[droppedFile()]); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('rejects detached drop/picker callbacks after sign-out', async () => {
  profile = { ...initialProfile }; let finish: (() => void) | undefined;
  auth.signOut = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' });
  const target = screen.getByRole('article',{ name:'Foto 1' }); const input = screen.getByLabelText('Agregar foto 1');
  act(() => {
    observer(null);
    fireEvent.drop(target,{ dataTransfer:{ types:['Files'],files:[droppedFile()] } });
    fireEvent.change(input,{ target:{ files:[droppedFile()] } });
  });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); expect(writes('POST')).toHaveLength(0);
  await act(async () => finish?.()); await screen.findByRole('button',{ name:'Ingresar' });
});
it.each([
  ['NOT_STARTED','Sin iniciar'], ['PENDING','En proceso'], ['VERIFIED','Verificada'],
  ['REJECTED','No aprobada'], ['NEEDS_REVIEW','Requiere revisión'], ['STALE','Requiere una nueva verificación'],
])('keeps authenticity state %s out of setup without changing activation eligibility', async (status) => {
  profile = { ...initialProfile,authenticityVerificationStatus:status };
  mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' });
  expect(screen.queryByText(/Autenticidad:/)).toBeNull();
  expect(screen.queryByText(/La validación de fotos revisa cada imagen/)).toBeNull();
  expect(screen.getByRole('button',{ name:'Activar perfil' })).toBeEnabled();
  expect(fetcher.mock.calls.some(x => String(x[0]).includes('/authenticity-verification'))).toBe(false);
});
it.each([
  { status: 'DRAFT', verified: false, copy: 'Tu perfil está en borrador' },
  { status: 'DRAFT', verified: true, copy: 'Tu perfil está en borrador' },
  { status: 'INACTIVE', verified: false, copy: 'Tu perfil está inactivo' },
])('orders setup for $status (verified=$verified)', async ({ status, verified, copy }) => {
  profile = { ...initialProfile, status };
  user = { ...user, emailVerified: verified, ...(verified && { providerData: [{ providerId: 'google.com', uid: 'g', displayName: null, email: null, phoneNumber: null, photoURL: null }] }) };
  mount();
  const state = await screen.findByText(copy);
  const email = screen.queryByRole('heading', { name: 'Verificá tu email' });
  const photos = screen.getByRole('button', { name: 'Fotos' });
  const questions = screen.queryByRole('heading', { name: 'Preguntas del perfil' });
  const preview = screen.queryByRole('button', { name: 'Vista previa de mi perfil' });
  const activate = screen.getByRole('button', { name: 'Activar perfil' });
  const account = screen.getByRole('button', { name: 'Cuenta' });
  const edit = screen.getByRole('button', { name:'Editar datos y preferencias' });
  const order = [edit, state, email, photos, questions, activate, preview, account].filter(node => node !== null);
  expect(screen.queryByRole('form', { name:'Datos del perfil' })).toBeNull();
  expect(screen.queryByRole('form', { name:'Preferencias de búsqueda' })).toBeNull();
  for (let i = 1; i < order.length; i++) {
    expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
  expect(photos).toHaveAttribute('aria-expanded', 'true');
  expect(account).toHaveAttribute('aria-expanded', 'false');
  expect(!!email).toBe(!verified);
  expect(!!questions).toBe(status === 'DRAFT');
  expect(!!preview).toBe(status === 'DRAFT');
  if (preview) expect(within(preview.parentElement!).getByText(/La vista previa es privada.*no activa ni publica/)).toBeVisible();
  if (verified) expect(activate).toBeEnabled();
  else expect(activate).toBeDisabled();
  expect(screen.queryByText(/Estado: (DRAFT|INACTIVE)|cuatro fotos validadas/)).toBeNull();
});
it.each([true,false])('renders verification section and its link only for unverified restored users (verified=%s)', async verified => {
  profile = { ...initialProfile }; Object.defineProperty(user,'emailVerified',{ value:verified,configurable:true });
  mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' });
  expect(!!screen.queryByRole('heading',{ name:'Verificá tu email' })).toBe(!verified);
  expect(!!screen.queryByRole('link',{ name:'Ir a la verificación de email' })).toBe(!verified);
  expect(!!screen.queryByRole('button',{ name:'Reenviar correo' })).toBe(!verified);
  expect(!!screen.queryByRole('button',{ name:'Ya verifiqué' })).toBe(!verified);
  expect(screen.queryByText('Email verificado')).not.toBeInTheDocument();
  if (verified) {
    expect(screen.getByRole('button',{ name:'Agregar en posición 1' })).toBeEnabled();
    expect(screen.getByRole('button',{ name:'Activar perfil' })).toBeEnabled();
  } else {
    expect(screen.getByRole('button',{ name:'Agregar en posición 1' })).toBeDisabled();
    expect(screen.getByRole('button',{ name:'Activar perfil' })).toBeDisabled();
  }
});
it('never displays verification controls after local bootstrap auto-verification', async () => {
  profile = { ...initialProfile }; Object.defineProperty(user,'emailVerified',{ value:false,configurable:true });
  vi.mocked(user.reload).mockImplementation(async () => { Object.defineProperty(user,'emailVerified',{ value:true,configurable:true }); });
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((input,options) => String(input).endsWith('/local-dev/email-verification') ? Promise.resolve(new Response(null,{ status:204 })) : original(input,options));
  mount(true); await screen.findByRole('heading',{ name:'Completá tu perfil' });
  expect(user.reload).toHaveBeenCalledOnce(); expect(user.getIdToken).toHaveBeenCalledWith(true);
  expect(auth.verify).not.toHaveBeenCalled();
  expect(screen.queryByRole('heading',{ name:'Verificá tu email' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link',{ name:'Ir a la verificación de email' })).not.toBeInTheDocument();
});
it('never displays verification controls for a verified Google sign-in', async () => {
  profile = { ...initialProfile }; auth.observe = vi.fn(next => { next(null); return vi.fn(); });
  auth.google = vi.fn().mockResolvedValue(user);
  mount(); fireEvent.click(await screen.findByRole('button',{ name:'Continuar con Google' }));
  await screen.findByRole('heading',{ name:'Completá tu perfil' });
  expect(auth.verify).not.toHaveBeenCalled();
  expect(screen.queryByRole('heading',{ name:'Verificá tu email' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link',{ name:'Ir a la verificación de email' })).not.toBeInTheDocument();
});
it('removes verification section and link as soon as verification succeeds while reconciliation is pending', async () => {
  profile = { ...initialProfile }; Object.defineProperty(user,'emailVerified',{ value:false,configurable:true });
  let confirming = false; let finish: ((response: Response) => void) | undefined;
  vi.mocked(user.reload).mockImplementation(async () => { Object.defineProperty(user,'emailVerified',{ value:true,configurable:true }); confirming = true; });
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((input,options) => confirming && String(input).endsWith('/photos') ? new Promise(resolve => { finish = resolve; }) : original(input,options));
  mount(); const heading = await screen.findByRole('heading',{ name:'Completá tu perfil' });
  fireEvent.click(screen.getByRole('button',{ name:'Ya verifiqué' }));
  await waitFor(() => expect(finish).toBeDefined());
  expect(screen.queryByRole('heading',{ name:'Verificá tu email' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link',{ name:'Ir a la verificación de email' })).not.toBeInTheDocument();
  expect(screen.getByRole('heading',{ name:'Completá tu perfil' })).toBe(heading);
  expect(screen.getByRole('button',{ name:'Agregar en posición 1' })).toBeDisabled();
  expect(screen.getByRole('button',{ name:'Activar perfil' })).toBeDisabled();
  await act(async () => finish?.(json([])));
  await waitFor(() => expect(screen.getByRole('button',{ name:'Agregar en posición 1' })).toBeEnabled());
  expect(screen.getByRole('button',{ name:'Activar perfil' })).toBeEnabled();
});
it.each([4,9])('sends complete sparse placements for target %s and waits for the server before changing the grid', async target => {
  profile = { ...initialProfile }; list = [initialPhoto,{ ...initialPhoto,id:'second',position:4 },{ ...initialPhoto,id:'third',position:8 }];
  let finish: (() => Promise<void>) | undefined;
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((input,options) => String(input).endsWith('/reorder') ? new Promise(resolve => { finish = async () => { resolve(await original(input,options)); }; }) : original(input,options));
  mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' });
  reorderWithKeyboard(1,target); await waitFor(() => expect(finish).toBeDefined());
  expect(screen.getByRole('article',{ name:'Foto 1' })).toHaveAttribute('data-photo-id','photo');
  expect(screen.getByRole('article',{ name:'Foto 4' })).toHaveAttribute('data-photo-id','second');
  const expected = target === 4 ? [{ photoId:'second',position:1 },{ photoId:'photo',position:4 },{ photoId:'third',position:8 }]
    : [{ photoId:'second',position:4 },{ photoId:'third',position:8 },{ photoId:'photo',position:9 }];
  expect(JSON.parse(String(writes('PUT')[0]?.[1]?.body))).toEqual({ placements:expected });
  await act(async () => finish?.());
  await waitFor(() => expect(screen.getByRole('article',{ name:`Foto ${target}` })).toHaveAttribute('data-photo-id','photo'));
  expect(writes('PUT')).toHaveLength(1);
});
it('reconciles a reorder that persisted before a network failure and blocks duplicate retries', async () => {
  profile = { ...initialProfile }; list = [initialPhoto,{ ...initialPhoto,id:'second',position:4 }];
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (input,options) => {
    if (String(input).endsWith('/reorder')) { await original(input,options); throw new TypeError('connection lost'); }
    return original(input,options);
  });
  mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' }); reorderWithKeyboard(1,4);
  await screen.findByRole('alert');
  expect(screen.getByRole('article',{ name:'Foto 4' })).toHaveAttribute('data-photo-id','photo');
  expect(screen.getByRole('button',{ name:'Reordenar foto 4' })).toBeDisabled(); expect(writes('PUT')).toHaveLength(1);
  refreshView();
  await waitFor(() => expect(screen.getByRole('button',{ name:'Reordenar foto 4' })).toBeEnabled()); expect(writes('PUT')).toHaveLength(1);
});

function refreshView() {
  const recovery = screen.queryByRole('button', { name: /^(Reintentar|Consultar estado)$/ });
  if (recovery) fireEvent.click(recovery);
  else act(() => window.document.dispatchEvent(new Event('visibilitychange')));
}

it.each(['Tu perfil', 'Preferencias'])('retains the confirmed %s form across delayed and failed revisits', async destination => {
  await openManagement(destination);
  const title = destination === 'Tu perfil' ? 'Datos del perfil' : 'Preferencias de búsqueda';
  const form = await screen.findByRole('form', { name: title });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Volver a Inicio' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Volver a Inicio' }));
  await screen.findByRole('heading', { name: 'Inicio' });
  await waitFor(() => expect(screen.getByRole('button', { name: destination })).toBeEnabled());
  const base = fetcher.getMockImplementation()!;
  let finish!: (response: Response) => void;
  fetcher.mockImplementation((url, options) => url === '/api/me/profile' ? new Promise(resolve => { finish = resolve; }) : base(url, options));
  fireEvent.click(screen.getByRole('button', { name: destination }));
  await waitFor(() => expect(finish).toBeDefined());
  expect(screen.getByRole('form', { name: title })).toBe(form);
  expect(form.querySelector('input')).toBeDisabled();
  expect(window.document.querySelector('.session-loading')).toBeNull();
  await act(async () => finish(json({ code: 'SERVICE_UNAVAILABLE' }, 503)));
  await screen.findByRole('alert');
  expect(form).toBeVisible(); expect(form.querySelector('input')).toBeDisabled();
  expect(writes(destination === 'Tu perfil' ? 'PATCH' : 'PUT')).toHaveLength(0);
});

it.each(['ACTIVE','DRAFT'] as const)('opens confirmed preview from %s and preserves parent drafts through Back/Forward', async status => {
  installQuestions([savedAnswer('B', { selectedPosition: 1 })]);
  profile = { ...initialProfile, status }; mount();
  if (status === 'ACTIVE') {
    const entry = await screen.findByRole('button', { name: 'Tu perfil' }); await waitFor(() => expect(entry).toBeEnabled()); fireEvent.click(entry);
  }
  const entry = await screen.findByRole('button', { name: 'Vista previa de mi perfil' }); await waitFor(() => expect(entry).toBeEnabled());
  if (status === 'DRAFT') fireEvent.click(screen.getByRole('button', { name:'Editar datos y preferencias' }));
  const form = screen.getByRole('form', { name: 'Datos del perfil' });
  fireEvent.change(within(form).getByLabelText('Bio (opcional)'), { target: { value: 'Unsaved local draft' } });
  if (status === 'DRAFT') { fireEvent.click(screen.getByRole('button', { name:'Volver a fotos y activación' })); await waitFor(() => expect(entry).toBeVisible()); }
  fireEvent.click(entry);
  await screen.findByRole('heading', { name: 'Vista previa de mi perfil' }); await screen.findByText('Respuesta B');
  expect(screen.getByText('Unsaved local draft')).not.toBeVisible();
  expect(fetcher.mock.calls.some(([path]) => String(path).includes('/visual-profile'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Volver' }));
  await waitFor(() => expect(entry).toBeVisible()); expect(entry).toHaveFocus();
  expect(within(form).getByLabelText('Bio (opcional)')).toHaveValue('Unsaved local draft');
  await act(async () => { history.forward(); await new Promise(r => setTimeout(r,30)); });
  await screen.findByText('Respuesta B');
  expect(writes('PATCH')).toHaveLength(0); expect(writes('PUT')).toHaveLength(0);
});

it('keeps photo deletion feedback independent after a profile save and preserves new detail drafts', async () => {
  list = [initialPhoto]; vi.spyOn(window, 'confirm').mockReturnValue(true);
  await openManagement('Tu perfil');
  const form = await screen.findByRole('form', { name:'Datos del perfil' });
  const bio = within(form).getByLabelText('Bio (opcional)');
  fireEvent.change(bio, { target:{ value:'Confirmed bio' } }); fireEvent.submit(form);
  await within(form).findByText('Cambios guardados.');
  fireEvent.change(bio, { target:{ value:'Unsaved bio' } });
  fireEvent.click(screen.getByRole('button', { name:'Eliminar foto 1' }));
  await waitFor(() => expect(screen.queryByRole('button', { name:'Eliminar foto 1' })).toBeNull());
  const confirmation = await screen.findByText('Cambios guardados.');
  expect(confirmation).toHaveAttribute('role', 'status'); expect(confirmation.closest('form')).toBeNull();
  expect(within(form).getByRole('status')).toBeEmptyDOMElement();
  expect(bio).toHaveValue('Unsaved bio'); expect(profile?.bio).toBe('Confirmed bio');
  expect(within(form).getByRole('button', { name:'Guardar cambios' })).toBeEnabled();
  expect(writes('PATCH')).toHaveLength(1); expect(writes('DELETE')).toHaveLength(1);
});
