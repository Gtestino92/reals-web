import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PhotoGrid } from './PhotoGrid';
import { photoPlacements } from './photoReorder';
import type { Photo } from './contracts';

const first: Photo = { id:'first',url:'https://example.com/first',position:1,validationStatus:'VALIDATED',moderationStatus:'APPROVED',isPersonPhoto:true,isFullBody:true };
const second: Photo = { ...first,id:'second',url:'https://example.com/second',position:4 };
beforeEach(() => {
  vi.stubGlobal('PointerEvent',class extends MouseEvent {
    readonly pointerId: number; readonly pointerType: string; readonly isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) { super(type,init); this.pointerId = init.pointerId ?? 1; this.pointerType = init.pointerType ?? 'mouse'; this.isPrimary = init.isPrimary ?? true; }
  });
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({ x:0,y:0,left:0,top:0,right:90,bottom:90,width:90,height:90,toJSON:() => ({}) });
  Object.defineProperty(document,'elementFromPoint',{ configurable:true,value:vi.fn((x: number,y: number) => {
    const position = Math.floor(y/140)*3+Math.floor(x/100)+1;
    return x >= 0 && x < 300 && y >= 0 && position <= 9 ? document.querySelector(`[data-photo-position="${position}"]`) : null;
  }) });
  Object.defineProperty(HTMLElement.prototype,'setPointerCapture',{ configurable:true,value:vi.fn() });
  Object.defineProperty(HTMLElement.prototype,'hasPointerCapture',{ configurable:true,value:vi.fn().mockReturnValue(true) });
  Object.defineProperty(HTMLElement.prototype,'releasePointerCapture',{ configurable:true,value:vi.fn() });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function mount(photos = [first,second], disabled = false) {
  const onMove = vi.fn(), onSelect = vi.fn(), onDelete = vi.fn();
  const view = render(<StrictMode><PhotoGrid photos={photos} disabled={disabled} uploadsDisabled={disabled} onMove={onMove} onSelect={onSelect} onDelete={onDelete}/></StrictMode>);
  return { ...view,onMove,onSelect,onDelete,update:(next = photos,off = disabled) => view.rerender(<StrictMode><PhotoGrid photos={next} disabled={off} uploadsDisabled={off} onMove={onMove} onSelect={onSelect} onDelete={onDelete}/></StrictMode>) };
}
const point = (position: number) => ({ clientX:((position-1)%3)*100+20,clientY:Math.floor((position-1)/3)*140+60,pointerId:1,pointerType:'mouse',button:0 });
const handle = (position = 1) => screen.getByRole('button',{ name:`Reordenar foto ${position}` });
function touch(type: string,target: Element,position: number,id = 7) {
  const p = point(position), finger = { identifier:id,clientX:p.clientX,clientY:p.clientY };
  const event = new Event(type,{ bubbles:true,cancelable:true });
  Object.defineProperty(event,'touches',{ value:type === 'touchend' || type === 'touchcancel' ? [] : [finger] });
  Object.defineProperty(event,'changedTouches',{ value:[finger] }); fireEvent(target,event); return event;
}
it('shows nine position-labelled slots, compact add/change controls and no raw flags or numbered headings', () => {
  mount([first,{ ...second,moderationStatus:'NEEDS_REVIEW' },{ ...first,id:'rejected',position:7,moderationStatus:'REJECTED' }]);
  expect(screen.getAllByRole('article')).toHaveLength(9);
  expect(screen.queryByRole('heading',{ name:/Foto/ })).not.toBeInTheDocument();
  expect(screen.getAllByRole('button',{ name:/Agregar en posición/ })).toHaveLength(6);
  expect(screen.getAllByRole('button',{ name:/Cambiar foto/ })).toHaveLength(3);
  expect(screen.queryByRole('button',{ name:/Mover antes|Mover después/ })).not.toBeInTheDocument();
  expect(screen.getByRole('note',{ name:'Foto 4 pendiente de revisión' })).toHaveTextContent('En revisión');
  expect(screen.getByRole('note',{ name:'Foto 7 rechazada. Debe ser reemplazada.' })).toHaveTextContent('Rechazada');
  for (const raw of ['VALIDATED','APPROVED','NEEDS_REVIEW','REJECTED','isPersonPhoto','isFullBody']) expect(screen.queryByText(new RegExp(raw))).not.toBeInTheDocument();
  expect(within(screen.getByRole('article',{ name:'Foto 1' })).queryByRole('note')).not.toBeInTheDocument();
});
it('puts an accessible delete control inside the image frame and isolates it from reorder gestures', () => {
  const { onDelete,onMove } = mount(); const button = screen.getByRole('button',{ name:'Eliminar foto 1' });
  expect(button.parentElement).toHaveClass('photo-frame'); expect(button).toHaveClass('photo-delete'); expect(button).toHaveTextContent('×');
  fireEvent.pointerDown(button,point(1)); fireEvent.pointerMove(button,point(2)); fireEvent.pointerUp(button,point(2)); fireEvent.click(button);
  expect(onDelete).toHaveBeenCalledExactlyOnceWith(first); expect(onMove).not.toHaveBeenCalled();
});
it.each([4,9])('mouse drag submits a move to %s without installing an optimistic order', target => {
  const { onMove,onSelect } = mount(); const source = handle();
  fireEvent.pointerDown(source,point(1)); fireEvent.pointerMove(source,point(target));
  expect(document.querySelector('.photo-drag-ghost')).toBeInTheDocument();
  expect(screen.getByRole('article',{ name:`Foto ${target}` })).toHaveAttribute('data-reorder-target','true');
  fireEvent.pointerUp(source,point(target)); fireEvent.pointerUp(source,point(target));
  expect(onMove).toHaveBeenCalledExactlyOnceWith('first',target); expect(onSelect).not.toHaveBeenCalled();
  expect(screen.getByRole('article',{ name:'Foto 1' })).toHaveAttribute('data-photo-id','first');
  expect(document.querySelector('.photo-drag-ghost')).not.toBeInTheDocument();
});
it('supports keyboard pickup, grid arrows, empty positions, confirmation and escape/tab cancellation', () => {
  const { onMove } = mount(); const source = handle(); source.focus();
  fireEvent.keyDown(source,{ key:' ' }); expect(source).toHaveAttribute('aria-pressed','true');
  fireEvent.keyDown(source,{ key:'ArrowDown' }); fireEvent.keyDown(source,{ key:'ArrowRight' });
  expect(screen.getByRole('article',{ name:'Foto 5' })).toHaveAttribute('data-reorder-target','true'); expect(source).toHaveFocus();
  fireEvent.keyDown(source,{ key:'Enter' }); expect(onMove).toHaveBeenCalledExactlyOnceWith('first',5);
  fireEvent.keyDown(source,{ key:'Enter' }); fireEvent.keyDown(source,{ key:'End' }); fireEvent.keyDown(source,{ key:'Escape' });
  fireEvent.keyDown(source,{ key:'Enter' }); fireEvent.keyDown(source,{ key:'Tab' });
  expect(onMove).toHaveBeenCalledOnce(); expect(source).toHaveAttribute('aria-pressed','false');
  expect(source).toHaveAccessibleDescription(/Espacio o Enter/);
});
it('activates touch only after a long press, prevents scroll only while active, and drops once', () => {
  vi.useFakeTimers(); const { onMove } = mount(); const source = handle();
  expect(touch('touchstart',source,1).defaultPrevented).toBe(false);
  act(() => vi.advanceTimersByTime(499)); expect(document.querySelector('.photo-drag-ghost')).not.toBeInTheDocument();
  act(() => vi.advanceTimersByTime(1)); expect(document.querySelector('.photo-drag-ghost')).toBeInTheDocument();
  expect(touch('touchmove',source,9).defaultPrevented).toBe(true);
  touch('touchend',source,9); touch('touchend',source,9);
  expect(onMove).toHaveBeenCalledExactlyOnceWith('first',9);
});
it('allows page scrolling before long-press activation and cancels the pending hold', () => {
  vi.useFakeTimers(); const { onMove } = mount(); const source = handle();
  touch('touchstart',source,1); expect(touch('touchmove',source,4).defaultPrevented).toBe(false);
  act(() => vi.advanceTimersByTime(600)); touch('touchend',source,4);
  expect(document.querySelector('.photo-drag-ghost')).not.toBeInTheDocument(); expect(onMove).not.toHaveBeenCalled();
});
it.each(['touchcancel','disable','refresh','unmount','blur'])('cancels long-press ownership on %s', mode => {
  vi.useFakeTimers(); const view = mount(); const source = handle(); touch('touchstart',source,1);
  act(() => vi.advanceTimersByTime(500));
  if (mode === 'touchcancel') touch('touchcancel',source,1);
  if (mode === 'disable') view.update(undefined,true);
  if (mode === 'refresh') view.update([first,second]);
  if (mode === 'unmount') view.unmount();
  if (mode === 'blur') fireEvent(window,new Event('blur'));
  act(() => vi.advanceTimersByTime(600)); touch('touchend',source,9);
  expect(view.onMove).not.toHaveBeenCalled(); expect(document.querySelector('.photo-drag-ghost')).not.toBeInTheDocument();
});
it('does not activate an abandoned hold after unmount', () => {
  vi.useFakeTimers(); const view = mount(); touch('touchstart',handle(),1); view.unmount();
  act(() => vi.advanceTimersByTime(600)); expect(view.onMove).not.toHaveBeenCalled();
});
it('cancels mouse dragging outside the grid or on pointer cancellation/lost capture', () => {
  const { onMove } = mount(); const source = handle();
  fireEvent.pointerDown(source,point(1)); fireEvent.pointerMove(source,{ ...point(1),clientX:-50 }); fireEvent.pointerUp(source,{ ...point(1),clientX:-50 });
  fireEvent.pointerDown(source,point(1)); fireEvent.pointerMove(source,point(9)); fireEvent.pointerCancel(source,point(9));
  fireEvent.pointerDown(source,point(1)); fireEvent.pointerMove(source,point(9)); fireEvent.lostPointerCapture(source,point(9)); fireEvent.pointerUp(source,point(9));
  expect(onMove).not.toHaveBeenCalled();
});
it('keeps external files on the upload path and prevents them from committing an internal reorder', () => {
  const { onMove,onSelect } = mount(); const target = screen.getByRole('article',{ name:'Foto 3' });
  const file = new File(['jpeg'],'file.jpg',{ type:'image/jpeg' });
  fireEvent.drop(target,{ dataTransfer:{ types:['Files'],files:[file] } });
  expect(onSelect).toHaveBeenCalledExactlyOnceWith([file],3,undefined); expect(onMove).not.toHaveBeenCalled();
  const source = handle(); fireEvent.keyDown(source,{ key:' ' });
  fireEvent.drop(target,{ dataTransfer:{ types:['Files'],files:[file] } });
  expect(onSelect).toHaveBeenCalledOnce(); expect(onMove).not.toHaveBeenCalled();
});
it('builds complete Android-style swaps/moves preserving stable IDs and holes', () => {
  const photos = [first,second,{ ...first,id:'third',position:8 }];
  expect(photoPlacements(photos,'first',4)).toEqual([{ photoId:'second',position:1 },{ photoId:'first',position:4 },{ photoId:'third',position:8 }]);
  expect(photoPlacements(photos,'third',2)).toEqual([{ photoId:'first',position:1 },{ photoId:'third',position:2 },{ photoId:'second',position:4 }]);
  expect(photos.map(p => p.position)).toEqual([1,4,8]);
  for (const target of [0,10,NaN,1]) expect(photoPlacements(photos,'first',target)).toBeNull();
  expect(photoPlacements(photos,'missing',2)).toBeNull();
});
