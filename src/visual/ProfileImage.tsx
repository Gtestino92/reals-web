import { useState } from 'react';
import './visual.css';

export function usePhotoRequest(url: string, retryEpoch = 0) {
  const [image, setImage] = useState<{ epoch: number; url: string; status: 'loading' | 'loaded' | 'failed' }>(() => ({ epoch: retryEpoch, url, status: 'loading' }));
  // Pin the exact request string while loading/loaded. Only a failed request
  // adopts a renewed signature automatically. The retry epoch is installed
  // with an authoritative response so a click alone cannot restart the request.
  if (image.status === 'failed' && (image.url !== url || image.epoch !== retryEpoch)) setImage({ epoch: retryEpoch, url, status: 'loading' });
  return {
    status: image.status,
    src: image.url,
    onLoad: () => setImage(current => current === image ? { ...current, status: 'loaded' } : current),
    onError: () => setImage(current => current === image ? { ...current, status: 'failed' } : current),
  };
}

export function ThumbnailImage({ url, retryEpoch }: { url: string; retryEpoch: number }) {
  const { status, ...request } = usePhotoRequest(url, retryEpoch);
  return <span className="visual-thumbnail" data-image-state={status}>{status !== 'failed' && <img {...request} alt="" loading="lazy" referrerPolicy="no-referrer"/>}</span>;
}

export function PhotoLoading() {
  return <span className="visual-photo-loading" aria-hidden="true"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="m3 16 4-4 4 4 4-5 6 6"/></svg></span>;
}

export function ProfileImage({ url, label, eager, retryEpoch, onRetry }: { url: string; label: string; eager: boolean; retryEpoch: number; onRetry: () => void }) {
  const { status, ...request } = usePhotoRequest(url, retryEpoch);
  return <figure className="visual-photo" data-image-state={status}>
    {status !== 'failed' && <img {...request} alt={label} loading={eager ? 'eager' : 'lazy'} referrerPolicy="no-referrer" />}
    {status === 'loading' && <PhotoLoading/>}
    {status === 'failed' && <div className="visual-photo-error"><p>No se pudo cargar esta foto. Volvé a intentar.</p><button className="login-button login-outlined" onClick={onRetry}>Reintentar foto</button></div>}
    <figcaption>{label}</figcaption>
  </figure>;
}
