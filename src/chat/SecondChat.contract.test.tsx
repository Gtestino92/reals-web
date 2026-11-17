import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ApiError } from '../auth/api';
import { SecondChat } from './SecondChat';
import { SecondChatEntryIntent, SecondChatSession } from './SecondChatSession';
import { messageFixture } from './fixtures';
import { secondChatResponse, secondHarness } from './secondFixtures';

const joins = (h: ReturnType<typeof secondHarness>) => h.request.mock.calls.filter(c => c[0].endsWith('/join'));

it('loads backend ChatResponse without partner through explicit entry, messages and both participants joining', async () => {
  const a = secondHarness(), b = secondHarness();
  b.controller.snapshot = { ...b.controller.snapshot, account: { id: 'them', status: 'ACTIVE' } };
  for (const h of [a,b]) Object.assign(h.status,{ chatId:null, chatStatus:null, canJoin:true, myAttendanceStatus:'PENDING', myJoinedAt:null, partnerAttendanceStatus:'PENDING', partnerJoinedAt:null, conversationStartedAt:null });
  const first = new SecondChatSession(a.controller,'connection','m','me','Nombre de Home');
  const second = new SecondChatSession(b.controller,'connection','m','them','Otro nombre');
  expect(secondChatResponse()).not.toHaveProperty('partner');
  await first.refresh();
  expect(joins(a)).toHaveLength(0);
  await first.openFromUserAction(new SecondChatEntryIntent(a.controller,'connection','m'));
  expect(first.getSnapshot()).toMatchObject({blocked:false,error:'',partnerId:'them',partnerName:'Nombre de Home',status:{myAttendanceStatus:'LATE',partnerAttendanceStatus:'PENDING'}});
  Object.assign(b.status,{chatId:'c',chatStatus:'ACTIVE',partnerAttendanceStatus:'LATE',partnerJoinedAt:a.status.myJoinedAt});
  await second.openFromUserAction(new SecondChatEntryIntent(b.controller,'connection','m'));
  Object.assign(a.status,{partnerAttendanceStatus:'LATE',partnerJoinedAt:b.status.myJoinedAt});
  const message = messageFixture('1','them');
  a.messages.push(message); b.messages.push(message);
  await first.refresh(); await second.refresh();
  for (const session of [first,second]) {
    expect(session.getSnapshot()).toMatchObject({blocked:false,error:'',messages:[message],status:{myAttendanceStatus:'LATE',partnerAttendanceStatus:'LATE'}});
    expect(session.rules.writable).toBe(true);
  }
  expect(joins(a)).toHaveLength(1); expect(joins(b)).toHaveLength(1);
  expect(a.request.mock.calls.map(c=>c[0])).toContain('/chats/c/messages?limit=500');
});

it.each(['id','matchId','connectionId','chatType'] as const)('still rejects ChatResponse with incorrect %s', async field => {
  const h=secondHarness(), base=h.request.getMockImplementation()!;
  h.request.mockImplementation(async (...args) => args[0]==='/chats/c' ? {...secondChatResponse(),[field]:'foreign'} : base(...args));
  const session=new SecondChatSession(h.controller,'connection','m','me');await session.refresh();
  expect(session.getSnapshot()).toMatchObject({blocked:true,diagnostic:{stage:'chat',kind:'invalid',httpStatus:0},messages:[]});
});

it.each(['status','chat','messages'] as const)('preserves confirmed JOIN across subsequent %s failure and never replays it', async stage => {
  const h=secondHarness(),base=h.request.getMockImplementation()!;
  Object.assign(h.status,{chatId:null,chatStatus:null,canJoin:true,myAttendanceStatus:'PENDING',myJoinedAt:null});
  let joined=false,fail=true;
  h.request.mockImplementation(async (...args) => {
    if(args[0].endsWith('/join')) { const result=await base(...args);joined=true;return result; }
    if(joined && fail && (stage==='status'?args[0].endsWith('/status'):stage==='chat'?args[0]==='/chats/c':args[0].includes('/messages?'))) {
      if(stage==='status')throw new ApiError('network');
      return {invalid:'private payload must not be retained'};
    }
    return base(...args);
  });
  const session=new SecondChatSession(h.controller,'connection','m','me');
  const intent=new SecondChatEntryIntent(h.controller,'connection','m');await session.openFromUserAction(intent);
  expect(session.getSnapshot()).toMatchObject({blocked:true,busy:false,status:{myAttendanceStatus:'LATE',canJoin:false},diagnostic:{stage,kind:stage==='status'?'network':'invalid',httpStatus:0}});
  await session.join();expect(joins(h)).toHaveLength(1);
  fail=false;await session.refresh(true);await session.join();await session.openFromUserAction(intent);
  expect(session.getSnapshot()).toMatchObject({blocked:false,error:'',diagnostic:null});expect(joins(h)).toHaveLength(1);
});

it('validates malformed JOIN results and reconciles committed attendance without replay', async () => {
  const h=secondHarness(),base=h.request.getMockImplementation()!;
  Object.assign(h.status,{canJoin:true,myAttendanceStatus:'PENDING'});
  h.request.mockImplementation(async (...args) => { const result=await base(...args);return args[0].endsWith('/join')?{}:result; });
  const session=new SecondChatSession(h.controller,'connection','m','me');
  await session.openFromUserAction(new SecondChatEntryIntent(h.controller,'connection','m'));
  expect(session.getSnapshot()).toMatchObject({blocked:false,status:{myAttendanceStatus:'LATE'},diagnostic:{stage:'action',kind:'invalid',httpStatus:0}});
  await session.join();
  expect(session.getSnapshot().diagnostic).toBeNull();
  expect(joins(h)).toHaveLength(1);
});

it.each(['Nombre <seguro>',null,'   '])('keeps Home name as React text through StrictMode, or falls back safely: %s', async name => {
  const h=secondHarness();
  render(<StrictMode><SecondChat controller={h.controller} connectionId="connection" matchId="m" partnerName={name} onHome={vi.fn()}/></StrictMode>);
  expect(await screen.findByRole('heading',{name:name?.trim() || 'Segundo chat',level:2})).toBeVisible();
  expect(await screen.findByRole('textbox',{name:'Mensaje'})).toBeEnabled();expect(screen.queryByRole('alert')).toBeNull();
});

it('shows safe stage/kind/HTTP diagnostics without exception text or private data', async () => {
  const h=secondHarness(),base=h.request.getMockImplementation()!;
  h.request.mockImplementation(async (...args) => { if(args[0]==='/chats/c')throw new ApiError('backend',503,'SECRET_CODE',{message:'private message, token or URL'});return base(...args); });
  render(<SecondChat controller={h.controller} connectionId="connection" matchId="m" onHome={vi.fn()}/>);
  const alert=await screen.findByRole('alert');expect(alert).toHaveTextContent('second-chat/chat/backend/503');
  expect(alert).not.toHaveTextContent(/SECRET_CODE|private message|token|URL/);
  expect(screen.getByRole('button',{name:'Reintentar conexión'})).toBeEnabled();
});
