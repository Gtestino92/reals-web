export function photoFileError(file: File): string | null {
  if (!['image/jpeg', 'image/png'].includes(file.type)) return 'Elegí una foto JPEG o PNG. Este formato no es compatible.';
  if (file.size === 0 || file.size > 15 * 1024 * 1024) return 'Elegí una foto que no esté vacía y de hasta 15 MB.';
  return null;
}
