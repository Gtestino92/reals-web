import { expect, it, vi } from 'vitest';
import { SecondChatSession } from './SecondChatSession';
import { secondHarness } from './secondFixtures';
import { messageFixture } from './fixtures';
import { ApiError } from '../auth/api';
function harness() { const h=secondHarness(); const session=new SecondChatSession(h.controller,'connection','m','me');return {...h,session}; }
const writes=(h:ReturnType<typeof harness>)=>h.request.mock.calls.filter(([, ,method])=>method&&method!=='GET');
it('polling and previews never join',async()=>{const h=harness();h.status.canJoin=true;h.status.myAttendanceStatus='PENDING';await h.session.refresh();await h.session.refresh();expect(writes(h)).toHaveLength(0);});
it('joins only after a user action and fresh eligibility; reconciles uncertain attendance',async()=>{
  const h=harness();h.status.canJoin=true;h.status.myAttendanceStatus='PENDING';await h.session.refresh();const base=h.request.getMockImplementation()!;
  h.request.mockImplementation(async(...args)=>{if(args[0].endsWith('/join')){h.status.canJoin=false;h.status.myAttendanceStatus='LATE';throw new ApiError('network');}return base(...args);});
  await h.session.join();await h.session.join();expect(writes(h)).toHaveLength(1);expect(h.session.getSnapshot().status?.myAttendanceStatus).toBe('LATE');
});
it('serializes completion against concurrent sends and never replays resolution POSTs',async()=>{
  const h=harness();await h.session.refresh();const base=h.request.getMockImplementation()!;let resolve: (()=>void)|undefined;
  h.request.mockImplementation(async(...args)=>{if(args[0].endsWith('/completion-requests')){await new Promise<void>(r=>{resolve=r;});throw new ApiError('network');}return base(...args);});
  const first=h.session.action('completion');void h.session.send('Hola',null);void h.session.action('inactivity');await h.session.refresh();expect(h.session.getSnapshot().busy).toBe(true);resolve?.();await first;expect(writes(h)).toHaveLength(1);expect(h.session.getSnapshot().error).toContain('confirmar');
});
it('confirms text via stable UUID and reconciles ambiguous committed sends before retry',async()=>{
  const h=harness();await h.session.refresh();const base=h.request.getMockImplementation()!;
  h.request.mockImplementation(async(...args)=>{const result=await base(...args);if(args[2]==='POST'&&args[0].endsWith('/messages'))throw new ApiError('network');return result;});
  await h.session.send('Hola',null);expect(h.session.getSnapshot().outgoing).toBeNull();await h.session.retry();expect(writes(h)).toHaveLength(1);expect(h.session.getSnapshot().confirmationVersion).toBe(1);
});
it('retains uncertain payload UUID on same-target retry',async()=>{
  const h=harness();await h.session.refresh();const base=h.request.getMockImplementation()!;let fail=true;
  h.request.mockImplementation(async(...args)=>{if(fail&&args[2]==='POST'){fail=false;throw new ApiError('network');}return base(...args);});
  await h.session.send('Hola',null);const id=h.session.getSnapshot().outgoing?.clientMessageId;expect(id).toBeTruthy();await h.session.retry();const bodies=writes(h).map(c=>c[3]);expect(bodies[0]).toEqual(bodies[1]);expect(h.session.getSnapshot().outgoing).toBeNull();
});
it('rejects own replies and guidance; permits partner message replies',async()=>{const h=harness();h.messages.push(messageFixture('1','me'),messageFixture('2','them'));await h.session.refresh();await h.session.send('Hola',{type:'MESSAGE',targetId:'1'});await h.session.send('Hola',{type:'GUIDANCE_QUESTION',targetId:'q'});expect(writes(h)).toHaveLength(0);await h.session.send('Hola',{type:'MESSAGE',targetId:'2'});expect(writes(h)).toHaveLength(1);});
it.each(['requester','responder'] as const)('completion decision restricts %s role and deadline',async role=>{
 const h=harness();h.status.activeResolutionRequest={id:'r',type:'MUTUAL_COMPLETION',status:'PENDING',requesterUserId:role==='requester'?'me':'them',responderUserId:role==='responder'?'me':'them',referenceMessageId:null,createdAt:h.status.serverTime,expiresAt:'2026-11-13T12:13:00Z'};await h.session.refresh();await h.session.action('ACCEPTED');expect(writes(h)).toHaveLength(role==='responder'?1:0);
});
it('rejects stale reads after disposal and restart',async()=>{
  const h=harness();const base=h.request.getMockImplementation()!;let resolve: (()=>void)|undefined;
  h.request.mockImplementation(async(...args)=>{if(args[0].endsWith('/status'))await new Promise<void>(r=>{resolve=r;});return base(...args);});
  const read=h.session.refresh();await vi.waitFor(()=>expect(resolve).toBeDefined());h.session.dispose();resolve?.();await read;expect(h.session.getSnapshot().status).toBeNull();
});
it('withdraws retained messages at cutoff and prohibits writes',async()=>{const h=harness();h.status.chatStatus='FINISHED';h.status.readOnlyUntil='2026-11-13T12:13:00Z';h.messages.push(messageFixture('1','them'));await h.session.refresh();expect(h.session.getSnapshot().messages).toHaveLength(1);h.status.serverTime='2026-11-13T12:13:00Z';await h.session.refresh();expect(h.session.getSnapshot().messages).toHaveLength(0);await h.session.send('Hola',null);expect(writes(h)).toHaveLength(0);});
it('locks entry navigation synchronously through the status preflight',async()=>{
 const h=harness();h.status.canJoin=true;h.status.myAttendanceStatus='PENDING';await h.session.refresh();const base=h.request.getMockImplementation()!;let finish:(()=>void)|undefined;
 h.request.mockImplementation(async(...args)=>{if(args[0].endsWith('/status'))await new Promise<void>(r=>{finish=r;});return base(...args);});
 const entry=h.session.join();expect(h.session.getSnapshot().busy).toBe(true);await h.session.join();await h.session.action('block');expect(writes(h)).toHaveLength(0);
 await vi.waitFor(()=>expect(finish).toBeDefined());h.request.mockImplementation(base);finish?.();await entry;expect(writes(h)).toHaveLength(1);expect(h.session.getSnapshot().busy).toBe(false);
});
