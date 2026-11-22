import { useEffect, useRef, useState } from 'react';
import { cropRect, decodePhoto, drawCrop, exportCrop } from './cropImage';
export { cropRect, decodePhoto, exportCrop } from './cropImage';

const unit = (value: number) => Math.max(0,Math.min(1,value));
type Point = { x: number; y: number };
const initialCrop = { zoom: 1, x: .5, y: .5 };

function gesture(points: Point[]) {
  const [first, second] = points;
  if (!first) return null;
  if (!second) return { ...first, distance: 0 };
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
    distance: Math.hypot(first.x - second.x, first.y - second.y),
  };
}

export function CropDialog({ file, onCancel, onConfirm }: { file: File; onCancel: () => void; onConfirm: (blob: Blob) => Promise<void> }) {
  const [prepared,setPrepared] = useState<{ file: File; bitmap: ImageBitmap } | null>(null);
  const bitmap = prepared?.file === file ? prepared.bitmap : null;
  const [{zoom,x,y},setCrop] = useState(initialCrop);
  const crop = useRef(initialCrop);
  const updateCrop = (next: typeof initialCrop) => { crop.current = next; setCrop(next); };
  const [loadError,setLoadError] = useState(''), [renderError,setRenderError] = useState(''), [error,setError] = useState('');
  const [attempt,setAttempt] = useState(0), [ready,setReady] = useState(false), [busy,setBusy] = useState(false);
  const lock = useRef(false), generation = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const pointers = useRef(new Map<number, Point & { owner: HTMLDivElement; type: string }>());
  const releasePointer = (id: number) => {
    const pointer = pointers.current.get(id);
    pointers.current.delete(id);
    if (pointer?.owner.hasPointerCapture(id)) pointer.owner.releasePointerCapture(id);
  };
  const releaseGesture = () => { for (const id of pointers.current.keys()) releasePointer(id); };
  const cancel = () => { if (!lock.current) { releaseGesture(); onCancel(); } };
  useEffect(() => {
    let active = true; let decoded: ImageBitmap | undefined;
    const own = ++generation.current;
    setPrepared(null); setLoadError(''); setRenderError(''); setError(''); setReady(false); setBusy(false); lock.current = false;
    updateCrop(initialCrop);
    if (!dialog.current?.open) dialog.current?.showModal();
    // StrictMode cleanup cancels the first scheduled decode before it allocates.
    queueMicrotask(() => {
      if (!active) return;
      void decodePhoto(file).then(value => {
        if (active) { decoded = value; setPrepared({ file,bitmap:value }); }
        else value.close();
      }).catch(() => { if (active) setLoadError('No pudimos abrir la imagen. Usá JPEG o PNG de hasta 15 MB, 32 megapíxeles y 16.000 píxeles por lado. Podés reintentar o elegir otra foto.'); });
    });
    return () => { active = false; if (generation.current === own) generation.current++; releaseGesture(); decoded?.close(); };
  }, [file,attempt]);
  useEffect(() => {
    const target = canvas.current;
    if (!target || !bitmap) return;
    const lost = (event: Event) => { event.preventDefault(); releaseGesture(); setRenderError('La vista previa dejó de estar disponible. Reintentá o cancelá para elegir otra foto.'); setReady(false); };
    target.addEventListener('contextlost',lost);
    return () => { target.removeEventListener('contextlost',lost); target.width = 0; target.height = 0; };
  }, [bitmap]);
  useEffect(() => {
    const target = canvas.current;
    if (!target || !bitmap || renderError) return;
    let active = true;
    const frame = requestAnimationFrame(() => {
      if (!active) return;
      try {
        const context = target.getContext('2d');
        if (!context) throw new Error('Canvas unavailable');
        drawCrop(context,bitmap,zoom,x,y,560,700);
        setReady(true);
      } catch { setReady(false); setRenderError('No pudimos mostrar el recorte. Reintentá o cancelá para elegir otra foto.'); }
    });
    return () => { active = false; cancelAnimationFrame(frame); };
  }, [bitmap,zoom,x,y,renderError]);
  const failed = loadError || renderError;
  return <dialog ref={dialog} className="crop-dialog onboarding" onCancel={event => { event.preventDefault(); cancel(); }} onClose={releaseGesture} aria-labelledby="crop-title">
    <h2 id="crop-title">Recortar foto</h2><p>Arrastrá la foto, hacé zoom con dos dedos o ajustá los controles. El recorte será vertical 4:5.</p>
    {!bitmap && !failed && <p role="status">Preparando imagen…</p>}
    {bitmap && <div className="crop-viewport"
      onPointerDown={event => {
        const first = pointers.current.values().next().value;
        if (lock.current || !ready || failed || pointers.current.size >= 2 || event.button !== 0 ||
          (first && (first.type !== 'touch' || event.pointerType !== 'touch'))) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        pointers.current.set(event.pointerId, { x:event.clientX,y:event.clientY,owner:event.currentTarget,type:event.pointerType });
      }}
      onPointerUp={event => releasePointer(event.pointerId)}
      onPointerCancel={event => { if (pointers.current.has(event.pointerId)) releaseGesture(); }}
      onLostPointerCapture={event => { if (pointers.current.has(event.pointerId)) releaseGesture(); }}
      onPointerMove={event => {
        const pointer = pointers.current.get(event.pointerId);
        if (!pointer || lock.current || failed) return;
        const previous = gesture([...pointers.current.values()]);
        pointers.current.set(event.pointerId, { ...pointer,x:event.clientX,y:event.clientY });
        const next = gesture([...pointers.current.values()]);
        const bounds = event.currentTarget.getBoundingClientRect();
        if (!previous || !next || !bounds.width || !bounds.height) return;
        const current = crop.current;
        const zoom = previous.distance > 0 && next.distance > 0
          ? Math.max(1, Math.min(4, current.zoom * next.distance / previous.distance)) : current.zoom;
        const before = cropRect(bitmap.width,bitmap.height,current.zoom,current.x,current.y);
        const after = cropRect(bitmap.width,bitmap.height,zoom,0,0);
        // Keep the source point under the old centroid under the new centroid.
        const left = before.x + (previous.x-bounds.left)/bounds.width*before.w - (next.x-bounds.left)/bounds.width*after.w;
        const top = before.y + (previous.y-bounds.top)/bounds.height*before.h - (next.y-bounds.top)/bounds.height*after.h;
        updateCrop({
          zoom,
          x: bitmap.width > after.w ? unit(left/(bitmap.width-after.w)) : current.x,
          y: bitmap.height > after.h ? unit(top/(bitmap.height-after.h)) : current.y,
        });
      }}>
      <canvas ref={canvas} width={560} height={700} role="img" aria-label="Vista previa del recorte">No se pudo mostrar la vista previa.</canvas>
    </div>}
    {failed && <p role="alert">{failed}</p>}
    {failed && <button type="button" disabled={busy} onClick={() => setAttempt(value => value+1)}>Reintentar imagen</button>}
    <fieldset disabled={busy || !ready || !!failed}>
      <label>Zoom<input type="range" min="1" max="4" step=".01" value={zoom} onChange={event => updateCrop({ ...crop.current,zoom:Number(event.target.value) })}/></label>
      <label>Posición horizontal<input type="range" min="0" max="1" step=".01" value={x} onChange={event => updateCrop({ ...crop.current,x:Number(event.target.value) })}/></label>
      <label>Posición vertical<input type="range" min="0" max="1" step=".01" value={y} onChange={event => updateCrop({ ...crop.current,y:Number(event.target.value) })}/></label>
    </fieldset>
    <p>La foto se guardará con este encuadre. Si después querés modificarlo, tendrás que volver a subir la imagen.</p>
    <div className="crop-actions">
      <button type="button" className="login-button login-outlined" disabled={busy} onClick={cancel}>Cancelar</button>
      <button type="button" className="login-button login-outlined" disabled={busy || !ready || !!failed} onClick={() => { releaseGesture(); updateCrop(initialCrop); }}>Restablecer</button>
      <button type="button" className="login-button login-primary" disabled={busy || !ready || !!failed} onClick={() => {
        if (!bitmap || lock.current || !ready || failed) return;
        const own = generation.current;
        lock.current = true; setBusy(true); setError(''); releaseGesture();
        const {zoom,x,y} = crop.current;
        void exportCrop(bitmap,zoom,x,y).then(blob => { if (generation.current === own) return onConfirm(blob); })
          .catch(() => { if (generation.current === own) setError('No se pudo completar el recorte o la carga. Revisá el estado y volvé a intentar.'); })
          .finally(() => { if (generation.current === own) { lock.current = false; setBusy(false); } });
      }}>{busy ? 'Procesando…' : 'Usar foto'}</button>
    </div>
    {error && <p role="alert">{error}</p>}
  </dialog>;
}
