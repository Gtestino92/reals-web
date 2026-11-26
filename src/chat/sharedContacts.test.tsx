import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ApiError } from '../auth/api';
import { parseChat } from './contracts';
import { chatFixture, controllerFixture } from './fixtures';
import { SharedContactIndicator, rangeLabels } from './SharedContactIndicator';
import { ChatSession } from './ChatSession';

it.each([undefined, null, {}, 2, 'UNKNOWN'])('ignores an unusable optional range %s', sharedContactRange => {
  expect(parseChat({ ...chatFixture(), sharedContactRange }, 'm', 'c', 'them').sharedContactRange).toBeUndefined();
});
it.each(Object.entries(rangeLabels))('parses and presents %s', (range, label) => {
  const chat = parseChat({ ...chatFixture(), sharedContactRange: range }, 'm', 'c', 'them');
  const view = render(<SharedContactIndicator owner="a" chat="c" range={chat.sharedContactRange!}/>);
  fireEvent.click(screen.getByRole('button', { name: new RegExp(label) }));
  expect(screen.getByText(/Ambas personas/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: /Descartar/ }));
  expect(JSON.stringify(localStorage)).not.toContain(range);
  view.unmount();
  const props = { chat: 'c', range: chat.sharedContactRange! };
  const reopened = render(<SharedContactIndicator owner="a" {...props}/>);
  expect(screen.queryByRole('button')).toBeNull();
  reopened.unmount();
  render(<SharedContactIndicator owner="b" {...props}/>);
  expect(screen.getByRole('button', { name: new RegExp(label) })).toBeVisible();
  localStorage.clear();
});
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { resolve, reject, promise };
}
function activeChat() {
  const controller = controllerFixture();
  const meta = { ...chatFixture(), sharedContactRange: 'ONE_TO_FIVE' as string | null };
  const request = vi.spyOn(controller, 'request').mockImplementation(async path => {
    if (path === '/matches/m') return { id: 'm', userAId: 'me', userBId: 'them', state: 'CHAT_ACTIVE' };
    if (path === '/matches/m/chat') return { ...meta };
    return [];
  });
  const session = new ChatSession(controller, 'm', 'c', 'me', vi.fn());
  return { session, meta, request, controller };
}
it.each(['delayed', 'failed'])('retires authoritative removal before %s history', async mode => {
  const { session, meta, request } = activeChat();
  await session.refresh();
  expect(session.getSnapshot().chat?.sharedContactRange).toBe('ONE_TO_FIVE');
  meta.sharedContactRange = null;
  const history = deferred<unknown>(), requested = deferred<void>();
  const base = request.getMockImplementation()!;
  request.mockImplementation((...args) => {
    if (!args[0].includes('/messages?')) return base(...args);
    requested.resolve(); return history.promise;
  });
  const refreshed = session.refresh();
  await requested.promise;
  expect(session.getSnapshot().chat?.sharedContactRange).toBeUndefined();
  if (mode === 'delayed') history.resolve([]); else history.reject(new ApiError('network'));
  await refreshed;
  expect(session.getSnapshot().chat?.sharedContactRange).toBeUndefined();
  expect(request.mock.calls.some(([path]) => path.includes('shared-contacts'))).toBe(false);
});
it('ignores superseded metadata after a foreground read removes the bucket', async () => {
  const { session, meta, request } = activeChat();
  await session.refresh();
  const stale = { ...meta }, pending = deferred<unknown>(), requested = deferred<void>();
  const base = request.getMockImplementation()!;
  request.mockImplementationOnce(base).mockImplementationOnce(() => { requested.resolve(); return pending.promise; });
  const background = session.refresh(); await requested.promise;
  meta.sharedContactRange = null; await session.resume();
  pending.resolve(stale); await background;
  expect(session.getSnapshot().chat?.sharedContactRange).toBeUndefined();
});
it('clears the visible range on resume uncertainty and restores only from a successful refresh', async () => {
  const { session, request } = activeChat();
  await session.refresh();
  request.mockRejectedValueOnce(new ApiError('network'));
  await session.resume();
  expect(session.getSnapshot().chat?.sharedContactRange).toBeUndefined();
  await session.refresh();
  expect(session.getSnapshot().chat?.sharedContactRange).toBe('ONE_TO_FIVE');
  request.mockRejectedValueOnce(new ApiError('backend', 409, 'USER_PAIR_BLOCKED'));
  await act(() => session.refresh());
  expect(session.getSnapshot().chat?.sharedContactRange).toBeUndefined();
});



it('retires the range on a terminal match or disposal', async () => {
  const { session, request } = activeChat();
  await session.refresh();
  request.mockResolvedValueOnce({ id: 'm', userAId: 'me', userBId: 'them', state: 'EXPIRED' });
  await session.refresh();
  expect(session.getSnapshot().chat?.sharedContactRange).toBeUndefined();
  const second = activeChat(); await second.session.refresh(); second.session.dispose();
  expect(second.session.getSnapshot().chat?.sharedContactRange).toBeUndefined();
});
