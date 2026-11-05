import { StrictMode, useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgeRangeSlider } from './AgeRangeSlider';

beforeEach(() => {
  vi.stubGlobal('PointerEvent',class extends MouseEvent {
    readonly pointerId: number; readonly pointerType: string; readonly isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type,init); this.pointerId = init.pointerId ?? 1; this.pointerType = init.pointerType ?? 'mouse'; this.isPrimary = init.isPrimary ?? true;
    }
  });
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({ x:100,y:0,left:100,top:0,right:505,bottom:88,width:405,height:88,toJSON:() => ({}) });
  Object.defineProperty(HTMLElement.prototype,'setPointerCapture',{ configurable:true,value:vi.fn() });
  Object.defineProperty(HTMLElement.prototype,'hasPointerCapture',{ configurable:true,value:vi.fn().mockReturnValue(true) });
  Object.defineProperty(HTMLElement.prototype,'releasePointerCapture',{ configurable:true,value:vi.fn() });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mount(min = 18, max = 45, disabled = false) {
  const onChange = vi.fn();
  function Harness({ disabled: off }: { disabled:boolean }) {
    const [ages,setAges] = useState({ min,max });
    return <AgeRangeSlider minAge={ages.min} maxAge={ages.max} disabled={off} onChange={(nextMin,nextMax) => { onChange(nextMin,nextMax); setAges({ min:nextMin,max:nextMax }); }}/ >;
  }
  const view = render(<StrictMode><Harness disabled={disabled}/></StrictMode>);
  const lower = screen.getByRole('slider',{ name:'Edad mínima' }), upper = screen.getByRole('slider',{ name:'Edad máxima' });
  const rail = lower.parentElement;
  if (!rail) throw new Error('Slider rail missing');
  return { ...view,lower,upper,rail,onChange,setDisabled: (off: boolean) => view.rerender(<StrictMode><Harness disabled={off}/></StrictMode>) };
}
const x = (age: number) => 100 + (age-18)*5;
const pointer = (age: number, pointerType = 'mouse', pointerId = 1) => ({ pointerId,pointerType,clientX:x(age),clientY:20,button:0,isPrimary:true });
function expectAges(min: number, max: number) {
  expect(screen.getByText(`Edad: ${min}–${max} años`)).toBeInTheDocument();
  expect(screen.getByRole('slider',{ name:'Edad mínima' })).toHaveAttribute('aria-valuenow',String(min));
  expect(screen.getByRole('slider',{ name:'Edad máxima' })).toHaveAttribute('aria-valuenow',String(max));
}
it('exposes distinct horizontal thumbs and interval limits with a stable tab order', () => {
  const { lower,upper } = mount();
  expectAges(18,45); expect(screen.getAllByRole('slider')).toEqual([lower,upper]);
  expect(lower).toHaveAttribute('aria-valuemin','18'); expect(lower).toHaveAttribute('aria-valuemax','45');
  expect(upper).toHaveAttribute('aria-valuemin','18'); expect(upper).toHaveAttribute('aria-valuemax','99');
  lower.focus(); expect(lower).toHaveFocus(); upper.focus(); expect(upper).toHaveFocus();
  expect(lower).toHaveAccessibleDescription(/Desde y Hasta permiten escribir edades de 18 a 99/);
  expect(lower).toHaveAttribute('aria-orientation','horizontal');
  expect(upper).toHaveAttribute('aria-orientation','horizontal');
});
it('renders the same rounded bracket geometry for both mirrored markers', () => {
  const { lower,upper } = mount();
  const brackets = [lower,upper].map(thumb => thumb.querySelector('svg'));
  for (const bracket of brackets) {
    expect(bracket).toHaveAttribute('viewBox','0 0 24 32');
    expect(bracket).toHaveAttribute('width','24'); expect(bracket).toHaveAttribute('height','32');
    expect(bracket).toHaveAttribute('aria-hidden','true');
    expect(bracket?.querySelectorAll('path')).toHaveLength(2);
  }
  expect(brackets[0]?.innerHTML).toBe(brackets[1]?.innerHTML);
  expect(lower).toHaveClass('age-thumb-min'); expect(upper).toHaveClass('age-thumb-max');
});
it('supports arrows, page keys, Home and End while preventing crossing', () => {
  const { lower,upper } = mount(30,40);
  fireEvent.keyDown(lower,{ key:'ArrowUp' }); expectAges(31,40);
  fireEvent.keyDown(lower,{ key:'ArrowRight' }); expectAges(32,40);
  fireEvent.keyDown(lower,{ key:'ArrowDown' }); expectAges(31,40);
  fireEvent.keyDown(lower,{ key:'ArrowLeft' }); expectAges(30,40);
  fireEvent.keyDown(lower,{ key:'PageUp' }); expectAges(40,40);
  fireEvent.keyDown(lower,{ key:'ArrowRight' }); expectAges(40,40);
  fireEvent.keyDown(upper,{ key:'ArrowLeft' }); expectAges(40,40);
  fireEvent.keyDown(lower,{ key:'PageDown' }); expectAges(30,40);
  fireEvent.keyDown(lower,{ key:'Home' }); expectAges(18,40);
  fireEvent.keyDown(upper,{ key:'End' }); expectAges(18,99);
  fireEvent.keyDown(lower,{ key:'End' }); expectAges(99,99);
  fireEvent.keyDown(lower,{ key:'Home' }); fireEvent.keyDown(upper,{ key:'Home' }); expectAges(18,18);
});
it('handles adjacent ages and repeated keyboard changes before a render atomically', () => {
  const { lower,upper } = mount(44,45);
  act(() => { fireEvent.keyDown(upper,{ key:'ArrowRight' }); fireEvent.keyDown(upper,{ key:'ArrowRight' }); fireEvent.keyDown(lower,{ key:'End' }); });
  expectAges(47,47);
  fireEvent.keyDown(lower,{ key:'ArrowLeft' }); expectAges(46,47);
});
it.each(['mouse','touch','pen'])('drags and rounds values through one captured %s pointer', pointerType => {
  const { lower,upper,rail } = mount();
  fireEvent.pointerDown(lower,pointer(18,pointerType));
  expect(lower).toHaveFocus(); expect(rail.setPointerCapture).toHaveBeenCalledWith(1);
  fireEvent.pointerMove(rail,pointer(24.6,pointerType)); expectAges(25,45);
  fireEvent.pointerMove(rail,pointer(90,pointerType)); expectAges(45,45);
  fireEvent.pointerUp(rail,pointer(90,pointerType));
  fireEvent.pointerDown(upper,pointer(45,pointerType,2));
  fireEvent.pointerMove(rail,pointer(10,pointerType,2)); expectAges(45,45);
  fireEvent.pointerMove(rail,pointer(120,pointerType,2)); expectAges(45,99);
  fireEvent.pointerUp(rail,pointer(120,pointerType,2)); expect(rail.releasePointerCapture).toHaveBeenCalledWith(2);
});
it.each([18,99])('keeps both equal thumbs independently operable at boundary %s', boundary => {
  const { lower,upper,rail } = mount(boundary,boundary);
  const chosen = boundary === 18 ? upper : lower;
  fireEvent.pointerDown(chosen,pointer(boundary,'touch'));
  fireEvent.pointerMove(rail,pointer(boundary === 18 ? 19 : 98,'touch'));
  expectAges(boundary === 18 ? 18 : 98,boundary === 18 ? 19 : 99);
  fireEvent.pointerUp(rail,pointer(boundary,'touch'));
  const other = boundary === 18 ? lower : upper;
  fireEvent.keyDown(other,{ key:boundary === 18 ? 'End' : 'Home' });
  expectAges(boundary === 18 ? 19 : 98,boundary === 18 ? 19 : 98);
});
it('retains the grab offset instead of jumping when a thumb is grabbed off-center', () => {
  const { lower,rail } = mount(30,45);
  fireEvent.pointerDown(lower,{ ...pointer(30),clientX:x(30)+10 }); expectAges(30,45);
  fireEvent.pointerMove(rail,{ ...pointer(31),clientX:x(31)+10 }); expectAges(31,45);
});
it('selects the nearest track thumb with ties to minimum while explicit targets always win', () => {
  const { rail,upper } = mount(30,50);
  fireEvent.pointerDown(rail,pointer(25)); expectAges(25,50); fireEvent.pointerUp(rail,pointer(25));
  fireEvent.pointerDown(rail,pointer(25)); fireEvent.pointerMove(rail,pointer(50)); expectAges(50,50); fireEvent.pointerUp(rail,pointer(50));
  fireEvent.pointerDown(rail,pointer(50)); fireEvent.pointerMove(rail,pointer(49)); expectAges(49,50); fireEvent.pointerUp(rail,pointer(49));
  fireEvent.pointerDown(upper,pointer(50)); fireEvent.pointerMove(rail,pointer(60)); expectAges(49,60);
});
it.each(['pointerCancel','lostPointerCapture'])('releases a gesture on %s without changing values afterward', event => {
  const { lower,rail } = mount(); fireEvent.pointerDown(lower,pointer(18)); fireEvent.pointerMove(rail,pointer(30));
  if (event === 'pointerCancel') fireEvent.pointerCancel(rail,pointer(30)); else fireEvent.lostPointerCapture(rail,pointer(30));
  fireEvent.pointerMove(rail,pointer(40)); expectAges(30,45);
});
it('ignores competing pointers, nonprimary contact and right clicks', () => {
  const { lower,upper,rail,onChange } = mount();
  fireEvent.pointerDown(lower,{ ...pointer(18),isPrimary:false }); fireEvent.pointerDown(lower,{ ...pointer(18),button:2 });
  expect(rail.setPointerCapture).not.toHaveBeenCalled();
  fireEvent.pointerDown(lower,pointer(18)); fireEvent.pointerDown(upper,pointer(45,'touch',2));
  fireEvent.pointerMove(rail,pointer(80,'touch',2)); expect(onChange).not.toHaveBeenCalled();
  fireEvent.pointerMove(rail,pointer(25)); expectAges(25,45);
});
it('cancels owned capture when disabled or unmounted and ignores keyboard/pointer input while disabled', () => {
  const { lower,rail,onChange,setDisabled,unmount } = mount();
  fireEvent.pointerDown(lower,pointer(18)); setDisabled(true);
  expect(rail.releasePointerCapture).toHaveBeenCalledWith(1);
  fireEvent.pointerMove(rail,pointer(30)); fireEvent.keyDown(lower,{ key:'ArrowRight' }); expect(onChange).not.toHaveBeenCalled();
  expect(lower).toBeDisabled(); setDisabled(false);
  fireEvent.pointerDown(lower,pointer(18,'touch',3)); unmount(); expect(rail.releasePointerCapture).toHaveBeenCalledWith(3);
});

it('synchronizes numeric inputs and sliders without replacing focused controls', () => {
  const { lower,upper } = mount(30,45);
  const from = screen.getByRole('spinbutton',{ name:'Desde:' });
  const to = screen.getByRole('spinbutton',{ name:'Hasta:' });
  expect(from).toHaveValue(30); expect(to).toHaveValue(45);
  from.focus(); fireEvent.change(from,{ target:{ value:'35' } });
  expectAges(35,45); expect(from).toHaveFocus(); expect(screen.getByRole('spinbutton',{ name:'Desde:' })).toBe(from);
  fireEvent.blur(from); fireEvent.keyDown(lower,{ key:'ArrowLeft' }); expect(from).toHaveValue(34);
  to.focus(); fireEvent.change(to,{ target:{ value:'36' } }); expectAges(34,36); expect(to).toHaveFocus();
  fireEvent.blur(to); fireEvent.keyDown(upper,{ key:'ArrowUp' }); expect(to).toHaveValue(37);
});
it.each(['','e','-','17','100','35.5'])('holds invalid intermediate numeric input %j without corrupting the interval', value => {
  const { onChange } = mount(30,45);
  const from = screen.getByRole('spinbutton',{ name:'Desde:' });
  fireEvent.change(from,{ target:{ value } });
  expectAges(30,45); expect(onChange).not.toHaveBeenCalled(); expect(from).toHaveAttribute('aria-invalid','true');
  fireEvent.blur(from);
  const expected = value === '17' ? 18 : value === '100' ? 45 : value === '35.5' ? 36 : 30;
  expectAges(expected,45); expect(from).toHaveValue(expected); expect(from).toHaveAttribute('aria-invalid','false');
});
it('clamps numeric bounds and crossing endpoints on confirmation and allows equal/adjacent ages', () => {
  mount(30,45);
  const from = screen.getByRole('spinbutton',{ name:'Desde:' }), to = screen.getByRole('spinbutton',{ name:'Hasta:' });
  fireEvent.change(to,{ target:{ value:'120' } }); fireEvent.keyDown(to,{ key:'Enter' }); expectAges(30,99);
  fireEvent.change(from,{ target:{ value:'99' } }); expectAges(99,99); fireEvent.blur(from);
  fireEvent.change(from,{ target:{ value:'98' } }); expectAges(98,99); fireEvent.blur(from);
  fireEvent.change(to,{ target:{ value:'18' } }); expectAges(98,99);
  fireEvent.blur(to); expectAges(98,98);
  fireEvent.change(from,{ target:{ value:'-5' } }); fireEvent.blur(from); expectAges(18,98);
  fireEvent.change(to,{ target:{ value:'18' } }); fireEvent.blur(to); expectAges(18,18);
  fireEvent.change(to,{ target:{ value:'19' } }); expectAges(18,19);
});
it('commits the latest numeric draft in a batch and prevents Enter from submitting a surrounding form', () => {
  mount(30,45);
  const from = screen.getByRole('spinbutton',{ name:'Desde:' });
  act(() => {
    fireEvent.change(from,{ target:{ value:'100' } });
    expect(fireEvent.keyDown(from,{ key:'Enter' })).toBe(false);
  });
  expectAges(45,45); expect(from).toHaveValue(45);
  fireEvent.change(from,{ target:{ value:'20.5' } }); fireEvent.keyDown(from,{ key:'Escape' });
  expectAges(45,45); expect(from).toHaveValue(45);
});
it('reads the interval after numeric blur before beginning an off-center pointer gesture', () => {
  const { lower,rail } = mount(30,45);
  const from = screen.getByRole('spinbutton',{ name:'Desde:' });
  from.focus(); fireEvent.change(from,{ target:{ value:'35.5' } });
  fireEvent.pointerDown(lower,{ ...pointer(30),clientX:x(30)-15 }); expectAges(36,45);
  fireEvent.pointerMove(rail,{ ...pointer(31),clientX:x(31)-15 }); expectAges(37,45);
});
it('disables numeric controls and restores valid values when disabled during an edit', () => {
  const { setDisabled,onChange } = mount(30,45);
  const from = screen.getByRole('spinbutton',{ name:'Desde:' }), to = screen.getByRole('spinbutton',{ name:'Hasta:' });
  fireEvent.change(from,{ target:{ value:'100' } }); setDisabled(true);
  expect(from).toBeDisabled(); expect(to).toBeDisabled(); expect(from).toHaveValue(30);
  fireEvent.change(from,{ target:{ value:'20' } }); fireEvent.blur(from); expect(onChange).not.toHaveBeenCalled();
  setDisabled(false); expect(from).toHaveValue(30); expect(from).toHaveAttribute('aria-invalid','false');
});
