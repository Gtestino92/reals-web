import { useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import type { Photo } from './contracts';

export function PhotoSlot({ position, photo, disabled, onSelect, children }: {
  position: number; photo: Photo | undefined; disabled: boolean;
  onSelect: (files: File[]) => void; children?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files') || event.dataTransfer.files.length > 0;
  const dragOver = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = disabled ? 'none' : 'copy';
    setDragging(!disabled);
  };
  return <article className="photo-slot" aria-labelledby={`photo-slot-${position}`} data-drop-active={dragging && !disabled ? 'true' : undefined}
    onDragEnter={dragOver} onDragOver={dragOver}
    onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
    onDrop={event => { if (!hasFiles(event)) return; event.preventDefault(); setDragging(false); if (!disabled) onSelect(Array.from(event.dataTransfer.files)); }}>
    <h4 id={`photo-slot-${position}`}>Foto {position}</h4>
    {photo && <img src={photo.url} alt={`Foto ${position} del perfil`} draggable={false} referrerPolicy="no-referrer" onError={event => { event.currentTarget.alt = 'No se pudo cargar la foto. Actualizá el estado o revisá el acceso al almacenamiento.'; }}/ >}
    <input ref={input} hidden type="file" accept="image/jpeg,image/png" aria-label={`${photo ? 'Reemplazar' : 'Agregar'} foto ${position}`} aria-describedby="photo-upload-guidance" disabled={disabled}
      onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) onSelect(files); }}/>
    <button className={photo ? 'photo-replace' : 'photo-add'} type="button" disabled={disabled} aria-describedby="photo-upload-guidance" onClick={() => input.current?.click()}>
      {!photo && <span className="photo-plus" aria-hidden="true">+</span>}
      <span>{`${photo ? 'Reemplazar foto' : 'Agregar foto'} ${position}`}</span>
    </button>
    {children}
  </article>;
}
