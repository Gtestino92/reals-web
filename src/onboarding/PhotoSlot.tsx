import { useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { Photo } from './contracts';

export function PhotoSlot({ position, photo, disabled, managementDisabled = disabled, reorderDisabled = managementDisabled, picked = false, target = false, instructions, onSelect, onDelete }: {
  position: number; photo: Photo | undefined; disabled: boolean; managementDisabled?: boolean; reorderDisabled?: boolean;
  picked?: boolean; target?: boolean; instructions?: string;
  onSelect: (files: File[]) => void; onDelete?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files') || event.dataTransfer.files.length > 0;
  const dragOver = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault(); event.dataTransfer.dropEffect = disabled ? 'none' : 'copy'; setDragging(!disabled);
  };
  const rejected = photo?.moderationStatus === 'REJECTED', review = photo?.moderationStatus === 'NEEDS_REVIEW';
  return <article className="photo-slot" aria-label={`Foto ${position}`} data-photo-position={position} data-photo-id={photo?.id}
    data-drop-active={dragging && !disabled ? 'true' : undefined} data-reorder-target={target ? 'true' : undefined} data-reorder-source={picked ? 'true' : undefined}
    onDragEnter={dragOver} onDragOver={dragOver}
    onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
    onDrop={event => { if (!hasFiles(event)) return; event.preventDefault(); setDragging(false); if (!disabled) onSelect(Array.from(event.dataTransfer.files)); }}>
    <div className="photo-frame">
      {photo ? <>
        <button type="button" className="photo-reorder-handle" data-reorder-photo={photo.id} aria-label={`Reordenar foto ${position}`} aria-describedby={instructions} aria-pressed={picked} disabled={reorderDisabled}>
          <img src={photo.url} alt={`Foto ${position} del perfil`} draggable={false} referrerPolicy="no-referrer" onError={event => { event.currentTarget.alt = 'No se pudo cargar la foto. Actualizá el estado o revisá el acceso al almacenamiento.'; }}/>
        </button>
        {onDelete && <button className="photo-delete" type="button" disabled={managementDisabled} aria-label={`Eliminar foto ${position}`} onClick={onDelete}><span aria-hidden="true">×</span></button>}
        {(rejected || review) && <span className={`photo-moderation ${rejected ? 'photo-rejected' : ''}`} role="note" aria-label={rejected ? `Foto ${position} rechazada. Debe ser reemplazada.` : `Foto ${position} pendiente de revisión`} title={rejected ? 'Reemplazá esta foto.' : 'Esperá la revisión; el estado se consulta al volver a Reals.'}>{rejected ? 'Rechazada' : 'En revisión'}</span>}
      </> : <button className="photo-add" type="button" disabled={disabled} aria-label={`Agregar en posición ${position}`} aria-describedby="photo-upload-guidance" onClick={() => input.current?.click()}>
        <span className="photo-plus" aria-hidden="true">+</span><span>Agregar</span>
      </button>}
    </div>
    <input ref={input} hidden type="file" accept="image/jpeg,image/png" aria-label={`${photo ? 'Reemplazar' : 'Agregar'} foto ${position}`} aria-describedby="photo-upload-guidance" disabled={disabled}
      onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) onSelect(files); }}/>
    {photo && <button className="photo-replace" type="button" disabled={disabled} aria-label={`Cambiar foto ${position}`} aria-describedby="photo-upload-guidance" onClick={() => input.current?.click()}>Cambiar</button>}
  </article>;
}
