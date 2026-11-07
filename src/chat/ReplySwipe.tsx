import { useEffect, useRef, useState } from 'react';
import type { PointerEvent, ReactNode } from 'react';

const threshold = 60;
export function resistedReplyOffset(distance: number) {
  const raw = Math.max(0, Math.min(distance, threshold * 2.5));
  return raw <= threshold ? raw : threshold + (raw - threshold) * .2;
}

// One owner per target: no document listeners, timers or deferred reply callbacks.
export function ReplySwipe({ enabled, label, onReply, children, className = '' }: {
  enabled: boolean; label: string; onReply: () => void; children: ReactNode; className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: number; x: number; y: number; raw: number; horizontal: boolean } | null>(null);
  const [offset, setOffset] = useState(0), [dragging, setDragging] = useState(false);
  const reset = () => {
    const active = gesture.current;
    gesture.current = null;
    if (active && root.current?.hasPointerCapture(active.id)) root.current.releasePointerCapture(active.id);
    setOffset(0); setDragging(false);
  };
  useEffect(() => {
    const owner = root.current;
    if (!enabled) reset();
    return () => {
      const active = gesture.current;
      gesture.current = null;
      if (active && owner?.hasPointerCapture(active.id)) owner.releasePointerCapture(active.id);
    };
  }, [enabled]);
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (!enabled || !event.isPrimary || event.button !== 0) return;
    if (gesture.current) { reset(); return; }
    if (event.target instanceof Element && event.target.closest('button,a,audio,input,textarea,select')) return;
    // Shift-drag keeps native text selection. Ordinary right drags, including
    // those starting on text, reply; taps/double-clicks and left drags stay native.
    if (event.pointerType === 'mouse' && event.shiftKey) return;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, raw: 0, horizontal: false };
    // Capture before the first move: a fast pointer can already be outside a
    // short bubble when that move is dispatched. Native pan-y can still cancel.
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const active = gesture.current;
    if (!active || active.id !== event.pointerId) return;
    const dx = event.clientX - active.x, dy = event.clientY - active.y;
    if (!active.horizontal) {
      if (Math.abs(dy) > 8 && Math.abs(dy) >= Math.abs(dx)) { reset(); return; }
      if (Math.abs(dx) < 8) return;
      if (dx <= 0 || dx <= Math.abs(dy) * 1.5) { reset(); return; }
      active.horizontal = true;
      if (event.pointerType === 'mouse') window.getSelection()?.removeAllRanges();
      setDragging(true);
    }
    active.raw = Math.max(0, Math.min(dx, threshold * 2.5));
    event.preventDefault();
    setOffset(resistedReplyOffset(active.raw));
  };
  return <div ref={root} className={`reply-swipe ${enabled ? 'reply-swipe-enabled' : ''} ${className}`} title={enabled ? 'Deslizá a la derecha para responder. Con mouse, Shift + arrastrar selecciona texto.' : undefined} style={{ transform: `translateX(${offset}px)`, transition: dragging ? 'none' : undefined, userSelect: dragging ? 'none' : undefined }}
    onPointerDown={down} onPointerMove={move} onPointerUp={event => {
      const active = gesture.current;
      if (!active || active.id !== event.pointerId) return;
      // A quick drag can coalesce the last move. Use the release coordinates,
      // while a previously rejected/cancelled vertical gesture remains absent.
      const dx = event.clientX - active.x, dy = event.clientY - active.y;
      const horizontal = active.horizontal || (dx >= 8 && dx > Math.abs(dy) * 1.5);
      const select = enabled && horizontal && dx >= threshold;
      reset();
      if (select) onReply();
    }} onPointerCancel={reset} onLostPointerCapture={event => {
      // Touch starts with implicit capture on the text node. Transferring it to
      // this owner emits a bubbling loss for that child, not a cancelled gesture.
      if (event.target === event.currentTarget && gesture.current?.id === event.pointerId) reset();
    }} onDragStart={event => { if (gesture.current) event.preventDefault(); }} onPointerLeave={() => { if (!gesture.current?.horizontal) reset(); }}>
    {children}
    {enabled && <button type="button" className="reply-keyboard-action" aria-label={label} onClick={onReply}>Responder</button>}
  </div>;
}
