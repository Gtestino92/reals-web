import { beforeEach, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { ApiError } from '../auth/api';
import { ChatSession } from './ChatSession';
import { chatFixture, controllerFixture, messageFixture } from './fixtures';
import type { Exit, Message } from './contracts';
let chat:ReturnType<typeof chatFixture>, messages:ReturnType<typeof messageFixture>[], exits:Exit[], matchState:string;
let controller:ReturnType<typeof controllerFixture>, session:ChatSession, home:ReturnType<typeof vi.fn<(message: string) => void>>;
let request:MockInstance<typeof controller.request>;
const writes=()=>request.mock.calls.filter(([, ,method])=>method && method!=='GET');
beforeEach(()=>{
  chat=chatFixture();messages=[messageFixture()];exits=[];matchState='CHAT_ACTIVE';controller=controllerFixture();home=vi.fn();
  request=vi.spyOn(controller,'request').mockImplementation(async(path,_signal,method='GET',body)=>{
    if(method==='GET') {
      if(path==='/matches/m')return {id:'m',userAId:'me',userBId:'them',state:matchState};
      if(path==='/matches/m/chat')return chat;
      if(path==='/chats/c/exit-requests')return exits.map(e=>({...e,chatId:'c'}));
      if(path.startsWith('/chats/c/messages?'))return path.includes('after=')?{messages:[],hasMore:false}:messages;
      throw new Error('unexpected read');
    }
    if(path==='/chats/c/messages') { const b=body as {content:string;clientMessageId:string};const m={...messageFixture('2','me'),...b};messages.push(m);return m; }
    if(path.endsWith('/reaction')) {const m=messages.find(m=>path.includes(`/messages/${m.id}/`));if(m) m.reactionType='HEART';return m;}
    return {};
  });
  session=new ChatSession(controller,'m','c','me',home);
});
it('validates ownership and loads initial snapshot atomically',async()=>{await session.refresh();expect(session.getSnapshot().chat?.partner.displayName).toBe('María');expect(session.getSnapshot().blocked).toBe(false);expect(session.getSnapshot().messages).toHaveLength(1);});
it.each(['id','matchId','chatType'])('rejects wrong snapshot %s',async field=>{Object.assign(chat,{[field]:'wrong'});await session.refresh();expect(session.getSnapshot().chat).toBeNull();expect(session.getSnapshot().blocked).toBe(true);});
it('rejects nonparticipants before accessing chat',async()=>{request.mockResolvedValue({id:'m',userAId:'stranger',userBId:'other',state:'CHAT_ACTIVE'});await session.refresh();expect(session.getSnapshot().blocked).toBe(true);expect(request).toHaveBeenCalledTimes(1);});
it('sends stable logical text once and confirms it',async()=>{await session.refresh();await Promise.all([session.send('¡Hola!',null),session.send('¡Hola!',null)]);expect(writes()).toHaveLength(1);expect(writes()[0]?.[3]).toMatchObject({content:'¡Hola!',clientMessageId:expect.any(String)});expect(session.getSnapshot().outgoing).toBeNull();expect(session.getSnapshot().messages).toHaveLength(2);});
it.each(['','<b>hola</b>','a'.repeat(1001),'hola\t'])('rejects invalid text %s',async value=>{await session.refresh();await session.send(value,null);expect(writes()).toHaveLength(0);});
it.each([{type:'MESSAGE' as const,targetId:'1'},{type:'GUIDANCE_QUESTION' as const,targetId:'question-1'}])('preserves direct reply %s',async reply=>{await session.refresh();await session.send('Respuesta',reply);expect(writes()[0]?.[3]).toMatchObject({replyTo:reply});});
it('rejects obsolete guidance reply identities',async()=>{await session.refresh();await session.send('Respuesta',{type:'GUIDANCE_QUESTION',targetId:'old'});expect(writes()).toHaveLength(0);});
it('reconciles a committed send after a lost response without replay',async()=>{const base=request.getMockImplementation()!;request.mockImplementation(async(...args)=>{const value=await base(...args);if(args[2]==='POST')throw new ApiError('network');return value;});await session.refresh();await session.send('Hola',null);expect(session.getSnapshot().outgoing).toBeNull();await session.retry();expect(writes()).toHaveLength(1);});
it('retries uncertain text with identical UUID/payload only after authoritative reads',async()=>{const base=request.getMockImplementation()!;let fail=true;request.mockImplementation(async(...args)=>{if(args[2]==='POST'&&fail)throw new ApiError('network');return base(...args);});await session.refresh();await session.send('Hola',null);expect(session.getSnapshot().outgoing?.phase).toBe('uncertain');await session.send('otro',null);expect(writes()).toHaveLength(1);fail=false;await session.retry();expect(writes()).toHaveLength(2);expect(writes()[0]?.[3]).toEqual(writes()[1]?.[3]);expect(session.getSnapshot().outgoing).toBeNull();});
it('keeps failed drafts editable without silently discarding them',async()=>{const base=request.getMockImplementation()!;request.mockImplementation((...args)=>args[2]==='POST'?Promise.reject(new ApiError('backend',400,'CHAT_MESSAGE_INVALID')):base(...args));await session.refresh();await session.send('Hola',null);expect(session.getSnapshot().outgoing?.phase).toBe('failed');expect(session.getSnapshot().outgoing?.content).toBe('Hola');session.editFailed();expect(session.getSnapshot().outgoing).toBeNull();});
it('does not discard an uncertain send on edit',async()=>{const base=request.getMockImplementation()!;request.mockImplementation((...args)=>args[2]==='POST'?Promise.reject(new ApiError('network')):base(...args));await session.refresh();await session.send('Hola',null);session.editFailed();expect(session.getSnapshot().outgoing?.phase).toBe('uncertain');});
it('drains cursor pages and merges changed messages without duplicates',async()=>{const base=request.getMockImplementation()!;request.mockImplementation((...args)=>args[0].includes('after=1')?Promise.resolve({messages:[messageFixture('2')],hasMore:true}):args[0].includes('after=2')?Promise.resolve({messages:[messageFixture('3')],hasMore:false}):base(...args));await session.refresh();await session.refresh();await session.refresh();expect(session.getSnapshot().messages.map(m=>m.id)).toEqual(['1','2','3']);});
it('rejects nonadvancing malformed pagination',async()=>{const base=request.getMockImplementation()!;request.mockImplementation((...args)=>args[0].includes('after=')?Promise.resolve({messages:[],hasMore:true}):base(...args));await session.refresh();await session.refresh();await session.refresh();expect(session.getSnapshot().blocked).toBe(true);});
it('installs canonical irreversible reactions immediately',async()=>{await session.refresh();await session.react('1');expect(session.getSnapshot().messages[0]?.reactionType).toBe('HEART');await session.react('1');expect(writes()).toHaveLength(1);});
it('does not react to own messages',async()=>{messages=[messageFixture('1','me')];await session.refresh();await session.react('1');expect(writes()).toHaveLength(0);});
it.each(['APPROVED','REJECTED'])('routes own %s decisions to Home',async value=>{chat.myDecision=value;await session.refresh();expect(home).toHaveBeenCalled();await session.refresh();expect(request).toHaveBeenCalledTimes(4);});
it('decision-only blocks conversation but permits pending final decision and safety',async()=>{chat.partnerDecision='APPROVED';await session.refresh();await session.send('Hola',null);await session.action('guidance');await session.action('mutual');await session.action('cancel');await session.react('1');expect(writes()).toHaveLength(0);await session.action('approve');expect(writes()[0]?.[3]).toEqual({decision:'APPROVED'});});
it.each(['canRequestNext','myNextRequested','completed'])('guards guidance using server field %s',async field=>{Object.assign(chat.guidance,{[field]:field!=='canRequestNext'});await session.refresh();await session.action('guidance');expect(writes()).toHaveLength(0);});
it.each(['approve','reject','guidance','mutual','cancel','safety','block'] as const)('uses real endpoint for %s',async kind=>{await session.refresh();await session.action(kind,{reason:'HARASSMENT',details:'Detalle',blockUser:true});expect(writes()).toHaveLength(1);const expected={approve:'/matches/m/chat-decision',reject:'/matches/m/chat-decision',guidance:'/chats/c/guidance/next-request',mutual:'/chats/c/exit-requests',cancel:'/chats/c/cancellations',safety:'/chats/c/safety-cancellations',block:'/matches/m/block'};expect(writes()[0]?.[0]).toBe(expected[kind]);});
it.each(['acceptance','rejection','timeout'] as const)('resolves incoming mutual %s',async kind=>{exits=[{id:'exit',requesterUserId:'them',responderUserId:'me',type:'MUTUAL_CANCEL',status:'PENDING',createdAt:new Date().toISOString()}];await session.refresh();await session.send('Hola',null);await session.action('guidance');expect(writes()).toHaveLength(0);await session.action(kind);expect(writes()[0]?.[0]).toBe(`/chats/c/exit-requests/exit/${kind}`);});
it('cannot accept its own outgoing exit request',async()=>{exits=[{id:'exit',requesterUserId:'me',responderUserId:'them',type:'MUTUAL_CANCEL',status:'PENDING',createdAt:new Date().toISOString()}];await session.refresh();await session.action('acceptance');expect(writes()).toHaveLength(0);});
it.each(['EXPIRED','ABANDONED'])('routes authoritative %s and stops polling',async status=>{chat.status=status;await session.refresh();expect(home).toHaveBeenCalled();const n=request.mock.calls.length;await session.refresh();expect(request).toHaveBeenCalledTimes(n);});
it.each(['CHAT_EXPIRED','CHAT_ABANDONED'])('handles authoritative terminal conflict %s',async code=>{request.mockRejectedValue(new ApiError('backend',409,code));await session.refresh();expect(home).toHaveBeenCalled();});
it('local expiry blocks ordinary actions without synthesizing terminal state',async()=>{chat.timeoutAt=new Date(Date.now()-1000).toISOString();await session.refresh();await session.send('Hola',null);expect(writes()).toHaveLength(0);expect(home).not.toHaveBeenCalled();});
it('decision-only ignores inactivity advisory while awaiting final decision',async()=>{chat.partnerDecision='APPROVED';chat.inactivityExpiresAt=new Date(Date.now()-1000).toISOString();await session.refresh();await session.action('reject');expect(writes()).toHaveLength(1);});
it('disposal rejects obsolete async results',async()=>{let resolve:((value:unknown)=>void)|undefined;request.mockImplementation(()=>new Promise(r=>{resolve=r;}));const pending=session.refresh();session.dispose();resolve?.({id:'m',userAId:'me',userBId:'them',state:'VISUAL_PHASE'});await pending;expect(home).not.toHaveBeenCalled();expect(session.getSnapshot().chat).toBeNull();});
it('effect restart works after StrictMode cleanup',async()=>{session.dispose();session.start();await session.refresh();expect(session.getSnapshot().chat?.id).toBe('c');});
it('audio send uses multipart without boundary and keeps identical bytes/id on retry',async()=>{const base=request.getMockImplementation()!;request.mockImplementation((...args)=>args[0].endsWith('/audio-messages')?Promise.reject(new ApiError('network')):base(...args));await session.refresh();const file=new Blob(['aac'],{type:'audio/mp4'});await session.send('',{type:'MESSAGE',targetId:'1'},file);await session.retry();expect(writes()).toHaveLength(2);const first=writes()[0]?.[3],second=writes()[1]?.[3];expect(first).toBeInstanceOf(FormData);if(!(first instanceof FormData)||!(second instanceof FormData))throw Error();expect(first.get('clientMessageId')).toBe(second.get('clientMessageId'));expect(first.get('replyToType')).toBe('MESSAGE');expect((first.get('file') as File).size).toBe(file.size);});
it.each([false, true])('enforces audio policy enabled/quota %s',async enabled=>{chat.audioPolicy.enabled=enabled;chat.audioPolicy.remainingMessages=0;await session.refresh();await session.send('',null,new Blob(['aac'],{type:'audio/mp4'}));expect(writes()).toHaveLength(0);});
it('refreshes signed URLs only through authorized reads',async()=>{const audio:Message={...messageFixture(),messageType:'AUDIO',audio:{url:'https://media.example/a?signature=one',durationMillis:2000,sizeBytes:100,contentType:'audio/mp4'}};const base=request.getMockImplementation()!;request.mockImplementation((...args)=>args[0].startsWith('/chats/c/messages?')?Promise.resolve([audio]):base(...args));await session.refresh();audio.audio={...audio.audio!,url:'https://media.example/a?signature=two'};await session.refresh(true);expect(session.getSnapshot().messages[0]?.audio?.url).toBe(audio.audio.url);});
it('superseded poll cannot overwrite a confirmed send',async()=>{
  await session.refresh();const base=request.getMockImplementation()!;let resolve:((v:unknown)=>void)|undefined;
  request.mockImplementation((...args)=>args[0]==='/matches/m'&&args[2]===undefined&&!resolve?new Promise(r=>{resolve=r;}):base(...args));
  const poll=session.refresh();await session.send('Confirmado',null);resolve?.({id:'m',userAId:'me',userBId:'them',state:'VISUAL_PHASE'});await poll;
  expect(home).not.toHaveBeenCalled();expect(session.getSnapshot().messages.some(m=>m.content==='Confirmado')).toBe(true);
});
it('never resends after a confirmed mutation whose follow-up read failed',async()=>{
  await session.refresh();const base=request.getMockImplementation()!;let accepted=false;
  request.mockImplementation(async(...args)=>{if(accepted&&args[0]==='/matches/m')throw new ApiError('network');const result=await base(...args);if(args[2]==='POST')accepted=true;return result;});
  await session.send('Confirmado',null);expect(session.getSnapshot().outgoing).toBeNull();expect(session.getSnapshot().error).toContain('acción fue confirmada');await session.retry();expect(writes()).toHaveLength(1);
});
it('automatically requests advisory mutual timeout at most once per request',async()=>{
  exits=[{id:'exit',requesterUserId:'them',responderUserId:'me',type:'MUTUAL_CANCEL',status:'PENDING',createdAt:new Date(Date.now()-21000).toISOString()}];await session.refresh();await session.checkExitTimeout();await session.checkExitTimeout();expect(writes()).toHaveLength(1);expect(writes()[0]?.[0]).toContain('/timeout');expect(home).not.toHaveBeenCalled();
});
it('does not request timeout before the advisory delay',async()=>{
  exits=[{id:'exit',requesterUserId:'them',responderUserId:'me',type:'MUTUAL_CANCEL',status:'PENDING',createdAt:new Date().toISOString()}];await session.refresh();await session.checkExitTimeout();expect(writes()).toHaveLength(0);
});
it.each([{}, {reason:'HARASSMENT',details:'<b>x</b>',blockUser:false}, {reason:'OTHER',details:'',blockUser:true}])('rejects malformed safety details without a write',async body=>{await session.refresh();await session.action('safety',body);expect(writes()).toHaveLength(0);});
it('does not classify a malformed match state as conclusive termination',async()=>{request.mockResolvedValue({id:'m',userAId:'me',userBId:'them'});await session.refresh();expect(home).not.toHaveBeenCalled();expect(session.getSnapshot().blocked).toBe(true);});
it('does not hide unsupported future chat states as known-closed',async()=>{chat.status='FUTURE';await session.refresh();expect(home).not.toHaveBeenCalled();expect(session.getSnapshot().blocked).toBe(true);});
