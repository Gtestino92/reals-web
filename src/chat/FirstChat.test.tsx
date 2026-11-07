import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { FirstChat } from './FirstChat';
import { chatFixture, controllerFixture, messageFixture } from './fixtures';
let controller:ReturnType<typeof controllerFixture>, chat:ReturnType<typeof chatFixture>, messages:ReturnType<typeof messageFixture>[];
let home:ReturnType<typeof vi.fn<(message?:string)=>void>>;
beforeEach(()=>{
  controller=controllerFixture();chat=chatFixture();messages=[messageFixture()];home=vi.fn();
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value:function(this:HTMLDialogElement){this.open=true;}});
  Object.defineProperty(HTMLDialogElement.prototype,'close',{configurable:true,value:function(this:HTMLDialogElement){this.open=false;}});
  vi.spyOn(controller,'request').mockImplementation(async(path,_signal,method='GET',body)=>{
    if(path==='/matches/m')return {id:'m',userAId:'me',userBId:'them',state:'CHAT_ACTIVE'};
    if(path==='/matches/m/chat')return chat;
    if(path.endsWith('/exit-requests'))return [];
    if(path.startsWith('/chats/c/messages?'))return [...messages];
    if(path==='/chats/c/messages'&&method==='POST'){const m={...messageFixture(String(messages.length+1),'me'),...(body as {content:string;clientMessageId:string})};messages.push(m);return m;}
    return {};
  });
});
const mount=()=>render(<StrictMode><FirstChat controller={controller} matchId="m" chatId="c" onHome={home}/></StrictMode>);
const ready=async()=>{await screen.findByRole('heading',{name:'María'});await waitFor(()=>expect(screen.getByRole('textbox',{name:'Mensaje'})).toBeEnabled());};
it('works under StrictMode and renders safe chronological messages without photos',async()=>{messages[0]!.content='<img src=x onerror=bad>';mount();await ready();expect(screen.getByText('<img src=x onerror=bad>')).toBeVisible();expect(document.querySelector('img')).toBeNull();expect(screen.getByRole('list',{name:'Mensajes'})).toBeVisible();});
it('clears only a confirmed draft and preserves the next draft on incoming polling',async()=>{mount();await ready();const input=screen.getByRole('textbox',{name:'Mensaje'});fireEvent.change(input,{target:{value:'¡Hola!'}});fireEvent.click(screen.getByRole('button',{name:'Enviar mensaje'}));await waitFor(()=>expect(input).toHaveValue(''));fireEvent.change(input,{target:{value:'Nuevo borrador'}});messages.push(messageFixture('3'));fireEvent.click(screen.getByRole('button',{name:'Actualizar'}));await waitFor(()=>expect(screen.getAllByText('Hola, ¿cómo estás?')).toHaveLength(2));expect(input).toHaveValue('Nuevo borrador');});
it('uses immutable question identity for direct replies',async()=>{mount();await ready();fireEvent.click(screen.getByRole('button',{name:'Responder pregunta'}));fireEvent.change(screen.getByRole('textbox',{name:'Mensaje'}),{target:{value:'La música'}});fireEvent.click(screen.getByRole('button',{name:'Enviar mensaje'}));await waitFor(()=>expect(controller.request).toHaveBeenCalledWith('/chats/c/messages',expect.any(AbortSignal),'POST',expect.objectContaining({replyTo:{type:'GUIDANCE_QUESTION',targetId:'question-1'}})));});
it('replies to incoming messages without embedding a nested quote',async()=>{mount();await ready();fireEvent.click(screen.getByRole('button',{name:/^Responder$/}));fireEvent.change(screen.getByRole('textbox',{name:'Mensaje'}),{target:{value:'Bien'}});fireEvent.click(screen.getByRole('button',{name:'Enviar mensaje'}));await waitFor(()=>expect(controller.request).toHaveBeenCalledWith('/chats/c/messages',expect.any(AbortSignal),'POST',expect.objectContaining({replyTo:{type:'MESSAGE',targetId:'1'}})));});
it('decision-only disables conversation but leaves final decision and safety',async()=>{chat.partnerDecision='APPROVED';mount();await screen.findByRole('heading',{name:'María'});expect(screen.getByRole('textbox',{name:'Mensaje'})).toBeDisabled();expect(screen.getByRole('button',{name:'Aprobar chat'})).toBeEnabled();expect(screen.getByRole('button',{name:'Salida consensuada'})).toBeDisabled();expect(screen.getByRole('button',{name:'Reportar por seguridad'})).toBeEnabled();});
it('safety form requires valid details and sends reason and optional block',async()=>{mount();await ready();fireEvent.click(screen.getByRole('button',{name:'Reportar por seguridad'}));expect(screen.getByRole('dialog')).toBeVisible();expect(screen.getByRole('button',{name:'Confirmar'})).toBeDisabled();fireEvent.change(screen.getByRole('textbox',{name:'Detalle'}),{target:{value:'Descripción del incidente'}});fireEvent.change(screen.getByRole('combobox',{name:'Motivo'}),{target:{value:'HARASSMENT'}});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Confirmar'}));await waitFor(()=>expect(controller.request).toHaveBeenCalledWith('/chats/c/safety-cancellations',expect.any(AbortSignal),'POST',{reason:'HARASSMENT',details:'Descripción del incidente',blockUser:true}));});
it('warns before leaving with an unsent draft',async()=>{vi.spyOn(window,'confirm').mockReturnValue(false);mount();await ready();fireEvent.change(screen.getByRole('textbox',{name:'Mensaje'}),{target:{value:'Sin enviar'}});fireEvent.click(screen.getByRole('button',{name:'Volver a Inicio'}));expect(home).not.toHaveBeenCalled();expect(screen.getByRole('textbox',{name:'Mensaje'})).toHaveValue('Sin enviar');});
it('unmount aborts outstanding requests and removes the poller',async()=>{const view=mount();await ready();const signals=vi.mocked(controller.request).mock.calls.map(c=>c[1]);view.unmount();expect(signals.every(s=>s.aborted)).toBe(true);});
it('waiting guidance never displays an actionable next control',async()=>{chat.guidance.myNextRequested=true;mount();await ready();expect(screen.getByText('Esperando a la otra persona para continuar.')).toBeVisible();expect(screen.queryByRole('button',{name:'Otra pregunta'})).toBeNull();});
it('guidance completion is rendered from the snapshot',async()=>{chat.guidance.completed=true;mount();await ready();expect(screen.getByText('Etapa guiada completada.')).toBeVisible();});
it('shows message updates without moving focus out of composer',async()=>{mount();await ready();const input=screen.getByRole('textbox',{name:'Mensaje'});input.focus();messages.push(messageFixture('2'));await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Actualizar'})));expect(input).toHaveFocus();});
