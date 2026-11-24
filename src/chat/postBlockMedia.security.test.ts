import { expect, it, vi } from 'vitest';
import { ChatSession } from './ChatSession';
import { SecondChatSession } from './SecondChatSession';
import { chatFixture, controllerFixture, messageFixture } from './fixtures';
import { secondHarness } from './secondFixtures';

const audio = (id: string, senderId: string) => ({
  ...messageFixture(id, senderId), messageType: 'AUDIO', content: null,
  audio: { url: `https://media.example.test/${id}`, durationMillis: 1000, sizeBytes: 10, contentType: 'audio/mp4' },
});

// These expected failures record the current client boundary without changing production code.
// Remove .fails when the blocked-history reconciliation is implemented.
it.fails('first chat retires previously loaded counterpart audio after an authoritative full page omits it', async () => {
  const controller = controllerFixture();
  let rows = [messageFixture('1'), audio('2', 'them'), audio('3', 'me')];
  vi.spyOn(controller, 'request').mockImplementation(async path => {
    if (path === '/matches/m') return { id: 'm', userAId: 'me', userBId: 'them', state: 'CHAT_ACTIVE' };
    if (path === '/matches/m/chat') return chatFixture();
    if (path === '/chats/c/exit-requests') return [];
    if (path.startsWith('/chats/c/messages?')) return rows;
    throw Error('Unexpected request');
  });
  const session = new ChatSession(controller, 'm', 'c', 'me', vi.fn());
  await session.refresh(true);
  expect(session.getSnapshot().messages.map(message => message.id)).toEqual(['1', '2', '3']);
  rows = [rows[0]!, rows[2]!];
  await session.refresh(true);
  expect(session.getSnapshot().error).toBe('');
  expect(session.getSnapshot().messages.map(message => message.id)).toEqual(['1', '3']);
  session.dispose();
});

it.fails('second chat retires counterpart audio while preserving text and own audio after a full page omits it', async () => {
  const h = secondHarness();
  h.messages.push(messageFixture('1'), audio('2', 'them'), audio('3', 'me'));
  const session = new SecondChatSession(h.controller, 'connection', 'm', 'me');
  await session.refresh(true);
  expect(session.getSnapshot().messages.map(message => message.id)).toEqual(['1', '2', '3']);
  h.messages.splice(1, 1);
  await session.refresh(true);
  expect(session.getSnapshot().error).toBe('');
  expect(session.getSnapshot().messages.map(message => message.id)).toEqual(['1', '3']);
  session.dispose();
});
