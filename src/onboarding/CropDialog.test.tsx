import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CropDialog } from './CropDialog';
afterEach(() => vi.unstubAllGlobals());
it('owns URL and bitmap cleanup after cancellation', async () => {
  const close = vi.fn(); const bitmap = { width:800,height:1000,close };
  vi.stubGlobal('createImageBitmap',vi.fn().mockResolvedValue(bitmap));
  const create = vi.fn().mockReturnValue('blob:preview'), revoke = vi.fn();
  vi.stubGlobal('URL',Object.assign(class extends URL {},{ createObjectURL:create,revokeObjectURL:revoke }));
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{ configurable:true,value:vi.fn(function(this: HTMLDialogElement) { this.setAttribute('open',''); }) });
  const bytes = new ArrayBuffer(24); const data = new DataView(bytes); data.setUint32(0,0x89504e47); data.setUint32(4,0x0d0a1a0a); data.setUint32(16,800); data.setUint32(20,1000);
  const file = new File(['png'],'photo.png',{ type:'image/png' }); Object.defineProperty(file,'arrayBuffer',{ value:async () => bytes });
  const cancel = vi.fn(); const view = render(<CropDialog file={file} onCancel={cancel} onConfirm={vi.fn()}/>);
  await screen.findByAltText('Vista previa del recorte'); fireEvent.click(screen.getByRole('button',{ name:'Restablecer' })); fireEvent.click(screen.getByRole('button',{ name:'Cancelar' })); expect(cancel).toHaveBeenCalledOnce();
  view.unmount(); expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:preview'); expect(close).toHaveBeenCalledOnce();
});
it('closes an obsolete decode after unmount', async () => {
  let finish: ((value: unknown) => void) | undefined; const close = vi.fn();
  vi.stubGlobal('createImageBitmap',vi.fn(() => new Promise(resolve => { finish = resolve; })));
  vi.stubGlobal('URL',Object.assign(class extends URL {},{ createObjectURL:vi.fn().mockReturnValue('blob:preview'),revokeObjectURL:vi.fn() }));
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{ configurable:true,value:vi.fn(function(this: HTMLDialogElement) { this.setAttribute('open',''); }) });
  const bytes = new ArrayBuffer(24); const data = new DataView(bytes); data.setUint32(0,0x89504e47); data.setUint32(4,0x0d0a1a0a); data.setUint32(16,800); data.setUint32(20,1000);
  const file = new File(['png'],'photo.png',{ type:'image/png' }); Object.defineProperty(file,'arrayBuffer',{ value:async () => bytes });
  const view = render(<CropDialog file={file} onCancel={vi.fn()} onConfirm={vi.fn()}/>); await waitFor(() => expect(finish).toBeDefined()); view.unmount(); await act(async () => finish?.({ width:800,height:1000,close })); expect(close).toHaveBeenCalledOnce();
});
