import { useEffect, useId, useRef, useState } from 'react';

export const rangeLabels = {
  ONE_TO_FIVE: 'Entre 1 y 5 contactos en común',
  SIX_TO_TEN: 'Entre 6 y 10 contactos en común',
  MORE_THAN_TEN: 'Más de 10 contactos en común',
};
const compact = { ONE_TO_FIVE: '1–5 en común', SIX_TO_TEN: '6–10 en común', MORE_THAN_TEN: 'Más de 10 en común' };

export function SharedContactIndicator({ owner, chat, range }: { owner: string; chat: string; range: keyof typeof rangeLabels }) {
  const key = `reals.contacts.indicator.${encodeURIComponent(owner)}.${encodeURIComponent(chat)}`;
  const id = useId();
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(key) === 'dismissed'; } catch { return false; }
  });
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    function outside(e: Event) {
      if (e.target instanceof Node && !root.current?.contains(e.target)) setOpen(false);
    }
    function escape(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        trigger.current?.focus({ preventScroll: true });
      }
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);
  if (dismissed) return null;
  return <aside ref={root} className="contact-indicator" aria-label="Contactos en común">
    <button ref={trigger} aria-label={rangeLabels[range]} aria-expanded={open} aria-controls={open ? id : undefined} aria-describedby={open ? id : undefined} onClick={() => setOpen(!open)}>
      <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm7-1a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM1 20v-2c0-4 4-6 8-6s8 2 8 6v2zm17-8c3 0 5 2 5 5v2h-4v-1c0-2-.7-4-2-6z"/></svg>
      {compact[range]} <span aria-hidden="true">ⓘ</span></button>
    <button aria-label="Descartar indicador de contactos en común" onClick={() => {
      root.current?.closest('header')?.querySelector('h2')?.focus({ preventScroll: true });
      setOpen(false); setDismissed(true);
      try { localStorage.setItem(key, 'dismissed'); } catch { /* Keep dismissal for this view. */ }
    }}>×</button>
    {open && <p id={id}>Ambas personas eligieron compartir contactos. Los nombres y teléfonos de esos contactos quedan privados. Esta coincidencia no verifica la identidad ni garantiza seguridad.</p>}
  </aside>;
}
