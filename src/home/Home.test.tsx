import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../App';
import { ApiClient } from '../auth/api';
import type { AuthService, Identity } from '../auth/firebase';
import { emptyHome, homeStatus } from './fixtures';

let home: ReturnType<typeof emptyHome>, status: ReturnType<typeof homeStatus>;
let profile: { id: string; userId: string; status: string; displayName: string };
let observer: (u: Identity | null) => void, user: Identity, auth: AuthService;
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
let geo: ReturnType<typeof vi.fn<Geolocation['getCurrentPosition']>>;
const json = (v: unknown, code = 200) => new Response(JSON.stringify(v), { status: code });
const position = (overrides = {}) => ({ coords: { latitude: 12, longitude: -21, accuracy: 25, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}) }, timestamp: Date.now(), toJSON: () => ({}), ...overrides });
function mount() { return render(<App firebase={{ service: auth, localVerification: false }} api={new ApiClient(fetcher)} />); }
const search = () => screen.getByRole('button', { name: 'Buscar chat' });
const ready = async () => { await waitFor(() => { expect(document.querySelector('.home')).toHaveAttribute('aria-busy', 'false'); expect(screen.queryByText('Hola, Lucía') ?? screen.queryByRole('heading', { name: 'Buscando chat' })).toBeTruthy(); }); };
const writes = () => fetcher.mock.calls.filter(([url, o]) => String(url).endsWith('/queue') && o?.method !== 'GET');
beforeEach(() => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  home = emptyHome(); status = homeStatus(); profile = { id: 'p', userId: 'u', status: 'ACTIVE', displayName: 'Lucía' };
  user = { uid: 'f', emailVerified: true, getIdToken: vi.fn().mockResolvedValue('test'), reload: vi.fn() };
  auth = { observe: vi.fn(next => { observer = next; next(user); return vi.fn(); }), signIn: vi.fn(), signUp: vi.fn(), google: vi.fn(), verify: vi.fn(), signOut: vi.fn().mockResolvedValue(undefined) };
  geo = vi.fn<Geolocation['getCurrentPosition']>().mockImplementation(success => success(position()));
  vi.stubGlobal('isSecureContext', true); vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { geolocation: { getCurrentPosition: geo } }));
  fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, o) => {
    switch (String(url)) {
      case '/api/me': return json({ id: 'u', status: 'ACTIVE' });
      case '/api/me/profile': return json(profile);
      case '/api/me/home/status': return json(status);
      case '/api/me/home': return json(home);
      case '/api/matchmaking/queue':
        if (o?.method === 'POST') home.matchmaking.inQueue = true;
        if (o?.method === 'DELETE') home.matchmaking.inQueue = false;
        return json({ userId: 'u', inQueue: home.matchmaking.inQueue });
      default: throw new Error('Unexpected endpoint');
    }
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('ACTIVE reaches accessible empty Home without asking for location', async () => {
  mount(); await ready(); expect(search()).toBeEnabled(); expect(geo).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: 'Inicio', level: 2 })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Ver Actividad' })).toBeNull(); expect(document.body.textContent).not.toMatch(/0 conversaciones|No tenés primeros|Cuando haya próximos/);
});
it('renders all known summaries, notices and unknown types as text without navigation', async () => {
  home.pendingActions = [{ type: 'FIRST_CHAT', matchId: 'm', chatId: 'c', partner: { displayName: '<img src=x>' } }, { type: 'VISUAL_REVIEW', matchId: 'v', chatId: null }];
  home.nextSteps = ['SCHEDULING','SECOND_CHAT_SCHEDULED','SECOND_CHAT_AVAILABLE','SECOND_CHAT_EXPIRED','SECOND_CHAT_READ_ONLY','FUTURE'].map(type => ({ type, connectionId: type, matchId: 'm', requiresAction: true }));
  home.passiveNotices = [{ type: 'SCHEDULING_PREPARING' }, { type: 'UNKNOWN' }];
  mount(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Ver Actividad' })); expect(screen.getByText('Con <img src=x>')).toBeVisible(); expect(screen.getByText('Actividad pendiente')).toBeVisible();
  expect(screen.getByText(/Estos resúmenes son de solo lectura/)).toBeVisible(); expect(screen.queryByRole('link')).toBeNull(); expect(document.body.textContent).not.toContain('SECOND_CHAT_');
});
it('blocks ineligible search and offers cancellation while queued', async () => {
  home.matchmaking = { canSearch: false, inQueue: true, blockedReason: null };
  mount(); await ready(); expect(screen.queryByRole('button', { name: 'Buscar chat' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar búsqueda' })); await waitFor(() => expect(writes()).toHaveLength(1));
  await waitFor(() => expect(search()).toBeDisabled()); expect(geo).not.toHaveBeenCalled();
});
it('enqueues with supported location payload, reconciles and cancels', async () => {
  mount(); await ready(); const start = search(); fireEvent.click(start); fireEvent.click(start);
  await screen.findByRole('button', { name: 'Cancelar búsqueda' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Cancelar búsqueda' })).toBeEnabled());
  expect(writes()).toHaveLength(1); expect(JSON.parse(String(writes()[0]?.[1]?.body))).toEqual({ latitude: 12, longitude: -21, accuracyMeters: 25 });
  expect(fetcher.mock.calls.some(([url, o]) => String(url).endsWith('/queue') && o?.method === 'GET')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar búsqueda' })); await waitFor(() => expect(search()).toBeEnabled()); expect(writes()).toHaveLength(2);
});
it.each([1,2,3])('location error %s is actionable and never submits', async code => {
  geo.mockImplementation((_ok, fail) => fail?.({ code, message: 'sensitive', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }));
  mount(); await ready(); fireEvent.click(search()); expect(await screen.findByRole('alert')).not.toHaveTextContent('sensitive'); expect(writes()).toHaveLength(0); fireEvent.click(screen.getByRole('button', { name: 'Volver a Inicio' })); expect(search()).toBeEnabled();
});
it.each([NaN,91,Infinity])('rejects invalid latitude %s', async latitude => {
  geo.mockImplementation(ok => ok(position({ coords: { ...position().coords, latitude } })));
  mount(); await ready(); fireEvent.click(search()); await screen.findByRole('alert'); expect(writes()).toHaveLength(0);
});
it.each(['network','http','malformed'])('reconciles uncertain enqueue %s without retrying', async kind => {
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, o) => {
    if (o?.method === 'POST') { home.matchmaking.inQueue = true; if (kind === 'network') throw new TypeError(); return kind === 'http' ? json({ code: 'ACTIVE_PENALTY' }, 409) : json({}); }
    return original(url, o);
  });
  mount(); await ready(); fireEvent.click(search()); const cancel = await screen.findByRole('button', { name: 'Cancelar búsqueda' });
  await screen.findByRole('alert'); expect(cancel).toBeDisabled(); expect(writes()).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar' })); await waitFor(() => expect(cancel).toBeEnabled()); expect(writes()).toHaveLength(1);
});
it('cancel failure reconciles queue and requires an explicit refresh', async () => {
  home.matchmaking.inQueue = true;
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, o) => { if (o?.method === 'DELETE') throw new TypeError(); return original(url, o); });
  mount(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Cancelar búsqueda' }));
  await screen.findByRole('alert'); expect(screen.getByRole('button', { name: 'Cancelar búsqueda' })).toBeDisabled(); expect(writes()).toHaveLength(1);
});
it('polls status only until version/dirty/due marker changes and stops on unmount', async () => {
  vi.useFakeTimers(); let view: ReturnType<typeof mount>;
  await act(async () => { view = mount(); await vi.advanceTimersByTimeAsync(0); });
  expect(search()).toBeEnabled(); fetcher.mockClear();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); expect(fetcher.mock.calls.map(c => c[0])).toEqual(['/api/me/home/status']);
  status.dirty = true;
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); expect(fetcher.mock.calls.filter(c => c[0] === '/api/me/home')).toHaveLength(1);
  view!.unmount(); fetcher.mockClear(); await act(async () => { await vi.advanceTimersByTimeAsync(10000); }); expect(fetcher).not.toHaveBeenCalled();
});
it('rejects an obsolete refresh after tab restoration supersedes it', async () => {
  mount(); await ready(); let finish: ((r: Response) => void) | undefined;
  fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
  await waitFor(() => expect(finish).toBeDefined());
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await ready(); await act(async () => finish?.(json({ ...homeStatus(), version: 99 })));
  expect(screen.getByText('Hola, Lucía')).toBeVisible(); expect(screen.queryByRole('alert')).toBeNull();
});
it.each(['signout','observer'])('clears Home and ignores late requests on %s', async kind => {
  mount(); await ready(); let finish: (r: Response) => void = () => {};
  fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
  if (kind === 'signout') fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' })); else act(() => observer(null));
  await screen.findByRole('button', { name: 'Ingresar' }); await act(async () => finish(json(homeStatus())));
  expect(screen.queryByText('Hola, Lucía')).toBeNull(); expect(writes()).toHaveLength(0);
});
it('preserves summaries when authoritative profile changes to DRAFT', async () => {
  mount(); await ready(); profile.status = 'DRAFT'; home.profileStatus = 'DRAFT'; home.pendingActions = [{ type: 'FIRST_CHAT', matchId: 'm', chatId: 'c' }];
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar' })); await screen.findByText('Tu perfil está en borrador'); expect(await screen.findByRole('button', { name: 'Ver Actividad' })).toBeVisible(); expect(search()).toBeDisabled();
});
it.each(['version','due'])('refreshes full Home for a status %s change', async mode => {
  vi.useFakeTimers();
  await act(async () => { mount(); await vi.advanceTimersByTimeAsync(0); }); fetcher.mockClear();
  if (mode === 'version') status.version++;
  else Object.assign(status, { nextRefreshAt: '2026-11-05T11:59:59Z' });
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(fetcher.mock.calls.filter(c => c[0] === '/api/me/home')).toHaveLength(1);
});
it('pauses polling while hidden and refreshes on visible restoration', async () => {
  vi.useFakeTimers();
  await act(async () => { mount(); await vi.advanceTimersByTimeAsync(0); }); fetcher.mockClear();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(10000); }); expect(fetcher).not.toHaveBeenCalled();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await vi.advanceTimersByTimeAsync(0); });
  expect(fetcher.mock.calls.filter(c => c[0] === '/api/me/home')).toHaveLength(1);
});
it('sign-out during location acquisition prevents enqueue', async () => {
  let done: PositionCallback | undefined; geo.mockImplementation(ok => { done = ok; });
  mount(); await ready(); fireEvent.click(search()); fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
  await screen.findByRole('button', { name: 'Ingresar' }); await act(async () => done?.(position())); expect(writes()).toHaveLength(0);
});
it('malformed Home fails closed and retry recovers', async () => {
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url, o) => String(url) === '/api/me/home' ? Promise.resolve(json({})) : original(url, o));
  mount(); await screen.findByRole('alert'); expect(screen.queryByRole('button', { name: 'Buscar chat' })).toBeNull();
  fetcher.mockImplementation(original); fireEvent.click(screen.getByRole('button', { name: 'Actualizar' })); await ready(); expect(search()).toBeEnabled();
});
it('terminal authentication loss during Home refresh returns to login', async () => {
  mount(); await ready(); fetcher.mockImplementation(async () => json({ code: 'INVALID_TOKEN' }, 401));
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
  await screen.findByRole('button', { name: 'Ingresar' }); expect(auth.signOut).toHaveBeenCalledOnce(); expect(screen.queryByText('Hola, Lucía')).toBeNull();
});
it('failed reconciliation blocks further queue writes', async () => {
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation(async (url, o) => {
    if (String(url).endsWith('/queue') && o?.method === 'GET') throw new TypeError();
    return original(url, o);
  });
  mount(); await ready(); fireEvent.click(search()); await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: 'Buscar chat' })).toBeNull(); expect(screen.getByRole('button', { name: 'Actualizar' })).toBeEnabled(); expect(writes()).toHaveLength(1);
});
it('opens Activity and returns with heading focus without fetching again', async () => {
  home.pendingActions = [{ type: 'VISUAL_REVIEW', matchId: 'v', chatId: null }];
  home.nextSteps = ['SCHEDULING','SECOND_CHAT_AVAILABLE','SECOND_CHAT_SCHEDULED','SECOND_CHAT_EXPIRED','FUTURE'].map(type => ({ type, connectionId: type, matchId: 'm', requiresAction: true }));
  mount(); await ready(); fetcher.mockClear();
  expect(screen.queryByText('Perfil por descubrir')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Ver Actividad' }));
  expect(screen.getByRole('heading', { name: 'Actividad', level: 2 })).toHaveFocus();
  for (const name of ['Requiere tu acción','En curso','Próximamente','Recientes','Otros']) expect(screen.getByRole('region', { name })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Volver a Inicio' }));
  expect(screen.getByRole('heading', { name: 'Inicio' })).toHaveFocus(); expect(fetcher).not.toHaveBeenCalled();
});
it('can cancel location acquisition, reconcile and ignore a late position', async () => {
  let done: PositionCallback | undefined; geo.mockImplementation(ok => { done = ok; });
  mount(); await ready(); fireEvent.click(search());
  expect(screen.getByRole('heading', { name: 'Obteniendo tu ubicación' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Inicio' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar búsqueda' }));
  await waitFor(() => expect(search()).toBeEnabled());
  await act(async () => done?.(position())); expect(writes()).toHaveLength(0);
  expect(fetcher.mock.calls.some(([url]) => url === '/api/matchmaking/queue')).toBe(true);
});
it('serializes cancellation after an in-flight admission and suppresses duplicates', async () => {
  const original = fetcher.getMockImplementation()!; let admit: ((response: Response) => void) | undefined;
  fetcher.mockImplementation((url, options) => options?.method === 'POST' ? new Promise(resolve => { admit = resolve; }) : original(url, options));
  mount(); await ready(); fireEvent.click(search());
  await screen.findByRole('heading', { name: 'Iniciando búsqueda' }); await waitFor(() => expect(admit).toBeDefined());
  const cancel = screen.getByRole('button', { name: 'Cancelar búsqueda' }); fireEvent.click(cancel); fireEvent.click(cancel);
  expect(screen.getByRole('heading', { name: 'Cancelando búsqueda' })).toBeVisible();
  expect(writes().map(([, o]) => o?.method)).toEqual(['POST']);
  home.matchmaking.inQueue = true;
  await act(async () => admit?.(json({ userId: 'u', inQueue: true })));
  await waitFor(() => expect(search()).toBeEnabled());
  expect(writes().map(([, o]) => o?.method)).toEqual(['POST','DELETE']); expect(home.matchmaking.inQueue).toBe(false);
});
it('keeps uncertain canceled admission visible even if a later DELETE succeeds', async () => {
  const original = fetcher.getMockImplementation()!; let rejectAdmission: (() => void) | undefined;
  fetcher.mockImplementation((url, options) => options?.method === 'POST' ? new Promise((_resolve, reject) => { rejectAdmission = () => reject(new TypeError()); }) : original(url, options));
  mount(); await ready(); fireEvent.click(search()); await waitFor(() => expect(rejectAdmission).toBeDefined());
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar búsqueda' }));
  await act(async () => rejectAdmission?.()); await screen.findByRole('alert');
  expect(screen.getByRole('heading', { name: 'Revisá tu búsqueda' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Volver a Inicio' })).toBeNull();
  expect(writes().map(([, o]) => o?.method)).toEqual(['POST','DELETE']);
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar' })); await waitFor(() => expect(search()).toBeEnabled());
});
it('shows restored queue membership on the dedicated surface', async () => {
  home.matchmaking.inQueue = true; mount(); await ready();
  expect(screen.getByRole('heading', { name: 'Buscando chat' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Ver Actividad' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Buscar chat' })).toBeNull();
});
it('leaves waiting for authoritative new activity using the same poller', async () => {
  home.matchmaking.inQueue = true; vi.useFakeTimers();
  const view = mount(); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByRole('heading', { name: 'Buscando chat' })).toBeVisible(); fetcher.mockClear();
  home.matchmaking.inQueue = false; home.pendingActions = [{ type: 'FIRST_CHAT', matchId: 'm', chatId: 'c' }]; status.version++;
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.getByRole('heading', { name: 'Inicio' })).toBeVisible(); expect(screen.getByRole('region', { name: 'Prioridad ahora' })).toHaveTextContent('Primer chat');
  expect(fetcher.mock.calls.filter(([url]) => url === '/api/me/home')).toHaveLength(1);
  fetcher.mockClear(); fireEvent.click(screen.getByRole('button', { name: 'Ver Actividad' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/me/home/status']);
  view.unmount(); fetcher.mockClear(); await act(async () => { await vi.advanceTimersByTimeAsync(10000); }); expect(fetcher).not.toHaveBeenCalled();
});
it('resets Activity and aborts pending location when authenticated account changes', async () => {
  home.pendingActions = [{ type: 'VISUAL_REVIEW', matchId: 'old', chatId: null }]; mount(); await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Ver Actividad' }));
  home = emptyHome(); profile.displayName = 'Cuenta nueva';
  act(() => observer({ ...user, uid: 'new' }));
  await screen.findByText('Hola, Cuenta nueva'); expect(screen.queryByRole('button', { name: 'Ver Actividad' })).toBeNull();
  let done: PositionCallback | undefined; geo.mockImplementation(ok => { done = ok; }); fireEvent.click(search());
  act(() => observer(null)); await screen.findByRole('button', { name: 'Ingresar' });
  await act(async () => done?.(position())); expect(writes()).toHaveLength(0);
});
