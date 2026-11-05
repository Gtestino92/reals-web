import { photoFileError } from './photoFiles';

const imageError = () => new Error('La imagen no es compatible o es demasiado grande. Usá JPEG o PNG de hasta 32 megapíxeles y 16.000 píxeles por lado.');
const clamp = (value: number, min: number, max: number, fallback: number) => Number.isFinite(value) ? Math.max(min,Math.min(max,value)) : fallback;
export function cropRect(width: number, height: number, zoom: number, x: number, y: number) {
  if (![width,height].every(v => Number.isFinite(v) && v > 0)) throw imageError();
  const w = Math.min(width,height * 4/5) / clamp(zoom,1,4,1);
  const h = w * 5/4;
  return { x:(width-w)*clamp(x,0,1,.5),y:(height-h)*clamp(y,0,1,.5),w,h };
}
export function boundedDimensions(width: number, height: number) {
  if (![width,height].every(v => Number.isInteger(v) && v > 0 && v <= 16000) || width*height > 32_000_000) throw imageError();
  const scale = Math.min(1,2400/width,2400/height,Math.sqrt(4_000_000/(width*height)));
  return { width:Math.max(1,Math.floor(width*scale)),height:Math.max(1,Math.floor(height*scale)) };
}
function orientation(view: DataView, start: number, end: number): number {
  if (start+8 > end) throw imageError();
  const order = view.getUint16(start);
  if (order !== 0x4949 && order !== 0x4d4d) throw imageError();
  const little = order === 0x4949;
  if (view.getUint16(start+2,little) !== 42) throw imageError();
  const offset = view.getUint32(start+4,little);
  const directory = start+offset;
  if (offset < 8 || directory+2 > end) throw imageError();
  const count = view.getUint16(directory,little);
  if (directory+2+count*12 > end) throw imageError();
  for (let i=0; i<count; i++) {
    const entry = directory+2+i*12;
    if (view.getUint16(entry,little) !== 0x112) continue;
    if (view.getUint16(entry+2,little) !== 3 || view.getUint32(entry+4,little) !== 1) throw imageError();
    const value = view.getUint16(entry+8,little);
    if (value < 1 || value > 8) throw imageError();
    return value;
  }
  return 1;
}
function imageDimensions(bytes: ArrayBuffer, type: string) {
  const view = new DataView(bytes);
  let width = 0, height = 0, rotation = 1;
  if (type === 'image/png' && view.byteLength >= 33 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a && view.getUint32(12) === 0x49484452) {
    width = view.getUint32(16); height = view.getUint32(20);
    for (let at=8; at+12 <= view.byteLength;) {
      const size = view.getUint32(at), end = at+8+size;
      if (end+4 > view.byteLength) throw imageError();
      const tag = view.getUint32(at+4);
      if (tag === 0x65584966) rotation = orientation(view,at+8,end);
      if (tag === 0x49454e44) break;
      at = end+4;
    }
  } else if (type === 'image/jpeg' && view.byteLength >= 4 && view.getUint16(0) === 0xffd8) {
    for (let at=2; at+4 <= view.byteLength;) {
      if (view.getUint8(at) !== 255) throw imageError();
      const tag = view.getUint8(at+1);
      if (tag === 255) { at++; continue; }
      if (tag === 218 || tag === 217) break;
      if (tag === 1 || (tag >= 208 && tag <= 215)) { at+=2; continue; }
      const size = view.getUint16(at+2), end = at+2+size;
      if (size < 2 || end > view.byteLength) throw imageError();
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(tag)) {
        if (size < 8) throw imageError();
        height = view.getUint16(at+5); width = view.getUint16(at+7);
      }
      if (tag === 225 && size >= 8 && view.getUint32(at+4) === 0x45786966 && view.getUint16(at+8) === 0) rotation = orientation(view,at+10,end);
      at = end;
    }
  }
  boundedDimensions(width,height); // Reject unreasonable source dimensions before decoding.
  return rotation >= 5 ? { width:height,height:width } : { width,height };
}
export async function decodePhoto(file: File) {
  const error = photoFileError(file);
  if (error) throw new Error(error);
  const source = imageDimensions(await file.arrayBuffer(),file.type);
  const target = boundedDimensions(source.width,source.height);
  const bitmap = await createImageBitmap(file,{ imageOrientation:'from-image',resizeWidth:target.width,resizeHeight:target.height,resizeQuality:'high' });
  if (bitmap.width !== target.width || bitmap.height !== target.height || bitmap.width*bitmap.height > 4_000_000) { bitmap.close(); throw imageError(); }
  return bitmap;
}
export function drawCrop(context: CanvasRenderingContext2D, bitmap: ImageBitmap, zoom: number, x: number, y: number, width: number, height: number) {
  const r = cropRect(bitmap.width,bitmap.height,zoom,x,y);
  context.fillStyle = '#fff'; context.fillRect(0,0,width,height);
  context.drawImage(bitmap,r.x,r.y,r.w,r.h,0,0,width,height);
}
export async function exportCrop(bitmap: ImageBitmap, zoom: number, x: number, y: number): Promise<Blob> {
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1350;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo preparar el recorte.');
    drawCrop(context,bitmap,zoom,x,y,1080,1350);
    return await new Promise<Blob>((resolve,reject) => canvas.toBlob(blob => blob?.type === 'image/jpeg' ? resolve(blob) : reject(new Error('No se pudo exportar JPEG.')), 'image/jpeg',.9));
  } finally { canvas.width = 0; canvas.height = 0; }
}
