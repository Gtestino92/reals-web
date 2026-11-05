import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { Photo } from './contracts';
import { PhotoSlot } from './PhotoSlot';

interface Interaction {
  kind: 'mouse' | 'touch' | 'keyboard'; id: number; active: boolean; photo: Photo;
  startX: number; startY: number; x: number; y: number; size: number; target: number | null;
  timer: number | null; capture: HTMLDivElement | null;
}
export function PhotoGrid({ photos, disabled, uploadsDisabled, onSelect, onDelete, onMove }: {
  photos: Photo[]; disabled: boolean; uploadsDisabled: boolean;
  onSelect: (files: File[], position: number, photo?: Photo) => void;
  onDelete: (photo: Photo) => void; onMove: (photoId: string, target: number) => void;
}) {
  const instructions = useId();
  const grid = useRef<HTMLDivElement>(null), owned = useRef<Interaction | null>(null), mounted = useRef(false);
  const latest = useRef({ photos,disabled,onMove });
  const [view,setView] = useState<Interaction | null>(null), [feedback,setFeedback] = useState('');
  const clear = (message = '') => {
    const current = owned.current; owned.current = null;
    if (current?.timer !== null && current?.timer !== undefined) clearTimeout(current.timer);
    if (current?.capture?.hasPointerCapture(current.id)) current.capture.releasePointerCapture(current.id);
    if (mounted.current) { setView(null); if (message) setFeedback(message); }
  };
  useLayoutEffect(() => {
    const previous = latest.current; latest.current = { photos,disabled,onMove };
    if (disabled || previous.photos !== photos) clear();
  }, [photos,disabled,onMove]);
  const sourceAt = (target: EventTarget | null) => {
    const handle = target instanceof Element ? target.closest<HTMLButtonElement>('[data-reorder-photo]') : null;
    if (!handle || !grid.current?.contains(handle)) return null;
    const photo = latest.current.photos.find(item => item.id === handle.dataset.reorderPhoto);
    return photo ? { photo,handle } : null;
  };
  const targetAt = (x: number, y: number) => {
    const element = document.elementFromPoint?.(x,y)?.closest('[data-photo-position]');
    const position = element && grid.current?.contains(element) ? Number(element.getAttribute('data-photo-position')) : 0;
    return position >= 1 && position <= 9 ? position : null;
  };
  const start = (photo: Photo, handle: HTMLButtonElement, kind: Interaction['kind'], id: number, x: number, y: number): Interaction => ({
    kind,id,photo,active:kind === 'keyboard',startX:x,startY:y,x,y,size:handle.getBoundingClientRect().width,target:photo.position,timer:null,capture:null,
  });
  const activate = (current: Interaction) => {
    if (!mounted.current || owned.current !== current || latest.current.disabled) return;
    current.active = true; current.target = current.kind === 'keyboard' ? current.photo.position : targetAt(current.x,current.y);
    setFeedback(''); setView({ ...current });
  };
  const move = (current: Interaction, x: number, y: number) => {
    current.x = x; current.y = y; current.target = targetAt(x,y);
    if (current.active) setView({ ...current });
  };
  const finish = (current: Interaction) => {
    if (owned.current !== current) return;
    const target = current.target;
    clear(current.active ? 'Reordenación cancelada.' : '');
    if (current.active && !latest.current.disabled && target !== null && target !== current.photo.position) {
      setFeedback('Cambio de posición solicitado.'); latest.current.onMove(current.photo.id,target);
    }
  };
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' || event.isPrimary === false || event.button !== 0 || latest.current.disabled || owned.current) return;
    const source = sourceAt(event.target); if (!source) return;
    event.preventDefault(); source.handle.focus({ preventScroll:true });
    const current = start(source.photo,source.handle,'mouse',event.pointerId,event.clientX,event.clientY);
    current.capture = event.currentTarget; owned.current = current; event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = owned.current;
    if (!current || current.kind !== 'mouse' || current.id !== event.pointerId) return;
    if (!current.active && Math.hypot(event.clientX-current.startX,event.clientY-current.startY) >= 4) activate(current);
    if (current.active) { event.preventDefault(); move(current,event.clientX,event.clientY); }
  };
  const keyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    const source = sourceAt(event.target); const current = owned.current;
    if (event.key === 'Escape' || event.key === 'Tab') { if (current) { clear('Reordenación cancelada.'); if (event.key === 'Escape') event.preventDefault(); } return; }
    if (!source || latest.current.disabled || (current && current.kind !== 'keyboard')) return;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (current) finish(current);
      else { const next = start(source.photo,source.handle,'keyboard',0,0,0); owned.current = next; activate(next); }
      return;
    }
    if (!current) return;
    const offset: Record<string,number> = { ArrowLeft:-1,ArrowRight:1,ArrowUp:-3,ArrowDown:3 };
    const next = event.key === 'Home' ? 1 : event.key === 'End' ? 9 : Object.hasOwn(offset,event.key) ? (current.target ?? current.photo.position)+(offset[event.key] ?? 0) : null;
    if (next !== null) { event.preventDefault(); current.target = Math.max(1,Math.min(9,next)); setView({ ...current }); }
  };
  useEffect(() => {
    const element = grid.current; if (!element) return;
    mounted.current = true;
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) { if (owned.current?.kind === 'touch') clear('Reordenación cancelada.'); return; }
      if (latest.current.disabled || owned.current) return;
      const source = sourceAt(event.target), finger = event.touches[0]; if (!source || !finger) return;
      const current = start(source.photo,source.handle,'touch',finger.identifier,finger.clientX,finger.clientY); owned.current = current;
      current.timer = window.setTimeout(() => activate(current),500);
    };
    const touchMove = (event: TouchEvent) => {
      const current = owned.current; if (!current || current.kind !== 'touch') return;
      const finger = Array.from(event.touches).find(item => item.identifier === current.id);
      if (!finger || event.touches.length !== 1) { clear('Reordenación cancelada.'); return; }
      if (!current.active) { if (Math.hypot(finger.clientX-current.startX,finger.clientY-current.startY) > 8) clear(); return; }
      if (!event.cancelable) { clear('Reordenación cancelada.'); return; }
      event.preventDefault(); move(current,finger.clientX,finger.clientY);
    };
    const touchEnd = (event: TouchEvent) => {
      const current = owned.current; if (!current || current.kind !== 'touch') return;
      const finger = Array.from(event.changedTouches).find(item => item.identifier === current.id); if (!finger) return;
      if (current.active) { if (event.cancelable) event.preventDefault(); move(current,finger.clientX,finger.clientY); }
      finish(current);
    };
    const touchCancel = () => { if (owned.current?.kind === 'touch') clear('Reordenación cancelada.'); };
    const abandon = () => clear();
    const hidden = () => { if (document.visibilityState !== 'visible') clear(); };
    // Non-passive only here: scrolling is prevented after the long press, not before.
    element.addEventListener('touchstart',touchStart,{ passive:true });
    element.addEventListener('touchmove',touchMove,{ passive:false });
    element.addEventListener('touchend',touchEnd,{ passive:false });
    element.addEventListener('touchcancel',touchCancel);
    window.addEventListener('blur',abandon); document.addEventListener('visibilitychange',hidden);
    return () => {
      mounted.current = false; clear(); element.removeEventListener('touchstart',touchStart); element.removeEventListener('touchmove',touchMove);
      element.removeEventListener('touchend',touchEnd); element.removeEventListener('touchcancel',touchCancel);
      window.removeEventListener('blur',abandon); document.removeEventListener('visibilitychange',hidden);
    };
  }, []);
  return <>
    <p id={instructions} className="photo-reorder-instructions">Para reordenar, arrastrá una foto con el mouse o mantenela presionada y arrastrá en el teléfono. Con teclado: Espacio o Enter para seleccionar, flechas para elegir destino, Enter para confirmar y Escape para cancelar.</p>
    <p role="status" aria-atomic="true" className="photo-reorder-feedback">{view ? `Foto ${view.photo.position} seleccionada. ${view.target ? `Destino: posición ${view.target}.` : 'Fuera de la grilla.'} Confirmá para mover o cancelá.` : feedback}</p>
    <div ref={grid} className="photo-grid" onPointerDown={pointerDown} onPointerMove={pointerMove}
      onPointerUp={event => { const current = owned.current; if (current?.kind === 'mouse' && current.id === event.pointerId) { if (current.active) move(current,event.clientX,event.clientY); finish(current); } }}
      onPointerCancel={event => { if (owned.current?.kind === 'mouse' && owned.current.id === event.pointerId) clear('Reordenación cancelada.'); }}
      onLostPointerCapture={event => { if (owned.current?.kind === 'mouse' && owned.current.id === event.pointerId) clear('Reordenación cancelada.'); }}
      onKeyDown={keyboard} onClick={event => { if (event.detail === 0 && sourceAt(event.target) && !latest.current.disabled && !owned.current) { const source = sourceAt(event.target); if (source) { const next = start(source.photo,source.handle,'keyboard',0,0,0); owned.current = next; activate(next); } } }}
      onContextMenu={event => { if (sourceAt(event.target)) event.preventDefault(); }}
      onBlur={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) clear(); }}>
      {Array.from({ length:9 },(_,i) => {
        const position = i+1, photo = photos.find(item => item.position === position);
        return <PhotoSlot key={position} position={position} photo={photo} disabled={uploadsDisabled || !!view} managementDisabled={disabled || !!view} reorderDisabled={disabled}
          picked={view?.photo.id === photo?.id && !!photo} target={view?.target === position} instructions={instructions}
          onSelect={files => { if (!owned.current) onSelect(files,position,photo); }} onDelete={() => { if (photo && !owned.current) onDelete(photo); }}/ >;
      })}
      {view && view.kind !== 'keyboard' && <div className="photo-drag-ghost" aria-hidden="true" style={{ left:view.x-view.size/2,top:view.y-view.size/2,width:view.size,height:view.size }}><img src={view.photo.url} alt="" draggable={false} referrerPolicy="no-referrer"/></div>}
    </div>
  </>;
}
