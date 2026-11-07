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
    // Mouse users can drag the bubble padding; dragging text keeps native selection.
    if (event.pointerType === 'mouse' && ((event.target instanceof Element && event.target.closest('p,blockquote,time,span')) || window.getSelection()?.toString())) return;
    gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY, raw: 0, horizontal: false };
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
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragging(true);
    }
    active.raw = Math.max(0, Math.min(dx, threshold * 2.5));
    event.preventDefault();
    setOffset(resistedReplyOffset(active.raw));
  };
  return <div ref={root} className={`reply-swipe ${enabled ? 'reply-swipe-enabled' : ''} ${className}`} style={{ transform: `translateX(${offset}px)`, transition: dragging ? 'none' : undefined }}
    onPointerDown={down} onPointerMove={move} onPointerUp={event => {
      const active = gesture.current;
      if (!active || active.id !== event.pointerId) return;
      const select = enabled && active.horizontal && active.raw >= threshold;
      reset();
      if (select) onReply();
    }} onPointerCancel={reset} onLostPointerCapture={reset} onPointerLeave={() => { if (!gesture.current?.horizontal) reset(); }}>
    {children}
    {enabled && <button type="button" className="reply-keyboard-action" aria-label={label} onClick={onReply}>Responder</button>}
  </div>;
}
