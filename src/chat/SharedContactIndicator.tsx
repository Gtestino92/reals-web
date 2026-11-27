import { useId, useState } from 'react';

export const rangeLabels = {
  ONE_TO_FIVE: 'Entre 1 y 5 contactos en común',
  SIX_TO_TEN: 'Entre 6 y 10 contactos en común',
  MORE_THAN_TEN: 'Más de 10 contactos en común',
};

export function SharedContactIndicator({ owner, chat, range }: { owner: string; chat: string; range: keyof typeof rangeLabels }) {
  const key = `reals.contacts.indicator.${encodeURIComponent(owner)}.${encodeURIComponent(chat)}`;
  const id = useId();
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem(key) ?? 'collapsed'; } catch { return 'collapsed'; }
  });
  function update(value: string) {
    setMode(value);
    try { localStorage.setItem(key, value); } catch { /* Current view still honors the choice. */ }
  }
  if (mode === 'dismissed') return null;
  return <aside className="contact-indicator" aria-label="Contactos en común">
    <button aria-expanded={mode === 'expanded'} aria-controls={id} onClick={() => update(mode === 'expanded' ? 'collapsed' : 'expanded')}>{rangeLabels[range]} {mode === 'expanded' ? '▴' : '▾'}</button>
    <button aria-label="Descartar indicador de contactos en común" onClick={() => update('dismissed')}>×</button>
    <p id={id} hidden={mode !== 'expanded'}>Ambas personas eligieron compartir contactos. Los nombres y teléfonos de esos contactos quedan privados. Esta coincidencia no verifica la identidad ni garantiza seguridad.</p>
  </aside>;
}
