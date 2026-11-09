import { confirmSignOut } from '../test/signOut';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OperationalApp as App } from '../App';
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
const confirmed = async () => { await waitFor(() => { expect(document.querySelector('.search-screen')).toHaveAttribute('aria-busy', 'false'); expect(screen.getByRole('button', { name: 'Cancelar búsqueda' })).toBeEnabled(); expect(screen.queryByRole('alert')).toBeNull(); }); };
const search = () => screen.getByRole('button', { name: 'Buscar chat' });
const ready = async () => { await waitFor(() => { expect(document.querySelector('.home')).toHaveAttribute('aria-busy', 'false'); expect(screen.queryByText('Hola, Lucía') ?? screen.queryByRole('heading', { name: 'Buscando chat' })).toBeTruthy(); }); };
const writes = () => fetcher.mock.calls.filter(([url, o]) => String(url).endsWith('/queue') && o?.method !== 'GET');
it('offers confirmed exceptional sign-out after initial Home failure, while preserving retry', async () => {
  const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url, options) => url === '/api/me/home/status' ? Promise.reject(new TypeError('offline')) : base(url, options));
  mount(); await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Actualizar' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Cuenta' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' })); expect(auth.signOut).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' })); confirmSignOut();
  await screen.findByRole('button', { name: 'Ingresar' }); expect(auth.signOut).toHaveBeenCalledOnce();
});
it('shows four peer management cards and a standalone Account with one header return', async () => {
  mount(); await ready();
  const account = screen.getByRole('button', { name: 'Cuenta' });
  expect(account.parentElement).toBe(screen.getByRole('button', { name: 'Tu perfil' }).parentElement);
  expect(screen.getByRole('button', { name: 'Tu perfil' })).toHaveTextContent('Datos personales, bio, fotos y preguntas públicas.');
  expect(screen.queryByRole('button', { name: 'Preguntas del perfil' })).toBeNull();
  expect(account).not.toHaveAttribute('aria-expanded'); expect(screen.queryByRole('button', { name: 'Cerrar sesión' })).toBeNull();
  fireEvent.click(account);
  expect(screen.getByRole('heading', { name: 'Cuenta', level: 2 })).toHaveFocus();
  const back = screen.getByRole('button', { name: 'Volver a Inicio' }); expect(back.parentElement?.tagName).toBe('HEADER');
  fireEvent.click(back); await screen.findByRole('heading', { name: 'Inicio' });
  expect(screen.queryByRole('button', { name: 'Cerrar sesión' })).toBeNull();
  act(() => history.forward()); await screen.findByRole('heading', { name: 'Cuenta', level: 2 });
});
it('does not show a transient loading row while reconciling a loaded Home on return', async () => {
  mount(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Afinidades' }));
  let finish!: (value: Response) => void;
  const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url, options) => url === '/api/me/home/status' ? new Promise(resolve => { finish = resolve; }) : base(url, options));
  fireEvent.click(screen.getByRole('button', { name: 'Volver a Inicio' })); await screen.findByRole('heading', { name: 'Inicio' });
  await waitFor(() => expect(finish).toBeDefined()); expect(search()).toBeDisabled();
  expect(screen.queryByText('Actualizando Inicio…')).toBeNull();
  await act(async () => finish(json(status))); await ready();
});
it('restores the Notifications entry focus for explicit and browser Back to Account', async () => {
  const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((path, options) => path === '/api/me/notification-preferences' ? Promise.resolve(json({ activityEnabled: true, remindersEnabled: false, availabilityEnabled: true })) : base(path, options));
  mount(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Cuenta' }));
  fireEvent.click(screen.getByRole('button', { name: 'Notificaciones' })); await screen.findByRole('switch', { name: 'Actividad' });
  fireEvent.click(screen.getByRole('button', { name: 'Volver a Cuenta' })); await screen.findByRole('heading', { name: 'Cuenta' });
  expect(screen.getByRole('button', { name: 'Notificaciones' })).toHaveFocus();
  act(() => history.forward()); await screen.findByRole('heading', { name: 'Notificaciones' });
  act(() => history.back()); await screen.findByRole('heading', { name: 'Cuenta' }); expect(screen.getByRole('button', { name: 'Notificaciones' })).toHaveFocus();
});
it('preserves uncertain deletion across Account → Home → Account', async () => {
  const base = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url, options) => url === '/api/me' && options?.method === 'DELETE' ? Promise.reject(new TypeError('offline')) : base(url, options));
  mount(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Cuenta' }));
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar cuenta' })); fireEvent.click(screen.getByRole('button', { name: 'Programar eliminación' })); await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Volver a Inicio' })); await screen.findByRole('heading', { name: 'Inicio' }); await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Cuenta' }));
  expect(screen.getByRole('button', { name: 'Eliminar cuenta' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Eliminar cuenta' }));
  expect(fetcher.mock.calls.filter(([url, options]) => url === '/api/me' && options?.method === 'DELETE')).toHaveLength(1);
});
beforeEach(() => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  home = emptyHome(); status = homeStatus(); profile = { id: 'p', userId: 'u', status: 'ACTIVE', displayName: 'Lucía' };
  user = { uid: 'f', emailVerified: true, getIdToken: vi.fn().mockResolvedValue('test'), reload: vi.fn() };
  auth = { observe: vi.fn(next => { observer = next; next(user); return vi.fn(); }), signIn: vi.fn(), signUp: vi.fn(), google: vi.fn(), verify: vi.fn(), signOut: vi.fn().mockResolvedValue(undefined) };
  geo = vi.fn<Geolocation['getCurrentPosition']>().mockImplementation(success => success(position()));
  vi.stubGlobal('isSecureContext', true); vi.stubGlobal('navigator', Object.assign(Object.create(navigator), { geolocation: { getCurrentPosition: geo } }));
  fetcher = vi.fn<typeof fetch>().mockImplementation(async (url, o) => {
    switch (String(url)) {
      case '/api/reference/affinity-questions': return json({ catalogVersion: 'empty', categories: [], questions: [] });
      case '/api/me/profile/affinity-answers': return json({ answers: [] });
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
  home.pendingActions = [{ type: 'VISUAL_REVIEW', matchId: 'm', chatId: null, partner: { displayName: '<img src=x>' } }, { type: 'VISUAL_REVIEW', matchId: 'v', chatId: null }];
  home.nextSteps = ['SCHEDULING','SECOND_CHAT_SCHEDULED','SECOND_CHAT_AVAILABLE','SECOND_CHAT_EXPIRED','SECOND_CHAT_READ_ONLY','FUTURE'].map(type => ({ type, connectionId: type, matchId: 'm', requiresAction: true }));
  home.passiveNotices = [{ type: 'SCHEDULING_PREPARING' }, { type: 'UNKNOWN' }];
  mount(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Ver Actividad' })); expect(screen.getByText('Con <img src=x>')).toBeVisible(); expect(screen.getByText('Actividad pendiente')).toBeVisible();
  expect(screen.queryByText(/Podés continuar tu primer chat/)).toBeNull(); expect(screen.queryByRole('link')).toBeNull(); expect(document.body.textContent).not.toContain('SECOND_CHAT_');
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
  expect(screen.queryByRole('button', { name: 'Reintentar ubicación' })).toBeNull();
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
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');act(() => document.dispatchEvent(new Event('visibilitychange')));
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');act(() => document.dispatchEvent(new Event('visibilitychange')));
  await ready(); await act(async () => finish?.(json({ ...homeStatus(), version: 99 })));
  expect(screen.getByText('Hola, Lucía')).toBeVisible(); expect(screen.queryByRole('alert')).toBeNull();
});
it('clears Home and ignores late requests after an external sign-out', async () => {
  mount(); await ready(); let finish: (r: Response) => void = () => {};
  fetcher.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
  act(() => observer(null));
  await screen.findByRole('button', { name: 'Ingresar' }); await act(async () => finish(json(homeStatus())));
  expect(screen.queryByText('Hola, Lucía')).toBeNull(); expect(writes()).toHaveLength(0);
});
it('preserves summaries when authoritative profile changes to DRAFT', async () => {
  mount(); await ready(); profile.status = 'DRAFT'; home.profileStatus = 'DRAFT'; home.pendingActions = [{ type: 'VISUAL_REVIEW', matchId: 'm', chatId: null }];
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
  expect(fetcher.mock.calls.map(c => c[0])).toEqual(['/api/me/home/status', '/api/reference/affinity-questions', '/api/me/profile/affinity-answers']);
});
it('sign-out during location acquisition prevents enqueue', async () => {
  let done: PositionCallback | undefined; geo.mockImplementation(ok => { done = ok; });
  mount(); await ready(); fireEvent.click(search()); act(() => observer(null));
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
  expect(await screen.findByRole('heading', { name: 'Inicio' })).toHaveFocus(); expect(fetcher).not.toHaveBeenCalled();
});
it('can cancel location acquisition, reconcile and ignore a late position', async () => {
  let done: PositionCallback | undefined; geo.mockImplementation(ok => { done = ok; });
  mount(); await ready(); fireEvent.click(search());
  expect(screen.getByRole('heading', { name: 'Buscando chat' })).toBeVisible();
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
  await screen.findByRole('heading', { name: 'Buscando chat' }); await waitFor(() => expect(admit).toBeDefined());
  const cancel = screen.getByRole('button', { name: 'Cancelar búsqueda' }); fireEvent.click(cancel); fireEvent.click(cancel);
  expect(screen.getByRole('heading', { name: 'Buscando chat' })).toBeVisible();
  expect(writes().map(([, o]) => o?.method)).toEqual(['POST']);
  home.matchmaking.inQueue = true;
  await act(async () => admit?.(json({ userId: 'u', inQueue: true })));
  await waitFor(() => expect(search()).toBeEnabled());
  expect(writes().map(([, o]) => o?.method)).toEqual(['POST','DELETE']); expect(home.matchmaking.inQueue).toBe(false);
});
it('keeps the same search DOM, copy, focus and scroll through admission and pending cancellation', async () => {
  let located: PositionCallback | undefined, admit: ((response: Response) => void) | undefined, queueRead: ((response: Response) => void) | undefined, leave: ((response: Response) => void) | undefined;
  let holdQueue = true;
  geo.mockImplementation(ok => { located = ok; });
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url, options) => {
    if (options?.method === 'POST') return new Promise(resolve => { admit = resolve; });
    if (options?.method === 'DELETE') return new Promise(resolve => { leave = resolve; });
    if (url === '/api/matchmaking/queue' && holdQueue) { holdQueue = false; return new Promise(resolve => { queueRead = resolve; }); }
    return original(url, options);
  });
  mount(); await ready(); fireEvent.click(search());
  const heading = screen.getByRole('heading', { name: 'Buscando chat' }), status = screen.getByRole('status');
  const body = status.textContent, container = heading.parentElement, seal = screen.getByRole('img', { name: 'Reals' }), dots = document.querySelector('.search-dots');
  const pulses = Array.from(dots?.children ?? []), cancel = screen.getByRole('button', { name: 'Cancelar b\u00fasqueda' });
  act(() => cancel.focus()); document.documentElement.scrollTop = 41;
  const stable = () => {
    expect(screen.getByRole('heading', { name: 'Buscando chat' })).toBe(heading);
    expect(heading.parentElement).toBe(container); expect(screen.getByRole('status')).toBe(status); expect(status.textContent).toBe(body);
    expect(status).not.toHaveAttribute('aria-label'); expect(screen.getByRole('img', { name: 'Reals' })).toBe(seal);
    expect(document.querySelector('.search-dots')).toBe(dots); expect(dots).toHaveClass('search-dots', { exact: true });
    pulses.forEach((pulse, index) => expect(dots?.children[index]).toBe(pulse));
    expect(document.documentElement.scrollTop).toBe(41); expect(screen.queryByRole('heading', { name: 'Inicio' })).toBeNull();
  };
  stable();
  await act(async () => located?.(position())); await waitFor(() => expect(admit).toBeDefined()); stable(); expect(cancel).toHaveFocus();
  home.matchmaking.inQueue = true; await act(async () => admit?.(json({ userId: 'u', inQueue: true })));
  await waitFor(() => expect(queueRead).toBeDefined()); stable(); expect(cancel).toBeEnabled();
  await act(async () => queueRead?.(json({ userId: 'u', inQueue: true }))); await confirmed(); stable(); expect(cancel).toHaveFocus();
  fireEvent.click(cancel); fireEvent.click(cancel); await waitFor(() => expect(leave).toBeDefined());
  stable(); expect(cancel).toBeDisabled(); expect(writes().map(([, options]) => options?.method)).toEqual(['POST', 'DELETE']);
  home.matchmaking.inQueue = false; await act(async () => leave?.(json({ userId: 'u', inQueue: false })));
  await waitFor(() => expect(search()).toBeEnabled()); expect(container).not.toBeInTheDocument();
  expect(writes()).toHaveLength(2); expect(screen.queryByRole('alert')).toBeNull();
});
it('accepts cancellation during admission reconciliation and keeps searching copy until it finishes', async () => {
  let queueRead: ((response: Response) => void) | undefined; let held = false;
  const original = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url, options) => {
    if (url === '/api/matchmaking/queue' && options?.method === 'GET' && !held) {
      held = true; return new Promise(resolve => { queueRead = resolve; });
    }
    return original(url, options);
  });
  mount(); await ready(); fireEvent.click(search()); await waitFor(() => expect(queueRead).toBeDefined());
  const cancel = screen.getByRole('button', { name: 'Cancelar búsqueda' });
  expect(cancel).toBeEnabled(); fireEvent.click(cancel); fireEvent.click(cancel);
  expect(screen.getByRole('heading', { name: 'Buscando chat' })).toBeVisible(); expect(cancel).toBeDisabled();
  await act(async () => queueRead?.(json({ userId: 'u', inQueue: true })));
  await waitFor(() => expect(search()).toBeEnabled());
  expect(writes().map(([, options]) => options?.method)).toEqual(['POST','DELETE']); expect(home.matchmaking.inQueue).toBe(false);
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
  expect(screen.getByRole('status')).toHaveTextContent('Estamos buscando a alguien compatible. Te avisaremos cuando encontremos una persona para conversar.');
});
it('waits for first permission grant and slow acquisition before sending exactly one admission', async () => {
  let granted: PositionCallback | undefined; geo.mockImplementation(ok => { granted = ok; });
  vi.useFakeTimers(); mount(); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  fireEvent.click(search());
  await act(async () => { await vi.advanceTimersByTimeAsync(12000); });
  expect(screen.getByRole('heading', { name: 'Buscando chat' })).toBeVisible(); expect(writes()).toHaveLength(0);
  await act(async () => { granted?.(position()); await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByRole('heading', { name: 'Buscando chat' })).toBeVisible(); expect(writes()).toHaveLength(1); expect(geo).toHaveBeenCalledOnce();
});
it('retries a pre-POST timeout on the same screen with no full Home refresh or duplicate admission', async () => {
  let oldCallback: PositionCallback | undefined;
  const timeout: Geolocation['getCurrentPosition'] = (ok, fail) => { oldCallback = ok; fail?.({ code: 3, message: '', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }); };
  geo.mockImplementationOnce(timeout).mockImplementationOnce(timeout);
  mount(); await ready(); fetcher.mockClear(); fireEvent.click(search());
  const retry = await screen.findByRole('button', { name: 'Reintentar ubicación' });
  expect(screen.getByRole('alert')).toHaveTextContent('Se agotó el tiempo'); expect(fetcher).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Actualizar' })).toBeNull();
  fireEvent.click(retry); fireEvent.click(retry);
  await confirmed(); await act(async () => oldCallback?.(position()));
  expect(geo).toHaveBeenCalledTimes(3); expect(writes()).toHaveLength(1);
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual(['/api/matchmaking/queue','/api/me/home/status','/api/me/profile','/api/matchmaking/queue','/api/me/home']);
});
it.each(['stale','inaccurate','invalid'])('explicit retry after %s asks for a fresh position', async kind => {
  const rejected: Geolocation['getCurrentPosition'] = ok => ok(kind === 'stale' ? position({ timestamp: Date.now() - 900001 }) : position({ coords: { ...position().coords, accuracy: kind === 'inaccurate' ? 5001 : NaN } }));
  geo.mockImplementationOnce(rejected); if (kind === 'inaccurate') geo.mockImplementationOnce(rejected);
  mount(); await ready(); fireEvent.click(search()); const retry = await screen.findByRole('button', { name: 'Reintentar ubicación' });
  expect(writes()).toHaveLength(0); fireEvent.click(retry);
  await confirmed(); expect(geo.mock.calls.at(-1)?.[2]).toMatchObject({ maximumAge: 0, enableHighAccuracy: false }); expect(writes()).toHaveLength(1);
});
it('permission denied has an explicit retry and never retries automatically', async () => {
  geo.mockImplementation((_ok, fail) => fail?.({ code: 1, message: 'sensitive', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }));
  vi.useFakeTimers(); mount(); await act(async () => { await vi.advanceTimersByTimeAsync(0); }); fireEvent.click(search());
  await act(async () => { await vi.advanceTimersByTimeAsync(20000); });
  expect(screen.getByRole('alert')).toHaveTextContent('Permití el acceso'); expect(geo).toHaveBeenCalledOnce(); expect(writes()).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar ubicación' }));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); }); expect(geo).toHaveBeenCalledTimes(2); expect(writes()).toHaveLength(0);
});
it('canceling a location retry ignores its callback and never enqueues', async () => {
  let done: PositionCallback | undefined;
  const timeout: Geolocation['getCurrentPosition'] = (_ok, fail) => fail?.({ code: 3, message: '', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
  geo.mockImplementationOnce(timeout).mockImplementationOnce(timeout).mockImplementation(ok => { done = ok; });
  mount(); await ready(); fireEvent.click(search()); fireEvent.click(await screen.findByRole('button', { name: 'Reintentar ubicación' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar búsqueda' }));
  await waitFor(() => expect(search()).toBeEnabled()); await act(async () => done?.(position())); expect(writes()).toHaveLength(0);
});
it('fallback admits once with actual accuracy and retains the screen while updating confirmation copy', async () => {
  let coarse: PositionCallback | undefined;
  geo.mockImplementationOnce((_ok, fail) => fail?.({ code: 3, message: '', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 })).mockImplementation(ok => { coarse = ok; });
  mount(); await ready(); fireEvent.click(search()); await waitFor(() => expect(geo).toHaveBeenCalledTimes(2));
  const heading = screen.getByRole('heading', { name: 'Buscando chat' }), status = screen.getByRole('status');
  const waitingSurface = heading.parentElement;
  expect(status).not.toHaveAttribute('aria-label'); expect(writes()).toHaveLength(0);
  await act(async () => coarse?.(position({ coords: { ...position().coords, accuracy: 4200 } }))); await confirmed();
  expect(heading).toHaveTextContent('Buscando chat'); expect(heading.parentElement).toBe(waitingSurface); expect(status).not.toHaveAttribute('aria-label');
  expect(writes()).toHaveLength(1); expect(JSON.parse(String(writes()[0]?.[1]?.body)).accuracyMeters).toBe(4200);
  expect(geo.mock.calls[1]?.[2]?.enableHighAccuracy).toBe(true);
});
it('cancels during the precise fallback and ignores late results from both requests', async () => {
  const callbacks: PositionCallback[] = [];
  geo.mockImplementation((ok, fail, options) => {
    callbacks.push(ok);
    if (!options?.enableHighAccuracy) fail?.({ code: 3, message: '', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
  });
  mount(); await ready(); fireEvent.click(search()); await waitFor(() => expect(geo).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar búsqueda' })); await waitFor(() => expect(search()).toBeEnabled());
  await act(async () => callbacks.forEach(ok => ok(position()))); expect(writes()).toHaveLength(0);
});
it('polling keeps location failure guidance but authoritative queue membership supersedes retry', async () => {
  geo.mockImplementation((_ok, fail) => fail?.({ code: 3, message: '', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }));
  vi.useFakeTimers(); mount(); await act(async () => { await vi.advanceTimersByTimeAsync(0); }); fireEvent.click(search());
  await act(async () => { await vi.advanceTimersByTimeAsync(0); }); status.version++;
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.getByRole('button', { name: 'Reintentar ubicación' })).toBeEnabled(); expect(screen.getByRole('alert')).toHaveTextContent('Se agotó el tiempo');
  home.matchmaking.inQueue = true; status.version++;
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.getByRole('heading', { name: 'Buscando chat' })).toBeVisible(); expect(screen.queryByRole('button', { name: 'Reintentar ubicación' })).toBeNull(); expect(writes()).toHaveLength(0);
});
it('leaves waiting for authoritative new activity using the same poller', async () => {
  home.matchmaking.inQueue = true; vi.useFakeTimers();
  const view = mount(); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(screen.getByRole('heading', { name: 'Buscando chat' })).toBeVisible(); fetcher.mockClear();
  home.matchmaking.inQueue = false; home.pendingActions = [{ type: 'FIRST_CHAT', matchId: 'm', chatId: 'c' }]; status.version++;
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(screen.getByRole('region', { name: 'Primer chat' })).toBeVisible();
  expect(document.querySelector('.search-screen')).toBeNull(); expect(screen.queryByRole('heading', { name: 'Inicio' })).toBeNull();
  expect(fetcher.mock.calls.filter(([url]) => url === '/api/me/home')).toHaveLength(1);
  fetcher.mockClear();
  await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
  expect(fetcher.mock.calls.some(([url]) => String(url).startsWith('/api/me/home'))).toBe(false);
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

function installFirstChatBackend() {
  const original = fetcher.getMockImplementation()!;
  const chat = { id:'c',matchId:'m',chatType:'FIRST_CHAT',status:'ACTIVE',partner:{userId:'them',displayName:'María'},myDecision:'PENDING',partnerDecision:'PENDING',timeoutAt:new Date(Date.now()+600000).toISOString(),inactivityExpiresAt:new Date(Date.now()+300000).toISOString(),serverTime:new Date().toISOString(),guidance:null,audioPolicy:null };
  fetcher.mockImplementation(async(url,options)=>{
    if(url==='/api/matches/m')return json({id:'m',userAId:'u',userBId:'them',state:'CHAT_ACTIVE'});
    if(url==='/api/matches/m/chat')return json(chat);
    if(String(url).startsWith('/api/chats/c/messages'))return json([]);
    if(url==='/api/chats/c/exit-requests')return json([]);
    return original(url,options);
  });
}
it('keeps active chat on Back and hides session chrome',async()=>{
  installFirstChatBackend();home.pendingActions=[{type:'FIRST_CHAT',matchId:'m',chatId:'c'}];mount();
  await screen.findByRole('region',{name:'Primer chat'});
  expect(screen.queryByRole('heading',{name:'Reals'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Cerrar sesión'})).toBeNull();
  expect(screen.queryByRole('button',{name:'Volver a Inicio'})).toBeNull();
  act(()=>window.dispatchEvent(new PopStateEvent('popstate')));
  expect(screen.getByRole('region',{name:'Primer chat'})).toBeVisible();
});
it('sign-out removes pending chat and aborts its resources',async()=>{
  installFirstChatBackend();home.pendingActions=[{type:'FIRST_CHAT',matchId:'m',chatId:'c'}];mount();await screen.findByRole('heading',{name:'María'});
  act(()=>observer(null));await screen.findByRole('button',{name:'Ingresar'});expect(screen.queryByRole('region',{name:'Primer chat'})).toBeNull();
});
it('authenticated identity replacement reloads chat ownership before rendering messages',async()=>{
  installFirstChatBackend();home.pendingActions=[{type:'FIRST_CHAT',matchId:'m',chatId:'c'}];mount();await screen.findByRole('heading',{name:'María'});
  home=emptyHome();profile.displayName='Cuenta nueva';act(()=>observer({...user,uid:'new'}));await screen.findByText('Hola, Cuenta nueva');expect(screen.queryByRole('region',{name:'Primer chat'})).toBeNull();
});

it.each(['CHAT_ABANDONED','CHAT_EXPIRED'])('hides terminal %s from every Home surface and prevents reopening after polling',async code=>{
  installFirstChatBackend();
  const original=fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url,options)=>url==='/api/matches/m/chat'?Promise.resolve(json({code},409)):original(url,options));
  home.pendingActions=[{type:'FIRST_CHAT',matchId:'m',chatId:'c'},{type:'VISUAL_REVIEW',matchId:'other',chatId:null,partner:{displayName:'Otra persona'}}];
  home.activeInteractionsSummary.activeInitialCount=2;
  vi.useFakeTimers();mount();await act(async()=>{await vi.advanceTimersByTimeAsync(0);});
  expect(screen.getByRole('heading',{name:'Inicio'})).toBeVisible();
  expect(screen.getAllByText(code==='CHAT_ABANDONED'?'El chat se cerró por inactividad.':'El chat venció.')).toHaveLength(1);
  expect(screen.queryByRole('region',{name:'Prioridad ahora'})).toBeNull();
  const before=fetcher.mock.calls.filter(([url])=>url==='/api/matches/m/chat').length;
  status.version++;await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});
  fireEvent.click(screen.getByRole('button',{name:'Ver Actividad'}));
  expect(screen.queryByRole('button',{name:'Abrir primer chat'})).toBeNull();
  expect(screen.getByText('Con Otra persona')).toBeVisible();
  expect(document.body.textContent).not.toContain('Tenés una conversación inicial');
  expect(fetcher.mock.calls.filter(([url])=>url==='/api/matches/m/chat')).toHaveLength(before);
});
it.each(['CHAT_ABANDONED','CHAT_EXPIRED'])('retires terminal %s copy on Search without losing backend notices or stale-chat suppression',async code=>{
  installFirstChatBackend();const base=fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url,options)=>url==='/api/matches/m/chat'?Promise.resolve(json({code},409)):base(url,options));
  home.pendingActions=[{type:'FIRST_CHAT',matchId:'m',chatId:'c'}];home.passiveNotices=[{type:'SCHEDULING_PREPARING'}];mount();
  const message=code==='CHAT_ABANDONED'?'El chat se cerró por inactividad.':'El chat venció.';await screen.findByText(message);await ready();
  const chatReads=fetcher.mock.calls.filter(([url])=>url==='/api/matches/m/chat').length;
  fireEvent.click(search());await confirmed();expect(screen.queryByText(message)).toBeNull();status.version++;
  await act(async()=>document.dispatchEvent(new Event('visibilitychange')));expect(screen.queryByText(message)).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Cancelar búsqueda'}));await waitFor(()=>expect(search()).toBeEnabled());
  expect(screen.queryByText(message)).toBeNull();expect(screen.getByText('Estamos preparando tus próximos pasos para coordinar horarios.')).toBeVisible();
  expect(fetcher.mock.calls.filter(([url])=>url==='/api/matches/m/chat')).toHaveLength(chatReads);
});
it.each(['dismiss','management','activity'])('retires completion copy on %s navigation',async action=>{
  installFirstChatBackend();const base=fetcher.getMockImplementation()!;fetcher.mockImplementation((url,options)=>url==='/api/matches/m/chat'?Promise.resolve(json({code:'CHAT_EXPIRED'},409)):base(url,options));
  home.pendingActions=[{type:'FIRST_CHAT',matchId:'m',chatId:'c'},{type:'VISUAL_REVIEW',matchId:'other',chatId:null}];mount();await screen.findByText('El chat venció.');await ready();
  const dismiss=screen.getByRole('button',{name:'Ocultar aviso del chat'});expect(dismiss.querySelector('svg')).not.toBeNull();expect(dismiss.textContent).toBe('');
  fireEvent.click(screen.getByRole('button',{name:action==='dismiss'?'Ocultar aviso del chat':action==='management'?'Afinidades':'Ver Actividad'}));expect(screen.queryByText('El chat venció.')).toBeNull();
  if(action!=='dismiss'){act(()=>window.dispatchEvent(new PopStateEvent('popstate')));await ready();expect(screen.queryByText('El chat venció.')).toBeNull();}
});
it.each(['home','search'])('keeps %s controls, DOM and focus unchanged during an unchanged foreground status check',async surface=>{
  if(surface==='search')home.matchmaking.inQueue=true;mount();await ready();await act(async()=>{});
  const button=surface==='home'?search():screen.getByRole('button',{name:'Cancelar búsqueda'}),root=button.closest('.home');act(()=>button.focus());
  expect(button).toHaveFocus();const base=fetcher.getMockImplementation()!;let done:((response:Response)=>void)|undefined;fetcher.mockClear();
  fetcher.mockImplementation((url,options)=>url==='/api/me/home/status'?new Promise(r=>{done=r;}):base(url,options));
  fireEvent(document,new Event('visibilitychange'));await waitFor(()=>expect(done).toBeDefined());
  expect(root).toHaveAttribute('aria-busy','false');expect(button).toBeEnabled();expect(button).toHaveFocus();expect(button.closest('.home')).toBe(root);expect(screen.queryByText('Actualizando Inicio…')).toBeNull();
  await act(async()=>done?.(json(status)));expect(button).toHaveFocus();expect(button).toBeEnabled();expect(fetcher.mock.calls.map(c=>c[0])).toEqual(['/api/me/home/status', '/api/reference/affinity-questions', '/api/me/profile/affinity-answers']);
});
it('reconciles a changed foreground Home version and routes Search to the authoritative First Chat',async()=>{
  installFirstChatBackend();home.matchmaking.inQueue=true;mount();await ready();
  home.matchmaking.inQueue=false;home.pendingActions=[{type:'FIRST_CHAT',matchId:'m',chatId:'c'}];status.version++;
  fireEvent(document,new Event('visibilitychange'));await screen.findByRole('heading',{name:'María'});expect(screen.queryByRole('heading',{name:'Buscando chat'})).toBeNull();expect(screen.queryByRole('button',{name:'Cerrar sesión'})).toBeNull();
});
it('recovers a failed foreground read with the same version without hiding existing Home',async()=>{
  mount();await ready();const base=fetcher.getMockImplementation()!;fetcher.mockImplementationOnce(()=>Promise.reject(new TypeError('Synthetic offline')));
  fireEvent(document,new Event('visibilitychange'));await screen.findByRole('alert');expect(screen.getByText('Hola, Lucía')).toBeVisible();expect(search()).toBeDisabled();
  fetcher.mockImplementation(base);fireEvent(document,new Event('visibilitychange'));await waitFor(()=>expect(search()).toBeEnabled());expect(screen.queryByRole('alert')).toBeNull();
});
it('foreground restoration does not clear an uncertain search mutation or replay admission',async()=>{
  const base=fetcher.getMockImplementation()!;fetcher.mockImplementation((url,options)=>{if(options?.method==='POST'){home.matchmaking.inQueue=true;return Promise.reject(new TypeError('Synthetic uncertain admission'));}return base(url,options);});
  mount();await ready();fireEvent.click(search());await screen.findByRole('alert');const cancel=screen.getByRole('button',{name:'Cancelar búsqueda'});expect(cancel).toBeDisabled();
  await act(async()=>document.dispatchEvent(new Event('visibilitychange')));expect(cancel).toBeDisabled();expect(writes()).toHaveLength(1);expect(screen.getByRole('alert')).toBeVisible();
});
it.each(['network','http'])('transient %s failure preserves a valid First Chat and Activity opening',async failure=>{
  installFirstChatBackend();const original=fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url,options)=>url==='/api/matches/m/chat'?(failure==='network'?Promise.reject(new TypeError()):Promise.resolve(json({code:'SERVICE_UNAVAILABLE'},503))):original(url,options));
  home.pendingActions=[{type:'FIRST_CHAT',matchId:'m',chatId:'c'}];mount();await screen.findByRole('alert');
  expect(screen.getByRole('region',{name:'Primer chat'})).toBeVisible();
  act(()=>window.dispatchEvent(new PopStateEvent('popstate')));expect(screen.getByRole('region',{name:'Primer chat'})).toBeVisible();
});
it('terminal suppression is not inherited by a new authenticated identity',async()=>{
  installFirstChatBackend();const original=fetcher.getMockImplementation()!;let closed=true;
  fetcher.mockImplementation((url,options)=>closed&&url==='/api/matches/m/chat'?Promise.resolve(json({code:'CHAT_ABANDONED'},409)):original(url,options));
  home.pendingActions=[{type:'FIRST_CHAT',matchId:'m',chatId:'c'}];mount();await screen.findByText('El chat se cerró por inactividad.');await ready();
  closed=false;act(()=>observer({...user,uid:'new-account'}));await screen.findByRole('heading',{name:'María'});
});
it('an active chat reconciles terminal state and suppresses stale Activity',async()=>{
  installFirstChatBackend();const original=fetcher.getMockImplementation()!;let closed=false;
  fetcher.mockImplementation((url,options)=>closed&&url==='/api/matches/m/chat'?Promise.resolve(json({code:'CHAT_ABANDONED'},409)):original(url,options));
  home.pendingActions=[{type:'FIRST_CHAT',matchId:'m',chatId:'c'}];mount();await screen.findByRole('region',{name:'Primer chat'});
  closed=true;act(()=>window.dispatchEvent(new Event('online')));await screen.findByText('El chat se cerró por inactividad.');await ready();
  expect(screen.queryByRole('button',{name:'Cerrar sesión'})).toBeNull();
  expect(screen.queryByRole('region',{name:'Primer chat'})).toBeNull();
});

it('waits for all parallel projections before installing the reconciled Home', async () => {
  mount(); await ready(); const original = fetcher.getMockImplementation()!;
  let finish!: (response: Response) => void;
  fetcher.mockImplementation((url, options) => url === '/api/me/profile' ? new Promise(done => { finish = done; }) : original(url, options));
  fetcher.mockClear(); fireEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
  await waitFor(() => expect(finish).toBeDefined());
  expect(fetcher.mock.calls.some(([url]) => url === '/api/me/home')).toBe(true); expect(search()).toBeDisabled();
  await act(async () => finish(json(profile))); await ready(); expect(search()).toBeEnabled();
});
it('browser Back dismisses sign-out and restores the owned Account entry', async () => {
  mount(); await ready(); fireEvent.click(screen.getByRole('button', { name: 'Cuenta' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' })); expect(screen.getByRole('dialog')).toBeVisible();
  const restored = vi.fn(); window.addEventListener('popstate', restored);
  try { act(() => history.back()); await waitFor(() => expect(restored).toHaveBeenCalledTimes(2)); }
  finally { window.removeEventListener('popstate', restored); }
  expect(screen.queryByRole('dialog')).toBeNull(); expect(history.state.trail.at(-1)).toBe('account'); expect(auth.signOut).not.toHaveBeenCalled();
});
