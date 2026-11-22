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

it('keeps a ready image across signature renewal and distinguishes loading from moderation and failure', () => {
  const photo={id:'p1',position:1,url:'https://example.test/photo?X-Amz-Signature=old',validationStatus:'VALIDATED',moderationStatus:'NEEDS_REVIEW',isPersonPhoto:true,isFullBody:false};
  const props={position:1,disabled:false,onSelect:vi.fn()};
  const {rerender}=render(<PhotoSlot {...props} photo={photo}/>);
  const image=screen.getByRole('img',{name:'Foto 1 del perfil'});
  expect(image.parentElement).toHaveAttribute('data-image-state','loading');
  const moderation=screen.getByRole('note',{name:'Foto 1 pendiente de revisión'});
  fireEvent.load(image);
  rerender(<PhotoSlot {...props} photo={{...photo,url:photo.url.replace('old','renewed')}}/>);
  expect(screen.getByRole('img',{name:'Foto 1 del perfil'})).toBe(image);
  expect(image).toHaveAttribute('src',photo.url);
  expect(image.parentElement).toHaveAttribute('data-image-state','loaded');
  expect(moderation).toBeVisible();
  fireEvent.error(image);
  const retry=screen.getByRole('img',{name:'Foto 1 del perfil'});
  expect(retry).toHaveAttribute('src',photo.url.replace('old','renewed'));
  fireEvent.error(retry);
  expect(screen.getByText('No se pudo cargar la foto.')).toBeVisible();
  expect(moderation).toBeVisible();
  rerender(<PhotoSlot {...props} photo={undefined}/>);
  expect(screen.queryByRole('img',{name:'Foto 1 del perfil'})).toBeNull();
});
