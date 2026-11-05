import { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CropDialog } from './CropDialog';
import { boundedDimensions, cropRect, decodePhoto, drawCrop, exportCrop } from './cropImage';

const frames = new Map<number,FrameRequestCallback>();
let frameId = 0;
const context = { fillStyle:'',fillRect:vi.fn(),drawImage:vi.fn() };
const decode = vi.fn<(source: ImageBitmapSource, options?: ImageBitmapOptions) => Promise<ImageBitmap>>();
const makeBitmap = (width = 800,height = 1000): ImageBitmap => ({ width,height,close:vi.fn() });
const createUrl = vi.fn(), revokeUrl = vi.fn();
function png(width = 800,height = 1000) {
  const data = new DataView(new ArrayBuffer(45));
  data.setUint32(0,0x89504e47); data.setUint32(4,0x0d0a1a0a); data.setUint32(8,13); data.setUint32(12,0x49484452);
  data.setUint32(16,width); data.setUint32(20,height); data.setUint8(24,8); data.setUint8(25,2); data.setUint32(37,0x49454e44);
  return data.buffer;
}
function fileFrom(bytes: ArrayBuffer, type = 'image/png') {
  const file = new File([bytes],'photo',{ type });
  Object.defineProperty(file,'arrayBuffer',{ value:vi.fn().mockResolvedValue(bytes) }); return file;
}
function jpeg(width: number,height: number,orientation = 1,little = true) {
  const data = new DataView(new ArrayBuffer(50));
  data.setUint16(0,0xffd8); data.setUint16(2,0xffe1); data.setUint16(4,34); data.setUint32(6,0x45786966);
  data.setUint16(12,little ? 0x4949 : 0x4d4d); data.setUint16(14,42,little); data.setUint32(16,8,little);
  data.setUint16(20,1,little); data.setUint16(22,0x112,little); data.setUint16(24,3,little); data.setUint32(26,1,little); data.setUint16(30,orientation,little);
  data.setUint16(38,0xffc0); data.setUint16(40,8); data.setUint8(42,8); data.setUint16(43,height); data.setUint16(45,width); data.setUint16(48,0xffd9);
  return fileFrom(data.buffer,'image/jpeg');
}
function flushFrames() { act(() => { const batch = [...frames.values()]; frames.clear(); batch.forEach(callback => callback(0)); }); }
async function prepared() {
  const preview = await screen.findByRole('img',{ name:'Vista previa del recorte' }); flushFrames();
  await waitFor(() => expect(screen.getByRole('button',{ name:'Usar foto' })).toBeEnabled()); return preview;
}
beforeEach(() => {
  frames.clear(); frameId = 0; context.drawImage.mockReset(); context.fillRect.mockReset(); decode.mockReset(); createUrl.mockReset(); revokeUrl.mockReset();
  decode.mockImplementation(async (_,options) => makeBitmap(options?.resizeWidth,options?.resizeHeight));
  vi.stubGlobal('createImageBitmap',decode);
  vi.stubGlobal('URL',Object.assign(class extends URL {},{ createObjectURL:createUrl,revokeObjectURL:revokeUrl }));
  vi.stubGlobal('requestAnimationFrame',vi.fn((callback: FrameRequestCallback) => { frames.set(++frameId,callback); return frameId; }));
  vi.stubGlobal('cancelAnimationFrame',vi.fn((id: number) => frames.delete(id)));
  vi.stubGlobal('PointerEvent',class extends MouseEvent {
    readonly pointerId: number; readonly isPrimary: boolean;
    constructor(type: string,init: PointerEventInit = {}) { super(type,init); this.pointerId = init.pointerId ?? 1; this.isPrimary = init.isPrimary ?? true; }
  });
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{ configurable:true,value:vi.fn(function(this: HTMLDialogElement) { this.setAttribute('open',''); }) });
  Object.defineProperty(HTMLElement.prototype,'setPointerCapture',{ configurable:true,value:vi.fn() });
  Object.defineProperty(HTMLElement.prototype,'hasPointerCapture',{ configurable:true,value:vi.fn().mockReturnValue(true) });
  Object.defineProperty(HTMLElement.prototype,'releasePointerCapture',{ configurable:true,value:vi.fn() });
  vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockReturnValue({ x:0,y:0,left:0,top:0,width:280,height:350,right:280,bottom:350,toJSON:() => ({}) });
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype,'toBlob').mockImplementation(function(this: HTMLCanvasElement,callback,type,quality) {
    expect(this.width).toBe(1080); expect(this.height).toBe(1350); expect(type).toBe('image/jpeg'); expect(quality).toBe(.9);
    callback(new Blob(['jpeg'],{ type:'image/jpeg' }));
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([
  [800,1000,800,1000], [4000,3000,2309,1732], [3000,4000,1732,2309], [2000,16000,300,2400],
  [16000,2000,2400,300], [16000,1,2400,1], [1,16000,1,2400], [5600,5600,2000,2000],
])('bounds decoded %s×%s to %s×%s while retaining aspect ratio within integer rounding', async (w,h,expectedWidth,expectedHeight) => {
  expect(boundedDimensions(w,h)).toEqual({ width:expectedWidth,height:expectedHeight });
  const file = fileFrom(png(w,h)); const bitmap = await decodePhoto(file);
  expect(bitmap.width).toBe(expectedWidth); expect(bitmap.height).toBe(expectedHeight);
  expect(bitmap.width*bitmap.height).toBeLessThanOrEqual(4_000_000);
  expect(decode).toHaveBeenCalledExactlyOnceWith(file,{ imageOrientation:'from-image',resizeWidth:expectedWidth,resizeHeight:expectedHeight,resizeQuality:'high' });
  bitmap.close();
});
it.each([1,2,3,4,5,6,7,8])('resizes EXIF orientation %s using oriented dimensions without manually rotating pixels', async orientation => {
  const file = jpeg(3000,4000,orientation,orientation%2 === 0); const bitmap = await decodePhoto(file);
  expect(bitmap.width).toBe(orientation >= 5 ? 2309 : 1732); expect(bitmap.height).toBe(orientation >= 5 ? 1732 : 2309);
  expect(decode.mock.calls[0]?.[1]?.imageOrientation).toBe('from-image'); bitmap.close();
});
it.each([[0,100],[16001,100],[4000,8001],[Infinity,100]])('rejects unsupported source dimensions %s×%s before decode', async (w,h) => {
  expect(() => boundedDimensions(w,h)).toThrow();
  await expect(decodePhoto(fileFrom(png(w,h)))).rejects.toThrow(); expect(decode).not.toHaveBeenCalled();
});
it('rejects a decoder result that violates the requested bounds and closes it', async () => {
  const bitmap = makeBitmap(2000,16000); decode.mockResolvedValueOnce(bitmap);
  await expect(decodePhoto(fileFrom(png(2000,16000)))).rejects.toThrow(); expect(bitmap.close).toHaveBeenCalledOnce();
});
it.each([[800,1000],[2000,1000],[1000,2000],[2400,1],[1,2400]])('uses finite in-bounds 4:5 geometry across the full zoom range for %s×%s', (w,h) => {
  for (let tick=100; tick<=400; tick++) for (const x of [0,.5,1]) {
    const zoom = tick/100, y = 1-x;
    const r = cropRect(w,h,zoom,x,y);
    expect(Object.values(r).every(Number.isFinite)).toBe(true); expect(r.w/r.h).toBeCloseTo(.8);
    expect(r.w).toBeGreaterThan(0); expect(r.h).toBeGreaterThan(0); expect(r.x).toBeGreaterThanOrEqual(0); expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x+r.w).toBeLessThanOrEqual(w+1e-9); expect(r.y+r.h).toBeLessThanOrEqual(h+1e-9);
  }
});
it('clamps non-finite or out-of-range controls and rejects invalid bitmap dimensions', () => {
  expect(cropRect(800,1000,NaN,Infinity,NaN)).toEqual(cropRect(800,1000,1,.5,.5));
  expect(cropRect(800,1000,20,-5,5)).toEqual(cropRect(800,1000,4,0,1));
  expect(() => cropRect(0,100,1,.5,.5)).toThrow();
});
it.each([1,2,3,4])('preview and export draw exactly the same source rectangle at zoom %s', async zoom => {
  const bitmap = makeBitmap(2400,300);
  drawCrop(context as unknown as CanvasRenderingContext2D,bitmap,zoom,.2,.8,560,700);
  const preview = context.drawImage.mock.calls.at(-1);
  expect((await exportCrop(bitmap,zoom,.2,.8)).type).toBe('image/jpeg');
  const output = context.drawImage.mock.calls.at(-1);
  expect(output?.slice(0,5)).toEqual(preview?.slice(0,5)); expect(output?.slice(-2)).toEqual([1080,1350]);
});
it('clears export canvas storage even if the context cannot be created', async () => {
  let output: HTMLCanvasElement | undefined;
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementationOnce(function(this: HTMLCanvasElement) { output = this; return null; });
  await expect(exportCrop(makeBitmap(),1,.5,.5)).rejects.toThrow();
  expect(output?.width).toBe(0); expect(output?.height).toBe(0);
});
it('reuses one bitmap and a fixed-size canvas across repeated slider changes and boundary values', async () => {
  const file = fileFrom(png(2000,16000));
  render(<StrictMode><CropDialog file={file} onCancel={vi.fn()} onConfirm={vi.fn()}/></StrictMode>); const preview = await prepared();
  for (let repeat=0; repeat<5; repeat++) for (const zoom of [1,2,3,4,1.01,3.99,1,4]) {
    fireEvent.change(screen.getByLabelText('Zoom'),{ target:{ value:String(zoom) } });
    fireEvent.change(screen.getByLabelText('Posición horizontal'),{ target:{ value:repeat%2 ? '0' : '1' } });
    fireEvent.change(screen.getByLabelText('Posición vertical'),{ target:{ value:repeat%2 ? '1' : '0' } }); flushFrames();
    expect(screen.getByRole('img',{ name:'Vista previa del recorte' })).toBe(preview);
    expect(preview).toHaveAttribute('width','560'); expect(preview).toHaveAttribute('height','700');
    expect(context.drawImage.mock.calls.at(-1)?.slice(1).every(Number.isFinite)).toBe(true);
  }
  expect(decode).toHaveBeenCalledOnce(); expect(file.arrayBuffer).toHaveBeenCalledOnce();
  expect(createUrl).not.toHaveBeenCalled(); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('does not dereference a released drag during batched pointer movement and release', async () => {
  render(<CropDialog file={fileFrom(png())} onCancel={vi.fn()} onConfirm={vi.fn()}/>); const viewport = (await prepared()).parentElement;
  if (!viewport) throw new Error('Missing viewport');
  fireEvent.change(screen.getByLabelText('Zoom'),{ target:{ value:'2' } }); flushFrames();
  fireEvent.pointerDown(viewport,{ clientX:100,clientY:100 });
  expect(() => act(() => { fireEvent.pointerMove(viewport,{ clientX:120,clientY:120 }); fireEvent.pointerUp(viewport); })).not.toThrow();
  flushFrames(); expect(Number((screen.getByLabelText('Posición horizontal') as HTMLInputElement).value)).toBeLessThan(.5);
  expect(Number((screen.getByLabelText('Posición vertical') as HTMLInputElement).value)).toBeLessThan(.5);
  for (const zoom of [1,2,3,4]) { fireEvent.change(screen.getByLabelText('Zoom'),{ target:{ value:String(zoom) } }); flushFrames(); }
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
it('releases owned bitmap/canvas storage and pending frames after cancellation without creating original-file URLs', async () => {
  const bitmap = makeBitmap(); decode.mockResolvedValueOnce(bitmap); const cancel = vi.fn();
  const view = render(<CropDialog file={fileFrom(png())} onCancel={cancel} onConfirm={vi.fn()}/>); const preview = await prepared();
  fireEvent.change(screen.getByLabelText('Zoom'),{ target:{ value:'4' } });
  fireEvent.click(screen.getByRole('button',{ name:'Cancelar' })); expect(cancel).toHaveBeenCalledOnce(); view.unmount();
  expect(bitmap.close).toHaveBeenCalledOnce(); expect(preview).toHaveAttribute('width','0'); expect(preview).toHaveAttribute('height','0'); expect(frames.size).toBe(0);
  expect(createUrl).not.toHaveBeenCalled(); expect(revokeUrl).not.toHaveBeenCalled();
});
it('closes a decode that finishes after unmount', async () => {
  let finish: ((value: ImageBitmap) => void) | undefined; const bitmap = makeBitmap();
  decode.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<CropDialog file={fileFrom(png())} onCancel={vi.fn()} onConfirm={vi.fn()}/>);
  await waitFor(() => expect(finish).toBeDefined()); view.unmount(); await act(async () => finish?.(bitmap)); expect(bitmap.close).toHaveBeenCalledOnce();
});
it('handles decode failures with cancel/retry, and recovers without confirming a failed image', async () => {
  decode.mockRejectedValueOnce(new Error('decode failed')); const confirm = vi.fn(), cancel = vi.fn();
  render(<CropDialog file={fileFrom(png())} onCancel={cancel} onConfirm={confirm}/>);
  expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos abrir la imagen'); expect(screen.getByRole('button',{ name:'Usar foto' })).toBeDisabled();
  expect(screen.getByRole('button',{ name:'Cancelar' })).toBeEnabled(); fireEvent.click(screen.getByRole('button',{ name:'Reintentar imagen' }));
  await prepared(); expect(decode).toHaveBeenCalledTimes(2); expect(confirm).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{ name:'Usar foto' })); await waitFor(() => expect(confirm).toHaveBeenCalledOnce());
});
it.each(['missing context','draw failure','context loss'])('reports %s without blanking the dialog and disables confirmation', async failure => {
  if (failure === 'missing context') vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValueOnce(null);
  if (failure === 'draw failure') context.drawImage.mockImplementationOnce(() => { throw new Error('render failed'); });
  render(<CropDialog file={fileFrom(png())} onCancel={vi.fn()} onConfirm={vi.fn()}/>);
  const preview = await screen.findByRole('img',{ name:'Vista previa del recorte' }); flushFrames();
  if (failure === 'context loss') fireEvent(preview,new Event('contextlost',{ cancelable:true }));
  expect(screen.getByRole('alert')).toHaveTextContent(/vista previa|recorte/); expect(screen.getByRole('heading',{ name:'Recortar foto' })).toBeInTheDocument();
  expect(screen.getByRole('button',{ name:'Usar foto' })).toBeDisabled(); expect(screen.getByRole('button',{ name:'Cancelar' })).toBeEnabled();
});
