import type { Photo } from './contracts';

// Android ProfilePhotoReorder.movePhotoLocally: swap occupied targets, preserve holes.
export function photoPlacements(photos: Photo[], photoId: string, targetPosition: number) {
  const source = photos.find(photo => photo.id === photoId);
  if (!source || !Number.isInteger(targetPosition) || targetPosition < 1 || targetPosition > 9 || source.position === targetPosition) return null;
  const target = photos.find(photo => photo.position === targetPosition);
  return photos.map(photo => ({ photoId:photo.id,position:photo.id === source.id ? targetPosition : photo.id === target?.id ? source.position : photo.position }))
    .sort((a,b) => a.position-b.position);
}
