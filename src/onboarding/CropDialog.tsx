import { useEffect, useRef, useState } from 'react';

export function cropRect(width: number, height: number, zoom: number, x: number, y: number) {
  const w = Math.min(width, height * 4 / 5) / Math.max(1, Math.min(4, zoom));
  const h = w * 5 / 4;
  return { x: (width - w) * Math.max(0, Math.min(1, x)), y: (height - h) * Math.max(0, Math.min(1, y)), w, h };
}
export async function decodePhoto(file: File) {
  if (!['image/jpeg', 'image/png'].includes(file.type) || file.size > 15 * 1024 * 1024) throw new Error('Elegí un JPEG o PNG de hasta 15 MB.');
  // Inspect dimensions before allocating a full decoded image.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  let width = 0, height = 0;
  if (file.type === 'image/png' && bytes.length >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) { width = view.getUint32(16); height = view.getUint32(20); }
  else if (file.type === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 255) break;
      const marker = bytes[i+1];
      if (marker === 218 || marker === 217) break;
      const length = view.getUint16(i+2);
      if (length < 2 || i + length + 2 > bytes.length) break;
      if (marker !== undefined && [192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) { height = view.getUint16(i+5); width = view.getUint16(i+7); break; }
      i += length + 2;
    }
  }
  if (!width || !height || width * height > 32_000_000 || Math.max(width,height) > 16000) throw new Error('La imagen no es compatible o es demasiado grande (máximo 32 megapíxeles).');
  return createImageBitmap(file, { imageOrientation: 'from-image', resizeWidth: Math.min(width, 2400), resizeQuality: 'high' });
}
export async function exportCrop(bitmap: ImageBitmap, zoom: number, x: number, y: number): Promise<Blob> {
  const r = cropRect(bitmap.width, bitmap.height, zoom, x, y);
  const canvas = document.createElement('canvas'); canvas.width = 1080; canvas.height = 1350;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No se pudo preparar el recorte.');
  context.fillStyle = '#fff'; context.fillRect(0, 0, 1080, 1350);
  context.drawImage(bitmap, r.x, r.y, r.w, r.h, 0, 0, 1080, 1350);
  try { return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob?.type === 'image/jpeg' ? resolve(blob) : reject(new Error('No se pudo exportar JPEG.')), 'image/jpeg', 0.9)); }
  finally { canvas.width = 0; canvas.height = 0; }
}
export function CropDialog({ file, onCancel, onConfirm }: { file: File; onCancel: () => void; onConfirm: (blob: Blob) => Promise<void> }) {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [url, setUrl] = useState('');
  const [zoom, setZoom] = useState(1), [x, setX] = useState(.5), [y, setY] = useState(.5);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const lock = useRef(false), alive = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    alive.current = true; let active = true; let decoded: ImageBitmap | undefined; const objectUrl = URL.createObjectURL(file); setUrl(objectUrl);
    dialog.current?.showModal();
    void decodePhoto(file).then(value => { if (active) { decoded = value; setBitmap(value); } else value.close(); }).catch(() => { if (active) setError('No pudimos abrir la imagen. Usá JPEG o PNG de hasta 15 MB y 32 megapíxeles.'); });
    return () => { alive.current = false; active = false; decoded?.close(); URL.revokeObjectURL(objectUrl); };
  }, [file]);
  return <dialog ref={dialog} className="crop-dialog onboarding" onCancel={e => { e.preventDefault(); if (!lock.current) onCancel(); }} aria-labelledby="crop-title">
    <h2 id="crop-title">Recortar foto</h2><p>Mové la foto o ajustá los controles. El recorte será vertical 4:5.</p>
    {bitmap && <div className="crop-viewport" onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY }; }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onPointerMove={e => { if (drag.current && !busy) { setX(v => Math.max(0,Math.min(1,v-(e.clientX-drag.current!.x)/250))); setY(v => Math.max(0,Math.min(1,v-(e.clientY-drag.current!.y)/250))); drag.current = { x: e.clientX, y: e.clientY }; } }}>
      <img alt="Vista previa del recorte" src={url} draggable={false} style={{ width: `${Math.max(1,bitmap.width / bitmap.height / .8)*zoom*100}%`, height: `${Math.max(1,bitmap.height / bitmap.width * .8)*zoom*100}%`, left: `${x*100}%`, top: `${y*100}%`, transform: `translate(-${x*100}%, -${y*100}%)` }} />
    </div>}
    <fieldset disabled={busy}><label>Zoom<input type="range" min="1" max="4" step=".01" value={zoom} onChange={e => setZoom(Number(e.target.value))}/></label><label>Posición horizontal<input type="range" min="0" max="1" step=".01" value={x} onChange={e => setX(Number(e.target.value))}/></label><label>Posición vertical<input type="range" min="0" max="1" step=".01" value={y} onChange={e => setY(Number(e.target.value))}/></label>
    <button type="button" onClick={() => { setZoom(1); setX(.5); setY(.5); }}>Restablecer</button><button type="button" onClick={onCancel}>Cancelar</button><button type="button" disabled={!bitmap} onClick={() => { if (!bitmap || lock.current) return; lock.current = true; setBusy(true); void exportCrop(bitmap,zoom,x,y).then(blob => { if (alive.current) return onConfirm(blob); }).catch(() => { if (alive.current) setError('No se pudo completar el recorte o la carga. Revisá el estado y volvé a intentar.'); }).finally(() => { lock.current = false; if (alive.current) setBusy(false); }); }}>{busy ? 'Procesando…' : 'Usar foto'}</button></fieldset>
    {error && <p role="alert">{error}</p>}
  </dialog>;
}
