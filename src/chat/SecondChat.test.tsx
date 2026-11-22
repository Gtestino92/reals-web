import { StrictMode } from 'react';
import { SecondChatEntryIntent } from './SecondChatSession';
import { expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SecondChat } from './SecondChat';
import { secondHarness } from './secondFixtures';
import { messageFixture } from './fixtures';
it('tracks the visual viewport with the loaded second-chat composer and retains a focused reply',async()=>{
 const h=secondHarness(); h.messages.push(messageFixture());
 const viewport=Object.assign(new EventTarget(),{height:window.innerHeight,offsetTop:0,scale:1});
 vi.stubGlobal('visualViewport',viewport);
 const view=render(<SecondChat controller={h.controller} connectionId="connection" matchId="m" partnerName="María" onHome={vi.fn()}/>);
 try {
   const input=await screen.findByRole('textbox',{name:'Mensaje'});
   fireEvent.click(screen.getByRole('button',{name:'Responder mensaje de María'}));
   fireEvent.change(input,{target:{value:'Te respondo'}});
   viewport.height=310; viewport.offsetTop=50;
   viewport.dispatchEvent(new Event('resize'));
   expect(screen.getByRole('region',{name:'Segundo chat'}).style.getPropertyValue('--chat-viewport-top')).toBe('50px');
   expect(input).toHaveFocus(); expect(input).toHaveValue('Te respondo');
   expect(screen.getByRole('button',{name:'Quitar respuesta'})).toBeEnabled();
   expect(screen.getByRole('button',{name:'Enviar mensaje'})).toBeEnabled();
 } finally { view.unmount(); vi.unstubAllGlobals(); }
});
it('renders joined waiting and no First Chat decisions or guidance',async()=>{const h=secondHarness();h.status.partnerAttendanceStatus='PENDING';render(<SecondChat controller={h.controller} connectionId="connection" matchId="m" onHome={vi.fn()}/>);await screen.findByText('Podés mandar mensajes mientras esperás. Eso no significa que la otra persona haya llegado.');expect(screen.queryByText('Aprobar chat')).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Volver a Inicio'})).not.toBeInTheDocument();});
it('only responder sees completion decisions; preserves text composer during request',async()=>{const h=secondHarness();h.status.activeResolutionRequest={id:'r',type:'MUTUAL_COMPLETION',status:'PENDING',requesterUserId:'them',responderUserId:'me',referenceMessageId:null,createdAt:h.status.serverTime,expiresAt:'2026-11-13T12:13:00Z'};render(<SecondChat controller={h.controller} connectionId="connection" matchId="m" onHome={vi.fn()}/>);expect(await screen.findByRole('button',{name:'Finalizar el chat'})).toBeEnabled();expect(screen.getByRole('textbox',{name:'Mensaje'})).toBeEnabled();fireEvent.click(screen.getByRole('button',{name:'Seguir conversando'}));await waitFor(()=>expect(h.request.mock.calls.some(c=>c[0].endsWith('/r/decision')&&JSON.stringify(c[3]).includes('REJECTED'))).toBe(true));});
it('renders retained messages without composition or new reactions',async()=>{const h=secondHarness();h.status.chatStatus='FINISHED';h.status.readOnlyUntil='2026-11-13T15:00:00Z';h.messages.push(messageFixture());render(<SecondChat controller={h.controller} connectionId="connection" matchId="m" onHome={vi.fn()}/>);await screen.findByText('Hola, ¿cómo estás?');expect(screen.queryByRole('textbox')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Volver a Inicio'})).toBeEnabled();});
it('safety report and manual blocking keep separate endpoints and dialogs',async()=>{const h=secondHarness();render(<SecondChat controller={h.controller} connectionId="connection" matchId="m" onHome={vi.fn()}/>);await screen.findByRole('textbox',{name:'Mensaje'});fireEvent.click(screen.getByRole('button',{name:'Opciones del chat'}));fireEvent.click(screen.getByRole('menuitem',{name:'Reportar por seguridad'}));fireEvent.change(await screen.findByRole('textbox',{name:'Detalle'}),{target:{value:'Conducta inapropiada'}});fireEvent.click(screen.getByRole('button',{name:'Confirmar'}));await waitFor(()=>expect(h.request.mock.calls.some(c=>c[0]==='/chats/c/safety-cancellations'&&JSON.stringify(c[3]).includes('blockUser'))).toBe(true));});

it('survives StrictMode effect replay with exactly one explicit entry and no join on remount without intent',async()=>{
 const h=secondHarness();Object.assign(h.status,{canJoin:true,myAttendanceStatus:'PENDING',myJoinedAt:null});
 const intent=new SecondChatEntryIntent(h.controller,'connection','m');
 const view=render(<StrictMode><SecondChat controller={h.controller} connectionId="connection" matchId="m" entryIntent={intent} onHome={vi.fn()}/></StrictMode>);
 await waitFor(()=>expect(h.request.mock.calls.filter(c=>c[0].endsWith('/join'))).toHaveLength(1));
 await waitFor(()=>expect(screen.queryByText('Procesando…')).toBeNull());
 view.unmount();Object.assign(h.status,{canJoin:true,myAttendanceStatus:'PENDING',myJoinedAt:null});h.request.mockClear();render(<SecondChat controller={h.controller} connectionId="connection" matchId="m" onHome={vi.fn()}/>);
 await screen.findByRole('button',{name:'Entrar al segundo chat'});fireEvent(window,new Event('online'));fireEvent(document,new Event('visibilitychange'));
 await waitFor(()=>expect(h.request.mock.calls.filter(c=>c[0].endsWith('/status')).length).toBeGreaterThan(0));expect(h.request.mock.calls.some(c=>c[0].endsWith('/join'))).toBe(false);
});
