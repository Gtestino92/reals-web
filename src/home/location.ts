export interface SearchLocation { latitude: number; longitude: number; accuracyMeters: number }
export type LocationFailureKind = 'permission-denied' | 'unavailable' | 'timeout' | 'invalid' | 'inaccurate' | 'stale' | 'insecure' | 'unsupported';
const messages: Record<LocationFailureKind, string> = {
  'permission-denied': 'Permití el acceso a tu ubicación en el navegador y después presioná «Reintentar ubicación».',
  unavailable: 'No pudimos obtener tu ubicación. Activá la ubicación del dispositivo y volvé a intentar.',
  timeout: 'Se agotó el tiempo para obtener tu ubicación. Podés reintentar en un lugar con mejor señal.',
  invalid: 'El navegador devolvió una ubicación no válida. Volvé a solicitarla antes de buscar.',
  inaccurate: 'La ubicación es demasiado aproximada. Necesitamos una precisión de hasta 5 km. Activá la ubicación del dispositivo y volvé a intentar.',
  stale: 'La ubicación es demasiado antigua. Volvé a solicitar tu ubicación actual.',
  insecure: 'Abrí Reals mediante HTTPS o localhost para compartir tu ubicación.',
  unsupported: 'Este navegador no ofrece ubicación. Probá con un navegador compatible.',
};
export class LocationError extends Error {
  constructor(public readonly kind: LocationFailureKind) { super(messages[kind]); }
}
const maxAgeMillis = 15 * 60 * 1000;
export async function currentLocation(signal: AbortSignal, allowCached = true): Promise<SearchLocation> {
  const maximumAge = allowCached ? maxAgeMillis : 0;
  try {
    return await acquireLocation(signal, { enableHighAccuracy: true, timeout: 5000, maximumAge });
  } catch (error) {
    signal.throwIfAborted();
    if (!(error instanceof LocationError) || !['timeout', 'unavailable', 'inaccurate'].includes(error.kind)) throw error;
    // One sequential alternative, never a permission retry or a queue mutation retry.
    return acquireLocation(signal, { enableHighAccuracy: false, timeout: 8000, maximumAge: error.kind === 'inaccurate' ? 0 : maximumAge });
  }
}
function acquireLocation(signal: AbortSignal, options: PositionOptions): Promise<SearchLocation> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    if (!window.isSecureContext) { reject(new LocationError('insecure')); return; }
    if (!navigator.geolocation) { reject(new LocationError('unsupported')); return; }
    let settled = false;
    const finish = () => {
      if (settled) return false;
      settled = true; signal.removeEventListener('abort', abort); return true;
    };
    const abort = () => { if (finish()) reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    try {
      navigator.geolocation.getCurrentPosition(position => {
        if (!finish()) return;
        const { latitude, longitude, accuracy } = position.coords;
        if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180 || !Number.isFinite(accuracy) || accuracy < 0 || !Number.isFinite(position.timestamp) || position.timestamp > Date.now() + 60000) {
          reject(new LocationError('invalid')); return;
        }
        if (accuracy > 5000) { reject(new LocationError('inaccurate')); return; }
        if (Date.now() - position.timestamp > maxAgeMillis) { reject(new LocationError('stale')); return; }
        resolve({ latitude, longitude, accuracyMeters: Math.ceil(accuracy) });
      }, error => {
        if (!finish()) return;
        reject(new LocationError(error.code === 1 ? 'permission-denied' : error.code === 3 ? 'timeout' : 'unavailable'));
      }, options);
    } catch { if (finish()) reject(new LocationError('unavailable')); }
  });
}
