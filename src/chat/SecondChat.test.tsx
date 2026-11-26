import { StrictMode } from 'react';
import { SecondChatEntryIntent } from './SecondChatSession';
import { expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SecondChat } from './SecondChat';
import { secondHarness } from './secondFixtures';
import { messageFixture } from './fixtures';
import { ApiError } from '../auth/api';
it('tracks the visual viewport with the loaded second-chat composer and retains a focused reply',async()=>{
 const h=secondHarness(); h.messages.push(messageFixture());
 const viewport=Object.assign(new EventTarget(),{height:window.innerHeight,offsetTop:0,scale:1});
 vi.stubGlobal('visualViewport',viewport);
 const view=render(<SecondChat controller={h.controller} connectionId="connection" matchId="m" partnerName="María" onHome={vi.fn()}/>);
 try {
   const input=await screen.findByRole('textbox',{name:'Mensaje'});
   fireEvent.click(screen.getByRole('button',{name:'Responder mensaje de María'}));
   fireEvent.change(input,{target:{value:'Te respondo'}});
   viewport.height=310; viewport.offsetTop=50;
   viewport.dispatchEvent(new Event('resize'));
   await waitFor(() => expect(screen.getByRole('region',{name:'Segundo chat'}).style.getPropertyValue('--chat-viewport-top')).toBe('50px'));
   expect(input).toHaveFocus(); expect(input).toHaveValue('Te respondo');
   expect(screen.getByRole('button',{name:'Quitar respuesta'})).toBeEnabled();
   expect(screen.getByRole('button',{name:'Enviar mensaje'})).toBeEnabled();
 } finally { view.unmount(); vi.unstubAllGlobals(); }
});
it('renders joined waiting and no First Chat decisions or guidance',async()=>{const h=secondHarness();h.status.partnerAttendanceStatus='PENDING';render(<SecondChat controller={h.controller} connectionId="connection" matchId="m" onHome={vi.fn()}/>);await screen.findByText('Podés mandar mensajes mientras esperás.');expect(screen.queryByText('Llegaste a tiempo.')).toBeNull();expect(screen.queryByText(/Eso no significa/)).toBeNull();expect(screen.queryByText('SEGUNDO CHAT')).toBeNull();expect(screen.queryByText('Aprobar chat')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Volver a Inicio'})).not.toBeInTheDocument();});
it('only responder sees completion decisions; preserves text composer during request',async()=>{const h=secondHarness();h.status.activeResolutionRequest={id:'r',type:'MUTUAL_COMPLETION',status:'PENDING',requesterUserId:'them',responderUserId:'me',referenceMessageId:null,createdAt:h.status.serverTime,expiresAt:'2026-11-13T12:13:00Z'};render(<SecondChat controller={h.controller} connectionId="connection" matchId="m" onHome={vi.fn()}/>);expect(await screen.findByRole('button',{name:'Finalizar el chat'})).toBeEnabled();expect(screen.getByRole('textbox',{name:'Mensaje'})).toBeEnabled();fireEvent.click(screen.getByRole('button',{name:'Seguir conversando'}));await waitFor(()=>expect(h.request.mock.calls.some(c=>c[0].endsWith('/r/decision')&&JSON.stringify(c[3]).includes('REJECTED'))).toBe(true));});
it('renders retained messages without composition or new reactions',async()=>{const h=secondHarness();h.status.chatStatus='FINISHED';h.status.readOnlyUntil='2026-11-13T15:00:00Z';h.messages.push(messageFixture());render(<SecondChat controller={h.controller} connectionId="connection" matchId="m" onHome={vi.fn()}/>);await screen.findByText('Hola, ¿cómo estás?');expect(screen.queryByRole('textbox')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Volver a Inicio'})).toBeEnabled();});
it('safety report and manual blocking keep separate endpoints and dialogs',async()=>{const h=secondHarness();render(<SecondChat controller={h.controller} connectionId="connection" matchId="m" onHome={vi.fn()}/>);await screen.findByRole('textbox',{name:'Mensaje'});fireEvent.click(screen.getByRole('button',{name:'Opciones del chat'}));fireEvent.click(screen.getByRole('menuitem',{name:'Reportar por seguridad'}));fireEvent.change(await screen.findByRole('textbox',{name:'Detalle'}),{target:{value:'Conducta inapropiada'}});fireEvent.click(screen.getByRole('button',{name:'Confirmar'}));await waitFor(()=>expect(h.request.mock.calls.some(c=>c[0]==='/chats/c/safety-cancellations'&&JSON.stringify(c[3]).includes('blockUser'))).toBe(true));});

it('survives StrictMode effect replay with exactly one explicit entry and no join on remount without intent',async()=>{
 const h=secondHarness();Object.assign(h.status,{canJoin:true,myAttendanceStatus:'PENDING',myJoinedAt:null});
 const intent=new SecondChatEntryIntent(h.controller,'connection','m');
 const view=render(<StrictMode><SecondChat controller={h.controller} connectionId="connection" matchId="m" entryIntent={intent} onHome={vi.fn()}/></StrictMode>);
 await waitFor(()=>expect(h.request.mock.calls.filter(c=>c[0].endsWith('/join'))).toHaveLength(1));
 await screen.findByRole('textbox',{name:'Mensaje'});
 view.unmount();Object.assign(h.status,{canJoin:true,myAttendanceStatus:'PENDING',myJoinedAt:null});h.request.mockClear();render(<SecondChat controller={h.controller} connectionId="connection" matchId="m" onHome={vi.fn()}/>);
 await screen.findByRole('button',{name:'Entrar al segundo chat'});fireEvent(window,new Event('online'));fireEvent(document,new Event('visibilitychange'));
 await waitFor(()=>expect(h.request.mock.calls.filter(c=>c[0].endsWith('/status')).length).toBeGreaterThan(0));expect(h.request.mock.calls.some(c=>c[0].endsWith('/join'))).toBe(false);
});

function delay() {
  let release!: () => void;
  const until = new Promise<void>(resolve => { release = resolve; });
  return { until, release };
}

it.each(['joined', 'explicit entry', 'retained'] as const)('shows a single initial skeleton through status and empty history for %s', async kind => {
  const h = secondHarness();
  const status = delay(), history = delay();
  if (kind === 'explicit entry') Object.assign(h.status,{chatId:null,chatStatus:'AVAILABLE',canJoin:true,myAttendanceStatus:'PENDING'});
  if (kind === 'retained') Object.assign(h.status,{chatStatus:'FINISHED',readOnlyUntil:h.status.absoluteExpiresAt});
  const base = h.request.getMockImplementation()!;
  h.request.mockImplementation(async (...args) => {
    if (args[0].endsWith('/second-chat/status')) await status.until;
    if (args[0].includes('/messages?')) await history.until;
    return base(...args);
  });
  const entryIntent = kind === 'explicit entry' ? new SecondChatEntryIntent(h.controller,'connection','m') : undefined;
  render(<SecondChat controller={h.controller} connectionId="connection" matchId="m" entryIntent={entryIntent} partnerName="María" onHome={vi.fn()}/>);
  const initial = screen.getByRole('status');
  expect(initial).toHaveTextContent('Cargando el segundo chat…');
  expect(screen.queryByRole('button')).toBeNull();
  await act(async () => status.release());
  await waitFor(() => expect(h.request.mock.calls.some(([path]) => path.includes('/messages?'))).toBe(true));
  expect(screen.getByRole('status')).toBe(initial);
  expect(screen.queryByRole('button')).toBeNull();
  await act(async () => history.release());
  expect(screen.getByRole('list',{name:'Mensajes'})).toBeEmptyDOMElement();
  expect(screen.getByRole('heading',{name:'María'})).toBeVisible();
  expect(screen.queryByText('Cargando el segundo chat…')).toBeNull();
  if (kind === 'retained') {
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText(/Podés leerlo hasta/)).toBeVisible();
  } else expect(screen.getByRole('textbox',{name:'Mensaje'})).toBeEnabled();
  expect(h.request.mock.calls.filter(([, , method]) => method === 'POST')).toHaveLength(kind === 'explicit entry' ? 1 : 0);
});

it('replaces failed initial history with retry and keeps loaded DOM on a failed or superseded resume', async () => {
  const h = secondHarness();
  h.messages.push(messageFixture());
  const base = h.request.getMockImplementation()!;
  let fail = true;
  let slow: ReturnType<typeof delay> | null = null;
  h.request.mockImplementation(async (...args) => {
    if (args[0].includes('/messages?')) {
      if (slow) await slow.until;
      if (fail) throw new ApiError('network');
    }
    return base(...args);
  });
  render(<SecondChat controller={h.controller} connectionId="connection" matchId="m" partnerName="María" onHome={vi.fn()}/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos actualizar el chat');
  expect(screen.queryByText('Cargando el segundo chat…')).toBeNull();
  expect(screen.queryByRole('textbox')).toBeNull();
  fail = false;
  fireEvent.click(screen.getByRole('button',{name:'Reintentar conexión'}));
  const input = await screen.findByRole('textbox',{name:'Mensaje'});
  fireEvent.click(screen.getByRole('button',{name:'Responder mensaje de María'}));
  fireEvent.change(input,{target:{value:'Borrador'}});
  const list = screen.getByRole('list',{name:'Mensajes'});
  const held = delay();
  slow = held;
  const reads = () => h.request.mock.calls.filter(([path]) => path.includes('/messages?')).length;
  const before = reads();
  fireEvent(window,new Event('online'));
  await waitFor(() => expect(reads()).toBe(before + 1));
  slow = null;
  fail = true;
  fireEvent(window,new Event('online'));
  await screen.findByRole('alert');
  fail = false;
  await act(async () => held.release());
  expect(screen.getByRole('alert')).toBeVisible();
  expect(screen.getByRole('list',{name:'Mensajes'})).toBe(list);
  expect(input).toHaveValue('Borrador');
  expect(input).toHaveFocus();
  expect(screen.getByRole('button',{name:'Quitar respuesta'})).toBeEnabled();
  expect(screen.getByRole('button',{name:'Enviar mensaje'})).toBeDisabled();
  expect(screen.queryByText('Cargando el segundo chat…')).toBeNull();
});

it.each([true,false])('applies the shared Enter policy with desktop input capabilities %s', async desktop => {
  vi.stubGlobal('matchMedia',vi.fn(() => ({matches:desktop})));
  try {
    const h = secondHarness();
    render(<SecondChat controller={h.controller} connectionId="connection" matchId="m" onHome={vi.fn()}/>);
    const input = await screen.findByRole('textbox',{name:'Mensaje'});
    const enter = {key:'Enter',code:'Enter'};
    const posts = () => h.request.mock.calls.filter(([, , method]) => method === 'POST');
    fireEvent.change(input,{target:{value:'Hola\nMaría'}});
    expect(fireEvent.keyDown(input,{...enter,shiftKey:true})).toBe(true);
    expect(fireEvent.keyDown(input,{...enter,ctrlKey:true})).toBe(true);
    fireEvent.compositionStart(input);
    expect(fireEvent.keyDown(input,enter)).toBe(true);
    fireEvent.compositionEnd(input);
    expect(fireEvent.keyDown(input,{key:'Enter'})).toBe(true);
    fireEvent.keyDown(input,{...enter,repeat:true});
    expect(posts()).toHaveLength(0);
    expect(fireEvent.keyDown(input,enter)).toBe(!desktop);
    expect(posts()).toHaveLength(desktop ? 1 : 0);
  } finally { vi.unstubAllGlobals(); }
});

it('keeps failed safety reports and their form in the dialog with local pending feedback and cancellation', async () => {
  const h = secondHarness(), request = delay();
  const base = h.request.getMockImplementation()!;
  h.request.mockImplementation(async (...args) => {
    if (args[0].endsWith('/safety-cancellations')) {
      await request.until;
      throw new ApiError('network');
    }
    return base(...args);
  });
  render(<SecondChat controller={h.controller} connectionId="connection" matchId="m" onHome={vi.fn()}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Opciones del chat'}));
  fireEvent.click(screen.getByRole('menuitem',{name:'Reportar por seguridad'}));
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByRole('textbox',{name:'Detalle'}),{target:{value:'Conducta inapropiada'}});
  const confirm = within(dialog).getByRole('button',{name:'Confirmar'});
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(within(dialog).getByRole('status')).toHaveTextContent('Enviando reporte…');
  expect(screen.queryByText('Procesando…')).toBeNull();
  expect(within(dialog).getByRole('button',{name:'Volver'})).toBeDisabled();
  fireEvent(dialog,new Event('cancel',{cancelable:true}));
  expect(dialog).toBeVisible();
  await act(async () => request.release());
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('No pudimos confirmar la acción');
  expect(within(dialog).getByRole('textbox',{name:'Detalle'})).toHaveValue('Conducta inapropiada');
  fireEvent.click(within(dialog).getByRole('button',{name:'Volver'}));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(h.request.mock.calls.filter(([, , method]) => method === 'POST')).toHaveLength(1);
});

it('announces a completion request in the initiating dialog and closes after reconciliation', async () => {
  const h = secondHarness(), pending = delay(), base = h.request.getMockImplementation()!;
  h.request.mockImplementation(async (...args) => {
    if (args[0].endsWith('/completion-requests')) await pending.until;
    return base(...args);
  });
  render(<SecondChat controller={h.controller} connectionId="connection" matchId="m" onHome={vi.fn()}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Opciones del chat'}));
  fireEvent.click(screen.getByRole('menuitem',{name:'Finalizar de común acuerdo'}));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button',{name:'Enviar solicitud'}));
  expect(within(dialog).getByRole('status')).toHaveTextContent('Enviando solicitud…');
  expect(within(dialog).getByRole('button',{name:'Cancelar'})).toBeDisabled();
  await act(async () => pending.release());
  expect(screen.queryByRole('dialog')).toBeNull();
});

it.each(['deadline','denied'] as const)('withdraws retained protected history immediately on %s', async cause => {
  const h = secondHarness(), onHome = vi.fn(), base = h.request.getMockImplementation()!;
  Object.assign(h.status,{chatStatus:'FINISHED',readOnlyUntil:h.status.absoluteExpiresAt});
  h.messages.push(messageFixture());
  render(<SecondChat controller={h.controller} connectionId="connection" matchId="m" onHome={onHome}/>);
  await screen.findByRole('list',{name:'Mensajes'});
  if (cause === 'deadline') h.status.serverTime = h.status.absoluteExpiresAt;
  else h.request.mockImplementation(async (...args) => {
    if (args[0].includes('/messages?')) throw new ApiError('backend',403);
    return base(...args);
  });
  fireEvent(window,new Event('online'));
  await waitFor(() => expect(onHome).toHaveBeenCalledOnce());
  expect(screen.queryByRole('list',{name:'Mensajes'})).toBeNull();
  expect(screen.queryByText('Cargando el segundo chat…')).toBeNull();
});
