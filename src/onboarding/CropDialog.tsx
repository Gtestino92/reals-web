import { useEffect, useRef, useState } from 'react';
import { cropRect, decodePhoto, drawCrop, exportCrop } from './cropImage';
export { cropRect, decodePhoto, exportCrop } from './cropImage';

const unit = (value: number) => Math.max(0,Math.min(1,value));
export function CropDialog({ file, onCancel, onConfirm }: { file: File; onCancel: () => void; onConfirm: (blob: Blob) => Promise<void> }) {
  const [prepared,setPrepared] = useState<{ file: File; bitmap: ImageBitmap } | null>(null);
  const bitmap = prepared?.file === file ? prepared.bitmap : null;
  const [zoom,setZoom] = useState(1), [x,setX] = useState(.5), [y,setY] = useState(.5);
  const [loadError,setLoadError] = useState(''), [renderError,setRenderError] = useState(''), [error,setError] = useState('');
  const [attempt,setAttempt] = useState(0), [ready,setReady] = useState(false), [busy,setBusy] = useState(false);
  const lock = useRef(false), generation = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; pointerId: number; owner: HTMLDivElement } | null>(null);
  const releaseDrag = () => {
    const current = drag.current; drag.current = null;
    if (current?.owner.hasPointerCapture(current.pointerId)) current.owner.releasePointerCapture(current.pointerId);
  };
  useEffect(() => {
    let active = true; let decoded: ImageBitmap | undefined;
    const own = ++generation.current;
    setPrepared(null); setLoadError(''); setRenderError(''); setError(''); setReady(false); setBusy(false); lock.current = false;
    setZoom(1); setX(.5); setY(.5);
    if (!dialog.current?.open) dialog.current?.showModal();
    // StrictMode cleanup cancels the first scheduled decode before it allocates.
    queueMicrotask(() => {
      if (!active) return;
      void decodePhoto(file).then(value => {
        if (active) { decoded = value; setPrepared({ file,bitmap:value }); }
        else value.close();
      }).catch(() => { if (active) setLoadError('No pudimos abrir la imagen. Usá JPEG o PNG de hasta 15 MB, 32 megapíxeles y 16.000 píxeles por lado. Podés reintentar o elegir otra foto.'); });
    });
    return () => { active = false; if (generation.current === own) generation.current++; releaseDrag(); decoded?.close(); };
  }, [file,attempt]);
  useEffect(() => {
    const target = canvas.current;
    if (!target || !bitmap) return;
    const lost = (event: Event) => { event.preventDefault(); setRenderError('La vista previa dejó de estar disponible. Reintentá o cancelá para elegir otra foto.'); setReady(false); };
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
  return <dialog ref={dialog} className="crop-dialog onboarding" onCancel={event => { event.preventDefault(); if (!lock.current) onCancel(); }} aria-labelledby="crop-title">
    <h2 id="crop-title">Recortar foto</h2><p>Mové la foto o ajustá los controles. El recorte será vertical 4:5.</p>
    {!bitmap && !failed && <p role="status">Preparando imagen…</p>}
    {bitmap && <div className="crop-viewport"
      onPointerDown={event => {
        if (busy || !ready || failed || drag.current || event.isPrimary === false || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x:event.clientX,y:event.clientY,pointerId:event.pointerId,owner:event.currentTarget };
      }}
      onPointerUp={event => { if (drag.current?.pointerId === event.pointerId) releaseDrag(); }}
      onPointerCancel={event => { if (drag.current?.pointerId === event.pointerId) releaseDrag(); }}
      onLostPointerCapture={event => { if (drag.current?.pointerId === event.pointerId) releaseDrag(); }}
      onPointerMove={event => {
        const previous = drag.current;
        if (!previous || previous.pointerId !== event.pointerId || busy || failed) return;
        // Snapshot numbers before queued React updaters run; pointer-up can clear drag.
        const dx = event.clientX-previous.x, dy = event.clientY-previous.y;
        const bounds = event.currentTarget.getBoundingClientRect();
        const crop = cropRect(bitmap.width,bitmap.height,zoom,0,0);
        const horizontal = (bitmap.width-crop.w)*bounds.width/crop.w;
        const vertical = (bitmap.height-crop.h)*bounds.height/crop.h;
        drag.current = { ...previous,x:event.clientX,y:event.clientY };
        if (horizontal > 0) setX(value => unit(value-dx/horizontal));
        if (vertical > 0) setY(value => unit(value-dy/vertical));
      }}>
      <canvas ref={canvas} width={560} height={700} role="img" aria-label="Vista previa del recorte">No se pudo mostrar la vista previa.</canvas>
    </div>}
    {failed && <p role="alert">{failed}</p>}
    {failed && <button type="button" disabled={busy} onClick={() => setAttempt(value => value+1)}>Reintentar imagen</button>}
    <fieldset disabled={busy || !ready || !!failed}>
      <label>Zoom<input type="range" min="1" max="4" step=".01" value={zoom} onChange={event => setZoom(Number(event.target.value))}/></label>
      <label>Posición horizontal<input type="range" min="0" max="1" step=".01" value={x} onChange={event => setX(Number(event.target.value))}/></label>
      <label>Posición vertical<input type="range" min="0" max="1" step=".01" value={y} onChange={event => setY(Number(event.target.value))}/></label>
      <button type="button" onClick={() => { setZoom(1); setX(.5); setY(.5); }}>Restablecer</button>
      <button type="button" onClick={() => {
        if (!bitmap || lock.current || !ready || failed) return;
        const own = generation.current;
        lock.current = true; setBusy(true); releaseDrag();
        void exportCrop(bitmap,zoom,x,y).then(blob => { if (generation.current === own) return onConfirm(blob); })
          .catch(() => { if (generation.current === own) setError('No se pudo completar el recorte o la carga. Revisá el estado y volvé a intentar.'); })
          .finally(() => { if (generation.current === own) { lock.current = false; setBusy(false); } });
      }}>{busy ? 'Procesando…' : 'Usar foto'}</button>
    </fieldset>
    <button type="button" disabled={busy} onClick={onCancel}>Cancelar</button>
    {error && <p role="alert">{error}</p>}
  </dialog>;
}
