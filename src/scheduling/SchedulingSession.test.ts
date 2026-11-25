import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from '../auth/api';
import { SchedulingSession } from './SchedulingSession';
import { setup, proposal, scheduledStep, time } from './fixtures';
const slot='2026-11-15T16:00:00Z';
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
async function ready() {vi.useFakeTimers();vi.setSystemTime(time);const f=setup(),finish=vi.fn(),model=new SchedulingSession(f.controller,'c','m',finish);await model.refresh();return {...f,model,finish};}
it('preserves draft during polling and resets only on round change',async()=>{
 const {model,state}=await ready();model.setDraft([slot]);await model.refresh();expect(model.getSnapshot().draft).toEqual([slot]);state.n={...state.n,roundNumber:2};await model.refresh();expect(model.getSnapshot().draft).toEqual([]);
});
it('uses one snapshot GET for an ordinary negotiation poll',async()=>{
 const {model,request}=await ready();request.mockClear();await model.poll();
 expect(request.mock.calls.map(([path])=>path)).toEqual(['/connections/c/scheduling-snapshot']);
 expect(model.getSnapshot().verified).toBe(true);
});
it('abandons only background reads on hide and preserves snapshot/draft across a fresh resume',async()=>{
 const {model,request}=await ready();model.setDraft([slot]);const base=request.getMockImplementation()!;let reject!:(error:unknown)=>void;
 request.mockReturnValueOnce(new Promise((_,r)=>{reject=r;}));const old=model.poll();const signal=request.mock.calls.at(-1)![1];model.pause();expect(signal.aborted).toBe(true);expect(model.getSnapshot()).toMatchObject({verified:true,busy:false,pending:false,draft:[slot]});request.mockImplementation(base);await model.poll();reject(new ApiError('network'));await old;expect(model.getSnapshot()).toMatchObject({verified:true,busy:false,error:'',draft:[slot]});
});
it('serializes submit, refresh, accept, rejection and block synchronously',async()=>{
 const {model,request,state}=await ready();model.setDraft([slot]);const read=request.getMockImplementation()!;let resolve!:()=>void;
 request.mockImplementation(async(path,signal,method,body)=>{if(method==='POST'){await new Promise<void>(r=>{resolve=r;});state.p=[proposal({userId:'me'})];return state.p;}return read(path,signal,method,body);});
 const first=model.act('submit');await vi.waitFor(()=>expect(resolve).toBeTypeOf('function'));await Promise.all([model.act('submit'),model.act('reject'),model.act('accept','p1'),model.act('block'),model.refresh()]);resolve();await first;
 expect(request.mock.calls.filter(c=>c[2]==='POST')).toHaveLength(1);expect(request.mock.calls.find(c=>c[2]==='POST')?.[3]).toEqual({expectedRoundNumber:1,proposedDateTimes:[slot]});
});
it('never replays uncertain POST and remains guarded until full reconciliation',async()=>{
 const {model,request,state}=await ready();model.setDraft([slot]);const read=request.getMockImplementation()!;let failReads=false;
 request.mockImplementation(async(path,signal,method,body)=>{if(method==='POST'){state.p=[proposal({userId:'me'})];failReads=true;throw new ApiError('network');}if(failReads)throw new ApiError('network');return read(path,signal,method,body);});
 await model.act('submit');expect(model.getSnapshot().uncertain).toBe(true);await model.act('submit');expect(request.mock.calls.filter(c=>c[2]==='POST')).toHaveLength(1);
 failReads=false;await model.refresh();expect(model.getSnapshot().uncertain).toBe(false);expect(model.getSnapshot().proposals).toHaveLength(1);
});
it.each(['CONFIRMED','FAILED'])('installs backend terminal %s after acceptance/rejection',async status=>{
 const {model,state,request}=await ready();state.p=[proposal()];await model.refresh();const read=request.getMockImplementation()!;
 request.mockImplementation(async(path,signal,method,body)=>{if(method==='POST'){state.n={...state.n,status,confirmedDateTime:status==='CONFIRMED'?slot:null};state.c={...state.c,state:status==='CONFIRMED'?'SECOND_CHAT_SCHEDULED':'CLOSED'};return state.n;}return read(path,signal,method,body);});
 await model.act(status==='CONFIRMED'?'accept':'reject','p1');expect(model.getSnapshot().negotiation?.status).toBe(status);expect(model.getSnapshot().verified).toBe(true);
});
it('rejects changed round without posting or replaying',async()=>{
 const {model,state,request}=await ready();model.setDraft([slot]);state.n={...state.n,roundNumber:2};await model.act('submit');expect(request.mock.calls.filter(c=>c[2]==='POST')).toHaveLength(0);expect(model.getSnapshot().error).toMatch(/ronda cambió/);expect(model.getSnapshot().draft).toEqual([]);
});
it('retains newly conflicting draft and disables writes on availability failure',async()=>{
 const {model,request}=await ready();model.setDraft([slot]);request.mockRejectedValue(new ApiError('network'));await model.refresh();expect(model.getSnapshot().draft).toEqual([slot]);expect(model.getSnapshot().verified).toBe(false);await model.act('submit');expect(request.mock.calls.filter(c=>c[2]==='POST')).toHaveLength(0);
});
it.each(['account replacement','logout','owner disposal'])('ignores a complete deferred poll after %s',async reason=>{
 const {model,controller,request,snapshot}=await ready();
 const pending=deferred<unknown>();
 request.mockReturnValueOnce(pending.promise);
 const poll=model.poll(),old=snapshot(),before=model.getSnapshot();
 if(reason==='account replacement')controller.snapshot={...controller.snapshot,account:{id:'replacement',status:'ACTIVE'}};
 else if(reason==='logout')controller.snapshot={...controller.snapshot,phase:'login',account:null,profile:null};
 else model.dispose(); // Both navigation and the inactive TabGate unmount the scheduling owner.
 pending.resolve({...old,connection:{...old.connection,state:'CLOSED'}});
 await poll;
 expect(model.getSnapshot().connection).toBe(before.connection);
 expect(model.getSnapshot().terminal).toBe(false);
});
it.each([new ApiError('invalid',404),new ApiError('backend',404,'RESOURCE_NOT_FOUND',{message:'Resource not found'}),new ApiError('backend',503)])('recovers from an unavailable snapshot endpoint',async error=>{
 const {model,request}=await ready();request.mockClear();request.mockRejectedValueOnce(error);
 await model.poll();expect(model.getSnapshot()).toMatchObject({verified:false,terminal:false,availability:null});
 expect(request.mock.calls.map(([path])=>path)).toEqual(['/connections/c/scheduling-snapshot']);
 await model.refresh();expect(model.getSnapshot().verified).toBe(true);
});
it('handles activation pending without failed negotiation',async()=>{
 const {model,state}=await ready();state.c={...state.c,state:'SCHEDULING_PENDING'};await model.refresh();expect(model.getSnapshot().negotiation).toBeNull();expect(model.getSnapshot().connection?.state).toBe('SCHEDULING_PENDING');
});

it('does not release a replacement refresh gate when an obsolete read fails',async()=>{
 const {model,request}=await ready();const read=request.getMockImplementation()!;let reject!:(e:unknown)=>void,resolve!:(v:unknown)=>void;
 request.mockReturnValueOnce(new Promise((_,r)=>{reject=r;}));const old=model.refresh();model.dispose();model.start();
 request.mockReturnValueOnce(new Promise(r=>{resolve=r;}));const fresh=model.refresh();reject(new ApiError('network'));await old;
 const count=request.mock.calls.length;await model.refresh();expect(request.mock.calls).toHaveLength(count);expect(model.getSnapshot().busy).toBe(true);
 resolve(await read('/connections/c/scheduling-snapshot',new AbortController().signal));await fresh;expect(model.getSnapshot().verified).toBe(true);
});
it('locks navigation synchronously before the first await',async()=>{
 vi.useFakeTimers();vi.setSystemTime(time);const f=setup(),lock=vi.fn(),model=new SchedulingSession(f.controller,'c','m',vi.fn(),lock);await model.refresh();model.setDraft([slot]);
 const action=model.act('submit');expect(lock).toHaveBeenCalledWith(true);await action;expect(lock).toHaveBeenLastCalledWith(false);
});
it('rejects contradictory snapshots instead of installing mixed rounds',async()=>{
 const {model,state}=await ready();state.p=[proposal({roundNumber:2})];
 await model.refresh();expect(model.getSnapshot().verified).toBe(false);expect(model.getSnapshot().negotiation?.roundNumber).toBe(1);
});
it('revalidates newly conflicting drafts and does not post',async()=>{
 const {model,state,request}=await ready();model.setDraft([slot]);state.a={...state.a,unavailableWindows:[{startsAt:slot,endsAt:slot}]};
 await model.act('submit');expect(model.getSnapshot().draft).toEqual([slot]);expect(model.getSnapshot().error).toMatch(/superponen/);expect(request.mock.calls.filter(c=>c[2]==='POST')).toHaveLength(0);
});
it('installs automatic agreement after submit without creating a chat',async()=>{
 const {model,state,request}=await ready();model.setDraft([slot]);const read=request.getMockImplementation()!;
 request.mockImplementation(async(path,...args)=>{if(args[1]==='POST'){state.n={...state.n,status:'CONFIRMED',confirmedDateTime:slot};state.c={...state.c,state:'SECOND_CHAT_SCHEDULED'};state.p=[proposal({userId:'me',status:'ACCEPTED'})];return state.p;}return read(path,...args);});
 await model.act('submit');expect(model.getSnapshot().negotiation?.status).toBe('CONFIRMED');expect(request.mock.calls.filter(c=>c[2]==='POST')).toHaveLength(1);expect(request).toHaveBeenCalledWith('/me/home',expect.any(AbortSignal));
});
it.each([1,2])('rejects a partner list before own submission, server round %i',async nextRound=>{
 const {model,state,request}=await ready();state.p=[proposal()];await model.refresh();const read=request.getMockImplementation()!;
 request.mockImplementation(async(path,...args)=>{if(args[1]==='POST'){state.p=[proposal({status:'REJECTED'})];state.n={...state.n,roundNumber:nextRound};return state.n;}return read(path,...args);});
 await model.act('reject');expect(model.getSnapshot().negotiation?.roundNumber).toBe(nextRound);expect(request.mock.calls.find(c=>c[2]==='POST')?.[3]).toEqual({expectedRoundNumber:1});
});
it.each(['SCHEDULING_NOT_AVAILABLE','SCHEDULING_EXPIRED','SCHEDULING_INVALID_PROPOSALS','SCHEDULING_PROPOSALS_ALREADY_SUBMITTED','SCHEDULING_ROUND_CHANGED','SCHEDULING_PARTNER_PROPOSALS_NOT_AVAILABLE','SCHEDULING_PROPOSAL_NOT_AVAILABLE','SCHEDULING_CANNOT_ACCEPT_OWN_PROPOSAL','SCHEDULING_SLOT_CONFLICT','LEGAL_ACTION_REQUIRED'])('reconciles %s without replaying',async code=>{
 const {model,request}=await ready();model.setDraft([slot]);const read=request.getMockImplementation()!;
 request.mockImplementation(async(path,...args)=>{if(args[1]==='POST')throw new ApiError('backend',409,code);return read(path,...args);});
 await model.act('submit');expect(model.getSnapshot().error).not.toBe('');expect(model.getSnapshot().verified).toBe(true);expect(request.mock.calls.filter(c=>c[2]==='POST')).toHaveLength(1);
});
it.each([401,403,404])('fails closed on authorization read %i',async status=>{
 const {model,request}=await ready();request.mockRejectedValue(new ApiError('backend',status));await model.refresh();expect(model.getSnapshot().terminal).toBe(true);await model.act('block');expect(request.mock.calls.filter(c=>c[2]==='POST')).toHaveLength(0);
});
it('never accepts an own proposal',async()=>{
 const {model,state,request}=await ready();state.p=[proposal({userId:'me'})];await model.refresh();await model.act('accept','p1');expect(request.mock.calls.filter(c=>c[2]==='POST')).toHaveLength(0);
});

it('respects authoritative closure without inventing negotiation failure',async()=>{
 const {model,state}=await ready();state.c={...state.c,state:'CLOSED'};await model.refresh();expect(model.getSnapshot().terminal).toBe(true);expect(model.getSnapshot().negotiation?.status).toBe('PENDING');
});


function deferred<T>() {let resolve!:(v:T)=>void, reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
it('keeps a slow poll editable and retains one guarded GET per complete snapshot',async()=>{
 const {model,request,state}=await ready();request.mockClear();const slow=deferred<unknown>();request.mockReturnValueOnce(slow.promise);
 const poll=model.poll();expect(model.getSnapshot()).toMatchObject({activity:'polling',busy:false,verified:true,pending:false});
 model.setDraft([slot]);slow.resolve({connection:state.c,negotiation:state.n,proposals:state.p,availability:state.a,serverTime:state.a.serverTime});await poll;
 expect(model.getSnapshot().draft).toEqual([slot]);expect(request).toHaveBeenCalledTimes(1);expect(model.getSnapshot().activity).toBe('idle');
});
it.each(['submit','accept','reject','block'] as const)('prioritizes %s over an ignored-abort poll and retains the mutation navigation lock',async operation=>{
 vi.useFakeTimers();vi.setSystemTime(time);const f=setup(),lock=vi.fn(),model=new SchedulingSession(f.controller,'c','m',vi.fn(),lock);await model.refresh();
 if(operation==='accept'||operation==='reject'){f.state.p=[proposal()];await model.refresh();}else model.setDraft([slot]);
 const read=f.request.getMockImplementation()!, stale=deferred<unknown>(),write=deferred<unknown>();
 f.request.mockReturnValueOnce(stale.promise);const poll=model.poll();const signal=f.request.mock.calls.at(-1)![1];
 f.request.mockImplementation(async(path,abort,method,body)=>method==='POST'?write.promise:read(path,abort,method,body));
 const action=model.act(operation,'p1');expect(signal?.aborted).toBe(true);expect(lock).toHaveBeenLastCalledWith(true);
 await vi.waitFor(()=>expect(f.request.mock.calls.some(c=>c[2]==='POST')).toBe(true));
 stale.resolve({...f.snapshot(),connection:{...f.state.c,state:'CLOSED'}});await poll;
 expect(model.getSnapshot()).toMatchObject({activity:'mutating',pending:true,busy:true});expect(lock).toHaveBeenLastCalledWith(true);
 await model.act(operation,'p1');await model.poll();expect(f.request.mock.calls.filter(c=>c[2]==='POST')).toHaveLength(1);
 write.resolve(operation==='submit'?[]:operation==='block'?{id:'block'}:f.state.n);await action;expect(lock).toHaveBeenLastCalledWith(false);
});
it('discards a stale poll after a completed mutation and does not continue its GET chain',async()=>{
 const {model,request,state,snapshot}=await ready();model.setDraft([slot]);const before=snapshot(),read=request.getMockImplementation()!,stale=deferred<unknown>();
 request.mockReturnValueOnce(stale.promise);const poll=model.poll();
 request.mockImplementation(async(path,signal,method,body)=>{if(method==='POST'){state.p=[proposal({userId:'me'})];state.n={...state.n,status:'CONFIRMED',confirmedDateTime:slot};state.c={...state.c,state:'SECOND_CHAT_SCHEDULED'};return state.p;}return read(path,signal,method,body);});
 await model.act('submit');const count=request.mock.calls.length;stale.resolve(before);await poll;
 expect(request.mock.calls).toHaveLength(count);expect(model.getSnapshot().negotiation?.status).toBe('CONFIRMED');expect(model.getSnapshot().proposals).toEqual(state.p);expect(model.getSnapshot().verified).toBe(true);
});
it('refuses to replay against a round changed while a poll yields',async()=>{
 const {model,request,state}=await ready();model.setDraft([slot]);const stale=deferred<unknown>();request.mockReturnValueOnce(stale.promise);const poll=model.poll();
 state.n={...state.n,roundNumber:2};await model.act('submit');stale.reject(new ApiError('network'));await poll;
 expect(request.mock.calls.filter(c=>c[2]==='POST')).toHaveLength(0);expect(model.getSnapshot().negotiation?.roundNumber).toBe(2);expect(model.getSnapshot().draft).toEqual([]);expect(model.getSnapshot().error).toMatch(/ronda/);
});
it.each([401,403])('installs background authorization revocation %i and refuses writes',async status=>{
 const {model,request}=await ready();request.mockRejectedValueOnce(new ApiError('backend',status));await model.poll();
 expect(model.getSnapshot()).toMatchObject({verified:false,terminal:true,availability:null});await model.act('block');expect(request.mock.calls.filter(c=>c[2]==='POST')).toHaveLength(0);
});
it('installs a background server-clock expiry and enforces it before POST',async()=>{
 const {model,state,request}=await ready();model.setDraft([slot]);state.a.serverTime='2026-11-16T12:00:00Z';await model.poll();
 expect(model.now()).toBeGreaterThanOrEqual(Date.parse(state.n.schedulingExpiresAt));await model.act('submit');expect(request.mock.calls.filter(c=>c[2]==='POST')).toHaveLength(0);
});
it('a torn background snapshot invalidates write eligibility without installing mixed rounds',async()=>{
 const {model,request,state}=await ready();request.mockResolvedValueOnce({connection:state.c,negotiation:state.n,proposals:state.p,availability:state.a,serverTime:slot});
 await model.poll();expect(model.getSnapshot()).toMatchObject({verified:false,availability:null});expect(model.getSnapshot().negotiation?.roundNumber).toBe(1);
});
it('does not let a poll bypass unresolved uncertain-write reconciliation',async()=>{
 const {model,request}=await ready();model.setDraft([slot]);const read=request.getMockImplementation()!;let failed=false;
 request.mockImplementation(async(path,...args)=>{if(args[1]==='POST'){failed=true;throw new ApiError('network');}if(failed)throw new ApiError('network');return read(path,...args);});await model.act('submit');
 failed=false;const slow=deferred<unknown>();request.mockReturnValueOnce(slow.promise);const recovery=model.poll();expect(model.getSnapshot()).toMatchObject({activity:'reconciling',busy:true,uncertain:true});
 const count=request.mock.calls.length;await model.act('submit');expect(request.mock.calls).toHaveLength(count);slow.resolve(await read('/connections/c/scheduling-snapshot',new AbortController().signal));await recovery;
 expect(model.getSnapshot().uncertain).toBe(false);expect(request.mock.calls.filter(c=>c[2]==='POST')).toHaveLength(1);
});

it.each([
  { connectionId:'other' },
  { matchId:'other' },
  { type:'SECOND_CHAT_AVAILABLE' },
  { type:'SECOND_CHAT_READ_ONLY' },
  { secondChat:{...scheduledStep().secondChat, availableAt:'2026-11-15T15:30:00Z'} },
])('rejects incompatible Home metadata on a confirmed poll (%j)', async override => {
  const {model,state,request}=await ready();
  expect(request.mock.calls.some(([path])=>path==='/me/home')).toBe(false);
  state.n={...state.n,status:'CONFIRMED',confirmedDateTime:slot};
  state.c.state='SECOND_CHAT_SCHEDULED';
  state.home.nextSteps=[scheduledStep()];
  await model.poll();
  expect(model.getSnapshot().calendarActivity?.secondChat?.durationMinutes).toBe(75);
  state.home.nextSteps=[{...scheduledStep(),...override}];
  await model.poll();
  expect(model.getSnapshot()).toMatchObject({verified:true,calendarActivity:null});
});

it.each(['SECOND_CHAT_AVAILABLE','SECOND_CHAT','CLOSED'])('removes metadata when the connection moves to %s', async stateName => {
  const {model,state,request}=await ready();
  state.n={...state.n,status:'CONFIRMED',confirmedDateTime:slot};
  state.c.state='SECOND_CHAT_SCHEDULED';
  state.home.nextSteps=[scheduledStep()];
  await model.poll();
  expect(model.getSnapshot().calendarActivity).not.toBeNull();
  request.mockClear();
  state.c.state=stateName;
  await model.poll();
  expect(model.getSnapshot().calendarActivity).toBeNull();
  expect(request.mock.calls.some(([path])=>path==='/me/home')).toBe(false);
});

it('retains the confirmed schedule when Home omits durationMinutes', async () => {
  const {model,state}=await ready();
  const step=scheduledStep();
  const {availableAt,entryClosesAt,expiresAt,myAttendanceStatus}=step.secondChat;
  state.n={...state.n,status:'CONFIRMED',confirmedDateTime:slot};
  state.c.state='SECOND_CHAT_SCHEDULED';
  state.home.nextSteps=[{...step,secondChat:{availableAt,entryClosesAt,expiresAt,myAttendanceStatus}}];
  await model.poll();
  expect(model.getSnapshot()).toMatchObject({
    verified:true, negotiation:{status:'CONFIRMED'}, calendarActivity:null, calendarReadFailed:true,
  });
});

it('hides Calendar metadata on a failed connection check and restores it from a full reconciliation', async () => {
  const {model,state,request}=await ready();
  state.n={...state.n,status:'CONFIRMED',confirmedDateTime:slot};
  state.c.state='SECOND_CHAT_SCHEDULED';
  state.home.nextSteps=[scheduledStep()];
  await model.poll();
  request.mockClear();
  request.mockRejectedValueOnce(new ApiError('network'));
  await model.tick();
  expect(request.mock.calls.map(([path])=>path)).toEqual(['/connections/c']);
  expect(model.getSnapshot()).toMatchObject({verified:false,terminal:false,calendarActivity:null,negotiation:{status:'CONFIRMED'}});
  expect(model.getSnapshot().error).toContain('Revisá tu conexión');

  request.mockClear();
  await model.tick();
  expect(request).toHaveBeenCalledWith('/me/home',expect.any(AbortSignal));
  expect(model.getSnapshot()).toMatchObject({verified:true,error:'',calendarActivity:{connectionId:'c'}});
});

it('aborts the Calendar connection check on disposal and ignores its result after identity replacement', async () => {
  const {model,state,request,controller}=await ready();
  state.n={...state.n,status:'CONFIRMED',confirmedDateTime:slot};
  state.c.state='SECOND_CHAT_SCHEDULED';
  state.home.nextSteps=[scheduledStep()];
  await model.poll();
  request.mockClear();
  const late=deferred<unknown>();
  request.mockReturnValueOnce(late.promise);
  const poll=model.tick();
  const signal=request.mock.calls[0]?.[1];
  controller.snapshot={...controller.snapshot,phase:'login',account:null,profile:null};
  model.dispose();
  expect(signal?.aborted).toBe(true);
  late.resolve({...state.c,state:'CLOSED'});
  await poll;
  await model.tick();
  expect(request).toHaveBeenCalledTimes(1);
  expect(model.getSnapshot().connection?.state).toBe('SECOND_CHAT_SCHEDULED');
});

it('rejects late Home metadata after a newer foreground read or session replacement', async () => {
  const {model,state,request,controller}=await ready(), read=request.getMockImplementation()!;
  state.n={...state.n,status:'CONFIRMED',confirmedDateTime:slot};
  state.c.state='SECOND_CHAT_SCHEDULED';
  state.home.nextSteps=[scheduledStep()];
  await model.poll();
  const home={...state.home};
  for(const replaceSession of [false,true]){
    const late=deferred<unknown>();
    request.mockImplementation((path,...args)=>path==='/me/home' ? late.promise : read(path,...args));
    request.mockClear();
    const poll=model.poll();
    await vi.waitFor(()=>expect(request).toHaveBeenCalledWith('/me/home',expect.any(AbortSignal)));
    if(replaceSession) {
      controller.snapshot={...controller.snapshot,authContextVersion:2};
      model.dispose();
    } else {
      model.pause();
      state.home.nextSteps=[];
      request.mockImplementation(read);
      await model.poll();
    }
    late.resolve(home);
    await poll;
    expect(model.getSnapshot().calendarActivity).toBeNull();
  }
});

it('waits for authoritative Home after an ambiguous but committed acceptance', async () => {
  const {model,state,request}=await ready(), read=request.getMockImplementation()!;
  state.p=[proposal()];
  await model.poll();
  request.mockImplementation(async(path,signal,method,body)=>{
    if(method==='POST'){
      state.n={...state.n,status:'CONFIRMED',confirmedDateTime:slot};
      state.c.state='SECOND_CHAT_SCHEDULED';
      throw new ApiError('network');
    }
    if(path==='/me/home')throw new ApiError('network');
    return read(path,signal,method,body);
  });
  await model.act('accept','p1');
  expect(model.getSnapshot()).toMatchObject({verified:false,uncertain:true,calendarActivity:null});
  state.home.nextSteps=[scheduledStep()];
  request.mockImplementation(read);
  await model.poll();
  expect(model.getSnapshot()).toMatchObject({verified:true,uncertain:false,calendarActivity:{connectionId:'c',matchId:'m'}});
  expect(request.mock.calls.filter(([, ,method])=>method==='POST')).toHaveLength(1);
});

it.each(['mutation','recovery'] as const)('keeps an owned pair block terminal during %s',async source=>{
 const {model,request}=await ready();model.setDraft([slot]);const read=request.getMockImplementation()!;let attempted=false;
 request.mockImplementation(async(path,signal,method,body)=>{
  if(method==='POST'){attempted=true;throw source==='mutation'?new ApiError('backend',409,'USER_PAIR_BLOCKED'):new ApiError('network');}
  if(attempted)throw new ApiError('backend',409,'USER_PAIR_BLOCKED');
  return read(path,signal,method,body);
 });
 await model.act('submit');expect(model.getSnapshot()).toMatchObject({terminal:true,verified:false,pending:false,busy:false});
 const count=request.mock.calls.length;await model.refresh();await model.poll();await model.act('submit');expect(request).toHaveBeenCalledTimes(count);
});

it('retires access for a missing connection reported by the snapshot endpoint',async()=>{
 const {model,request}=await ready();
 request.mockRejectedValueOnce(new ApiError('backend',404,'RESOURCE_NOT_FOUND',{message:'Connection not found: c'}));
 await model.poll();expect(model.getSnapshot()).toMatchObject({verified:false,terminal:true,availability:null});
});
it.each([
 ['connection ID',{connection:{id:'other'}}],
 ['match ID',{connection:{matchId:'other'}}],
 ['participant identity',{connection:{userAId:'other'}}],
 ['negotiation association',{negotiation:{connectionId:'other'}}],
 ['proposal association',{proposals:[proposal({connectionId:'other'})]}],
 ['proposal author',{proposals:[proposal({userId:'other'})]}],
 ['deadline',{negotiation:{schedulingExpiresAt:slot}}],
 ['lifecycle',{connection:{state:'SECOND_CHAT_SCHEDULED'}}],
 ['pending envelope',{connection:{state:'SCHEDULING_PENDING'}}],
 ['clock',{serverTime:'invalid'}],
] as const)('rejects a snapshot with inconsistent %s before installation',async(_,patch)=>{
 const {model,request,snapshot}=await ready();const before=model.getSnapshot();
 const raw=snapshot();
 request.mockResolvedValueOnce({...raw,...patch,connection:{...raw.connection,...('connection' in patch?patch.connection:{})},
  negotiation:{...raw.negotiation,...('negotiation' in patch?patch.negotiation:{})}});
 await model.poll();
 expect(model.getSnapshot().verified).toBe(false);
 expect(model.getSnapshot().connection).toBe(before.connection);
 expect(model.getSnapshot().negotiation).toBe(before.negotiation);
});
