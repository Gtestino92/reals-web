import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError, object } from '../auth/api';
import { FirstChat } from './FirstChat';
import { SecondChat } from './SecondChat';
import { chatFixture, controllerFixture, messageFixture } from './fixtures';
import { secondHarness } from './secondFixtures';
import type { Message } from './contracts';

function conversation(kind: 'first' | 'second', quotaExhausted = false, withIncoming = false) {
  const second = kind === 'second' ? secondHarness() : null;
  const controller = second?.controller ?? controllerFixture();
  const chat = chatFixture();
  if (quotaExhausted) {
    const policy = { enabled: false, unavailableReason: 'LIMIT_REACHED', remainingMessages: 0 };
    Object.assign(chat.audioPolicy, policy);
    if (second) Object.assign(second.status.audioPolicy ?? {}, policy);
  }
  const messages: Message[] = second?.messages ?? [];
  if (withIncoming) messages.push(messageFixture());
  const secondRequest = second?.request.getMockImplementation();
  let closed = false;
  let complete: (() => void) | undefined;
  const write = vi.fn(async (body: unknown) => {
    if (!object(body) || typeof body.content !== 'string' || typeof body.clientMessageId !== 'string') throw Error('Invalid test send');
    const r = body.replyTo;
    const replyTo: Message['replyTo'] = object(r) && r.type === 'MESSAGE' && typeof r.targetId === 'string'
      ? {type:'MESSAGE',targetId:r.targetId,previewText:null} : null;
    const message = { ...messageFixture(String(messages.length + 1), 'me'), replyTo, content: body.content, clientMessageId: body.clientMessageId };
    await new Promise<void>(resolve => { complete = resolve; });
    messages.push(message);
    return message;
  });
  if (!second) vi.spyOn(controller, 'request');
  vi.mocked(controller.request).mockImplementation(async (...args) => {
    const [path, , method, body] = args;
    if (path === '/chats/c/messages' && method === 'POST') return write(body);
    if (secondRequest) return secondRequest(...args);
    if (path === '/matches/m') return { id: 'm', userAId: 'me', userBId: 'them', state: closed ? 'CHAT_REJECTED' : 'CHAT_ACTIVE' };
    if (path === '/matches/m/chat') return chat;
    if (path.endsWith('/exit-requests')) return [];
    if (path.includes('/messages?')) return [...messages];
    throw Error('Unexpected test read');
  });

  const onHome = vi.fn();
  const screenForChat = kind === 'first'
    ? <FirstChat controller={controller} matchId="m" chatId="c" onHome={onHome}/>
    : <SecondChat controller={controller} matchId="m" connectionId="connection" onHome={onHome}/>;
  const view = render(<><button>Control externo</button>{screenForChat}</>);
  return {
    ...view, write, controller, onHome,
    confirm: async () => act(async () => complete?.()),
    close: () => {
      closed = true;
      if (second) {
        second.status.chatStatus = 'FINISHED';
        second.status.readOnlyUntil = '2026-11-14T15:00:00Z';
      }
    },
  };
}

const field = () => screen.getByRole('textbox', { name: 'Mensaje' });
const submit = () => screen.getByRole('button', { name: 'Enviar mensaje' });
function tap(button = submit()) {
  fireEvent.pointerDown(button, { pointerType: 'touch', button: 0 });
  fireEvent.pointerUp(button, { pointerType: 'touch', button: 0 });
  // Browsers transfer focus on the primary mousedown unless it is cancelled.
  if (fireEvent.mouseDown(button, { button: 0 })) button.focus();
  fireEvent.click(button);
}

afterEach(() => vi.restoreAllMocks());

it.each([
  ['first', true], ['first', false], ['second', true], ['second', false],
] as const)('%s dismisses the quota notice with writing focus initially %s', async (kind, focused) => {
  const chat = conversation(kind, true);
  const input = await screen.findByRole('textbox', { name: 'Mensaje' });
  const notice = screen.getByRole('button', { name: 'Ocultar aviso de audio' });
  const microphone = screen.getByRole('button', { name: 'Grabar audio' });
  expect(microphone).toBeDisabled();
  await waitFor(() => expect(input).toBeEnabled());
  act(() => input.focus());
  fireEvent.change(input, { target: { value: 'Borrador sin enviar' } });
  if (!focused) act(() => input.blur());
  const blur = vi.fn();
  input.addEventListener('blur', blur);
  const focus = vi.spyOn(input, 'focus');

  tap(notice);

  expect(notice).not.toBeInTheDocument();
  expect(field()).toBe(input);
  expect(input).toHaveValue('Borrador sin enviar');
  if (focused) expect(input).toHaveFocus();
  else expect(input).not.toHaveFocus();
  expect(blur).not.toHaveBeenCalled();
  expect(focus).not.toHaveBeenCalled();
  expect(microphone).toBeDisabled();
  expect(chat.write).not.toHaveBeenCalled();
});

it.each(['first', 'second'] as const)('%s keeps one focused field through consecutive confirmed sends', async kind => {
  const chat = conversation(kind);
  const input = await screen.findByRole('textbox', { name: 'Mensaje' });
  await waitFor(() => expect(input).toBeEnabled());
  const form = input.closest('form');
  if (!form) throw Error('Missing text composer');
  act(() => input.focus());
  const blur = vi.fn();
  input.addEventListener('blur', blur);

  for (const [index, draft] of ['Hola', 'Segundo mensaje', 'Tercer mensaje'].entries()) {
    fireEvent.change(input, { target: { value: draft } });
    await waitFor(() => expect(submit()).toBeEnabled());
    tap();
    expect(chat.write).toHaveBeenCalledTimes(index + 1);
    expect(input).toHaveFocus();
    expect(input).toHaveValue('');
    expect(screen.getByText(draft)).toBeVisible();
    expect(submit()).toBeDisabled();
    fireEvent.submit(form);
    expect(chat.write).toHaveBeenCalledTimes(index + 1);
    await chat.confirm();
    await waitFor(() => expect(input).toHaveValue(''));
    expect(screen.getByText(draft)).toBeVisible();
    expect(field()).toBe(input);
    expect(input).toHaveFocus();
  }
  expect(blur).not.toHaveBeenCalled();
});

it.each([
  ['first', 'failed'], ['first', 'uncertain'], ['second', 'failed'], ['second', 'uncertain'],
] as const)('%s preserves a draft with %s delivery', async (kind, phase) => {
  const chat = conversation(kind);
  chat.write.mockRejectedValueOnce(phase === 'failed' ? new ApiError('backend', 400) : new ApiError('network'));
  const input = await screen.findByRole('textbox', { name: 'Mensaje' });
  await waitFor(() => expect(input).toBeEnabled());
  act(() => input.focus());
  fireEvent.change(input, { target: { value: 'Conservar este borrador' } });
  tap();
  await screen.findByText(phase === 'failed' ? 'Falló el envío' : 'Sin confirmar');
  expect(chat.write).toHaveBeenCalledOnce();
  expect(field()).toBe(input);
  expect(input).toHaveValue('Conservar este borrador');
});

it.each(['first', 'second'] as const)('%s leaves focus outside the composer after explicit blur and terminal reconciliation', async kind => {
  const chat = conversation(kind);
  const input = await screen.findByRole('textbox', { name: 'Mensaje' });
  await waitFor(() => expect(input).toBeEnabled());
  act(() => input.focus());
  fireEvent.change(input, { target: { value: 'Último mensaje' } });
  tap();
  const outside = screen.getByRole('button', { name: 'Control externo' });
  act(() => outside.focus());
  chat.close();
  await chat.confirm();
  await waitFor(() => {
    if (kind === 'first') expect(input).toBeDisabled();
    else expect(input).not.toBeInTheDocument();
  });
  expect(outside).toHaveFocus();
  expect(chat.write).toHaveBeenCalledOnce();
});

it.each(['first', 'second'] as const)('%s neither submits mid-composition nor restores focus after navigation', async kind => {
  const chat = conversation(kind);
  const input = await screen.findByRole('textbox', { name: 'Mensaje' });
  await waitFor(() => expect(input).toBeEnabled());
  act(() => input.focus());
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: 'Texto en edición' } });
  tap();
  expect(input).toHaveFocus();
  expect(chat.write).not.toHaveBeenCalled();
  fireEvent.compositionEnd(input);
  tap();
  expect(chat.write).toHaveBeenCalledOnce();
  chat.rerender(<button>Otra pantalla</button>);
  const elsewhere = screen.getByRole('button', { name: 'Otra pantalla' });
  act(() => elsewhere.focus());
  await chat.confirm();
  expect(elsewhere).toHaveFocus();
  expect(input).not.toBeInTheDocument();
});

it('leaves focus outside Second Chat when authorization ends during a pending send', async () => {
  const chat = conversation('second');
  const input = await screen.findByRole('textbox', { name: 'Mensaje' });
  await waitFor(() => expect(input).toBeEnabled());
  act(() => input.focus());
  fireEvent.change(input, { target: { value: 'Mensaje pendiente' } });
  tap();
  expect(chat.write).toHaveBeenCalledOnce();
  chat.controller.snapshot = { ...chat.controller.snapshot, phase: 'signingOut', account: null };
  chat.rerender(<><button>Control externo</button><SecondChat controller={chat.controller} matchId="m" connectionId="connection" onHome={chat.onHome}/></>);
  const outside = screen.getByRole('button', { name: 'Control externo' });
  act(() => outside.focus());
  await chat.confirm();
  expect(screen.queryByRole('region', { name: 'Segundo chat' })).toBeNull();
  expect(outside).toHaveFocus();
});

it.each(['first', 'second'] as const)('%s retains an identical newly edited draft and completes an interrupted history read', async kind => {
  const chat = conversation(kind, false, true);
  const input = await screen.findByRole('textbox', { name: 'Mensaje' });
  await waitFor(() => expect(input).toBeEnabled());
  const original = vi.mocked(chat.controller.request).getMockImplementation()!;
  let releaseHistory: (() => void) | undefined;
  let pages = 0;
  vi.mocked(chat.controller.request).mockImplementation(async (...args) => {
    if (args[0].includes('/messages?') && ++pages === 1) {
      args[4]?.('ALLOWED');
      await new Promise<void>(resolve => { releaseHistory = resolve; });
      return [{ ...messageFixture('99'), content: 'Lectura obsoleta' }];
    }
    return original(...args);
  });
  fireEvent.change(input, { target: { value: 'Igual' } });
  tap();
  fireEvent.change(input, { target: { value: 'Otro' } });
  fireEvent.change(input, { target: { value: 'Igual' } });
  expect(submit()).toBeDisabled();
  await chat.confirm();
  expect(input).toHaveValue('Igual');
  expect(submit()).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: /^Responder mensaje/ }));
  tap();
  fireEvent.submit(input.closest('form')!);
  expect(chat.write).toHaveBeenCalledTimes(2);
  expect(chat.write.mock.calls[0]).not.toEqual(chat.write.mock.calls[1]);
  await chat.confirm();
  await act(async () => releaseHistory?.());
  expect(chat.write.mock.calls[1]?.[0]).toMatchObject({replyTo:{type:'MESSAGE',targetId:'1'}});
  expect(screen.queryByText('Lectura obsoleta')).toBeNull();
  expect(pages).toBe(2);
  expect(input).toHaveValue('');
});

it.each(['first', 'second'] as const)('%s keeps the confirmed bubble when the history body fails', async kind => {
  const chat = conversation(kind);
  const input = await screen.findByRole('textbox', { name: 'Mensaje' });
  await waitFor(() => expect(input).toBeEnabled());
  const original = vi.mocked(chat.controller.request).getMockImplementation()!;
  vi.mocked(chat.controller.request).mockImplementation(async (...args) => {
    if (args[0].includes('/messages?')) throw new ApiError('network');
    return original(...args);
  });
  fireEvent.change(input, {target:{value:'Confirmado'}});
  tap();
  fireEvent.change(input, {target:{value:'Siguiente'}});
  await chat.confirm();
  expect(screen.getByText('Confirmado')).toBeVisible();
  expect(submit()).toBeDisabled();
  expect(input).toHaveValue('Siguiente');
  expect(chat.write).toHaveBeenCalledOnce();
});

it.each(['first', 'second'] as const)('%s refuses another text after the partner access restriction arrives', async kind => {
  const chat = conversation(kind);
  const input = await screen.findByRole('textbox', { name: 'Mensaje' });
  await waitFor(() => expect(input).toBeEnabled());
  const original = vi.mocked(chat.controller.request).getMockImplementation()!;
  vi.mocked(chat.controller.request).mockImplementation(async (...args) => {
    if (args[0].includes('/messages?')) {
      args[4]?.('RESTRICTED');
      return [];
    }
    return original(...args);
  });
  fireEvent.change(input, {target:{value:'Primero'}});
  tap();
  fireEvent.change(input, {target:{value:'Segundo'}});
  await chat.confirm();
  expect(submit()).toBeDisabled();
  fireEvent.submit(input.closest('form')!);
  expect(chat.write).toHaveBeenCalledOnce();
});

it.each(['first', 'second'] as const)('%s retains a malformed text acknowledgement as uncertain', async kind => {
  const chat = conversation(kind);
  const input = await screen.findByRole('textbox', { name: 'Mensaje' });
  await waitFor(() => expect(input).toBeEnabled());
  const original = vi.mocked(chat.controller.request).getMockImplementation()!;
  const post = vi.fn();
  vi.mocked(chat.controller.request).mockImplementation(async (...args) => {
    if (args[2] !== 'POST') return original(...args);
    post(args[3]);
    return { ...messageFixture('2','me'), ...(object(args[3]) ? args[3] : {}), content:null };
  });
  fireEvent.change(input, {target:{value:'Sin confirmar'}});
  tap();
  await screen.findByRole('button', {name:/Reconciliar y reintentar/});
  fireEvent.submit(input.closest('form')!);
  expect(post).toHaveBeenCalledOnce();
  expect(submit()).toBeDisabled();
  expect(input).toHaveValue('Sin confirmar');
});

it.each(['first', 'second'] as const)('%s merges incoming text and reactions around the POST cursor', async kind => {
  const chat = conversation(kind, false, true);
  const input = await screen.findByRole('textbox', { name: 'Mensaje' });
  await waitFor(() => expect(input).toBeEnabled());
  const original = vi.mocked(chat.controller.request).getMockImplementation()!;
  vi.mocked(chat.controller.request).mockImplementation(async (...args) => {
    if (args[0].includes('/messages?')) {
      expect(args[0]).not.toContain('after=2');
      args[4]?.('ALLOWED');
      return [ { ...messageFixture('1'), reactionType:'HEART' }, { ...messageFixture('3'), content:'Mensaje entrante' } ];
    }
    return original(...args);
  });
  fireEvent.change(input, {target:{value:'Mensaje saliente'}});
  tap();
  await chat.confirm();
  expect(screen.getByText('Mensaje saliente')).toBeVisible();
  expect(screen.getByText('Mensaje entrante')).toBeVisible();
  expect(screen.getByRole('img',{name:'Reaccionaste con coraz\u00f3n'})).toBeVisible();
});
