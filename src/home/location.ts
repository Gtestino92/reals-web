export interface SearchLocation { latitude: number; longitude: number; accuracyMeters: number }
export function currentLocation(signal: AbortSignal): Promise<SearchLocation> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    if (!window.isSecureContext) { reject(new Error('Abrí Reals mediante HTTPS o localhost para compartir tu ubicación.')); return; }
    if (!navigator.geolocation) { reject(new Error('Este navegador no ofrece ubicación. Probá con un navegador compatible.')); return; }
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    const finish = () => signal.removeEventListener('abort', abort);
    navigator.geolocation.getCurrentPosition(position => {
      finish(); if (signal.aborted) return;
      const { latitude, longitude, accuracy } = position.coords;
      if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180 || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > 1000 || !Number.isFinite(position.timestamp) || Date.now() - position.timestamp > 900000 || position.timestamp > Date.now() + 60000) {
        reject(new Error('La ubicación no es válida o suficientemente precisa. Activá la ubicación precisa y volvé a intentar.')); return;
      }
      resolve({ latitude, longitude, accuracyMeters: Math.ceil(accuracy) });
    }, error => {
      finish(); if (signal.aborted) return;
      reject(new Error(error.code === 1 ? 'Permití el acceso a tu ubicación en el navegador y volvé a intentar.' : error.code === 3 ? 'Se agotó el tiempo para obtener tu ubicación. Volvé a intentar en un lugar con mejor señal.' : 'No pudimos obtener tu ubicación. Activá la ubicación del dispositivo y volvé a intentar.'));
    }, { enableHighAccuracy: true, timeout: 7000, maximumAge: 0 });
  });
}
