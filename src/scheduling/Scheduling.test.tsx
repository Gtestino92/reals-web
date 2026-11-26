import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Scheduling } from './Scheduling';
import { setup, negotiation, proposal, scheduledStep, time } from './fixtures';
import { visualProfile } from '../visual/fixtures';
import { ApiError } from '../auth/api';
import { SecondChatCard } from '../home/SecondChatCard';
import { homeSecondFixture } from '../home/secondHome.fixtures';
import { ActivityNotifications, useActivityNotifications } from '../notifications/useActivityNotifications';
import { freshPreferences, loadPreferences, savePreferences } from '../notifications/activityStorage';
import { activityId } from '../notifications/activityPolicy';
function view(f=setup()) {const back=vi.fn(),browse=vi.fn(),blocked=vi.fn();const props={controller:f.controller,connectionId:'c',matchId:'m',partnerName:'María',backToActivity:true,onActivity:back,onHome:vi.fn(),onFinished:back,onBlocked:blocked,browse:false,onBrowse:browse,onCloseBrowse:back};const v=render(<Scheduling {...props}/>);return {...f,...v,props,back,browse,blocked};}
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();localStorage.clear();});
const calendarLink = () => screen.queryByRole('link', { name: /^(Agregar a Google Calendar|Volver a agregar al calendario)$/ });
const openedStatus = 'Evento abierto en Google Calendar';

it.each([true,false])('shows one caller-specific return before confirmation and distinct destinations after confirmation (Activity caller: %s)', async activity => {
  const f = view();
  f.rerender(<Scheduling {...f.props} backToActivity={activity}/>);
  await screen.findByRole('heading',{name:'Proponé tus horarios'});
  const backLabel = activity ? 'Volver a Actividad' : 'Volver a Inicio';
  expect(screen.getAllByRole('button',{name:backLabel})).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:backLabel}));
  expect(activity ? f.props.onActivity : f.props.onHome).toHaveBeenCalledOnce();
  f.props.onActivity.mockClear();
  f.props.onHome.mockClear();
  f.state.n = negotiation({status:'CONFIRMED',confirmedDateTime:proposal().proposedDateTime});
  f.state.c = {...f.state.c,state:'SECOND_CHAT_SCHEDULED'};
  await act(async () => window.dispatchEvent(new Event('online')));
  expect(screen.getByRole('heading',{name:'Horario confirmado'})).toBeVisible();
  fireEvent.click(screen.getByRole('button',{name:'Volver a Actividad'}));
  expect(f.props.onActivity).toHaveBeenCalledOnce();
  expect(f.props.onHome).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Volver a Inicio'}));
  expect(f.props.onHome).toHaveBeenCalledOnce();
});

it('opens the icon menu by keyboard, dismisses it outside and preserves the pending block safeguards', async () => {
  const f = view(), read = f.request.getMockImplementation()!;
  let finish!: () => void;
  const held = new Promise<void>(resolve => { finish = resolve; });
  f.request.mockImplementation(async (path,...args) => {
    if (path.endsWith('/block')) {
      await held;
      throw new ApiError('network');
    }
    return read(path,...args);
  });
  await screen.findByRole('heading',{name:'Proponé tus horarios'});
  const trigger = screen.getByRole('button',{name:'Más acciones'});
  expect(trigger.querySelector('svg')).toHaveAttribute('width','24');
  trigger.focus();
  fireEvent.keyDown(trigger,{key:'ArrowDown'});
  const item = screen.getByRole('menuitem');
  expect(item).toHaveFocus();
  fireEvent.keyDown(item,{key:'Escape'});
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('menuitem'));
  fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));
  expect(trigger).toHaveFocus();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('menuitem'));
  const block = screen.getByRole('button',{name:'Bloquear definitivamente'});
  fireEvent.click(block);
  fireEvent.click(block);
  expect(trigger).toBeDisabled();
  expect(screen.getByRole('button',{name:'Volver a Actividad'})).toBeDisabled();
  const dialog = screen.getByRole('dialog');
  expect(fireEvent(dialog,new Event('cancel',{cancelable:true}))).toBe(false);
  expect(dialog).toBeVisible();
  await act(async () => finish());
  expect(f.request.mock.calls.filter(([, , method]) => method === 'POST')).toHaveLength(1);
});

it('replaces proposal feedback with the confirmed time from polling and rejects older pending snapshots', async () => {
  const f=view(), read=f.request.getMockImplementation()!;
  const oldConnection=f.state.c, oldNegotiation=f.state.n;
  f.request.mockImplementation(async(path,signal,method,body)=>{
    if (method==='POST') { f.state.p=[proposal({userId:'me'})]; return f.state.p; }
    return read(path,signal,method,body);
  });
  await screen.findByRole('heading',{name:'Proponé tus horarios'});
  fireEvent.click(screen.getByRole('button',{name:'Agregar opción'}));
  fireEvent.click(screen.getByRole('button',{name:'Enviar horarios'}));
  await screen.findByText('Enviamos tus horarios.');
  expect(screen.getByRole('heading',{name:'Esperando a María'})).toBeVisible();
  expect(calendarLink()).toBeNull();
  const confirmed=proposal().proposedDateTime;
  f.state.n=negotiation({status:'CONFIRMED',confirmedDateTime:confirmed});
  f.state.c={...oldConnection,state:'SECOND_CHAT_SCHEDULED'};
  f.state.home.nextSteps=[scheduledStep('2026-11-15T13:00:00-03:00')];
  await act(async()=>window.dispatchEvent(new Event('online')));
  const heading=screen.getByRole('heading',{name:'Horario confirmado'});
  expect(heading.parentElement?.querySelector('time')).toHaveAttribute('datetime',confirmed);
  expect(calendarLink()).toHaveAttribute('href', expect.stringContaining('20261115T160000Z%2F20261115T171500Z'));
  expect(f.back).not.toHaveBeenCalled();
  expect(screen.queryByText('Enviamos tus horarios.')).toBeNull();
  f.state.n=oldNegotiation; f.state.c=oldConnection;
  await act(async()=>window.dispatchEvent(new Event('online')));
  expect(screen.getByRole('heading',{name:'Horario confirmado'})).toBe(heading);
  expect(calendarLink()).toBeNull();
  expect(screen.queryByText('Enviamos tus horarios.')).toBeNull();
});

it('keeps a failed acceptance actionable and shows one confirmation after a successful retry', async () => {
  const f=setup(), read=f.request.getMockImplementation()!;
  f.state.p=[proposal()];
  let fail=true;
  let finishHome: (() => void) | undefined;
  f.request.mockImplementation(async(path,signal,method,body)=>{
    if (path==='/me/home' && !fail) await new Promise<void>(resolve => { finishHome=resolve; });
    if (method==='POST') {
      if (fail) throw new ApiError('backend',409,'SCHEDULING_SLOT_CONFLICT');
      f.state.n=negotiation({status:'CONFIRMED',confirmedDateTime:proposal().proposedDateTime});
      f.state.c={...f.state.c,state:'SECOND_CHAT_SCHEDULED'};
      f.state.home.nextSteps=[scheduledStep()];
      return f.state.n;
    }
    return read(path,signal,method,body);
  });
  const {back}=view(f);
  const accept=await screen.findByRole('button',{name:'Aceptar opción 1'});
  fireEvent.click(accept);
  expect(await screen.findByRole('alert')).toHaveTextContent(/superpone/);
  expect(screen.queryByRole('heading',{name:'Horario confirmado'})).toBeNull();
  expect(calendarLink()).toBeNull();
  fail=false;
  f.request.mockClear();
  fireEvent.click(accept);
  await waitFor(()=>expect(finishHome).toBeDefined());
  expect(calendarLink()).toBeNull();
  finishHome?.();
  await screen.findByRole('heading',{name:'Horario confirmado'});
  expect(screen.getAllByText(/Horario confirmado/)).toHaveLength(1);
  expect(calendarLink()).toBeVisible();
  expect(back).not.toHaveBeenCalled();
  expect(f.request.mock.calls.filter(([path])=>path==='/me/home')).toHaveLength(1);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('observes a locally accepted appointment after its presentation without generating unread activity', async () => {
  const f = setup(), read = f.request.getMockImplementation()!;
  const slot = proposal().proposedDateTime;
  f.state.p = [proposal()];
  savePreferences('me', { ...freshPreferences(), records: [] });
  f.request.mockImplementation(async (path, signal, method, body) => {
    if (method === 'POST') {
      f.state.n = negotiation({ status: 'CONFIRMED', confirmedDateTime: slot });
      f.state.c = { ...f.state.c, state: 'SECOND_CHAT_SCHEDULED' };
      f.state.home.nextSteps = [scheduledStep()];
      return f.state.n;
    }
    return read(path, signal, method, body);
  });
  function View() {
    const notifications = useActivityNotifications(f.controller, 'me', false);
    return <ActivityNotifications.Provider value={notifications}><Scheduling controller={f.controller} connectionId="c" matchId="m"
      partnerName="María" backToActivity onActivity={vi.fn()} onHome={vi.fn()} onFinished={vi.fn()} onBlocked={vi.fn()} browse={false} onBrowse={vi.fn()} onCloseBrowse={vi.fn()}/></ActivityNotifications.Provider>;
  }
  render(<View/>);
  fireEvent.click(await screen.findByRole('button', { name: 'Aceptar opción 1' }));
  expect(await screen.findByRole('heading', { name: 'Horario confirmado' })).toBeVisible();
  expect(loadPreferences('me').records).toContainEqual([activityId('SECOND_CHAT_SCHEDULED', 'c', slot), true]);
  expect(document.title).toBe('Reals');
});

it('opens with a verified Calendar action on navigation and removes it when the start is reached', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-15T15:59:52Z'));
  const f = setup(), stage = scheduledStep();
  f.state.a.serverTime = new Date().toISOString();
  f.state.n = negotiation({status:'CONFIRMED',confirmedDateTime:stage.secondChat.availableAt});
  f.state.c.state = 'SECOND_CHAT_SCHEDULED';
  f.state.home.nextSteps = [stage];
  await act(async()=>{view(f);});
  expect(calendarLink()).toBeVisible();
  fireEvent.click(calendarLink()!);
  expect(screen.getByText(openedStatus)).toBeVisible();
  f.request.mockClear();
  let resolve: ((value: unknown) => void) | undefined;
  f.request.mockImplementationOnce(()=>new Promise(accept=>{resolve=accept;}));
  await act(async()=>{await vi.advanceTimersByTimeAsync(7000);});
  expect(f.request.mock.calls.map(([path])=>path)).toEqual(['/connections/c']);
  const signal=f.request.mock.calls[0]?.[1];
  expect(signal?.aborted).toBe(false);
  await act(async()=>{await vi.advanceTimersByTimeAsync(1000);});
  expect(calendarLink()).toBeNull();
  expect(screen.queryByText(openedStatus)).toBeNull();
  expect(signal?.aborted).toBe(true);
  await act(async()=>resolve?.({...f.state.c,state:'CLOSED'}));
  expect(screen.getByRole('heading',{name:'Horario confirmado'})).toBeVisible();
  await act(async()=>{await vi.advanceTimersByTimeAsync(14_000);});
  expect(f.request).toHaveBeenCalledTimes(1);
});

it.each(['CLOSED', 'denied'])('withdraws the Calendar link on remote %s while continuously visible', async outcome => {
  vi.useFakeTimers();
  vi.setSystemTime(time);
  const f=setup(), stage=scheduledStep();
  f.state.n=negotiation({status:'CONFIRMED',confirmedDateTime:stage.secondChat.availableAt});
  f.state.c.state='SECOND_CHAT_SCHEDULED';
  f.state.home.nextSteps=[stage];
  await act(async()=>{view(f);});
  const heading=screen.getByRole('heading',{name:'Horario confirmado'});
  const link=screen.getByRole('link',{name:'Agregar a Google Calendar'});
  fireEvent.click(link);
  expect(screen.getByText(openedStatus)).toBeVisible();
  f.request.mockClear();
  let resolve: ((value: unknown)=>void) | undefined;
  f.request.mockImplementationOnce(()=>new Promise(accept=>{resolve=accept;}));
  link.focus();

  await act(async()=>{await vi.advanceTimersByTimeAsync(14_000);});
  expect(f.request.mock.calls.map(([path])=>path)).toEqual(['/connections/c']);
  expect(calendarLink()).toBe(link);
  expect(link).toHaveFocus();
  await act(async()=>resolve?.(f.state.c));
  expect(screen.getByRole('heading',{name:'Horario confirmado'})).toBe(heading);
  expect(calendarLink()).toBe(link);
  expect(link).toHaveFocus();

  if (outcome==='CLOSED') f.state.c.state='CLOSED';
  else f.request.mockRejectedValueOnce(new ApiError('backend',403));
  await act(async()=>{await vi.advanceTimersByTimeAsync(7_000);});
  expect(calendarLink()).toBeNull();
  expect(screen.queryByText(openedStatus)).toBeNull();
  expect(screen.getByText('La conexión ya no está disponible.')).toBeVisible();
  expect(f.request.mock.calls.map(([path])=>path)).toEqual(['/connections/c','/connections/c']);
  await act(async()=>{await vi.advanceTimersByTimeAsync(14_000);});
  expect(f.request).toHaveBeenCalledTimes(2);
});

it.each(['Scheduling','Activity'])('shares an opened Calendar template from %s with both surfaces', async origin => {
  vi.useFakeTimers();
  vi.setSystemTime(time);
  const f=setup(), stage=scheduledStep();
  f.state.n=negotiation({status:'CONFIRMED',confirmedDateTime:stage.secondChat.availableAt});
  f.state.c.state='SECOND_CHAT_SCHEDULED';
  f.state.home.nextSteps=[stage];
  let scheduling: ReturnType<typeof view> | undefined;
  await act(async()=>{scheduling=view(f);});
  const item={...homeSecondFixture(),connectionId:stage.connectionId,
    partnerName:'María',secondChat:{...homeSecondFixture().secondChat!,...stage.secondChat}};
  const activity=render(<SecondChatCard item={item} accountId="me" disabled={false} onOpen={vi.fn()} onDismiss={vi.fn(async()=>{})}/>);
  const schedulingView=within(scheduling!.container), activityView=within(activity.container);
  const first=origin==='Scheduling'?schedulingView:activityView;
  fireEvent.click(first.getByRole('link',{name:'Agregar a Google Calendar'}));
  for(const surface of [schedulingView,activityView]){
    expect(surface.getByText(openedStatus)).toBeVisible();
    expect(surface.getByRole('link',{name:'Volver a agregar al calendario'})).toHaveAttribute('href',expect.stringContaining('20261115T160000Z%2F20261115T171500Z'));
  }
});

it('keeps the confirmed card and link during delayed resume, then hides the link on failure and restores it on retry', async () => {
  const f=setup(), stage=scheduledStep(), read=f.request.getMockImplementation()!;
  f.state.n=negotiation({status:'CONFIRMED',confirmedDateTime:stage.secondChat.availableAt});
  f.state.c.state='SECOND_CHAT_SCHEDULED';
  f.state.home.nextSteps=[stage];
  view(f);
  const link=await screen.findByRole('link',{name:'Agregar a Google Calendar'});
  const heading=screen.getByRole('heading',{name:'Horario confirmado'});
  let rejectHome: ((error: unknown)=>void) | undefined;
  f.request.mockImplementation((path,...args)=>path==='/me/home' ? new Promise((_, reject)=>{rejectHome=reject;}) : read(path,...args));
  link.focus();
  await act(async()=>document.dispatchEvent(new Event('visibilitychange')));
  expect(rejectHome).toBeDefined();
  expect(calendarLink()).toBe(link);
  expect(link).toHaveFocus();
  await act(async()=>rejectHome?.(new ApiError('network')));
  expect(screen.getByRole('heading',{name:'Horario confirmado'})).toBe(heading);
  expect(screen.getByRole('alert')).toHaveTextContent('No pudimos verificar los datos de la cita');
  expect(calendarLink()).toBeNull();
  f.request.mockImplementation(read);
  fireEvent.click(screen.getByRole('button',{name:'Reintentar'}));
  await screen.findByRole('link',{name:'Agregar a Google Calendar'});
  expect(screen.queryByRole('alert')).toBeNull();
});
it('renders selector with seven days, half hours, ordered removals and profile navigation',async()=>{
 const f=view();await screen.findByRole('heading',{name:'Proponé tus horarios'});expect(screen.getByLabelText('Día').children).toHaveLength(7);expect(screen.getByLabelText('Minutos').children).toHaveLength(2);
 fireEvent.click(screen.getByRole('button',{name:'Agregar opción'}));expect(screen.getByRole('button',{name:'Enviar horarios'})).toBeEnabled();fireEvent.click(screen.getByRole('button',{name:'Quitar opción 1'}));expect(screen.getByRole('button',{name:'Enviar horarios'})).toBeDisabled();fireEvent.click(screen.getByRole('button',{name:'Ver perfil'}));expect(f.browse).toHaveBeenCalledOnce();
});
it('prioritizes received expired proposals and allows rejection before own submission',async()=>{
 const f=setup();f.state.p=[proposal({proposedDateTime:'2020-01-01T12:00:00Z'})];view(f);await screen.findByRole('heading',{name:'Horarios que recibiste'});expect(screen.queryByRole('heading',{name:'Proponé tus horarios'})).toBeNull();expect(screen.getByRole('button',{name:'Aceptar opción 1'})).toBeDisabled();expect(screen.getByRole('button',{name:'Rechazar estas opciones'})).toBeEnabled();expect(screen.getByText('Vencido')).toBeVisible();
});
it('polls every seven seconds, skips hidden polls, resumes online and preserves selected draft',async()=>{
 vi.useFakeTimers();vi.setSystemTime(time);const f=view();await act(async()=>{});fireEvent.click(screen.getByRole('button',{name:'Agregar opción'}));const before=f.request.mock.calls.length;
 vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');await act(async()=>vi.advanceTimersByTime(7000));expect(f.request.mock.calls).toHaveLength(before);
 vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');await act(async()=>window.dispatchEvent(new Event('online')));expect(f.request.mock.calls.length).toBeGreaterThan(before);expect(screen.getByRole('button',{name:'Quitar opción 1'})).toBeVisible();
});
it('browses compact photos without decision controls and returns to preserved draft',async()=>{
 const f=view();await screen.findByRole('heading',{name:'Proponé tus horarios'});fireEvent.click(screen.getByRole('button',{name:'Agregar opción'}));const read=f.request.getMockImplementation()!;
 f.request.mockImplementation(async(path,...args)=>path.endsWith('/visual-profile')?visualProfile():read(path,...args));
 f.rerender(<Scheduling {...f.props} browse/>);await screen.findByRole('heading',{name:'María, 29'});expect(screen.queryByRole('button',{name:'Aprobar'})).toBeNull();expect(screen.getByRole('button',{name:'Ver foto 1 de 4'})).toHaveAttribute('aria-pressed','true');fireEvent.click(screen.getByRole('button',{name:'Ver foto 2 de 4'}));expect(screen.getByRole('button',{name:'Ver foto 2 de 4'})).toHaveAttribute('aria-pressed','true');f.rerender(<Scheduling {...f.props}/>);expect(screen.getByRole('button',{name:'Quitar opción 1'})).toBeVisible();
});
it('places biography, answers and affinities before every browse photo',async()=>{
 const f=setup(),read=f.request.getMockImplementation()!;f.request.mockImplementation(async(path,...args)=>path.endsWith('/visual-profile')?visualProfile():read(path,...args));const v=view(f);await screen.findByRole('heading',{name:'Proponé tus horarios'});v.rerender(<Scheduling {...v.props} browse/>);await screen.findByRole('heading',{name:'María, 29'});const image=screen.getAllByRole('img')[0]!;for(const title of ['Bio','Preguntas del perfil','Afinidades compartidas'])expect(screen.getByRole('heading',{name:title}).compareDocumentPosition(image)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(screen.queryByRole('heading',{name:'Mensaje personal'})).toBeNull();
});
it('reserves initial scheduling structure and keeps all placeholder content noninteractive',async()=>{
 const f=setup();let release!:(value:unknown)=>void;f.request.mockReturnValueOnce(new Promise(r=>{release=r;}));view(f);expect(screen.getByRole('status')).toHaveTextContent('Cargando coordinación…');expect(document.querySelector('.scheduling-placeholder button')).toBeNull();expect(screen.queryByRole('combobox')).toBeNull();await act(async()=>release(f.snapshot()));await screen.findByRole('heading',{name:'Proponé tus horarios'});expect(document.querySelector('.scheduling-placeholder')).toBeNull();
});
it('requires permanent block confirmation and serializes double click',async()=>{
 const f=view();await screen.findByRole('heading',{name:'Proponé tus horarios'});fireEvent.click(screen.getByRole('button',{name:'Más acciones'}));fireEvent.click(screen.getByRole('menuitem'));expect(screen.getByRole('dialog')).toBeVisible();expect(f.request.mock.calls.some(c=>c[2]==='POST')).toBe(false);
 const read=f.request.getMockImplementation()!;f.request.mockImplementation(async(path,...args)=>path.endsWith('/block')?{id:'block'}:read(path,...args));const block=screen.getByRole('button',{name:'Bloquear definitivamente'});fireEvent.click(block);fireEvent.click(block);await waitFor(()=>expect(f.back).toHaveBeenCalledOnce());expect(f.request.mock.calls.filter(c=>c[2]==='POST')).toHaveLength(1);
});
it('disables expired negotiation without inventing failure and refreshes authority',async()=>{
 const f=setup();f.state.n.schedulingExpiresAt='2020-01-01T12:00:00Z';f.state.c.schedulingExpiresAt=f.state.n.schedulingExpiresAt;view(f);await screen.findByText(/La coordinación venció/);expect(screen.getByRole('button',{name:'Enviar horarios'})).toBeDisabled();expect(screen.queryByText(/No hubo acuerdo/)).toBeNull();
});
it('shows transient availability errors and retries safely',async()=>{
 const f=setup();f.request.mockRejectedValueOnce(new ApiError('network'));view(f);await screen.findByRole('alert');fireEvent.click(screen.getByRole('button',{name:'Reintentar'}));await screen.findByRole('heading',{name:'Proponé tus horarios'});expect(screen.getByRole('button',{name:'Agregar opción'})).toBeEnabled();
});

it('keeps picker, submit, profile and block responsive during a slow background poll without loading flicker',async()=>{
 const f=view();await screen.findByRole('heading',{name:'Proponé tus horarios'});const read=f.request.getMockImplementation()!;let resolve!:(v:unknown)=>void;
 f.request.mockReturnValueOnce(new Promise(r=>{resolve=r;}));act(()=>window.dispatchEvent(new Event('online')));
 fireEvent.click(screen.getByRole('button',{name:'Agregar opción'}));expect(screen.getByRole('button',{name:'Enviar horarios'})).toBeEnabled();expect(screen.getByRole('button',{name:'Ver perfil'})).toBeEnabled();
 expect(screen.queryByText(/Actualizando/)).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Más acciones'}));fireEvent.click(screen.getByRole('menuitem'));expect(screen.getByRole('button',{name:'Bloquear definitivamente'})).toBeEnabled();
 await act(async()=>resolve(await read('/connections/c/scheduling-snapshot',new AbortController().signal)));
});

it.each([['Buenos Aires', 'AR', 'Buenos Aires, Argentina'], [null, 'XX', null]])('shows guarded partner location %s through the shared profile', async (city, countryCode, label) => {
  const f = setup(), read = f.request.getMockImplementation()!;
  f.request.mockImplementation(async (path, ...args) => path.endsWith('/visual-profile') ? visualProfile({ city, countryCode }) : read(path, ...args));
  const v = view(f); await screen.findByRole('heading', { name:'Proponé tus horarios' });
  v.rerender(<Scheduling {...v.props} browse/>);
  const heading = await screen.findByRole('heading', { name:'María, 29' });
  if (label) expect(heading.nextElementSibling).toHaveTextContent(label);
  else expect(document.querySelector('.public-profile-location')).toBeNull();
  expect(f.request.mock.calls.filter(c => c[0].endsWith('/visual-profile'))).toHaveLength(1);
  expect(f.request.mock.calls.some(c => c[0].includes('/reference/countries'))).toBe(false);
  expect(f.request.mock.calls.some(c => c[2] && c[2] !== 'GET')).toBe(false);
});

it('keeps partner identity and actions stable while the initial profile is delayed', async () => {
  const f = setup(), read = f.request.getMockImplementation()!; let finish!: (value: unknown) => void;
  f.request.mockImplementation((path, ...args) => path.endsWith('/visual-profile') ? new Promise(resolve => { finish = resolve; }) : read(path, ...args));
  const v = view(f); await screen.findByRole('heading', { name: 'Proponé tus horarios' });
  v.rerender(<Scheduling {...v.props} browse/>);
  const heading = screen.getByRole('heading', { name: 'María' });
  const back = screen.getByRole('button', { name: 'Volver' });
  expect(back.parentElement).toHaveClass('partner-profile-actions');
  expect(heading.closest('header')).toHaveClass('partner-profile-heading');
  expect(document.querySelector('.profile-placeholder')).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('Cargando perfil…');
  await act(async () => finish(visualProfile({ city: 'Rosario', countryCode: 'AR' })));
  expect(screen.getByRole('heading', { name: 'María, 29' })).toBe(heading);
  expect(screen.getByRole('button', { name: 'Volver' })).toBe(back);
  expect(document.querySelector('.partner-profile-loading')).toBeNull();
});

it.each(['VISUAL_CONTENT_NOT_AVAILABLE','USER_PAIR_BLOCKED'])('preserves the selected partner photo on resume and clears it on %s', async code => {
  const f=setup(),read=f.request.getMockImplementation()!;
  let renew=false, denied=false;
  f.request.mockImplementation(async(path,...args)=>{
    if(!path.endsWith('/visual-profile')) return read(path,...args);
    if(denied) throw new ApiError('backend',409,code);
    const profile=visualProfile();
    return {...profile,photos:profile.photos.map(photo=>({...photo,url:photo.url+'&X-Amz-Signature='+(renew?'renewed':'initial')}))};
  });
  const v=view(f);
  await screen.findByRole('heading',{name:'Proponé tus horarios'});
  v.rerender(<Scheduling {...v.props} browse/>);
  const selected=await screen.findByRole('button',{name:'Ver foto 2 de 4'});
  fireEvent.click(selected); selected.focus();
  const image=screen.getByRole('img',{name:/Foto 2/});
  fireEvent.load(image);
  renew=true;
  await act(async()=>document.dispatchEvent(new Event('visibilitychange')));
  expect(screen.getByRole('img',{name:/Foto 2/})).toBe(image);
  expect(image.getAttribute('src')).toContain('initial');
  expect(selected).toHaveFocus();
  denied=true;
  await act(async()=>document.dispatchEvent(new Event('visibilitychange')));
  expect(image).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toBeVisible();
});

it('withdraws a mounted gallery when the scheduling owner observes a pair block',async()=>{
 const f=setup(),read=f.request.getMockImplementation()!;
 f.request.mockImplementation(async(path,...args)=>path.endsWith('/visual-profile')?visualProfile():read(path,...args));
 const v=view(f);await screen.findByRole('heading',{name:'Proponé tus horarios'});v.rerender(<Scheduling {...v.props} browse/>);const image=await screen.findByRole('img');
 f.request.mockImplementation(async(path,...args)=>{if(path.startsWith('/connections/'))throw new ApiError('backend',409,'USER_PAIR_BLOCKED');return path.endsWith('/visual-profile')?visualProfile():read(path,...args);});
 await act(async()=>window.dispatchEvent(new Event('online')));await waitFor(()=>expect(image).not.toBeInTheDocument());expect(screen.getByText('La conexión ya no está disponible.')).toBeVisible();
 const count=f.request.mock.calls.length;await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('online'));});expect(f.request).toHaveBeenCalledTimes(count);expect(screen.queryByRole('img')).toBeNull();
});
