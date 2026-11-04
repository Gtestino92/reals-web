import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { App } from '../App';
import { ApiClient } from '../auth/api';
import type { AuthService, Identity } from '../auth/firebase';
import { defaults } from './contracts';
// Real canvas/export/cleanup behavior is covered in CropDialog tests.
vi.mock('./CropDialog', () => ({ CropDialog: ({ onConfirm, onCancel }: { onConfirm: (blob: Blob) => Promise<void>; onCancel: () => void }) => <div role="dialog"><button onClick={() => void onConfirm(new Blob(['jpeg'],{ type:'image/jpeg' }))}>Confirmar recorte</button><button onClick={onCancel}>Cancelar recorte</button></div> }));
const initialProfile = { ...defaults, displayName:'Ana',city:'Córdoba',countryCode:'AR',id:'p',userId:'u',status:'DRAFT',authenticityVerificationStatus:'STALE' };
const initialPhoto = { id:'photo',url:'http://localhost:9000/photo',position:1,validationStatus:'VALIDATED',moderationStatus:'APPROVED',isPersonPhoto:true,isFullBody:true };
let profile: typeof initialProfile | null, list: typeof initialPhoto[], satisfied: boolean, version: string;
let user: Identity, auth: AuthService;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
const json = (body: unknown,status = 200) => new Response(JSON.stringify(body),{ status });
const document = () => ({ type:'PRIVACY_NOTICE',version,requiredAction:'ACKNOWLEDGED',satisfied,url:'https://example.com/privacy' });
beforeEach(() => {
  profile = null; list = []; satisfied = true; version = 'v1';
  user = { uid:'f',emailVerified:true,getIdToken:vi.fn().mockResolvedValue('token'),reload:vi.fn().mockResolvedValue(undefined) };
  auth = { observe:vi.fn(next => { next(user); return vi.fn(); }),signIn:vi.fn(),signUp:vi.fn(),google:vi.fn(),verify:vi.fn().mockResolvedValue(undefined),signOut:vi.fn().mockResolvedValue(undefined) };
  fetcher = vi.fn<typeof fetch>().mockImplementation(async (input,options) => {
    const path = String(input), method = options?.method ?? 'GET';
    if (path === '/api/me') return json({ id:'u',status:'ACTIVE' });
    if (path === '/api/reference/countries') return json([{ code:'AR',displayName:'Argentina' },{ code:'ES',displayName:'España' }]);
    if (path === '/api/me/legal-status') return json({ requirementsSatisfied:satisfied,documents:[document()] });
    if (path === '/api/legal/documents/current') return json({ documents:[document()] });
    if (path === '/api/me/legal-document-actions') { const body = JSON.parse(String(options?.body)); if (body.documentVersion !== version) return json({ code:'LEGAL_DOCUMENT_VERSION_MISMATCH' },409); satisfied = true; return json({}); }
    if (path === '/api/me/profile' && method !== 'GET') { const body = JSON.parse(String(options?.body)); profile = { ...(profile ?? initialProfile),...body }; return json(profile,method === 'POST' ? 201 : 200); }
    if (path === '/api/me/profile') return profile ? json(profile) : json({ code:'PROFILE_NOT_FOUND' },404);
    if (path === '/api/me/profile/photos' && method === 'GET') return json(list);
    if (path === '/api/me/home') return json({ pendingActions:[],nextSteps:[],passiveNotices:[],activeInteractionsSummary:{ hasPendingSchedulingConnection:false,activeInitialCount:0,activeConnectionCount:0,actionableConnectionCount:0 } });
    if (path === '/api/me/profile/match-filters') { profile = { ...initialProfile,...profile,...JSON.parse(String(options?.body)) }; return json(profile); }
    if (path === '/api/me/profile/activation') { profile = { ...initialProfile,status:'ACTIVE' }; return json(profile); }
    if (path.endsWith('/photos/reorder')) { const placements: { photoId:string; position:number }[] = JSON.parse(String(options?.body)).placements; list = list.map(p => ({ ...p,position:placements.find(x => x.photoId === p.id)?.position ?? p.position })); return json(list); }
    if (method === 'DELETE') { list = list.filter(x => !path.endsWith(x.id)); return json(profile); }
    throw new Error(`Unexpected test endpoint: ${method} ${path}`);
  });
});
function mount() { return render(<StrictMode><App firebase={{ service:auth,localVerification:false }} api={new ApiClient(fetcher)}/></StrictMode>); }
const writes = (method: string) => fetcher.mock.calls.filter(x => x[1]?.method === method);
async function createForm() { await screen.findByRole('heading',{ name:'Crear perfil' }); const form = screen.getByRole('form',{ name:'Crear perfil' }); fireEvent.change(within(form).getByLabelText('Nombre visible'),{ target:{ value:'Ana' } }); fireEvent.change(within(form).getByLabelText('Ciudad'),{ target:{ value:'Córdoba' } }); fireEvent.change(within(form).getByLabelText('País'),{ target:{ value:'AR' } }); return form; }
it('creates once under StrictMode and duplicate submit, restores DRAFT and activates through backend', async () => {
  mount(); const form = await createForm(); fireEvent.submit(form); fireEvent.submit(form);
  await screen.findByRole('heading',{ name:'Completá tu perfil' }); expect(writes('POST')).toHaveLength(1); expect(profile?.status).toBe('DRAFT');
  fireEvent.click(screen.getByRole('button',{ name:'Activar perfil' })); await screen.findByRole('heading',{ name:'Tu perfil está activo' }); expect(user.reload).toHaveBeenCalledOnce(); expect(user.getIdToken).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByRole('button',{ name:'Ir a Inicio' })); expect(screen.getByRole('heading',{ name:'Inicio' })).toBeInTheDocument();
});
it.each(['DRAFT','INACTIVE','ACTIVE'])('restores %s after reload', async status => { profile = { ...initialProfile,status }; mount(); await screen.findByRole('heading',{ name:status === 'ACTIVE' ? 'Inicio' : 'Completá tu perfil' }); expect(writes('POST')).toHaveLength(0); });
it('records exactly the required legal action and version', async () => { satisfied = false; mount(); await screen.findByRole('heading',{ name:'Antes de continuar' }); fireEvent.click(screen.getByRole('button',{ name:'Confirmar lectura' })); await screen.findByRole('heading',{ name:'Crear perfil' }); expect(JSON.parse(String(writes('POST')[0]?.[1]?.body))).toEqual({ documentType:'PRIVACY_NOTICE',documentVersion:'v1',action:'ACKNOWLEDGED' }); });
it('recovers a stale legal version without silently accepting the new version', async () => { satisfied = false; mount(); await screen.findByRole('heading',{ name:'Antes de continuar' }); version = 'v2'; fireEvent.click(screen.getByRole('button',{ name:'Confirmar lectura' })); await screen.findByText(/Versión v2/); expect(satisfied).toBe(false); expect(screen.getByRole('button',{ name:'Confirmar lectura' })).toBeEnabled(); });
it('searches countries without accents and validates without a mutation', async () => { mount(); const form = await createForm(); fireEvent.change(within(form).getByLabelText('Buscar país'),{ target:{ value:'espana' } }); expect(within(form).getByRole('option',{ name:'España' })).toBeInTheDocument(); fireEvent.change(within(form).getByLabelText('Nombre visible'),{ target:{ value:'x' } }); fireEvent.submit(form); expect(await screen.findByRole('alert')).toHaveTextContent('Nombre visible'); expect(writes('POST')).toHaveLength(0); });
it('updates details and filters using separate contracts', async () => { profile = { ...initialProfile }; mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' });
  fireEvent.click(screen.getByText('Datos del perfil',{ selector:'summary' })); const details = screen.getByRole('form',{ name:'Datos del perfil' }); fireEvent.change(within(details).getByLabelText('Ciudad'),{ target:{ value:'Rosario' } }); fireEvent.submit(details); await waitFor(() => expect(profile?.city).toBe('Rosario')); await waitFor(() => expect(screen.getByRole('button',{ name:'Actualizar estado' })).toBeEnabled()); expect(JSON.parse(String(writes('PATCH')[0]?.[1]?.body))).not.toHaveProperty('intention');
  fireEvent.click(screen.getByText('Preferencias de búsqueda',{ selector:'summary' })); const filters = screen.getByRole('form',{ name:'Preferencias de búsqueda' }); fireEvent.change(within(filters).getByLabelText('Intención'),{ target:{ value:'FRIENDSHIP' } }); fireEvent.submit(filters); await waitFor(() => expect(profile?.intention).toBe('FRIENDSHIP')); expect(JSON.parse(String(writes('PUT')[0]?.[1]?.body))).not.toHaveProperty('city');
});
it('reorders all placements and deletes by ID with confirmation', async () => { profile = { ...initialProfile }; list = [initialPhoto,{ ...initialPhoto,id:'second',position:2 }]; vi.spyOn(window,'confirm').mockReturnValue(true); mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' }); fireEvent.click(screen.getByRole('button',{ name:'Mover después foto 1' })); await waitFor(() => expect(list[0]?.position).toBe(2)); await waitFor(() => expect(screen.getByRole('button',{ name:'Actualizar estado' })).toBeEnabled()); expect(JSON.parse(String(writes('PUT')[0]?.[1]?.body)).placements).toEqual([{ photoId:'second',position:1 },{ photoId:'photo',position:2 }]); fireEvent.click(screen.getByRole('button',{ name:'Eliminar foto 2' })); await waitFor(() => expect(list).toHaveLength(1)); expect(writes('DELETE')[0]?.[0]).toBe('/api/me/profile/photos/photo'); });
it.each(['EMAIL_NOT_VERIFIED','PROFILE_PHOTOS_REQUIRED','PROFILE_PERSON_PHOTO_REQUIRED','PROFILE_FULL_BODY_PHOTO_REQUIRED','PROFILE_PHOTO_MODERATION_NOT_APPROVED','PROFILE_AUTHENTICITY_VERIFICATION_REQUIRED','LEGAL_ACTION_REQUIRED','PROFILE_NOT_ACTIVATABLE'])('retains draft after activation rejection %s', async code => {
  profile = { ...initialProfile }; const original = fetcher.getMockImplementation()!; fetcher.mockImplementation((input,options) => String(input).endsWith('/activation') ? Promise.resolve(json({ code },409)) : original(input,options)); mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' }); fireEvent.click(screen.getByRole('button',{ name:'Activar perfil' })); await screen.findByRole('alert'); expect(screen.queryByRole('heading',{ name:'Tu perfil está activo' })).not.toBeInTheDocument(); expect(profile.status).toBe('DRAFT');
});
it('email resend and reload use Firebase with cooldown', async () => { profile = { ...initialProfile }; Object.defineProperty(user,'emailVerified',{ value:false,configurable:true }); mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' }); fireEvent.click(screen.getByRole('button',{ name:'Reenviar correo' })); await waitFor(() => expect(screen.getByRole('button',{ name:/Reenviar correo/ })).toBeDisabled()); expect(auth.verify).toHaveBeenCalledOnce(); vi.mocked(user.reload).mockImplementation(async () => { Object.defineProperty(user,'emailVerified',{ value:true,configurable:true }); }); fireEvent.click(screen.getByRole('button',{ name:'Ya verifiqué' })); await screen.findByText('Email verificado'); });
it('rejects stale domain results after sign-out', async () => { let finish: ((value: Response) => void) | undefined; const original = fetcher.getMockImplementation()!; fetcher.mockImplementation((input,options) => String(input).endsWith('/legal-status') ? new Promise(resolve => { finish = resolve; }) : original(input,options)); mount(); await waitFor(() => expect(finish).toBeDefined()); fireEvent.click(screen.getByRole('button',{ name:'Cerrar sesión' })); await screen.findByRole('button',{ name:'Ingresar' }); await act(async () => { finish?.(json({ requirementsSatisfied:true,documents:[] })); }); expect(screen.queryByRole('heading',{ name:'Crear perfil' })).not.toBeInTheDocument(); });
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
  mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' }); fireEvent.click(screen.getByRole('button',{ name:'Mover después foto 1' })); await screen.findByRole('alert'); expect(list[0]?.id).toBe('photo'); expect(screen.getByRole('button',{ name:'Mover después foto 1' })).toBeEnabled();
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
  mount(); await screen.findByRole('heading',{ name:'Completá tu perfil' }); const move = screen.getByRole('button',{ name:'Mover después foto 1' }); fireEvent.click(move); fireEvent.click(move);
  await waitFor(() => expect(finish).toBeDefined()); expect(writes('PUT')).toHaveLength(1); expect(screen.getByRole('button',{ name:'Eliminar foto 1' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{ name:'Cerrar sesión' })); await screen.findByRole('button',{ name:'Ingresar' }); await act(async () => finish?.(json(list))); expect(screen.queryByRole('heading',{ name:'Completá tu perfil' })).not.toBeInTheDocument();
});
