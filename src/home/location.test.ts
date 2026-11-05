import { afterEach, expect, it, vi } from 'vitest';
import { currentLocation } from './location';
function position(overrides: Partial<GeolocationCoordinates> = {}): GeolocationPosition {
  return { coords: { latitude: 0, longitude: 0, accuracy: 20, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}), ...overrides }, timestamp: Date.now(), toJSON: () => ({}) };
}
afterEach(() => vi.unstubAllGlobals());
it('requires a secure context and browser support', async () => {
  vi.stubGlobal('isSecureContext', false);
  await expect(currentLocation(new AbortController().signal)).rejects.toThrow('HTTPS');
  vi.stubGlobal('isSecureContext', true); vi.stubGlobal('navigator', {});
  await expect(currentLocation(new AbortController().signal)).rejects.toThrow('compatible');
});
it.each([
  { longitude: 181 }, { longitude: NaN }, { accuracy: -1 }, { accuracy: 1001 }, { accuracy: Infinity },
])('rejects invalid quality/longitude %j', async overrides => {
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: (ok: PositionCallback) => ok(position(overrides)) } });
  await expect(currentLocation(new AbortController().signal)).rejects.toThrow('precisa');
});
it('ignores location arriving after its owner is aborted', async () => {
  let done: PositionCallback | undefined;
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: (ok: PositionCallback) => { done = ok; } } });
  const owner = new AbortController(), result = currentLocation(owner.signal);
  owner.abort(); await expect(result).rejects.toThrow();
  done?.(position());
});
