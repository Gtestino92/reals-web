import { describe, expect, it, vi } from 'vitest';
import { ApiClient, ApiError } from '../auth/api';
import { SessionController } from '../auth/session';
import type { AuthService, Identity } from '../auth/firebase';
import { TabOwnershipManager } from '../tabs/TabOwnershipManager';
import { ChatSession } from './ChatSession';
import { SecondChatSession } from './SecondChatSession';
import { chatFixture, messageFixture } from './fixtures';
import { secondHarness } from './secondFixtures';

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const audio = (id: string, senderId: string) => ({
  ...messageFixture(id, senderId), messageType: 'AUDIO', content: null,
  audio: { url: `https://media.example.test/${id}`, durationMillis: 1000, sizeBytes: 10, contentType: 'audio/mp4' },
});
const history = (body: unknown, access: string | null = 'ALLOWED') => Response.json(body, {
  headers: access === null ? {} : { 'X-Reals-Counterpart-Audio-Access': access },
});
function harness(kind: 'first' | 'second') {
  const h = secondHarness();
  const fetcher = vi.fn<typeof fetch>();
  const api = new ApiClient(fetcher);
  const base = h.request.getMockImplementation()!;
  h.request.mockImplementation((...args) => {
    const [path, signal, method, body, access] = args;
    if (access) return api.request(path, signal, undefined, method, body, undefined, true, undefined, access);
    if (kind === 'first') {
      if (path === '/matches/m') return Promise.resolve({ id:'m', userAId:'me', userBId:'them', state:'CHAT_ACTIVE' });
      if (path === '/matches/m/chat') return Promise.resolve(chatFixture());
      if (path.endsWith('/exit-requests')) return Promise.resolve([]);
    }
    return base(...args);
  });
  const session = kind === 'first' ? new ChatSession(h.controller,'m','c','me',vi.fn()) : new SecondChatSession(h.controller,'connection','m','me');
  const rows = [{...messageFixture('1'), reactionType:'HEART'}, audio('2','me'), audio('3','them')];
  fetcher.mockResolvedValueOnce(history(rows));
  return { ...h, fetcher, session, rows, ids: () => session.getSnapshot().messages.map(m => m.id) };
}
describe.each(['first','second'] as const)('%s chat participant media', kind => {
  it('retains an omitted authorized row, retires it on restriction, and rejects contradictory history and HEART rows', async () => {
    const h = harness(kind);
    await h.session.refresh(true);
    expect(h.ids()).toEqual(['1','2','3']);
    h.fetcher.mockResolvedValueOnce(history([]));
    await h.session.refresh(true);
    expect(h.ids()).toEqual(['1','2','3']);
    h.fetcher.mockResolvedValueOnce(history(h.rows,'RESTRICTED'));
    await h.session.refresh(true);
    expect(h.ids()).toEqual(['1','2']);
    expect(h.session.getSnapshot().messages[0]?.reactionType).toBe('HEART');
    expect(h.session.eligible.size).toBe(0);
    h.fetcher.mockResolvedValueOnce(history([...h.rows,messageFixture('4')]));
    await h.session.refresh(true);
    expect(h.ids()).toEqual(['1','2','4']);
    const base = h.request.getMockImplementation()!;
    h.request.mockImplementation((...args) => args[2] === 'PUT' ? Promise.resolve(h.rows[2]) : base(...args));
    h.fetcher.mockResolvedValueOnce(history([]));
    await h.session.react('4');
    expect(h.ids()).toEqual(['1','2','4']);
    expect(h.session.getSnapshot().audioAccess).toBe('RESTRICTED');
  });

  it.each([null, 'allowed', 'ALLOWED, RESTRICTED'])('fails closed on header %s and recovers only fresh media', async access => {
    const h = harness(kind);
    await h.session.refresh(true);
    h.fetcher.mockResolvedValueOnce(history([audio('3','them')],access));
    await h.session.refresh();
    expect(h.session.getSnapshot().audioAccess).toBe('UNKNOWN');
    expect(h.ids()).toEqual(['1','2']);
    h.fetcher.mockResolvedValueOnce(history({messages:[audio('4','them')],hasMore:false}));
    await h.session.refresh();
    expect(h.ids()).toEqual(['1','2','4']);
    expect(h.fetcher.mock.calls.every(([,init]) => init?.cache === 'no-store')).toBe(true);
  });

  it('retires on a later page before a failing continuation and keeps the raw cursor', async () => {
    const h = harness(kind);
    await h.session.refresh(true);
    const pending = deferred<Response>();
    h.fetcher.mockResolvedValueOnce(history({messages:[audio('4','them')],hasMore:true}))
      .mockResolvedValueOnce(history({messages:[audio('5','them')],hasMore:true},'RESTRICTED'))
      .mockReturnValueOnce(pending.promise);
    const read = h.session.refresh();
    await vi.waitFor(() => expect(h.fetcher.mock.lastCall?.[0]).toContain('after=5'));
    expect(h.ids()).toEqual(['1','2']);
    pending.reject(Error('synthetic'));
    await read;
    expect(h.session.getSnapshot()).toMatchObject({audioAccess:'RESTRICTED',blocked:true});
  });

  it.each(['renewal','HEART'])('retires on owned USER_PAIR_BLOCKED during %s', async path => {
    const h = harness(kind);
    await h.session.refresh(true);
    if (path === 'HEART') {
      const base = h.request.getMockImplementation()!;
      h.request.mockImplementation((...args) => args[2] === 'PUT' ? Promise.reject(new ApiError('backend',409,'USER_PAIR_BLOCKED')) : base(...args));
      h.fetcher.mockResolvedValueOnce(history(h.rows));
      await h.session.react('3');
    } else {
      h.fetcher.mockResolvedValueOnce(Response.json({code:'USER_PAIR_BLOCKED'},{status:409}));
      expect(await h.session.renewAudio('3')).toBeNull();
    }
    expect(h.session.getSnapshot().audioAccess).toBe('RESTRICTED');
    expect(h.ids()).toEqual(['1','2']);
  });

  it('keeps an uncertain mutation and its exact reply payload across access withdrawal', async () => {
    const h = harness(kind);
    await h.session.refresh(true);
    const base = h.request.getMockImplementation()!;
    h.request.mockImplementation((...args) => args[2] === 'POST' ? Promise.reject(new ApiError('network')) : base(...args));
    h.fetcher.mockResolvedValueOnce(history([], 'RESTRICTED'));
    const reply = {type:'MESSAGE' as const,targetId:'3'};
    await h.session.send('Synthetic draft',reply);
    const writes = h.request.mock.calls.filter(([, ,method]) => method === 'POST');
    expect(writes).toHaveLength(1);
    expect(h.ids()).toEqual(['1','2']);
    expect(h.session.getSnapshot().outgoing).toMatchObject({content:'Synthetic draft',replyTo:reply,phase:'uncertain'});
    expect(writes[0]?.[3]).toMatchObject({clientMessageId:h.session.getSnapshot().outgoing?.clientMessageId,replyTo:reply});
  });

  it('keeps the latest incoming sender boundary when its only message becomes invisible', async () => {
    const h = harness(kind);
    await h.session.refresh();
    h.fetcher.mockResolvedValueOnce(history([messageFixture('4'),messageFixture('5','me'),audio('6','them')]));
    await h.session.refresh(true);
    expect([...h.session.eligible]).toEqual(['6']);
    h.fetcher.mockResolvedValueOnce(history([], 'RESTRICTED'));
    await h.session.refresh(true);
    expect(h.ids()).toContain('4');
    expect(h.session.eligible.has('4')).toBe(false);
  });

  it('ignores a superseded response and a delayed response after disposal', async () => {
    const h = harness(kind);
    await h.session.refresh(true);
    const old = deferred<Response>();
    h.fetcher.mockReturnValueOnce(old.promise).mockResolvedValueOnce(history([], 'RESTRICTED'));
    const poll = h.session.refresh();
    await vi.waitFor(() => expect(h.fetcher).toHaveBeenCalledTimes(2));
    await h.session.resume();
    old.resolve(history(h.rows));
    await poll;
    expect(h.ids()).toEqual(['1','2']);
    const late = deferred<Response>();
    h.fetcher.mockReturnValueOnce(late.promise);
    const renewal = h.session.renewAudio('2');
    await vi.waitFor(() => expect(h.fetcher).toHaveBeenCalledTimes(4));
    h.session.dispose();
    late.resolve(history(h.rows));
    expect(await renewal).toBeNull();
    expect(h.ids()).toEqual([]);
  });
});
it('retires on an empty history response before the parallel exit request finishes', async () => {
  const h = harness('first');
  await h.session.refresh(true);
  const exits = deferred<unknown>();
  const base = h.request.getMockImplementation()!;
  h.request.mockImplementation((...args) => args[0].endsWith('/exit-requests') ? exits.promise : base(...args));
  h.fetcher.mockResolvedValueOnce(history({messages:[],hasMore:false},'RESTRICTED'));
  const read = h.session.refresh();
  await vi.waitFor(() => expect(h.ids()).toEqual(['1','2']));
  exits.reject(Error('synthetic'));
  await read;
  expect(h.session.getSnapshot().audioAccess).toBe('RESTRICTED');
});

it.each(['logout','account replacement','tab transfer'])('rejects history metadata and body after %s in the authenticated transport', async loss => {
  let observer!: (identity: Identity | null) => void;
  const auth: AuthService = {
    observe: fn => { observer = fn; return () => {}; },
    signIn:vi.fn(), signUp:vi.fn(), google:vi.fn(), verify:vi.fn(), signOut:vi.fn().mockResolvedValue(undefined),
  };
  const user = { uid:'synthetic', emailVerified:true, getIdToken:vi.fn().mockResolvedValue('synthetic'), reload:vi.fn() };
  const lease = new TabOwnershipManager();
  vi.spyOn(lease,'getSnapshot').mockReturnValue('active');
  vi.spyOn(lease,'assert').mockImplementation(() => {});
  const fetcher = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({id:'me',status:'ACTIVE'}))
    .mockResolvedValueOnce(Response.json({id:'p',userId:'me',status:'ACTIVE'}));
  const controller = new SessionController(auth,new ApiClient(fetcher).withOwnership(lease),false,lease);
  const unsubscribe = controller.subscribe(() => {});
  observer(user);
  await vi.waitFor(() => expect(controller.snapshot.phase).toBe('ready'));
  const signal = new AbortController().signal;
  const access = vi.fn();
  fetcher.mockResolvedValueOnce(history([]));
  await expect(controller.request('/chats/c/messages',signal,'GET',undefined,access)).resolves.toEqual([]);
  expect(access).toHaveBeenCalledExactlyOnceWith('ALLOWED');
  const pending = deferred<Response>();
  fetcher.mockReturnValueOnce(pending.promise);
  const read = controller.request('/chats/c/messages?after=1',signal,'GET',undefined,access);
  await vi.waitFor(() => expect(String(fetcher.mock.lastCall?.[0])).toContain('?after=1'));
  if (loss === 'logout') controller.signOut();
  if (loss === 'tab transfer') lease.stop();
  if (loss === 'account replacement') {
    fetcher.mockResolvedValueOnce(Response.json({code:'UNAVAILABLE'},{status:503}));
    observer({...user,uid:'replacement'});
  }
  pending.resolve(history([audio('3','them')],'RESTRICTED'));
  await expect(read).rejects.toMatchObject({name:'AbortError'});
  expect(access).toHaveBeenCalledTimes(1);
  unsubscribe();
});
