import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ReplySwipe, resistedReplyOffset } from './ReplySwipe';

// jsdom has no native PointerEvent/capture; real pointer arbitration is checked in Chrome.
export function pointer(target: Element, type: string, x: number, y = 0, pointerType = 'touch', shiftKey = false) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, shiftKey });
  Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true }, pointerType: { value: pointerType } });
  fireEvent(target, event);
  return event;
}
beforeEach(() => {
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => true);
});
const setup = () => {
  const reply = vi.fn();
  const view = render(<StrictMode><ReplySwipe enabled label="Responder prueba" onReply={reply}><p>Texto seleccionable</p><audio controls /></ReplySwipe></StrictMode>);
  const target = view.container.firstElementChild!;
  return { ...view, reply, target };
};
it.each(['touch', 'mouse', 'pen'])('requires 60px and selects exactly once for %s', kind => {
  const { target, reply } = setup();
  pointer(target, 'pointerdown', 0, 0, kind); pointer(target, 'pointermove', 59, 0, kind); pointer(target, 'pointerup', 59, 0, kind);
  expect(reply).not.toHaveBeenCalled();
  pointer(target, 'pointerdown', 0, 0, kind); pointer(target, 'pointermove', 60, 0, kind);
  expect(target).toHaveStyle({ transform: 'translateX(60px)' });
  pointer(target, 'pointerup', 60, 0, kind); pointer(target, 'pointerup', 60, 0, kind);
  expect(reply).toHaveBeenCalledTimes(1); expect(target).toHaveStyle({ transform: 'translateX(0px)' });
});
it('applies Android resistance and the 150px raw cap', () => {
  expect(resistedReplyOffset(-10)).toBe(0); expect(resistedReplyOffset(60)).toBe(60);
  expect(resistedReplyOffset(100)).toBe(68); expect(resistedReplyOffset(200)).toBe(78);
});
it.each(['pointercancel', 'lostpointercapture'])('cancels %s without selecting', type => {
  const { target, reply } = setup(); pointer(target,'pointerdown',0); pointer(target,'pointermove',90);
  pointer(target,type,90); pointer(target,'pointerup',90); expect(reply).not.toHaveBeenCalled();
  expect(target).toHaveStyle({ transform:'translateX(0px)' });
});
it.each([[0, 0], [5, 4], [-90, 0], [20, 70], [65, 60]])('ignores taps, left and vertical/diagonal movement (%s,%s)', (x,y) => {
  const { target, reply } = setup(); pointer(target,'pointerdown',0); const move=pointer(target,'pointermove',x,y);
  pointer(target,'pointerup',x,y); expect(reply).not.toHaveBeenCalled(); expect(move.defaultPrevented).toBe(false);
});
it('does not let a vertical gesture turn into a reply later', () => {
  const { target, reply } = setup(); pointer(target,'pointerdown',0); pointer(target,'pointermove',0,30);
  pointer(target,'pointermove',100,30); pointer(target,'pointerup',100,30); expect(reply).not.toHaveBeenCalled();
});
it('preserves Shift-drag text selection', () => {
  const { target, reply } = setup();
  pointer(target.querySelector('p')!,'pointerdown',0,0,'mouse',true); pointer(target,'pointermove',90,0,'mouse',true); pointer(target,'pointerup',90,0,'mouse',true);
  expect(reply).not.toHaveBeenCalled();
});
it('leaves audio, buttons and links native without acquiring capture',()=>{
  const reply=vi.fn();const view=render(<StrictMode><ReplySwipe enabled label="Responder prueba" onReply={reply}><audio controls/><button>Acción</button><a href="#">Enlace</a></ReplySwipe></StrictMode>);
  const root=view.container.firstElementChild!;
  for(const element of root.querySelectorAll('audio,button,a')){
    pointer(element,'pointerdown',0,0,'mouse');pointer(root,'pointermove',90,0,'mouse');pointer(root,'pointerup',90,0,'mouse');
  }
  expect(reply).not.toHaveBeenCalled();expect(Element.prototype.setPointerCapture).not.toHaveBeenCalled();
});
it.each(['mouse','touch'])('captures %s on text before a quick move leaves a short bubble',kind=>{
  const {target,reply}=setup();const text=target.querySelector('p')!;
  pointer(text,'pointerdown',0,0,kind);expect(Element.prototype.setPointerCapture).toHaveBeenCalledWith(1);
  pointer(target,'pointermove',90,0,kind);pointer(target,'pointerup',90,0,kind);
  expect(reply).toHaveBeenCalledTimes(1);
});
it('does not cancel on a child implicit-capture loss when ownership transfers to wrapper',()=>{
  const {target,reply}=setup();const text=target.querySelector('p')!;
  pointer(text,'pointerdown',0);pointer(target,'pointermove',90);pointer(text,'lostpointercapture',90);
  expect(target).toHaveStyle({transform:'translateX(66px)'});
  pointer(target,'pointerup',90);expect(reply).toHaveBeenCalledTimes(1);
});
it.each([0,18])('uses the release endpoint when the last move was only %s px',lastMove=>{
  const {target,reply}=setup();pointer(target.querySelector('p')!,'pointerdown',0,0,'mouse');
  if(lastMove)pointer(target,'pointermove',lastMove,0,'mouse');
  pointer(target,'pointerup',90,0,'mouse');pointer(target,'pointerup',90,0,'mouse');expect(reply).toHaveBeenCalledTimes(1);
});
it('uses the final endpoint when reversing below threshold',()=>{
  const {target,reply}=setup();pointer(target,'pointerdown',0);pointer(target,'pointermove',90);pointer(target,'pointerup',40);
  expect(reply).not.toHaveBeenCalled();expect(target).toHaveStyle({transform:'translateX(0px)'});
});
it('cancels when eligibility changes and releases capture on unmount', () => {
  const { target, reply, rerender, unmount } = setup(); pointer(target,'pointerdown',0); pointer(target,'pointermove',90);
  rerender(<StrictMode><ReplySwipe enabled={false} label="Responder prueba" onReply={reply}><p>Texto</p></ReplySwipe></StrictMode>);
  pointer(target,'pointerup',90); expect(reply).not.toHaveBeenCalled(); expect(screen.queryByRole('button')).toBeNull();
  unmount(); expect(Element.prototype.releasePointerCapture).toHaveBeenCalled();
});
it('exposes a native keyboard button outside the content, without a permanent visible action', () => {
  const { reply, target } = setup(); const button=screen.getByRole('button',{name:'Responder prueba'});
  act(()=>button.focus()); expect(button).toHaveFocus(); expect(button).toHaveClass('reply-keyboard-action');
  fireEvent.click(button); expect(reply).toHaveBeenCalledTimes(1); expect(target.querySelector('p')?.contains(button)).toBe(false);
});
