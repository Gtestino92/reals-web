import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { ApiError } from '../auth/api';
import { ChatSession } from './ChatSession';
import { chatFixture, controllerFixture, messageFixture } from './fixtures';
import type { Exit, Message } from './contracts';
let chat:ReturnType<typeof chatFixture>, messages:ReturnType<typeof messageFixture>[], exits:Exit[], matchState:string;
let controller:ReturnType<typeof controllerFixture>, session:ChatSession, home:ReturnType<typeof vi.fn<(message: string) => void>>;
let request:MockInstance<typeof controller.request>;
afterEach(() => vi.restoreAllMocks());
const writes=()=>request.mock.calls.filter(([, ,method])=>method && method!=='GET');
it.each(['CHAT_ACTIVE', 'VISUAL_PHASE'])('uses private decision feedback with authoritative %s', async state => {
  await session.refresh();
  chat.myDecision = 'APPROVED'; matchState = state;
  await session.refresh();
  expect(home).toHaveBeenCalledWith(state === 'CHAT_ACTIVE' ? '' : 'El chat terminó.', state !== 'CHAT_ACTIVE');
  expect(JSON.stringify(home.mock.calls)).not.toMatch(/Ambas|Actividad|mutu/);
});
it('keeps quick approval pending for presentation only and excludes duplicates', async () => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  await session.refresh();
  const base = request.getMockImplementation()!;
  request.mockImplementation(async (path, signal, method, body) => {
    if (path.endsWith('/chat-decision')) { chat.myDecision = 'APPROVED'; return {}; }
    return base(path, signal, method, body);
  });
  vi.useFakeTimers();
  try {
    const pending = session.action('approve');
    await session.action('approve');
    await vi.advanceTimersByTimeAsync(100);
    expect(session.getSnapshot().decisionPending).toBe('approve'); expect(home).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200); await pending;
    expect(home).toHaveBeenCalledWith('', false); expect(writes()).toHaveLength(1);
  } finally { vi.useRealTimers(); }
});
it.each(['dispose', 'hidden'])('releases presentation ownership on %s', async outcome => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  await session.refresh(); const base = request.getMockImplementation()!;
  request.mockImplementation(async (path, signal, method, body) => {
    if (path.endsWith('/chat-decision')) { chat.myDecision = 'APPROVED'; return {}; }
    return base(path, signal, method, body);
  });
  vi.useFakeTimers();
  try {
    const pending = session.action('approve'); await vi.advanceTimersByTimeAsync(50);
    if (outcome === 'dispose') session.dispose();
    else { vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden'); document.dispatchEvent(new Event('visibilitychange')); }
    await pending;
    expect(vi.getTimerCount()).toBe(0);
    expect(home).toHaveBeenCalledTimes(outcome === 'dispose' ? 0 : 1);
  } finally { vi.useRealTimers(); }
});
it('installs authoritative guidance acknowledgement even if following reconciliation fails',async()=>{
  await session.refresh();const base=request.getMockImplementation()!;let accepted=false;
  request.mockImplementation((path,signal,method,body)=>{
    if(path.endsWith('/guidance/next-request')){accepted=true;return Promise.resolve({...chat.guidance,myNextRequested:true});}
    if(accepted)return Promise.reject(new ApiError('network'));
    return base(path,signal,method,body);
  });
  await session.action('guidance');
  expect(session.getSnapshot()).toMatchObject({busy:false,guidancePending:false,blocked:true,chat:{guidance:{myNextRequested:true}}});
  expect(session.getSnapshot().error).toContain('confirmada');expect(writes()).toHaveLength(1);
  await session.action('guidance');expect(writes()).toHaveLength(1);
});
it('installs the next immutable guidance question and refreshed audio policy from server state',async()=>{
  await session.refresh();const base=request.getMockImplementation()!;
  request.mockImplementation((path,signal,method,body)=>{
    if(path.endsWith('/guidance/next-request')){chat.guidance={...chat.guidance,questionOrdinal:2,question:{...chat.guidance.question,instanceId:'question-2',text:'Segunda pregunta'}};return Promise.resolve(chat.guidance);}
    return base(path,signal,method,body);
  });
  await session.action('guidance'); expect(session.getSnapshot().chat?.guidance?.question.instanceId).toBe('question-2');expect(session.getSnapshot().blocked).toBe(false);
});
beforeEach(()=>{
  chat=chatFixture();messages=[messageFixture()];exits=[];matchState='CHAT_ACTIVE';controller=controllerFixture();home=vi.fn();
  request=vi.spyOn(controller,'request').mockImplementation(async(path,_signal,method='GET',body,access)=>{
    access?.('ALLOWED');
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
it('keeps a confirmed reaction authoritative when reconciliation fails and exposes recoverable reaction feedback',async()=>{
  const base=request.getMockImplementation()!;await session.refresh();let failRefresh=true;
  request.mockImplementation((path,signal,method,body)=>method==='PUT'?base(path,signal,method,body):failRefresh?Promise.reject(new ApiError('network')):base(path,signal,method,body));
  await session.react('1');expect(session.getSnapshot()).toMatchObject({reactionFeedback:'error',busy:false,blocked:true});
  expect(session.getSnapshot().messages[0]?.reactionType).toBe('HEART');expect(session.getSnapshot().error).toContain('confirmada');
  failRefresh=false;await session.refresh();expect(session.getSnapshot()).toMatchObject({reactionFeedback:null,error:'',blocked:false});expect(writes()).toHaveLength(1);
});
it.each(['id','matchId','chatType'])('rejects wrong snapshot %s',async field=>{Object.assign(chat,{[field]:'wrong'});await session.refresh();expect(session.getSnapshot().chat).toBeNull();expect(session.getSnapshot().blocked).toBe(true);});
it('rejects nonparticipants before accessing chat',async()=>{request.mockResolvedValue({id:'m',userAId:'stranger',userBId:'other',state:'CHAT_ACTIVE'});await session.refresh();expect(session.getSnapshot().blocked).toBe(true);expect(request).toHaveBeenCalledTimes(1);});
it('sends stable logical text once and confirms it',async()=>{await session.refresh();await Promise.all([session.send('¡Hola!',null),session.send('¡Hola!',null)]);expect(writes()).toHaveLength(1);expect(writes()[0]?.[3]).toMatchObject({content:'¡Hola!',clientMessageId:expect.any(String)});expect(session.getSnapshot().outgoing).toBeNull();expect(session.getSnapshot().messages).toHaveLength(2);});
it('installs the exact confirmed reply and file with the confirmation version, retaining locks through reconciliation',async()=>{
  await session.refresh();const base=request.getMockImplementation()!;const file=new Blob(['aac'],{type:'audio/mp4'}),reply={type:'MESSAGE' as const,targetId:'1'};
  let release:(()=>void)|undefined;let afterPost=false;
  request.mockImplementation((path,signal,method,body)=>{
    if(path.endsWith('/audio-messages')){afterPost=true;return Promise.resolve({...messageFixture('2','me'),clientMessageId:body instanceof FormData?body.get('clientMessageId'):null,messageType:'AUDIO',content:null,audio:{url:'https://example.test/audio',durationMillis:1000,sizeBytes:3,contentType:'audio/mp4'}});}
    if(afterPost&&path==='/matches/m')return new Promise(resolve=>{release=()=>{void base(path,signal,method,body).then(resolve);};});
    return base(path,signal,method,body);
  });
  const pending=session.send('',reply,file);await vi.waitFor(()=>expect(session.getSnapshot().confirmationVersion).toBe(1));
  expect(session.getSnapshot()).toMatchObject({busy:true,messagePending:true,confirmedReply:reply,confirmedFile:file,outgoing:null});
  release?.();await pending;expect(session.getSnapshot()).toMatchObject({busy:false,messagePending:false,confirmedReply:reply,confirmedFile:file});
});
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
it.each(['APPROVED','REJECTED'])('routes own %s decisions to Home',async value=>{chat.myDecision=value;await session.refresh();expect(home).toHaveBeenCalled();await session.refresh();expect(request.mock.calls.map(([path]) => path)).toEqual(['/matches/m','/matches/m/chat']);});
it('decision-only blocks conversation but permits pending final decision and safety',async()=>{chat.partnerDecision='APPROVED';await session.refresh();await session.send('Hola',null);await session.action('guidance');await session.action('mutual');await session.react('1');expect(writes()).toHaveLength(0);await session.action('approve');expect(writes()[0]?.[3]).toEqual({decision:'APPROVED'});});
it.each(['canRequestNext','myNextRequested','completed'])('guards guidance using server field %s',async field=>{Object.assign(chat.guidance,{[field]:field!=='canRequestNext'});await session.refresh();await session.action('guidance');expect(writes()).toHaveLength(0);});
it.each(['approve','reject','guidance','mutual','safety','block'] as const)('uses real endpoint for %s',async kind=>{await session.refresh();await session.action(kind,{reason:'HARASSMENT',details:'Detalle',blockUser:true});expect(writes()).toHaveLength(1);const expected={approve:'/matches/m/chat-decision',reject:'/matches/m/chat-decision',guidance:'/chats/c/guidance/next-request',mutual:'/chats/c/exit-requests',safety:'/chats/c/safety-cancellations',block:'/matches/m/block'};expect(writes()[0]?.[0]).toBe(expected[kind]);});
it.each(['acceptance','rejection'] as const)('resolves incoming mutual %s',async kind=>{exits=[{id:'exit',requesterUserId:'them',responderUserId:'me',type:'MUTUAL_CANCEL',status:'PENDING',createdAt:new Date().toISOString()}];await session.refresh();await session.send('Hola',null);await session.action('guidance');expect(writes()).toHaveLength(0);await session.action(kind, undefined, 'exit');expect(writes()[0]?.[0]).toBe(`/chats/c/exit-requests/exit/${kind}`);});
it('cannot accept its own outgoing exit request',async()=>{exits=[{id:'exit',requesterUserId:'me',responderUserId:'them',type:'MUTUAL_CANCEL',status:'PENDING',createdAt:new Date().toISOString()}];await session.refresh();await session.action('acceptance', undefined, 'exit');expect(writes()).toHaveLength(0);});
it.each(['EXPIRED','ABANDONED'])('routes authoritative %s and stops polling',async status=>{chat.status=status;await session.refresh();expect(home).toHaveBeenCalled();const n=request.mock.calls.length;await session.refresh();expect(request).toHaveBeenCalledTimes(n);});
it.each(['CHAT_EXPIRED','CHAT_ABANDONED'])('handles authoritative terminal conflict %s',async code=>{request.mockRejectedValue(new ApiError('backend',409,code));await session.refresh();expect(home).toHaveBeenCalled();});
it('local expiry blocks ordinary actions without synthesizing terminal state',async()=>{chat.timeoutAt=new Date(Date.now()-1000).toISOString();await session.refresh();await session.send('Hola',null);expect(writes()).toHaveLength(0);expect(home).toHaveBeenCalledWith('El plazo del chat terminó.','local-expiry');});
it('decision-only ignores inactivity advisory while awaiting final decision',async()=>{chat.partnerDecision='APPROVED';chat.inactivityExpiresAt=new Date(Date.now()-1000).toISOString();await session.refresh();await session.action('reject');expect(writes()).toHaveLength(1);});
it.each(['approve','reject'] as const)('keeps %s pending metadata coupled to the write lock and reconciles authoritative closure',async kind=>{
  await session.refresh();const base=request.getMockImplementation()!;let complete:((value:unknown)=>void)|undefined;
  request.mockImplementation((path,signal,method,body)=>path.endsWith('/chat-decision')?new Promise(r=>{complete=r;}):base(path,signal,method,body));
  const write=session.action(kind);expect(session.getSnapshot()).toMatchObject({decisionPending:kind,busy:true});await session.action(kind);await session.resume();expect(writes()).toHaveLength(1);
  matchState=kind==='approve'?'VISUAL_PHASE':'CHAT_REJECTED';complete?.({id:'m',state:matchState});await write;
  expect(home).toHaveBeenCalledTimes(1);expect(session.getSnapshot()).toMatchObject({busy:false,decisionPending:null});
});
it('does not infer mutual approval from a write alone and reconciles an uncertain decision before retry',async()=>{
  chat.partnerDecision='APPROVED';await session.refresh();const base=request.getMockImplementation()!;let failReads=false;
  request.mockImplementation((path,signal,method,body)=>{if(path.endsWith('/chat-decision')){failReads=true;return Promise.reject(new ApiError('network'));}return failReads?Promise.reject(new ApiError('network')):base(path,signal,method,body);});
  await session.action('approve');expect(home).not.toHaveBeenCalled();expect(session.getSnapshot()).toMatchObject({blocked:true,busy:false,decisionPending:null});await session.action('approve');expect(writes()).toHaveLength(1);
  failReads=false;matchState='VISUAL_PHASE';await session.resume();expect(home).toHaveBeenCalledTimes(1);expect(writes()).toHaveLength(1);
});
it('shows an approval eligibility failure without accepting a decision locally',async()=>{
  await session.refresh();const base=request.getMockImplementation()!;request.mockImplementation((path,signal,method,body)=>path.endsWith('/chat-decision')?Promise.reject(new ApiError('backend',409,'FIRST_CHAT_APPROVAL_TOO_EARLY')):base(path,signal,method,body));
  await session.action('approve');expect(session.getSnapshot().error).toContain('Todavía');expect(session.getSnapshot().chat?.myDecision).toBe('PENDING');expect(session.getSnapshot().decisionPending).toBeNull();expect(home).not.toHaveBeenCalled();
});
it('foreground supersedes an old read without resetting the valid chat or accepting its late response',async()=>{
  await session.refresh();const base=request.getMockImplementation()!;let old:((value:unknown)=>void)|undefined;
  request.mockImplementationOnce(()=>new Promise(r=>{old=r;}));const stale=session.refresh(false,true);chat.partnerDecision='APPROVED';await session.resume();
  expect(session.getSnapshot().chat?.partnerDecision).toBe('APPROVED');old?.({id:'m',userAId:'me',userBId:'them',state:'EXPIRED'});await stale;
  expect(home).not.toHaveBeenCalled();expect(session.getSnapshot().chat?.partnerDecision).toBe('APPROVED');request.mockImplementation(base);
});
it('disposal rejects obsolete async results',async()=>{let resolve:((value:unknown)=>void)|undefined;request.mockImplementation(()=>new Promise(r=>{resolve=r;}));const pending=session.refresh();session.dispose();resolve?.({id:'m',userAId:'me',userBId:'them',state:'VISUAL_PHASE'});await pending;expect(home).not.toHaveBeenCalled();expect(session.getSnapshot().chat).toBeNull();});
it('effect restart works after StrictMode cleanup',async()=>{session.dispose();session.start();await session.refresh();expect(session.getSnapshot().chat?.id).toBe('c');});
it('audio send uses multipart without boundary and keeps identical bytes/id on retry',async()=>{const base=request.getMockImplementation()!;request.mockImplementation((...args)=>args[0].endsWith('/audio-messages')?Promise.reject(new ApiError('network')):base(...args));await session.refresh();const file=new Blob(['aac'],{type:'audio/mp4'});await session.send('',{type:'MESSAGE',targetId:'1'},file);await session.retry();expect(writes()).toHaveLength(2);const first=writes()[0]?.[3],second=writes()[1]?.[3];expect(first).toBeInstanceOf(FormData);if(!(first instanceof FormData)||!(second instanceof FormData))throw Error();expect(first.get('clientMessageId')).toBe(second.get('clientMessageId'));expect(first.get('replyToType')).toBe('MESSAGE');expect((first.get('file') as File).size).toBe(file.size);});
it.each([false, true])('enforces audio policy enabled/quota %s',async enabled=>{chat.audioPolicy.enabled=enabled;chat.audioPolicy.remainingMessages=0;await session.refresh();await session.send('',null,new Blob(['aac'],{type:'audio/mp4'}));expect(writes()).toHaveLength(0);});
it('refreshes signed URLs only through authorized reads',async()=>{
  const audio:Message={...messageFixture(),messageType:'AUDIO',audio:{url:'https://media.example/a?signature=one',durationMillis:2000,sizeBytes:100,contentType:'audio/mp4'}};
  const base=request.getMockImplementation()!;
  request.mockImplementation(async (...args)=>{
    if (!args[0].startsWith('/chats/c/messages?')) return base(...args);
    args[4]?.('ALLOWED');
    return [audio];
  });
  await session.refresh();
  audio.audio={...audio.audio!,url:'https://media.example/a?signature=two'};
  expect(await session.renewAudio(audio.id)).toBe(audio.audio.url);
});
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
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  exits=[{id:'exit',requesterUserId:'them',responderUserId:'me',type:'MUTUAL_CANCEL',status:'PENDING',createdAt:new Date(Date.now()-21000).toISOString()}];await session.refresh();await session.checkExitTimeout();await session.checkExitTimeout();expect(writes()).toHaveLength(1);expect(writes()[0]?.[0]).toContain('/timeout');expect(home).not.toHaveBeenCalled();
});
it('does not request timeout before the advisory delay',async()=>{
  exits=[{id:'exit',requesterUserId:'them',responderUserId:'me',type:'MUTUAL_CANCEL',status:'PENDING',createdAt:new Date().toISOString()}];await session.refresh();await session.checkExitTimeout();expect(writes()).toHaveLength(0);
});
it.each([{}, {reason:'HARASSMENT',details:'<b>x</b>',blockUser:false}, {reason:'OTHER',details:'',blockUser:true}])('rejects malformed safety details without a write',async body=>{await session.refresh();await session.action('safety',body);expect(writes()).toHaveLength(0);});
it('does not classify a malformed match state as conclusive termination',async()=>{request.mockResolvedValue({id:'m',userAId:'me',userBId:'them'});await session.refresh();expect(home).not.toHaveBeenCalled();expect(session.getSnapshot().blocked).toBe(true);});
it('does not hide unsupported future chat states as known-closed',async()=>{chat.status='FUTURE';await session.refresh();expect(home).not.toHaveBeenCalled();expect(session.getSnapshot().blocked).toBe(true);});

it('expires only the stalled initial read and ignores its eventual terminal result after retry', async () => {
  vi.useFakeTimers();
  try {
    let release!: (response: unknown) => void;
    request.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const stalled = session.refresh();
    await vi.advanceTimersByTimeAsync(30000);
    expect(session.getSnapshot()).toMatchObject({ busy: false, blocked: true, chat: null });
    expect(session.getSnapshot().error).toContain('Reintentá');
    await session.refresh();
    release({ id: 'm', userAId: 'me', userBId: 'them', state: 'EXPIRED' });
    await stalled;
    expect(home).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({ blocked: false, error: '', chat: { id: 'c' } });
  } finally { vi.useRealTimers(); }
});

it.each(['approve', 'reject'] as const)('navigates without a decision notice after authoritative %s', async choice => {
  await session.refresh();
  const base = request.getMockImplementation()!;
  request.mockImplementation((path, ...args) => {
    if (path.endsWith('/chat-decision')) {
      matchState = choice === 'approve' ? 'VISUAL_PHASE' : 'CHAT_REJECTED';
      return Promise.resolve({});
    }
    return base(path, ...args);
  });
  await session.action(choice);
  expect(home).toHaveBeenCalledWith('', true);
  expect(writes()).toHaveLength(1);
});

it.each(['decision','exit','expiry'])('installs %s and updated guidance before accepting another text', async transition => {
  await session.refresh();
  chat.guidance.question.instanceId = 'question-2';
  if (transition === 'decision') chat.partnerDecision = 'APPROVED';
  if (transition === 'expiry') chat.timeoutAt = new Date(Date.now()-1000).toISOString();
  if (transition === 'exit') exits = [{id:'exit', requesterUserId:'them', responderUserId:'me',
    type:'MUTUAL_CANCEL', status:'PENDING', createdAt:new Date().toISOString()}];
  await session.send('Primero',null);
  if (transition === 'expiry') expect(home).toHaveBeenCalledWith('El plazo del chat terminó.', 'local-expiry');
  else expect(session.getSnapshot().chat?.guidance?.question.instanceId).toBe('question-2');
  expect(session.canSendText).toBe(false);
  await session.send('Segundo',null);
  expect(writes()).toHaveLength(1);
});

const exitFixture = (own = true) => ({
  id: '8ec99818-c357-4dd9-90ef-c7eb04ce42a2', chatId: 'c',
  requesterUserId: own ? 'me' : 'them', responderUserId: own ? 'them' : 'me',
  type: 'MUTUAL_CANCEL', status: 'PENDING', createdAt: new Date().toISOString(),
});
it.each([
  {id:' '}, {chatId:'other'}, {requesterUserId:'them',responderUserId:'me'},
  {type:'OTHER'}, {status:'ACCEPTED'}, {createdAt:'yesterday'},
])('reconciles an invalid creation acknowledgement without installing it (%j)', async patch => {
  await session.refresh();
  const base = request.getMockImplementation()!;
  request.mockImplementation((...args) => args[2] === 'POST'
    ? Promise.resolve({...exitFixture(), ...patch}) : base(...args));
  await session.action('mutual');
  expect(session.getSnapshot().exits).toEqual([]);
  expect(session.getSnapshot().error).toMatch(/Actualizá/);
  expect(writes()).toHaveLength(1);
});
it('recovers the counterpart request after uncertain creation without replay', async () => {
  await session.refresh();
  const base = request.getMockImplementation()!;
  request.mockImplementation((...args) => {
    if (args[2] !== 'POST') return base(...args);
    exits = [exitFixture(false)];
    return Promise.reject(new ApiError('network'));
  });
  await session.action('mutual');
  expect(session.getSnapshot()).toMatchObject({exits:[{responderUserId:'me'}],error:''});
  expect(writes()).toHaveLength(1);
});
it.each(['early','network'] as const)('bounds %s timeout retries after checking the same pending request', async failure => {
  vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
  let now = Date.now();
  vi.spyOn(Date,'now').mockImplementation(() => now);
  const exit = {...exitFixture(false), createdAt:new Date(now - 21_000).toISOString()};
  exits = [exit];
  await session.refresh();
  const base = request.getMockImplementation()!;
  request.mockImplementation((...args) => args[2] === 'POST'
    ? Promise.reject(failure === 'early' ? new ApiError('backend',409,'CHAT_EXIT_REQUEST_NOT_AVAILABLE') : new ApiError('network'))
    : base(...args));
  const first = session.checkExitTimeout();
  await session.checkExitTimeout();
  await first;
  await session.checkExitTimeout();
  expect(writes()).toHaveLength(1);
  now += 3000;
  await session.checkExitTimeout();
  now += 3000;
  await session.checkExitTimeout();
  expect(writes()).toHaveLength(2);
  expect(session.getSnapshot().error).toMatch(/Actualizá/);
  // A concurrent responder finished while this participant was disconnected.
  matchState = 'CHAT_REJECTED';
  await session.recover();
  await session.checkExitTimeout();
  expect(home).toHaveBeenCalledTimes(1);
  expect(writes()).toHaveLength(2);
});
it('requires explicit successful recovery when timeout delivery and reconciliation both fail', async () => {
  vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
  const exit = {...exitFixture(),createdAt:new Date(Date.now()-21_000).toISOString()};
  exits = [exit];
  await session.refresh();
  const base = request.getMockImplementation()!;
  request.mockRejectedValue(new ApiError('network'));
  await session.checkExitTimeout();
  expect(session.getSnapshot().blocked).toBe(true);
  request.mockImplementation((...args) => args[2] === 'POST'
    ? Promise.resolve({chat:{id:'c',matchId:'m',chatType:'FIRST_CHAT',status:'CANCELLED'},exitRequest:{...exit,status:'TIMED_OUT'}})
    : base(...args));
  await session.poll();
  await session.checkExitTimeout();
  expect(writes()).toHaveLength(1);
  await session.recover();
  await session.checkExitTimeout();
  expect(home).toHaveBeenCalledWith('La conversación se cerró.',true);
  expect(writes()).toHaveLength(2);
});
it.each(['POST','history'])('retires at the absolute deadline during a stalled %s', async delayed => {
  let now = Date.now();
  vi.spyOn(Date,'now').mockImplementation(() => now);
  chat.timeoutAt = new Date(now + 5000).toISOString();
  await session.refresh();
  const base = request.getMockImplementation()!;
  let release!: () => void;
  request.mockImplementation(async (...args) => {
    if (delayed === 'POST' ? args[2] === 'POST' : args[0].includes('/messages?'))
      await new Promise<void>(resolve => {release = resolve;});
    return base(...args);
  });
  const sending = session.send('Mensaje',null);
  await vi.waitFor(() => expect(release).toBeDefined());
  now += 6000;
  await session.checkExitTimeout();
  expect(home).toHaveBeenCalledWith('El plazo del chat terminó.', 'local-expiry');
  const retired = session.getSnapshot();
  release();
  await sending;
  expect(session.getSnapshot()).toBe(retired);
  expect(home).toHaveBeenCalledTimes(1);
});
it('reconciles an elapsed inactivity deadline extended by a counterpart message', async () => {
  chat.inactivityExpiresAt = new Date(Date.now()-2000).toISOString();
  await session.refresh();
  expect(session.canSendText).toBe(false);
  messages.push(messageFixture('2'));
  chat.inactivityExpiresAt = new Date(Date.now()+60_000).toISOString();
  await session.poll();
  expect(session.getSnapshot().messages).toHaveLength(2);
  expect(session.canSendText).toBe(true);
  expect(home).not.toHaveBeenCalled();
});

it('keeps the original response deadline through polls and resume, and lets absolute expiry supersede it', async () => {
  vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
  let now = Date.now();
  vi.spyOn(Date,'now').mockImplementation(() => now);
  const exit = {...exitFixture(), createdAt:new Date(now-10_000).toISOString()};
  exits = [exit];
  chat.timeoutAt = new Date(now+7000).toISOString();
  await session.refresh();
  now += 5000;
  chat.serverTime = new Date(now).toISOString();
  await session.poll();
  await session.resume();
  expect(session.getSnapshot().exits[0]?.createdAt).toBe(exit.createdAt);
  await session.checkExitTimeout();
  expect(writes()).toHaveLength(0);
  now += 2000;
  await session.checkExitTimeout();
  expect(home).toHaveBeenCalledWith('El plazo del chat terminó.', 'local-expiry');
  expect(writes()).toHaveLength(0);
});
it('checks an inactivity extension and then an authoritative abandonment during a pending POST', async () => {
  let now = Date.now();
  vi.spyOn(Date,'now').mockImplementation(() => now);
  chat.inactivityExpiresAt = new Date(now+2000).toISOString();
  await session.refresh();
  const base = request.getMockImplementation()!;
  let release!: () => void;
  request.mockImplementation(async (...args) => {
    if (args[2] === 'POST') await new Promise<void>(resolve => { release=resolve; });
    return base(...args);
  });
  const send = session.send('Mensaje',null);
  now += 3000;
  chat.serverTime = new Date(now).toISOString();
  chat.inactivityExpiresAt = new Date(now+4000).toISOString();
  await session.poll();
  expect(session.getSnapshot().chat?.inactivityExpiresAt).toBe(chat.inactivityExpiresAt);
  expect(home).not.toHaveBeenCalled();
  now += 5000;
  chat.status = 'ABANDONED';
  await session.poll();
  expect(home).toHaveBeenCalledWith('El chat se cerró por inactividad.',true);
  release();
  await send;
  expect(session.getSnapshot().confirmed).toBeNull();
});
it('times out an acknowledged creation even when its complementary history is still pending', async () => {
  vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
  let now = Date.now();
  vi.spyOn(Date,'now').mockImplementation(() => now);
  await session.refresh();
  const exit = {...exitFixture(), createdAt:chat.serverTime}, base = request.getMockImplementation()!;
  let release!: () => void;
  request.mockImplementation(async (...args) => {
    const [path,,method] = args;
    if (path.endsWith('/timeout')) return {exitRequest:{...exit,status:'TIMED_OUT'},chat:{...chat,status:'CANCELLED'}};
    if (method === 'POST') { exits=[exit]; return exit; }
    if (path.includes('/messages?')) await new Promise<void>(resolve => {release=resolve;});
    return base(...args);
  });
  const creation = session.action('mutual');
  await vi.waitFor(() => expect(release).toBeDefined());
  now += 21_000;
  await session.checkExitTimeout();
  expect(home).toHaveBeenCalledWith('La conversación se cerró.',true);
  release();
  await creation;
  expect(home).toHaveBeenCalledTimes(1);
  expect(writes()).toHaveLength(2);
});

it('observes an incoming pause during a stalled send without losing or replaying its POST', async () => {
  let now = Date.now();
  vi.spyOn(Date,'now').mockImplementation(() => now);
  await session.refresh();
  const base = request.getMockImplementation()!;
  let release!: () => void;
  request.mockImplementation(async (...args) => {
    if (args[2] === 'POST') await new Promise<void>(resolve => {release=resolve;});
    return base(...args);
  });
  const sent = session.send('Mensaje en curso',null);
  now += 6000;
  exits = [exitFixture(false)];
  await session.poll();
  expect(session.getSnapshot()).toMatchObject({exits:[{responderUserId:'me'}],outgoing:{phase:'pending'}});
  expect(session.canSendText).toBe(false);
  release();
  await sent;
  expect(session.getSnapshot()).toMatchObject({exits:[{responderUserId:'me'}],confirmed:'Mensaje en curso',outgoing:null});
  expect(writes()).toHaveLength(1);
});

it.each(['ACCEPTED','REJECTED','TIMED_OUT'])('reconciles a competing %s resolution without another timeout POST', async status => {
  vi.spyOn(document,'visibilityState','get').mockReturnValue('visible');
  const exit = {...exitFixture(false),createdAt:new Date(Date.now()-25_000).toISOString()};
  exits = [exit];
  await session.refresh();
  const base = request.getMockImplementation()!;
  request.mockImplementation(async (...args) => {
    if (args[2] === 'POST') {
      exits = [{...exit,status}];
      throw new ApiError('backend',409,'CHAT_EXIT_REQUEST_NOT_AVAILABLE');
    }
    return base(...args);
  });
  await session.checkExitTimeout();
  await session.checkExitTimeout();
  expect(home).toHaveBeenCalledWith('La conversación se cerró.',true);
  expect(writes()).toHaveLength(1);
});

it.each([
  ['UNILATERAL_CANCEL','ACCEPTED','text',true],
  ['SAFETY_REPORT','ACCEPTED','audio',true],
  ['no record','CHAT_REJECTED','text',true],
  ['SAFETY_REPORT','REJECTED','text',false],
  ['UNILATERAL_CANCEL','TIMED_OUT','text',false],
  ['UNKNOWN','ACCEPTED','text',false],
  ['wrong chat','ACCEPTED','text',false],
  ['wrong partner','CHAT_REJECTED','text',false],
  ['read failure','CHAT_ACTIVE','text',false],
] as const)('checks %s / %s during a stalled %s send', async (type,status,media,closed) => {
  let now = Date.now();
  vi.spyOn(Date,'now').mockImplementation(() => now);
  await session.refresh();
  const base = request.getMockImplementation()!;
  let release!: () => void;
  request.mockImplementation(async (...args) => {
    if (args[2] === 'POST') await new Promise<void>(resolve => {release=resolve;});
    if (args[0].endsWith('/exit-requests')) {
      if (type === 'read failure') throw new ApiError('network');
      if (type === 'no record' || type === 'wrong partner') return [];
      return [{...exitFixture(false),chatId:type==='wrong chat'?'another':'c',type:type==='wrong chat'?'SAFETY_REPORT':type,status,details:'private report'}];
    }
    if (args[0] === '/matches/m') return {id:'m',userAId:'me',userBId:type==='wrong partner'?'other':'them',state:type==='no record'||type==='wrong partner'?status:'CHAT_ACTIVE'};
    return base(...args);
  });
  const sent = session.send('Mensaje',null,media==='audio'?new Blob(['audio'],{type:'audio/mp4'}):null);
  const calls = request.mock.calls.length;
  await session.poll();
  expect(request.mock.calls).toHaveLength(calls);
  now += 6000;
  await session.poll();
  const snapshot = session.getSnapshot();
  expect(home).toHaveBeenCalledTimes(closed?1:0);
  expect(snapshot.confirmed).toBeNull();
  expect(JSON.stringify([snapshot,home.mock.calls])).not.toContain('private report');
  release();
  await sent;
  if (closed) expect(session.getSnapshot()).toBe(snapshot);
  expect(writes()).toHaveLength(1);
});

it('verifies inactivity while an earlier stalled-send check is still pending', async () => {
  let now = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => now);

  chat.inactivityExpiresAt = new Date(now + 10_000).toISOString();
  await session.refresh();

  const base = request.getMockImplementation()!;

  let releaseSend!: () => void;
  let releaseReads!: () => void;

  const sendGate = new Promise<void>(resolve => {
    releaseSend = resolve;
  });

  const readGate = new Promise<void>(resolve => {
    releaseReads = resolve;
  });

  request.mockImplementation(async (...args) => {
    const [path, , method] = args;

    if (method === 'POST') await sendGate;

    if (
      path === '/matches/m' ||
      path.endsWith('/exit-requests')
    ) {
      await readGate;
    }

    return base(...args);
  });

  const sending = session.send('Mensaje pendiente', null);

  now += 6000;
  const checking = session.poll();

  try {
    now += 5000;
    chat.status = 'ABANDONED';

    await session.poll();

    expect(home).toHaveBeenCalledWith(
      'El chat se cerró por inactividad.',
      true,
    );

    expect(session.getSnapshot().confirmed).toBeNull();
  } finally {
    releaseReads();
    releaseSend();
    await Promise.all([checking, sending]);
  }

  expect(home).toHaveBeenCalledTimes(1);
  expect(writes()).toHaveLength(1);
});
