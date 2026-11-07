import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FirstChat } from './FirstChat';
import { chatFixture, controllerFixture, messageFixture } from './fixtures';
import type { Message } from './contracts';
let controller:ReturnType<typeof controllerFixture>, chat:ReturnType<typeof chatFixture>, messages:Message[];
let home:ReturnType<typeof vi.fn<(message?:string)=>void>>;
beforeEach(()=>{
  vi.stubGlobal('matchMedia',vi.fn(()=>({matches:true})));
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
  vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});
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
afterEach(()=>vi.unstubAllGlobals());
const mount=()=>render(<StrictMode><FirstChat controller={controller} matchId="m" chatId="c" onHome={home}/></StrictMode>);
const ready=async()=>{await screen.findByRole('heading',{name:'María'});await waitFor(()=>expect(screen.getByRole('textbox',{name:'Mensaje'})).toBeEnabled());};
it('works under StrictMode and renders safe chronological messages without photos',async()=>{messages[0]!.content='<img src=x onerror=bad>';mount();await ready();expect(screen.getByText('<img src=x onerror=bad>')).toBeVisible();expect(document.querySelector('img')).toBeNull();expect(screen.getByRole('list',{name:'Mensajes'})).toBeVisible();});
it('clears only a confirmed draft and preserves the next draft on incoming polling',async()=>{mount();await ready();const input=screen.getByRole('textbox',{name:'Mensaje'});fireEvent.change(input,{target:{value:'¡Hola!'}});fireEvent.click(screen.getByRole('button',{name:'Enviar mensaje'}));await waitFor(()=>expect(input).toHaveValue(''));fireEvent.change(input,{target:{value:'Nuevo borrador'}});messages.push(messageFixture('3'));fireEvent(window,new Event('online'));await waitFor(()=>expect(screen.getAllByText('Hola, ¿cómo estás?')).toHaveLength(2));expect(input).toHaveValue('Nuevo borrador');});
it('uses immutable question identity for direct replies',async()=>{mount();await ready();fireEvent.click(screen.getByRole('button',{name:'Responder pregunta'}));fireEvent.change(screen.getByRole('textbox',{name:'Mensaje'}),{target:{value:'La música'}});fireEvent.click(screen.getByRole('button',{name:'Enviar mensaje'}));await waitFor(()=>expect(controller.request).toHaveBeenCalledWith('/chats/c/messages',expect.any(AbortSignal),'POST',expect.objectContaining({replyTo:{type:'GUIDANCE_QUESTION',targetId:'question-1'}})));});
it('replies to incoming messages without embedding a nested quote',async()=>{mount();await ready();fireEvent.click(screen.getByRole('button',{name:/^Responder mensaje de/}));fireEvent.change(screen.getByRole('textbox',{name:'Mensaje'}),{target:{value:'Bien'}});fireEvent.click(screen.getByRole('button',{name:'Enviar mensaje'}));await waitFor(()=>expect(controller.request).toHaveBeenCalledWith('/chats/c/messages',expect.any(AbortSignal),'POST',expect.objectContaining({replyTo:{type:'MESSAGE',targetId:'1'}})));});
it('decision-only disables conversation but leaves final decision and safety',async()=>{chat.partnerDecision='APPROVED';mount();await screen.findByRole('heading',{name:'María'});expect(screen.getByRole('textbox',{name:'Mensaje'})).toBeDisabled();expect(screen.getByRole('button',{name:'Aprobar chat'})).toBeEnabled();fireEvent.click(screen.getByRole('button',{name:'Opciones del chat'}));expect(screen.queryByRole('menuitem',{name:'Salida consensuada'})).toBeNull();expect(screen.getByRole('menuitem',{name:'Reportar por seguridad'})).toBeEnabled();});
it('safety form requires valid details and sends reason and optional block',async()=>{mount();await ready();fireEvent.click(screen.getByRole('button',{name:'Opciones del chat'}));fireEvent.click(screen.getByRole('menuitem',{name:'Reportar por seguridad'}));expect(screen.getByRole('dialog')).toBeVisible();expect(screen.getByRole('button',{name:'Confirmar'})).toBeDisabled();fireEvent.change(screen.getByRole('textbox',{name:'Detalle'}),{target:{value:'Descripción del incidente'}});fireEvent.change(screen.getByRole('combobox',{name:'Motivo'}),{target:{value:'HARASSMENT'}});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Confirmar'}));await waitFor(()=>expect(controller.request).toHaveBeenCalledWith('/chats/c/safety-cancellations',expect.any(AbortSignal),'POST',{reason:'HARASSMENT',details:'Descripción del incidente',blockUser:true}));});
it('warns before leaving with an unsent draft',async()=>{vi.spyOn(window,'confirm').mockReturnValue(false);mount();await ready();fireEvent.change(screen.getByRole('textbox',{name:'Mensaje'}),{target:{value:'Sin enviar'}});fireEvent(window,new PopStateEvent('popstate'));expect(home).not.toHaveBeenCalled();expect(screen.getByRole('textbox',{name:'Mensaje'})).toHaveValue('Sin enviar');});
it('unmount aborts outstanding requests and removes the poller',async()=>{const view=mount();await ready();const signals=vi.mocked(controller.request).mock.calls.map(c=>c[1]);view.unmount();expect(signals.every(s=>s.aborted)).toBe(true);});
it('waiting guidance never displays an actionable next control',async()=>{chat.guidance.myNextRequested=true;mount();await ready();expect(screen.getByText('Esperando a la otra persona para continuar.')).toBeVisible();expect(screen.queryByRole('button',{name:'Otra pregunta'})).toBeNull();});
it('guidance completion is rendered from the snapshot',async()=>{chat.guidance.completed=true;mount();await ready();expect(screen.getByText('Etapa guiada completada.')).toBeVisible();});
it('shows message updates without moving focus out of composer',async()=>{mount();await ready();const input=screen.getByRole('textbox',{name:'Mensaje'});input.focus();messages.push(messageFixture('2'));await act(async()=>fireEvent(window,new Event('online')));expect(input).toHaveFocus();});

it('menu supports keyboard traversal, Escape, outside dismissal and focus restoration',async()=>{
  mount();await ready();const trigger=screen.getByRole('button',{name:'Opciones del chat'});
  expect(screen.queryByRole('button',{name:'Actualizar'})).toBeNull();expect(screen.queryByRole('button',{name:'Volver a Inicio'})).toBeNull();
  fireEvent.keyDown(trigger,{key:'ArrowDown'});expect(screen.getByRole('menuitem',{name:'Rechazar chat'})).toHaveFocus();
  fireEvent.keyDown(document.activeElement!,{key:'End'});expect(screen.getByRole('menuitem',{name:'Bloquear'})).toHaveFocus();
  fireEvent.keyDown(document.activeElement!,{key:'Escape'});expect(trigger).toHaveFocus();expect(screen.queryByRole('menu')).toBeNull();
  fireEvent.click(trigger);fireEvent.pointerDown(screen.getByRole('textbox',{name:'Mensaje'}));expect(screen.queryByRole('menu')).toBeNull();
  expect(screen.getByRole('heading',{name:'María'}).compareDocumentPosition(screen.getByRole('button',{name:'Aprobar chat'})) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
it.each([
  ['Rechazar chat','/matches/m/chat-decision'],
  ['Salida consensuada','/chats/c/exit-requests'],
  ['Salir unilateralmente','/chats/c/cancellations'],
  ['Bloquear','/matches/m/block'],
])('menu preserves confirmation and service for %s',async(label,path)=>{
  mount();await ready();fireEvent.click(screen.getByRole('button',{name:'Opciones del chat'}));fireEvent.click(screen.getByRole('menuitem',{name:label}));
  expect(screen.getByRole('dialog')).toBeVisible();expect(vi.mocked(controller.request).mock.calls.some(c=>c[0]===path&&c[2]==='POST')).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'Confirmar'}));await waitFor(()=>expect(vi.mocked(controller.request).mock.calls.some(c=>c[0]===path&&c[2]==='POST')).toBe(true));
});

it('toggles closed after pointer focus moves to trigger and can reopen under StrictMode',async()=>{
  mount();await ready();const trigger=screen.getByRole('button',{name:'Opciones del chat'});
  fireEvent.click(trigger);expect(screen.getByRole('menu')).toBeVisible();
  // fireEvent.click alone omits the browser focus transition preceding click.
  fireEvent.pointerDown(trigger);act(()=>trigger.focus());
  expect(screen.getByRole('menu')).toBeVisible();
  fireEvent.click(trigger);expect(screen.queryByRole('menu')).toBeNull();expect(trigger).toHaveAttribute('aria-expanded','false');
  fireEvent.click(trigger);expect(screen.getByRole('menu')).toBeVisible();
  fireEvent.keyDown(document.activeElement!,{key:'ArrowDown'});expect(screen.getByRole('menuitem',{name:'Salida consensuada'})).toHaveFocus();
  act(()=>trigger.focus());expect(screen.getByRole('menu')).toBeVisible();
  fireEvent.keyDown(trigger,{key:'Escape'});expect(screen.queryByRole('menu')).toBeNull();expect(trigger).toHaveFocus();
});
it('keeps focus moves inside the boundary open and dismisses focus leaving it',async()=>{
  mount();await ready();const trigger=screen.getByRole('button',{name:'Opciones del chat'});fireEvent.click(trigger);
  act(()=>trigger.focus());act(()=>screen.getByRole('menuitem',{name:'Bloquear'}).focus());expect(screen.getByRole('menu')).toBeVisible();
  act(()=>screen.getByRole('textbox',{name:'Mensaje'}).focus());expect(screen.queryByRole('menu')).toBeNull();
});
it('disabled menu actions cannot open a confirmation or send a mutation',async()=>{
  chat.myDecision='APPROVED';mount();await screen.findByRole('heading',{name:'María'});
  fireEvent.click(screen.getByRole('button',{name:'Opciones del chat'}));const reject=screen.getByRole('menuitem',{name:'Rechazar chat'});
  expect(reject).toBeDisabled();fireEvent.click(reject);expect(screen.queryByRole('dialog')).toBeNull();expect(screen.getByRole('menu')).toBeVisible();
  expect(vi.mocked(controller.request).mock.calls.some(c=>c[2]==='POST')).toBe(false);
});

function swipe(target: Element) {
  for (const [type,x] of [['pointerdown',0],['pointermove',70],['pointerup',70]] as const) {
    const event=new MouseEvent(type,{bubbles:true,clientX:x,button:0});
    Object.defineProperties(event,{pointerId:{value:1},isPrimary:{value:true},pointerType:{value:'touch'}});fireEvent(target,event);
  }
}
it('swipes question and incoming audio with immutable direct target IDs',async()=>{
  Element.prototype.setPointerCapture=vi.fn();Element.prototype.hasPointerCapture=vi.fn(()=>false);
  messages[0]={...messageFixture(),messageType:'AUDIO',content:null,audio:{url:'https://example.test/audio',contentType:'audio/mp4',durationMillis:1000,sizeBytes:10}};
  mount();await ready();
  swipe(screen.getByRole('complementary',{name:'Conversación guiada'}).parentElement!);
  fireEvent.change(screen.getByRole('textbox',{name:'Mensaje'}),{target:{value:'Respuesta'}});fireEvent.click(screen.getByRole('button',{name:'Enviar mensaje'}));
  await waitFor(()=>expect(controller.request).toHaveBeenCalledWith('/chats/c/messages',expect.any(AbortSignal),'POST',expect.objectContaining({replyTo:{type:'GUIDANCE_QUESTION',targetId:'question-1'}})));
  await waitFor(()=>expect(screen.getByRole('textbox',{name:'Mensaje'})).toBeEnabled());
  swipe(screen.getByLabelText('Mensaje de audio').closest('.reply-swipe')!);
  expect(screen.getByText('Mensaje de audio')).toBeVisible();
  fireEvent.change(screen.getByRole('textbox',{name:'Mensaje'}),{target:{value:'Otra respuesta'}});fireEvent.click(screen.getByRole('button',{name:'Enviar mensaje'}));
  await waitFor(()=>expect(controller.request).toHaveBeenCalledWith('/chats/c/messages',expect.any(AbortSignal),'POST',expect.objectContaining({replyTo:{type:'MESSAGE',targetId:'1'}})));
});
it('keeps incoming hearts outside bubbles and own received hearts passive',async()=>{
  messages=[{...messageFixture('1'),reactionType:'HEART'}, {...messageFixture('2','me'),reactionType:'HEART'}];
  mount();await ready();
  expect(screen.getByRole('img',{name:'Reaccionaste con corazón'}).closest('.chat-reaction-lane')).not.toBeNull();
  expect(screen.getByRole('img',{name:'La otra persona reaccionó con corazón'}).closest('.chat-message')).toBeNull();
  expect(screen.queryByRole('button',{name:/Reaccionar con/})).toBeNull();
  expect(screen.getAllByRole('button',{name:/Responder mensaje/})).toHaveLength(1);
});
it('locks a pending reaction and installs only the confirmed HEART response',async()=>{
  const original=vi.mocked(controller.request).getMockImplementation()!;
  let resolve: ((value:unknown)=>void) | undefined;
  vi.mocked(controller.request).mockImplementation((path,signal,method,body)=>path.endsWith('/reaction')?new Promise(r=>{resolve=r;}):original(path,signal,method,body));
  mount();await ready();const heart=screen.getByRole('button',{name:'Reaccionar con corazón'});
  expect(heart.closest('.chat-message')).toBeNull();fireEvent.click(heart);fireEvent.click(heart);
  expect(screen.getByRole('button',{name:'Guardando corazón'})).toBeDisabled();
  expect(vi.mocked(controller.request).mock.calls.filter(c=>c[0].endsWith('/reaction'))).toHaveLength(1);
  messages[0]={...messages[0]!,reactionType:'HEART'};await act(async()=>resolve?.(messages[0]));
  expect(await screen.findByRole('img',{name:'Reaccionaste con corazón'})).toBeVisible();
});
it('cancels a question gesture when authoritative question identity changes',async()=>{
  Element.prototype.setPointerCapture=vi.fn();Element.prototype.hasPointerCapture=vi.fn(()=>false);
  mount();await ready();const old=screen.getByRole('complementary',{name:'Conversación guiada'}).parentElement!;
  for (const [type,x] of [['pointerdown',0],['pointermove',90]] as const) {
    const event=new MouseEvent(type,{bubbles:true,clientX:x,button:0});
    Object.defineProperties(event,{pointerId:{value:1},isPrimary:{value:true},pointerType:{value:'touch'}});fireEvent(old,event);
  }
  chat={...chat,guidance:{...chat.guidance,question:{...chat.guidance.question,instanceId:'question-2',text:'Nueva pregunta'}}};
  fireEvent(window,new Event('online'));await screen.findByText('Nueva pregunta');
  fireEvent.pointerUp(old);expect(screen.queryByRole('button',{name:'Quitar respuesta'})).toBeNull();
});
it('hides guidance and reply affordances in decision-only mode',async()=>{
  chat.partnerDecision='APPROVED';mount();await screen.findByRole('heading',{name:'María'});
  expect(screen.queryByRole('complementary',{name:'Conversación guiada'})).toBeNull();
  expect(screen.queryByRole('button',{name:/Responder mensaje|Responder pregunta/})).toBeNull();
  expect(screen.getByRole('button',{name:'Reaccionar con corazón'})).toBeDisabled();
});
it.each(['success','failure'] as const)('reaction %s never scrolls or inserts a loading row, near bottom or in older content',async outcome=>{
  const original=vi.mocked(controller.request).getMockImplementation()!;
  let complete: ((value:unknown)=>void) | undefined, fail: ((error:unknown)=>void) | undefined;
  let holdRead=false, resumeRead: (()=>void) | undefined;
  vi.mocked(controller.request).mockImplementation((path,signal,method,body)=>{
    if(path.endsWith('/reaction'))return new Promise((resolve,reject)=>{complete=resolve;fail=reject;});
    if(holdRead&&path==='/matches/m')return new Promise(resolve=>{resumeRead=()=>{holdRead=false;void original(path,signal,method,body).then(resolve);};});
    return original(path,signal,method,body);
  });
  mount();await ready();const list=screen.getByRole('list',{name:'Mensajes'}), bubble=list.querySelector('article');
  let position=outcome==='success'?675:100;
  const scroll=vi.fn((next:number)=>{position=next;});
  Object.defineProperties(list,{scrollTop:{configurable:true,get:()=>position,set:scroll},scrollHeight:{configurable:true,value:1000},clientHeight:{configurable:true,value:300}});
  fireEvent.scroll(list);
  fireEvent.click(screen.getByRole('button',{name:'Reaccionar con corazón'}));
  expect(screen.queryByText('Actualizando…')).toBeNull();
  await act(async()=>{if(outcome==='success'){messages[0]={...messages[0]!,reactionType:'HEART'};complete?.(messages[0]);}else {holdRead=true;fail?.(new TypeError('Synthetic network failure'));}});
  expect(scroll).not.toHaveBeenCalled();expect(list.querySelector('article')).toBe(bubble);
  if(outcome==='failure'){
    expect(screen.getByRole('alert')).toHaveClass('chat-reaction-error');
    expect(screen.queryByText('Actualizando…')).toBeNull();
    expect(screen.getByRole('button',{name:'Reintentar conexión'})).toBeDisabled();
    await act(async()=>resumeRead?.());
    fireEvent.click(screen.getByRole('button',{name:'Reintentar conexión'}));await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
    expect(vi.mocked(controller.request).mock.calls.filter(c=>c[0].endsWith('/reaction'))).toHaveLength(1);
  }
});
it('renders a compact question with an accessible chevron using the existing progression action',async()=>{
  mount();await ready();const card=screen.getByRole('complementary',{name:'Conversación guiada'});
  expect(card).toHaveTextContent('Pregunta 1 de 3');expect(card).toHaveTextContent('¿Qué te inspira?');
  expect(card).not.toHaveTextContent('Sigan participando');expect(card).not.toHaveTextContent('Ya podés');
  const next=screen.getByRole('button',{name:'Otra pregunta'});expect(next.querySelector('svg')).not.toBeNull();expect(next).toHaveTextContent('');
  fireEvent.click(next);await waitFor(()=>expect(controller.request).toHaveBeenCalledWith('/chats/c/guidance/next-request',expect.any(AbortSignal),'POST',undefined));
});
it.each(['ineligible','waiting','completed','unknown','final-null'] as const)('does not expose a progression control for %s guidance',async mode=>{
  if(mode==='ineligible')chat.guidance.canRequestNext=false;
  if(mode==='waiting')chat.guidance.myNextRequested=true;
  if(mode==='completed')chat.guidance.completed=true;
  if(mode==='unknown')chat.guidance.progressionAction='FUTURE_ACTION';
  if(mode==='final-null')Object.assign(chat.guidance,{questionOrdinal:3,progressionAction:null});
  mount();await ready();expect(screen.queryByRole('button',{name:'Otra pregunta'})).toBeNull();expect(screen.queryByRole('button',{name:'Completar etapa'})).toBeNull();
  expect(screen.getByText('¿Qué te inspira?')).toBeVisible();
});
it('distinguishes completion from next and disables it while submitting',async()=>{
  Object.assign(chat.guidance,{questionOrdinal:3,progressionAction:'COMPLETE'});
  const original=vi.mocked(controller.request).getMockImplementation()!;
  vi.mocked(controller.request).mockImplementation((path,signal,method,body)=>path.endsWith('/guidance/next-request')?new Promise(()=>{}):original(path,signal,method,body));
  mount();await ready();const complete=screen.getByRole('button',{name:'Completar etapa'});expect(complete).toHaveTextContent('Completar');expect(complete).not.toHaveTextContent('›');
  fireEvent.click(complete);expect(complete).toBeDisabled();fireEvent.click(complete);expect(vi.mocked(controller.request).mock.calls.filter(c=>c[0].endsWith('/guidance/next-request'))).toHaveLength(1);
});
const enter=(input:HTMLElement,options:KeyboardEventInit={})=>fireEvent.keyDown(input,{key:'Enter',code:'Enter',...options});
it('desktop Enter sends the existing message reply once through the form',async()=>{
  mount();await ready();fireEvent.click(screen.getByRole('button',{name:/Responder mensaje de/}));
  const input=screen.getByRole('textbox',{name:'Mensaje'});fireEvent.change(input,{target:{value:'Respuesta por teclado'}});
  expect(enter(input)).toBe(false);
  await waitFor(()=>expect(controller.request).toHaveBeenCalledWith('/chats/c/messages',expect.any(AbortSignal),'POST',expect.objectContaining({content:'Respuesta por teclado',replyTo:{type:'MESSAGE',targetId:'1'}})));
  expect(vi.mocked(controller.request).mock.calls.filter(c=>c[0]==='/chats/c/messages')).toHaveLength(1);
});
it.each([{shiftKey:true},{isComposing:true},{keyCode:229},{code:''},{code:'Unidentified'}])('preserves native input instead of sending for %j',async options=>{
  mount();await ready();const input=screen.getByRole('textbox',{name:'Mensaje'});fireEvent.change(input,{target:{value:'Texto'}});
  expect(enter(input,options)).toBe(true);expect(vi.mocked(controller.request).mock.calls.some(c=>c[2]==='POST')).toBe(false);
});
it('tracks IME composition until it ends',async()=>{
  mount();await ready();const input=screen.getByRole('textbox',{name:'Mensaje'});fireEvent.change(input,{target:{value:'Texto'}});
  fireEvent.compositionStart(input);expect(enter(input)).toBe(true);expect(vi.mocked(controller.request).mock.calls.some(c=>c[2]==='POST')).toBe(false);
  fireEvent.compositionEnd(input);enter(input);await waitFor(()=>expect(vi.mocked(controller.request).mock.calls.some(c=>c[2]==='POST')).toBe(true));
});
it.each(['','   ','<invalid>'])('does not submit empty or invalid text %j',async value=>{
  mount();await ready();const input=screen.getByRole('textbox',{name:'Mensaje'});fireEvent.change(input,{target:{value}});enter(input);
  expect(vi.mocked(controller.request).mock.calls.some(c=>c[2]==='POST')).toBe(false);
});
it('keeps multiline Enter behavior for coarse/touch input capabilities regardless of width',async()=>{
  vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false})));
  mount();await ready();const input=screen.getByRole('textbox',{name:'Mensaje'});fireEvent.change(input,{target:{value:'Texto'}});
  expect(enter(input)).toBe(true);expect(vi.mocked(controller.request).mock.calls.some(c=>c[2]==='POST')).toBe(false);
});
it('prevents duplicates from repeated Enter and simultaneous form submission while pending',async()=>{
  const original=vi.mocked(controller.request).getMockImplementation()!;
  vi.mocked(controller.request).mockImplementation((path,signal,method,body)=>path==='/chats/c/messages'&&method==='POST'?new Promise(()=>{}):original(path,signal,method,body));
  mount();await ready();const input=screen.getByRole('textbox',{name:'Mensaje'});fireEvent.change(input,{target:{value:'Una vez'}});
  enter(input,{repeat:true});expect(vi.mocked(controller.request).mock.calls.some(c=>c[2]==='POST')).toBe(false);
  enter(input);enter(input);fireEvent.submit(input.closest('form')!);
  expect(vi.mocked(controller.request).mock.calls.filter(c=>c[0]==='/chats/c/messages')).toHaveLength(1);expect(input).toBeEnabled();fireEvent.change(input,{target:{value:'Siguiente borrador'}});expect(input).toHaveValue('Siguiente borrador');
});
it('never sends with Enter in decision-only mode',async()=>{
  chat.partnerDecision='APPROVED';mount();await screen.findByRole('heading',{name:'María'});const input=screen.getByRole('textbox',{name:'Mensaje'});
  fireEvent.change(input,{target:{value:'No permitido'}});enter(input);expect(vi.mocked(controller.request).mock.calls.some(c=>c[2]==='POST')).toBe(false);
});
it('keeps a labelled preview structurally above input and clearing it preserves typed text',async()=>{
  mount();await ready();const input=screen.getByRole('textbox',{name:'Mensaje'});fireEvent.change(input,{target:{value:'Mi borrador'}});
  fireEvent.click(screen.getByRole('button',{name:/Responder mensaje de/}));const preview=screen.getByRole('complementary',{name:'Respuesta seleccionada'});
  expect(within(preview).getByText('María')).toBeVisible();expect(preview.compareDocumentPosition(input)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();expect(input).toHaveFocus();
  expect(preview.closest('form')).toBe(input.closest('form'));fireEvent.click(screen.getByRole('button',{name:'Quitar respuesta'}));expect(input).toHaveValue('Mi borrador');
  const send=screen.getByRole('button',{name:'Enviar mensaje'});expect(send.querySelector('svg')).not.toBeNull();expect(send.textContent).toBe('');
});
it('labels history citations by quoted author, never by the replying author',async()=>{
  messages=[{...messageFixture('1','them'),replyTo:{type:'MESSAGE',targetId:'x',previewText:'Texto mío',senderId:'me',messageType:'TEXT'}},
    {...messageFixture('2','me'),replyTo:{type:'MESSAGE',targetId:'y',previewText:'Texto de María',senderId:'them',messageType:'TEXT'}},
    {...messageFixture('3','me'),replyTo:{type:'GUIDANCE_QUESTION',targetId:'q',previewText:'Pregunta original'}},
    {...messageFixture('4','them'),replyTo:{type:'MESSAGE',targetId:'a',previewText:null,senderId:'me',messageType:'AUDIO'}},
    {...messageFixture('5','them'),replyTo:{type:'MESSAGE',targetId:'legacy',previewText:'Sin autor'}}];
  mount();await ready();const quotes=document.querySelectorAll('blockquote');
  expect(quotes[0]).toHaveTextContent('Vos');expect(quotes[1]).toHaveTextContent('María');expect(quotes[2]).toHaveTextContent('Pregunta');expect(quotes[3]).toHaveTextContent('Mensaje de audio');expect(quotes[4]).toHaveTextContent('Respuesta');expect(quotes[4]).not.toHaveTextContent('María');
});
it('preserves the text and quoted target when delivery is uncertain',async()=>{
  const original=vi.mocked(controller.request).getMockImplementation()!;
  vi.mocked(controller.request).mockImplementation((path,signal,method,body)=>path==='/chats/c/messages'&&method==='POST'?Promise.reject(new TypeError('Synthetic failure')):original(path,signal,method,body));
  mount();await ready();fireEvent.click(screen.getByRole('button',{name:'Responder pregunta'}));const input=screen.getByRole('textbox',{name:'Mensaje'});fireEvent.change(input,{target:{value:'Respuesta pendiente'}});enter(input);
  await screen.findByText('Sin confirmar');expect(input).toHaveValue('Respuesta pendiente');expect(screen.getByRole('complementary',{name:'Respuesta seleccionada'})).toHaveTextContent('Pregunta');expect(screen.getByRole('button',{name:'Quitar respuesta'})).toBeDisabled();
});

it.each(['guidance','reaction','message'] as const)('keeps global presentation stable during %s writes',async kind=>{
  const original=vi.mocked(controller.request).getMockImplementation()!;
  vi.mocked(controller.request).mockImplementation((path,signal,method,body)=>method&&method!=='GET'?new Promise(()=>{}):original(path,signal,method,body));
  mount();await ready();const input=screen.getByRole('textbox',{name:'Mensaje'});act(()=>input.focus());
  if(kind==='guidance')fireEvent.click(screen.getByRole('button',{name:'Otra pregunta'}));
  if(kind==='reaction')fireEvent.click(screen.getByRole('button',{name:'Reaccionar con corazón'}));
  if(kind==='message'){fireEvent.change(input,{target:{value:'Texto enviado'}});enter(input);}
  expect(screen.getByRole('button',{name:'Aprobar chat'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Aprobar chat'})).toHaveClass('chat-stable-control');
  expect(screen.queryByText('Actualizando?')).toBeNull();expect(input).toBeEnabled();expect(input).toHaveFocus();
  if(kind==='guidance')expect(screen.getByRole('button',{name:'Otra pregunta'})).toHaveAttribute('aria-busy','true');
});
it('reply selection focuses input without asking the browser to scroll ancestors',async()=>{
  mount();await ready();const input=screen.getByRole('textbox',{name:'Mensaje'}),focus=vi.spyOn(input,'focus');
  fireEvent.click(screen.getByRole('button',{name:'Responder pregunta'}));expect(focus).toHaveBeenCalledWith({preventScroll:true});
});
it.each([true,false])('hides the quota notice only for a confirmed text send: %s',async success=>{
  Object.assign(chat.audioPolicy,{enabled:false,remainingMessages:0,unavailableReason:'LIMIT_REACHED'});
  const base=vi.mocked(controller.request).getMockImplementation()!;
  if(!success)vi.mocked(controller.request).mockImplementation((path,signal,method,body)=>path==='/chats/c/messages'&&method==='POST'?Promise.reject(new TypeError('Synthetic uncertain delivery')):base(path,signal,method,body));
  mount();await ready();expect(screen.getByRole('button',{name:'Ocultar aviso de audio'})).toBeVisible();
  const input=screen.getByRole('textbox',{name:'Mensaje'});fireEvent.change(input,{target:{value:'Mensaje de texto'}});fireEvent.click(screen.getByRole('button',{name:'Enviar mensaje'}));
  if(success){await waitFor(()=>expect(input).toHaveValue(''));expect(screen.queryByRole('button',{name:'Ocultar aviso de audio'})).toBeNull();}
  else {await screen.findByRole('alert');expect(input).toHaveValue('Mensaje de texto');expect(screen.getByRole('button',{name:'Ocultar aviso de audio'})).toBeVisible();}
  expect(screen.getByRole('button',{name:'Grabar audio'})).toBeDisabled();expect(screen.getByRole('button',{name:'Grabar audio'})).toHaveAccessibleDescription('Alcanzaste el límite de audios.');
});
