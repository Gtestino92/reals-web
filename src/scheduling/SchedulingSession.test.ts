import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from '../auth/api';
import { SchedulingSession } from './SchedulingSession';
import { setup, proposal, time } from './fixtures';
const slot='2026-11-15T16:00:00Z';
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
async function ready() {vi.useFakeTimers();vi.setSystemTime(time);const f=setup(),finish=vi.fn(),model=new SchedulingSession(f.controller,'c','m',finish);await model.refresh();return {...f,model,finish};}
it('preserves draft during polling and resets only on round change',async()=>{
 const {model,state}=await ready();model.setDraft([slot]);await model.refresh();expect(model.getSnapshot().draft).toEqual([slot]);state.n={...state.n,roundNumber:2};await model.refresh();expect(model.getSnapshot().draft).toEqual([]);
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
it('discards late reads after session replacement and dispose',async()=>{
 const {model,controller,request}=await ready();let resolve!:(v:unknown)=>void;request.mockReturnValueOnce(new Promise(r=>{resolve=r;}));const pending=model.refresh();controller.snapshot={...controller.snapshot,authContextVersion:2};model.dispose();resolve({});await pending;expect(model.getSnapshot().verified).toBe(false);
});
it('handles activation pending without failed negotiation',async()=>{
 const {model,state}=await ready();state.c={...state.c,state:'SCHEDULING_PENDING'};await model.refresh();expect(model.getSnapshot().negotiation).toBeNull();expect(model.getSnapshot().connection?.state).toBe('SCHEDULING_PENDING');
});

it('does not release a replacement refresh gate when an obsolete read fails',async()=>{
 const {model,request}=await ready();const read=request.getMockImplementation()!;let reject!:(e:unknown)=>void,resolve!:(v:unknown)=>void;
 request.mockReturnValueOnce(new Promise((_,r)=>{reject=r;}));const old=model.refresh();model.dispose();model.start();
 request.mockReturnValueOnce(new Promise(r=>{resolve=r;}));const fresh=model.refresh();reject(new ApiError('network'));await old;
 const count=request.mock.calls.length;await model.refresh();expect(request.mock.calls).toHaveLength(count);expect(model.getSnapshot().busy).toBe(true);
 resolve(await read('/connections/c',new AbortController().signal));await fresh;expect(model.getSnapshot().verified).toBe(true);
});
it('locks navigation synchronously before the first await',async()=>{
 vi.useFakeTimers();vi.setSystemTime(time);const f=setup(),lock=vi.fn(),model=new SchedulingSession(f.controller,'c','m',vi.fn(),lock);await model.refresh();model.setDraft([slot]);
 const action=model.act('submit');expect(lock).toHaveBeenCalledWith(true);await action;expect(lock).toHaveBeenLastCalledWith(false);
});
it('rejects contradictory snapshots instead of installing mixed rounds',async()=>{
 const {model,request,state}=await ready();const read=request.getMockImplementation()!;let negotiations=0;
 request.mockImplementation(async(path,...args)=>{if(path.endsWith('/negotiation')&&++negotiations===2)return {...state.n,roundNumber:2};return read(path,...args);});
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
