import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ApiError } from '../auth/api';
import { SecondChat } from './SecondChat';
import { SecondChatSession } from './SecondChatSession';
import { secondHarness, secondFixture } from './secondFixtures';
import { secondPresentation } from './secondContracts';
import { messageFixture } from './fixtures';
it.each([null,'AVAILABLE','ACTIVE'] as const)('does not present unjoined %s as terminal',async chatStatus=>{
 const h=secondHarness();Object.assign(h.status,{chatStatus,myAttendanceStatus:'PENDING',canJoin:true});render(<SecondChat controller={h.controller} connectionId="connection" matchId="m" onHome={vi.fn()}/>);
 await screen.findByRole('button',{name:'Entrar al segundo chat'});expect(screen.queryByText(/ya no está activo|no está disponible para lectura/)).not.toBeInTheDocument();
});
it('separates all presentation phases without deriving terminal state from timers',()=>{
 const s=secondFixture(),now=Date.parse(s.serverTime);
 expect(secondPresentation(null,now)).toBe('loading');expect(secondPresentation(s,now)).toBe('active');s.partnerAttendanceStatus='PENDING';expect(secondPresentation(s,now)).toBe('waiting');s.myAttendanceStatus='PENDING';s.chatStatus='AVAILABLE';expect(secondPresentation(s,now)).toBe('pre-entry');expect(secondPresentation(s,Date.parse(s.entryClosesAt))).toBe('unavailable');
 s.chatStatus='FINISHED';s.readOnlyUntil=s.absoluteExpiresAt;expect(secondPresentation(s,now)).toBe('terminal-readable');expect(secondPresentation(s,Date.parse(s.absoluteExpiresAt))).toBe('terminal-unavailable');
});
it.each(['block','safety'] as const)('returns Home after acknowledged %s without depending on inaccessible GETs',async kind=>{
 const h=secondHarness(),session=new SecondChatSession(h.controller,'connection','m','me');await session.refresh();const base=h.request.getMockImplementation()!;let acknowledged=false;
 h.request.mockImplementation(async(...args)=>{if(args[2]==='POST'){acknowledged=true;return kind==='block'?{id:'b',source:'MANUAL',createdAt:h.status.serverTime}:{chat:{id:'c',status:'CANCELLED'}};}if(acknowledged)throw new ApiError('backend',403);return base(...args);});
 await session.action(kind,kind==='safety'?{reason:'HARASSMENT',details:'Reporte de prueba',blockUser:false}:undefined);
 expect(session.getSnapshot()).toMatchObject({busy:false,blocked:true,messages:[],outgoing:null});expect(session.getSnapshot().returnHome).toBeTruthy();expect(h.request.mock.calls.filter(c=>c[0].endsWith('/status'))).toHaveLength(1);
});
it('reconciles an uncertain block and returns safely when access was withdrawn, without claiming confirmation',async()=>{
 const h=secondHarness(),session=new SecondChatSession(h.controller,'connection','m','me');await session.refresh();const base=h.request.getMockImplementation()!;let attempted=false;
 h.request.mockImplementation(async(...args)=>{if(args[2]==='POST'){attempted=true;throw new ApiError('network');}if(attempted)throw new ApiError('backend',404);return base(...args);});await session.action('block');expect(session.getSnapshot().returnHome).toContain('no está accesible');expect(h.request.mock.calls.filter(c=>c[2]==='POST')).toHaveLength(1);
});
it.each(['failed','uncertain'] as const)('allows explicit safety after %s send without retrying or replacing its UUID',async phase=>{
 const h=secondHarness(),session=new SecondChatSession(h.controller,'connection','m','me');await session.refresh();const base=h.request.getMockImplementation()!;
 h.request.mockImplementation(async(...args)=>{if(args[2]==='POST'&&args[0].endsWith('/messages'))throw new ApiError(phase==='uncertain'?'network':'backend',phase==='uncertain'?0:400);if(args[0].endsWith('/safety-cancellations'))return{chat:{id:'c',status:'CANCELLED'}};return base(...args);});await session.send('Borrador privado',null);const outgoing=session.getSnapshot().outgoing;expect(outgoing?.phase).toBe(phase);
 const preparation=session.prepareSafety();expect(session.getSnapshot().busy).toBe(true);await session.action('block');expect(await preparation).toBe(true);expect(session.getSnapshot().outgoing?.clientMessageId).toBe(outgoing?.clientMessageId);
 await session.action('safety',{reason:'HARASSMENT',details:'Necesito asistencia',blockUser:false});expect(h.request.mock.calls.filter(c=>c[0].endsWith('/messages')&&c[2]==='POST')).toHaveLength(1);expect(session.getSnapshot().returnHome).toBeTruthy();
});
it('returns once after local absolute expiry but leaves ordinarily retained conversations open',async()=>{
 const h=secondHarness(),home=vi.fn();h.status.chatStatus='FINISHED';h.status.readOnlyUntil='2026-11-13T15:00:00Z';const view=render(<SecondChat controller={h.controller} connectionId="connection" matchId="m" onHome={home}/>);await screen.findByText(/Podés leerlo/);expect(home).not.toHaveBeenCalled();view.unmount();h.status.chatStatus='ACTIVE';h.status.serverTime=h.status.absoluteExpiresAt;render(<SecondChat controller={h.controller} connectionId="connection" matchId="m" onHome={home}/>);await waitFor(()=>expect(home).toHaveBeenCalledOnce());expect(home).toHaveBeenCalledWith('El segundo chat venció.');
});
it('scrubs private data and rejects ignored-abort responses after account replacement',async()=>{
 const h=secondHarness(),session=new SecondChatSession(h.controller,'connection','m','me');h.messages.push(messageFixture());await session.refresh();const base=h.request.getMockImplementation()!;let resolve:(()=>void)|undefined;
 h.request.mockImplementation(async(...args)=>{if(args[0].endsWith('/status'))await new Promise<void>(r=>{resolve=r;});return base(...args);});const old=session.refresh();await vi.waitFor(()=>expect(resolve).toBeDefined());h.controller.snapshot={...h.controller.snapshot,account:{id:'replacement',status:'ACTIVE'}};session.dispose();resolve?.();await old;expect(session.getSnapshot()).toMatchObject({messages:[],status:null,partnerId:'',partnerName:'',outgoing:null});
});
it('unmounts timeline and media when sign-out replaces the authenticated owner',async()=>{
 const h=secondHarness();h.messages.push(messageFixture());const view=render(<SecondChat controller={h.controller} connectionId="connection" matchId="m" onHome={vi.fn()}/>);await screen.findByText('Hola, ¿cómo estás?');act(()=>{h.controller.snapshot={...h.controller.snapshot,phase:'signingOut',account:null};view.rerender(<SecondChat controller={h.controller} connectionId="connection" matchId="m" onHome={vi.fn()}/>);});expect(screen.queryByRole('region',{name:'Segundo chat'})).not.toBeInTheDocument();
});
it('keeps safety UI reachable after a failed outgoing message',async()=>{
 const h=secondHarness(),base=h.request.getMockImplementation()!;h.request.mockImplementation(async(...args)=>{if(args[0].endsWith('/messages')&&args[2]==='POST')throw new ApiError('network');return base(...args);});render(<SecondChat controller={h.controller} connectionId="connection" matchId="m" onHome={vi.fn()}/>);fireEvent.change(await screen.findByRole('textbox',{name:'Mensaje'}),{target:{value:'Hola'}});fireEvent.click(screen.getByRole('button',{name:'Enviar mensaje'}));await screen.findByText('Sin confirmar');fireEvent.click(screen.getByRole('button',{name:'Opciones del chat'}));fireEvent.click(screen.getByRole('menuitem',{name:'Bloquear'}));await screen.findByRole('heading',{name:'Bloquear a esta persona'});
});

it.each(['CANCELLED','CLOSED','FINISHED','ABANDONED','EXPIRED'] as const)('returns Home for genuinely inaccessible terminal %s',async chatStatus=>{const h=secondHarness(),home=vi.fn();h.status.chatStatus=chatStatus;h.status.readOnlyUntil=null;render(<SecondChat controller={h.controller} connectionId="connection" matchId="m" onHome={home}/>);await waitFor(()=>expect(home).toHaveBeenCalledOnce());expect(home).toHaveBeenCalledWith('Este segundo chat ya no está disponible.');});

it('retains a local-expiry return intent while a write settles into retained terminal state',async()=>{
 const h=secondHarness(),session=new SecondChatSession(h.controller,'connection','m','me');await session.refresh();const base=h.request.getMockImplementation()!;let finish:(()=>void)|undefined;
 h.request.mockImplementation(async(...args)=>{if(args[2]==='POST')await new Promise<void>(r=>{finish=r;});return base(...args);});const sending=session.send('Último mensaje',null);
 vi.useFakeTimers();try{vi.setSystemTime(Date.now()+120*60000);session.checkAbsoluteExpiry();expect(session.getSnapshot().returnHome).toBeNull();h.status.chatStatus='EXPIRED';h.status.readOnlyUntil='2026-11-14T15:00:00Z';h.status.serverTime=h.status.absoluteExpiresAt;finish?.();await sending;session.checkAbsoluteExpiry();expect(session.getSnapshot().returnHome).toBe('El segundo chat venció.');}finally{vi.useRealTimers();}
});

it('preserves private chat state during same-account token refresh notifications',async()=>{
 const h=secondHarness();h.messages.push(messageFixture());const home=vi.fn(),view=render(<SecondChat controller={h.controller} connectionId="connection" matchId="m" onHome={home}/>);await screen.findByText('Hola, ¿cómo estás?');act(()=>{h.controller.snapshot={...h.controller.snapshot,authContextVersion:10};view.rerender(<SecondChat controller={h.controller} connectionId="connection" matchId="m" onHome={home}/>);});expect(screen.getByText('Hola, ¿cómo estás?')).toBeInTheDocument();expect(screen.getByRole('textbox',{name:'Mensaje'})).toBeEnabled();expect(home).not.toHaveBeenCalled();
});

it.each(['MANUAL','SAFETY_REPORT','ADMIN'])('accepts authoritative idempotent block acknowledgement preserving stored source %s',async source=>{
 const h=secondHarness(),session=new SecondChatSession(h.controller,'connection','m','me');await session.refresh();const base=h.request.getMockImplementation()!;h.request.mockImplementation(async(...args)=>args[0].endsWith('/block')?{id:'existing-block',source,createdAt:h.status.serverTime}:base(...args));await session.action('block');expect(session.getSnapshot().returnHome).toBe('La persona quedó bloqueada.');expect(h.request.mock.calls.filter(c=>c[0].endsWith('/status'))).toHaveLength(1);
});
