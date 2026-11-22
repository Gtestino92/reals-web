import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { useChatViewport } from './useChatViewport';

const resizeInput = () => {};
function Conversation() {
  const root=useRef<HTMLElement>(null), timeline=useRef<HTMLOListElement>(null);
  const following=useRef(true), height=useRef(0);
  useChatViewport(root,timeline,following,height,true,resizeInput);
  return <section ref={root} aria-label="Chat">
    <ol ref={timeline} aria-label="Mensajes" onScroll={event=>{
      const list=event.currentTarget;
      following.current=list.scrollHeight-list.scrollTop-list.clientHeight<100;
    }}/>
    <div className="chat-composer"><textarea aria-label="Mensaje"/><button>Enviar mensaje</button></div>
  </section>;
}

afterEach(()=>vi.unstubAllGlobals());

it('tracks keyboard open and close, panning and rotation while honoring reading intent and zoom', () => {
  const viewport=Object.assign(new EventTarget(),{height:768,offsetTop:0,scale:1});
  const remove=vi.spyOn(viewport,'removeEventListener');
  vi.stubGlobal('visualViewport',viewport);
  const view=render(<Conversation/>);
  const chat=screen.getByRole('region',{name:'Chat'}), list=screen.getByRole('list'), draft=screen.getByRole('textbox');
  Object.defineProperties(list,{scrollHeight:{value:1000},clientHeight:{value:400}});
  draft.focus(); fireEvent.change(draft,{target:{value:'Borrador'}});
  viewport.height=320; viewport.offsetTop=48;
  viewport.dispatchEvent(new Event('resize'));
  expect(chat.style.getPropertyValue('--chat-viewport')).toBe('320px');
  expect(chat.style.getPropertyValue('--chat-viewport-top')).toBe('48px');
  expect(chat).toHaveAttribute('data-compact-viewport');
  expect(list.scrollTop).toBe(1000);
  list.scrollTop=120; fireEvent.scroll(list);
  viewport.offsetTop=64;
  viewport.dispatchEvent(new Event('scroll'));
  expect(chat.style.getPropertyValue('--chat-viewport-top')).toBe('64px');
  expect(list.scrollTop).toBe(120);
  viewport.height=245;
  fireEvent(window,new Event('resize'));
  expect(chat.style.getPropertyValue('--chat-viewport')).toBe('245px');
  expect(list.scrollTop).toBe(120);
  expect(draft).toHaveFocus();
  expect(draft).toHaveValue('Borrador');
  expect(screen.getByRole('button',{name:'Enviar mensaje'})).toBeEnabled();
  draft.blur();
  Object.assign(viewport,{height:768,offsetTop:0});
  viewport.dispatchEvent(new Event('resize'));
  expect(chat).not.toHaveAttribute('data-compact-viewport');
  expect(list.scrollTop).toBe(120);
  viewport.scale=1.5;
  viewport.dispatchEvent(new Event('resize'));
  expect(chat).not.toHaveAttribute('data-visual-viewport');
  expect(chat.style.getPropertyValue('--chat-viewport-top')).toBe('');
  view.unmount();
  expect(remove).toHaveBeenCalledWith('resize',expect.any(Function));
  expect(remove).toHaveBeenCalledWith('scroll',expect.any(Function));
});

it('updates from layout viewport resize when VisualViewport is unavailable', () => {
  vi.stubGlobal('visualViewport',undefined);
  vi.stubGlobal('innerHeight',720);
  render(<Conversation/>);
  const chat=screen.getByRole('region',{name:'Chat'});
  expect(chat.style.getPropertyValue('--chat-viewport')).toBe('720px');
  screen.getByRole('textbox').focus();
  vi.stubGlobal('innerHeight',330);
  fireEvent(window,new Event('resize'));
  expect(chat.style.getPropertyValue('--chat-viewport')).toBe('330px');
  expect(chat).not.toHaveAttribute('data-visual-viewport');
  expect(chat).toHaveAttribute('data-compact-viewport');
  expect(screen.getByRole('textbox')).toHaveFocus();
});

it('compacts when visual and layout heights shrink together and restores on close', () => {
  const viewport=Object.assign(new EventTarget(),{height:760,offsetTop:0,scale:1});
  vi.stubGlobal('visualViewport',viewport);
  vi.stubGlobal('innerHeight',760);
  render(<Conversation/>);
  const chat=screen.getByRole('region',{name:'Chat'});
  screen.getByRole('textbox').focus();
  vi.stubGlobal('innerHeight',300);
  viewport.height=300;
  viewport.dispatchEvent(new Event('resize'));
  expect(chat).toHaveAttribute('data-compact-viewport');
  vi.stubGlobal('innerHeight',760);
  viewport.height=760;
  viewport.dispatchEvent(new Event('resize'));
  expect(chat).not.toHaveAttribute('data-compact-viewport');
  expect(screen.getByRole('textbox')).toHaveFocus();
});
