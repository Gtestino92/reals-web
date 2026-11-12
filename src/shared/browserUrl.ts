// Validate without serializing URL: signed paths and queries must stay byte-for-byte intact.
export function browserUrl(value: unknown): string | null {
  if (typeof value !== 'string' || /[\s\u0000-\u001f\u007f\\]/.test(value) || /%(?![\da-f]{2})/i.test(value)) return null;
  const authority = /^https?:\/\/([^/?#]+)/i.exec(value)?.[1];
  if (!authority || authority.includes('@')) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.protocol === 'https:') return value;
    // Local MinIO and ADB reverse endpoints; no LAN, emulator or production HTTP exception.
    if (url.protocol === 'http:' && import.meta.env.DEV && !import.meta.env.PROD && /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(authority)) return value;
  } catch { return null; }
  return null;
}
