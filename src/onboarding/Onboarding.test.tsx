import { confirmSignOut } from '../test/signOut';
import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OperationalApp as App } from '../App';
import { ApiClient } from '../auth/api';
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
it.each(['DRAFT', 'INACTIVE'])('reuses confirmed recoverable deletion in %s setup and excludes duplicate/coupled writes', async status => {
  profile = { ...initialProfile, status };
  let finish!: (value: Response) => void;
  const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url, options) => url === '/api/me' && options?.method === 'DELETE' ? new Promise(resolve => { finish = resolve; }) : base(url, options));
  mount(); await screen.findByRole('heading', { name: 'Completá tu perfil' });
  expect(screen.queryByRole('button', { name: 'Cerrar sesión' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Cuenta' }));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const remove = screen.getByRole('button', { name: 'Eliminar cuenta' }); fireEvent.click(remove); expect(writes('DELETE')).toHaveLength(0);
  confirm.mockReturnValue(true); fireEvent.click(remove); fireEvent.click(remove);
  await waitFor(() => expect(writes('DELETE')).toHaveLength(1)); expect(auth.signOut).not.toHaveBeenCalled();
  const details = screen.getByRole('form', { name: 'Datos del perfil', hidden: true }); fireEvent.submit(details); expect(writes('PATCH')).toHaveLength(0);
  await act(async () => finish(new Response(null, { status: 200 })));
  await screen.findByRole('button', { name: 'Ingresar' }); expect(auth.signOut).toHaveBeenCalledOnce();
});
it('keeps uncertain setup deletion blocked and offers authoritative account reconciliation', async () => {
  profile = { ...initialProfile }; const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url, options) => url === '/api/me' && options?.method === 'DELETE' ? Promise.reject(new TypeError('offline')) : base(url, options));
  mount(); await screen.findByRole('heading', { name: 'Completá tu perfil' }); fireEvent.click(screen.getByRole('button', { name: 'Cuenta' }));
  vi.spyOn(window, 'confirm').mockReturnValue(true); const remove = screen.getByRole('button', { name: 'Eliminar cuenta' }); fireEvent.click(remove);
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
it('offers compact management entries and ACTIVE profile editing with photos and a focused return', async () => {
  profile = { ...initialProfile, status:'ACTIVE' }; mount();
  for (const name of ['Tu perfil','Preferencias','Afinidades','Cuenta']) expect(await screen.findByRole('button',{ name })).toBeVisible();
  const entry = screen.getByRole('button',{ name:'Tu perfil' }); await waitFor(() => expect(entry).toBeEnabled()); fireEvent.click(entry);
  const form = await screen.findByRole('form',{ name:'Datos del perfil' });
  expect(form.compareDocumentPosition(screen.getByText('Fotos', { selector: 'summary' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getByRole('heading',{ name:'Tu perfil' })).toHaveFocus();
  expect(screen.getByLabelText('Agregar foto 1')).toBeInTheDocument();
  expect(screen.queryByRole('button',{ name:'Activar perfil' })).toBeNull();
  expect(screen.queryByRole('form',{ name:'Preferencias de búsqueda' })).toBeNull();
  fireEvent.change(within(form).getByLabelText('Bio opcional'),{ target:{ value:'Una bio nueva' } }); fireEvent.submit(form);
  await screen.findByText('Cambios guardados.'); expect(profile?.bio).toBe('Una bio nueva');
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
  fireEvent.click(screen.getByRole('button',{ name:'Volver a Inicio' }));
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
  else fireEvent.submit(screen.getByRole('form',{ name:method === 'PUT' ? 'Preferencias de búsqueda' : 'Datos del perfil' }));
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
});
it('ACTIVE photos retain keyboard reordering', async () => {
  list = [initialPhoto,{ ...initialPhoto,id:'second',position:2 }]; await openManagement('Tu perfil');
  await screen.findByRole('form',{ name:'Datos del perfil' }); reorderWithKeyboard(1,2);
  await screen.findByText('Cambios guardados.'); expect(list[0]?.position).toBe(2);
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
it('shows honest unavailable surfaces and signs out once from Account', async () => {
  await openManagement('Afinidades'); expect(screen.getByRole('heading',{ name:'Próximamente' })).toBeVisible();
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
async function createForm() { await screen.findByRole('heading',{ name:'Crear perfil' }); const form = screen.getByRole('form',{ name:'Crear perfil' }); fireEvent.change(within(form).getByLabelText('Nombre visible'),{ target:{ value:'Ana' } }); fireEvent.change(within(form).getByLabelText('Ciudad'),{ target:{ value:'Córdoba' } }); fireEvent.change(within(form).getByLabelText('Fecha de nacimiento'),{ target:{ value:'1995-01-01' } }); return form; }
it('creates once under StrictMode and duplicate submit, restores DRAFT and activates through backend', async () => {
  mount(); const form = await createForm(); fireEvent.submit(form); fireEvent.submit(form);
  await screen.findByRole('heading',{ name:'Completá tu perfil' }); expect(writes('POST')).toHaveLength(1); expect(profile?.status).toBe('DRAFT');
  fireEvent.click(screen.getByRole('button',{ name:'Activar perfil' })); await screen.findByRole('heading',{ name:'Inicio' }); expect(user.reload).toHaveBeenCalledOnce(); expect(user.getIdToken).toHaveBeenCalledWith(true);
  expect(screen.getByRole('heading',{ name:'Inicio' })).toBeInTheDocument();
});
it.each(['DRAFT','INACTIVE','ACTIVE'])('restores %s after reload', async status => { profile = { ...initialProfile,status }; mount(); await screen.findByRole('heading',{ name:status === 'ACTIVE' ? 'Inicio' : 'Completá tu perfil' }); expect(writes('POST')).toHaveLength(0); });
it('records exactly the required legal action and version', async () => { satisfied = false; mount(); await screen.findByRole('heading',{ name:'Antes de continuar' }); fireEvent.click(screen.getByRole('button',{ name:'Confirmar lectura' })); await screen.findByRole('heading',{ name:'Crear perfil' }); expect(JSON.parse(String(writes('POST')[0]?.[1]?.body))).toEqual({ documentType:'PRIVACY_NOTICE',documentVersion:'v1',action:'ACKNOWLEDGED' }); });
it('recovers a stale legal version without silently accepting the new version', async () => { satisfied = false; mount(); await screen.findByRole('heading',{ name:'Antes de continuar' }); version = 'v2'; fireEvent.click(screen.getByRole('button',{ name:'Confirmar lectura' })); await screen.findByText(/Versión v2/); expect(satisfied).toBe(false); expect(screen.getByRole('button',{ name:'Confirmar lectura' })).toBeEnabled(); });
it('uses a single country dropdown and validates without a mutation', async () => { mount(); const form = await createForm(); expect(within(form).queryByLabelText('Buscar país')).not.toBeInTheDocument(); expect(within(form).getByLabelText('País')).toHaveValue('AR'); expect(within(form).getByRole('option',{ name:'España' })).toBeInTheDocument(); fireEvent.change(within(form).getByLabelText('Nombre visible'),{ target:{ value:'x' } }); fireEvent.submit(form); expect(await screen.findByRole('alert')).toHaveTextContent('Nombre visible'); expect(writes('POST')).toHaveLength(0); });
it('updates details and filters using separate contracts', async () => { profile = { ...initialProfile }; mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' });
  fireEvent.click(screen.getByText('Datos del perfil',{ selector:'summary' })); const details = screen.getByRole('form',{ name:'Datos del perfil' }); fireEvent.change(within(details).getByLabelText('Ciudad'),{ target:{ value:'Rosario' } }); fireEvent.submit(details); await waitFor(() => expect(profile?.city).toBe('Rosario')); await waitFor(() => expect(screen.getByRole('button',{ name:'Actualizar estado' })).toBeEnabled()); expect(JSON.parse(String(writes('PATCH')[0]?.[1]?.body))).not.toHaveProperty('intention');
  fireEvent.click(screen.getByText('Preferencias de búsqueda',{ selector:'summary' })); const filters = screen.getByRole('form',{ name:'Preferencias de búsqueda' }); fireEvent.change(within(filters).getByLabelText('Intención'),{ target:{ value:'FRIENDSHIP' } }); fireEvent.submit(filters); await waitFor(() => expect(profile?.intention).toBe('FRIENDSHIP')); expect(JSON.parse(String(writes('PUT')[0]?.[1]?.body))).not.toHaveProperty('city');
});
it('reorders all placements and deletes by ID with confirmation', async () => { profile = { ...initialProfile }; list = [initialPhoto,{ ...initialPhoto,id:'second',position:2 }]; vi.spyOn(window,'confirm').mockReturnValue(true); mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' }); reorderWithKeyboard(1,2); await waitFor(() => expect(list[0]?.position).toBe(2)); await waitFor(() => expect(screen.getByRole('button',{ name:'Actualizar estado' })).toBeEnabled()); expect(JSON.parse(String(writes('PUT')[0]?.[1]?.body)).placements).toEqual([{ photoId:'second',position:1 },{ photoId:'photo',position:2 }]); fireEvent.click(screen.getByRole('button',{ name:'Eliminar foto 2' })); await waitFor(() => expect(list).toHaveLength(1)); expect(writes('DELETE')[0]?.[0]).toBe('/api/me/profile/photos/photo'); });
it.each(['EMAIL_NOT_VERIFIED','PROFILE_PHOTOS_REQUIRED','PROFILE_PERSON_PHOTO_REQUIRED','PROFILE_FULL_BODY_PHOTO_REQUIRED','PROFILE_PHOTO_MODERATION_NOT_APPROVED','PROFILE_AUTHENTICITY_VERIFICATION_REQUIRED','LEGAL_ACTION_REQUIRED','PROFILE_NOT_ACTIVATABLE'])('retains draft after activation rejection %s', async code => {
  profile = { ...initialProfile }; const original = fetcher.getMockImplementation()!; fetcher.mockImplementation((input,options) => String(input).endsWith('/activation') ? Promise.resolve(json({ code },409)) : original(input,options)); mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' }); fireEvent.click(screen.getByRole('button',{ name:'Activar perfil' })); await screen.findByRole('alert'); expect(screen.queryByRole('heading',{ name:'Inicio' })).not.toBeInTheDocument(); expect(profile.status).toBe('DRAFT');
});
it('email resend and reload use Firebase with cooldown', async () => { profile = { ...initialProfile }; Object.defineProperty(user,'emailVerified',{ value:false,configurable:true }); mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' }); fireEvent.click(screen.getByRole('button',{ name:'Reenviar correo' })); await waitFor(() => expect(screen.getByRole('button',{ name:/Reenviar correo/ })).toBeDisabled()); expect(auth.verify).toHaveBeenCalledOnce(); vi.mocked(user.reload).mockImplementation(async () => { Object.defineProperty(user,'emailVerified',{ value:true,configurable:true }); }); fireEvent.click(screen.getByRole('button',{ name:'Ya verifiqué' })); await screen.findByText('Email verificado.'); expect(screen.queryByRole('heading',{ name:'Verificá tu email' })).not.toBeInTheDocument(); });
it('rejects stale domain results after sign-out', async () => { let finish: ((value: Response) => void) | undefined; const original = fetcher.getMockImplementation()!; fetcher.mockImplementation((input,options) => String(input).endsWith('/legal-status') ? new Promise(resolve => { finish = resolve; }) : original(input,options)); mount(); await waitFor(() => expect(finish).toBeDefined()); confirmSignOut(); await screen.findByRole('button',{ name:'Ingresar' }); await act(async () => { finish?.(json({ requirementsSatisfied:true,documents:[] })); }); expect(screen.queryByRole('heading',{ name:'Crear perfil' })).not.toBeInTheDocument(); });
it('keeps failed creation input and reconciles before another attempt', async () => { const original = fetcher.getMockImplementation()!; fetcher.mockImplementation((input,options) => options?.method === 'POST' ? Promise.reject(new TypeError('offline')) : original(input,options)); mount(); const form = await createForm(); fireEvent.submit(form); await screen.findByRole('alert'); expect(screen.getByLabelText('Nombre visible')).toHaveValue('Ana'); expect(writes('POST')).toHaveLength(1); });
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
  mount(); await screen.findByRole('alert'); expect(auth.signOut).not.toHaveBeenCalled(); malformed = false; fireEvent.click(screen.getByRole('button',{ name:'Actualizar estado' })); await screen.findByRole('heading',{ name:'Completá tu perfil' });
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
  fireEvent.click(screen.getByRole('button',{ name:'Actualizar estado' }));
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
  fireEvent.click(screen.getByText('Datos del perfil',{ selector:'summary' }));
  const form = screen.getByRole('form',{ name:'Datos del perfil' });
  fireEvent.change(within(form).getByLabelText('Ciudad'),{ target:{ value:'Rosario' } });
  fireEvent.submit(form);
  await waitFor(() => expect(profile?.city).toBe('Rosario'));
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
  unavailable = true; fireEvent.click(screen.getByRole('button',{ name:'Actualizar estado' }));
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
  mount(); await screen.findByRole('alert');
  expect(screen.queryByRole('heading',{ name:'Inicio no disponible' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{ name:'Activar perfil' })).not.toBeInTheDocument();
  if (code === 'INVALID_TOKEN') { await screen.findByRole('button',{ name:'Ingresar' }); expect(auth.signOut).toHaveBeenCalledOnce(); }
  else { expect(screen.getByRole('alert')).toHaveTextContent('suspendida temporalmente'); expect(auth.signOut).not.toHaveBeenCalled(); }
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
  fireEvent.click(screen.getByRole('button',{ name:'Actualizar estado' }));
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
  expect(screen.getByRole('status')).toHaveTextContent('Preparando Reals…');
  expect(screen.getByRole('heading',{ name:'Reals',level:1 })).toBeVisible();
  expect(screen.queryByRole('button',{ name:'Ingresar' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button',{ name:'Actualizar estado' })).not.toBeInTheDocument();
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
    for (const frame of visibleFrames) { expect(frame).not.toMatch(technicalStatus); expect(frame).not.toContain('Iniciar sesión'); expect(frame).toContain('Reals'); }
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
  offline = false; fireEvent.click(screen.getByRole('button',{ name:'Actualizar estado' }));
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
it('shows transient upload guidance during reconciliation and an actionable error after it fails', async () => {
  profile = { ...initialProfile }; const original = fetcher.getMockImplementation()!;
  let finish: ((response: Response) => void) | undefined; let refreshing = false;
  fetcher.mockImplementation((input,options) => refreshing && String(input).endsWith('/photos') ? new Promise(resolve => { finish = resolve; }) : original(input,options));
  mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' });
  refreshing = true; fireEvent.click(screen.getByRole('button',{ name:'Actualizar estado' }));
  await waitFor(() => expect(finish).toBeDefined());
  expect(screen.getByRole('button',{ name:'Agregar en posición 1' })).toBeDisabled();
  expect(screen.getByRole('button',{ name:'Agregar en posición 1' })).toHaveAccessibleDescription(/Estamos actualizando/);
  dropPhoto(1,[droppedFile()]); expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
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
])('presents authenticity %s in Spanish without changing activation eligibility', async (status,label) => {
  profile = { ...initialProfile,authenticityVerificationStatus:status };
  mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' });
  expect(screen.getByText(`Autenticidad: ${label}`)).toBeInTheDocument();
  expect(screen.queryByText(`Autenticidad: ${status}`)).not.toBeInTheDocument();
  expect(screen.getByText(/La validación de fotos revisa cada imagen/)).toHaveTextContent('proceso separado');
  expect(screen.getByRole('button',{ name:'Activar perfil' })).toBeEnabled();
  expect(fetcher.mock.calls.some(x => String(x[0]).includes('/authenticity-verification'))).toBe(false);
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
  fireEvent.click(screen.getByRole('button',{ name:'Actualizar estado' }));
  await waitFor(() => expect(screen.getByRole('button',{ name:'Reordenar foto 4' })).toBeEnabled()); expect(writes('PUT')).toHaveLength(1);
});
