import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PhotoSlot } from './PhotoSlot';
it('highlights external file targets, clears the highlight and does not accept internal/text drags', () => {
  const onSelect = vi.fn();
  render(<PhotoSlot position={1} photo={undefined} disabled={false} onSelect={onSelect}/>);
  const target = screen.getByRole('article',{ name:'Foto 1' });
  const transfer = { types:['Files'],files:[],dropEffect:'none' };
  fireEvent.dragOver(target,{ dataTransfer:transfer });
  expect(target).toHaveAttribute('data-drop-active','true'); expect(transfer.dropEffect).toBe('copy');
  fireEvent.dragLeave(target); expect(target).not.toHaveAttribute('data-drop-active');
  const internal = new Event('drop',{ bubbles:true,cancelable:true });
  Object.defineProperty(internal,'dataTransfer',{ value:{ types:['text/uri-list'],files:[] } });
  fireEvent(target,internal); expect(internal.defaultPrevented).toBe(false); expect(onSelect).not.toHaveBeenCalled();
});
it('does not advertise a disabled target or accept its files', () => {
  const onSelect = vi.fn(); render(<PhotoSlot position={1} photo={undefined} disabled onSelect={onSelect}/>);
  const target = screen.getByRole('article',{ name:'Foto 1' });
  const transfer = { types:['Files'],files:[new File(['image'],'photo.jpg',{ type:'image/jpeg' })],dropEffect:'copy' };
  fireEvent.dragOver(target,{ dataTransfer:transfer });
  expect(target).not.toHaveAttribute('data-drop-active'); expect(transfer.dropEffect).toBe('none');
  fireEvent.drop(target,{ dataTransfer:transfer }); expect(onSelect).not.toHaveBeenCalled();
});
