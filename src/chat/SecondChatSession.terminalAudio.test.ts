import { expect, it, vi } from 'vitest';
import { ApiError } from '../auth/api';
import { SecondChatSession } from './SecondChatSession';
import { secondHarness } from './secondFixtures';
import { messageFixture } from './fixtures';
function harness(){const h=secondHarness();return {...h,session:new SecondChatSession(h.controller,'connection','m','me')};}
const file=()=>new Blob(['synthetic'],{type:'audio/mp4'});
function end(h:ReturnType<typeof harness>){Object.assign(h.status,{chatStatus:'ABANDONED',endedReason:'SECOND_CHAT_NO_CONVERSATION_STARTED',endedAt:h.status.serverTime,readOnlyUntil:h.status.absoluteExpiresAt});}
it('locks navigation before initial verification and through transient failures, then releases an unjoined chat',async()=>{
 const h=harness(),base=h.request.getMockImplementation()!;
 expect(h.session.canReturnHome).toBe(false);
 h.request.mockRejectedValue(new ApiError('network'));await h.session.refresh();expect(h.session.canReturnHome).toBe(false);
 h.request.mockImplementation(base);Object.assign(h.status,{myAttendanceStatus:'PENDING',chatStatus:'AVAILABLE',chatId:null});await h.session.refresh();expect(h.session.canReturnHome).toBe(true);
});
it.each([false,true])('does not use pre-JOIN PENDING attendance as exit permission after an uncertain JOIN, committed=%s',async committed=>{
 const h=harness();Object.assign(h.status,{myAttendanceStatus:'PENDING',chatId:null,chatStatus:null,canJoin:true});await h.session.refresh();
 const base=h.request.getMockImplementation()!;let attempted=false;
 h.request.mockImplementation(async(...args)=>{
  if(args[0].endsWith('/join')){attempted=true;if(committed)await base(...args);throw new ApiError('network');}
  if(attempted&&args[0].endsWith('/status'))throw new ApiError('network');return base(...args);
 });
 await h.session.join();expect(h.session.getSnapshot().status?.myAttendanceStatus).toBe('PENDING');expect(h.session.canReturnHome).toBe(false);
 h.request.mockImplementation(base);await h.session.refresh();expect(h.session.canReturnHome).toBe(!committed);
 expect(h.request.mock.calls.filter(c=>c[0].endsWith('/join'))).toHaveLength(1);
});

it('confirms a successful upload while active',async()=>{
 const h=harness();await h.session.refresh();await h.session.send('',null,file());
 expect(h.session.getSnapshot()).toMatchObject({outgoing:null,error:'',messages:[{messageType:'AUDIO'}]});
});
it.each(['SECOND_CHAT_CONVERSATION_ALREADY_RESOLVED','CHAT_NOT_AVAILABLE'])('reconciles %s before dropping the terminal uncommitted audio and Blob',async code=>{
 const h=harness();h.messages.push(messageFixture('1'));await h.session.refresh();const base=h.request.getMockImplementation()!;
 let release!:()=>void;
 h.request.mockImplementation(async(...args)=>{
  if(args[0].endsWith('/audio-messages')){end(h);throw new ApiError('backend',409,code);}
  if(args[0].includes('/messages?'))await new Promise<void>(r=>{release=r;});
  return base(...args);
 });
 const pending=h.session.send('',null,file());await vi.waitFor(()=>expect(release).toBeDefined());
 expect(h.session.getSnapshot().outgoing?.file).toBeInstanceOf(Blob);
 release();await pending;expect(h.session.getSnapshot()).toMatchObject({outgoing:null,confirmed:null,error:'',diagnostic:null,blocked:false,messages:[{id:'1'}]});
 expect(h.session.getSnapshot().notice).toContain('ya no admite audios');expect(h.session.rules.readable).toBe(true);
 const posts=h.request.mock.calls.filter(c=>c[2]==='POST').length;await h.session.retry();expect(h.request.mock.calls.filter(c=>c[2]==='POST')).toHaveLength(posts);
});
it('retains a recoverable 409 while the authoritative chat is active',async()=>{
 const h=harness();await h.session.refresh();const base=h.request.getMockImplementation()!;
 h.request.mockImplementation(async(...args)=>{if(args[0].endsWith('/audio-messages'))throw new ApiError('backend',409,'CHAT_AUDIO_WAITING_FOR_BOTH');return base(...args);});
 await h.session.send('',null,file());expect(h.session.getSnapshot()).toMatchObject({outgoing:{phase:'failed'},notice:'',blocked:false});expect(h.session.getSnapshot().outgoing?.file).toBeTruthy();
});
it.each([false,true])('reconciles an ambiguous committed audio before clearing its payload, terminal=%s',async isTerminal=>{
 const h=harness();await h.session.refresh();const base=h.request.getMockImplementation()!;
 h.request.mockImplementation(async(...args)=>{const result=await base(...args);if(args[0].endsWith('/audio-messages')){if(isTerminal)end(h);throw new ApiError('network');}return result;});
 await h.session.send('',null,file());expect(h.session.getSnapshot().outgoing).toBeNull();
 expect(h.session.getSnapshot().messages[0]?.messageType).toBe('AUDIO');
 if(isTerminal){expect(h.session.getSnapshot().confirmed).toBeNull();expect(h.session.getSnapshot().notice).toContain('guardado');expect(h.session.getSnapshot().error).toBe('');}
 await h.session.retry();expect(h.request.mock.calls.filter(c=>c[2]==='POST')).toHaveLength(1);
});
it('keeps uncertainty on reconciliation failure, then safely discards on a successful terminal read',async()=>{
 const h=harness();await h.session.refresh();const base=h.request.getMockImplementation()!;let failing=true;
 h.request.mockImplementation(async(...args)=>{if(args[0].endsWith('/audio-messages')){end(h);throw new ApiError('network');}if(failing&&args[0].includes('/messages?'))throw new ApiError('network');return base(...args);});
 await h.session.send('',null,file());expect(h.session.getSnapshot()).toMatchObject({blocked:true,outgoing:{phase:'uncertain'}});
 failing=false;await h.session.refresh();expect(h.session.getSnapshot()).toMatchObject({blocked:false,outgoing:null,confirmed:null,error:''});
});
it('handles an in-flight successful audio crossing a terminal transition without losing its committed message',async()=>{
 const h=harness();await h.session.refresh();const base=h.request.getMockImplementation()!;let release!:()=>void;
 h.request.mockImplementation(async(...args)=>{if(args[0].endsWith('/audio-messages'))await new Promise<void>(r=>{release=r;});return base(...args);});
 const pending=h.session.send('',null,file());await vi.waitFor(()=>expect(release).toBeDefined());end(h);release();await pending;
 expect(h.session.getSnapshot()).toMatchObject({messages:[{messageType:'AUDIO'}],outgoing:null,confirmed:null,error:''});
 expect(h.session.getSnapshot().notice).toContain('guardado');
});
it('does not discard on an active transient server error; disposal releases the retained Blob',async()=>{
 const h=harness();await h.session.refresh();const base=h.request.getMockImplementation()!;
 h.request.mockImplementation(async(...args)=>{if(args[0].endsWith('/audio-messages'))throw new ApiError('backend',503);return base(...args);});
 await h.session.send('',null,file());expect(h.session.getSnapshot().outgoing?.phase).toBe('uncertain');h.session.dispose();expect(h.session.getSnapshot()).toMatchObject({outgoing:null,confirmed:null,messages:[]});
});
it('checks beyond a full initial list before resolving a terminal audio UUID',async()=>{
 const h=harness();await h.session.refresh();const base=h.request.getMockImplementation()!;let id='';
 h.request.mockImplementation(async(...args)=>{
  if(args[0].endsWith('/audio-messages')){if(!(args[3] instanceof FormData))throw Error();id=String(args[3].get('clientMessageId'));end(h);throw new ApiError('network');}
  if(id&&args[0].includes('/messages?')){
   if(!args[0].includes('&after='))return Array.from({length:500},(_,i)=>messageFixture(String(i+1)));
   return {messages:[{...messageFixture('501','me'),clientMessageId:id,messageType:'AUDIO',content:null,audio:{url:'https://example.test/committed',durationMillis:1000,sizeBytes:100,contentType:'audio/mp4'}}],hasMore:false,serverTime:h.status.serverTime};
  }
  return base(...args);
 });
 await h.session.send('',null,file());expect(h.session.getSnapshot()).toMatchObject({outgoing:null,confirmed:null,blocked:false,historyLimited:false});
 expect(h.session.getSnapshot().messages).toHaveLength(501);expect(h.session.getSnapshot().notice).toContain('guardado');
});
