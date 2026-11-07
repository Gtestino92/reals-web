import { afterEach, expect, it, vi } from 'vitest';
import { currentLocation, LocationError } from './location';
function position(overrides: Partial<GeolocationCoordinates> = {}): GeolocationPosition {
  return { coords: { latitude: 0, longitude: 0, accuracy: 20, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}), ...overrides }, timestamp: Date.now(), toJSON: () => ({}) };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('requires a secure context and browser support', async () => {
  vi.stubGlobal('isSecureContext', false);
  await expect(currentLocation(new AbortController().signal)).rejects.toThrow('HTTPS');
  vi.stubGlobal('isSecureContext', true); vi.stubGlobal('navigator', {});
  await expect(currentLocation(new AbortController().signal)).rejects.toThrow('compatible');
});
it.each([
  { coords: { longitude: 181 }, kind: 'invalid' }, { coords: { longitude: NaN }, kind: 'invalid' },
  { coords: { accuracy: -1 }, kind: 'invalid' }, { coords: { accuracy: 5001 }, kind: 'inaccurate' }, { coords: { accuracy: Infinity }, kind: 'invalid' },
])('rejects invalid quality/longitude $kind', async ({ coords, kind }) => {
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: (ok: PositionCallback) => ok(position(coords)) } });
  await expect(currentLocation(new AbortController().signal)).rejects.toMatchObject({ kind });
});
it('ignores location arriving after its owner is aborted', async () => {
  let done: PositionCallback | undefined;
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: (ok: PositionCallback) => { done = ok; } } });
  const owner = new AbortController(), result = currentLocation(owner.signal);
  owner.abort(); await expect(result).rejects.toThrow();
  done?.(position());
});
it('falls back quickly after precise acquisition times out', async () => {
  vi.useFakeTimers(); vi.stubGlobal('isSecureContext', true);
  const acquire = vi.fn<Geolocation['getCurrentPosition']>().mockImplementation((ok, fail, options) => {
    if (options?.enableHighAccuracy) setTimeout(() => fail?.({ code: 3, message: '', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }), options.timeout);
    else setTimeout(() => ok(position({ accuracy: 3500 })), 300);
  });
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: acquire } });
  const result = currentLocation(new AbortController().signal);
  const settled = vi.fn(); void result.then(settled);
  await vi.advanceTimersByTimeAsync(4999); expect(acquire).toHaveBeenCalledOnce(); expect(settled).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(301); await expect(result).resolves.toMatchObject({ accuracyMeters: 3500 });
  expect(acquire.mock.calls.map(call => call[2])).toEqual([
    { enableHighAccuracy: true, timeout: 5000, maximumAge: 900000 },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 900000 },
  ]);
});
it.each([0, 899999, 900000, 900001])('validates cached timestamp age %s without relaxing quality', async age => {
  vi.useFakeTimers(); vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: (ok: PositionCallback) => ok({ ...position({ accuracy: 1000 }), timestamp: Date.now() - age }) } });
  const result = currentLocation(new AbortController().signal);
  if (age <= 900000) await expect(result).resolves.toMatchObject({ accuracyMeters: 1000 });
  else await expect(result).rejects.toMatchObject({ kind: 'stale' });
});
it.each([1,2,3])('maps browser error %s to a safe distinct category', async code => {
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: (_ok: PositionCallback, fail: PositionErrorCallback) => fail({ code, message: 'sensitive', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }) } });
  const result = currentLocation(new AbortController().signal);
  await expect(result).rejects.toBeInstanceOf(LocationError);
  await expect(result).rejects.toMatchObject({ kind: code === 1 ? 'permission-denied' : code === 2 ? 'unavailable' : 'timeout' });
  await expect(result).rejects.not.toThrow('sensitive');
});
it('ignores callbacks from a settled failed request after a new attempt begins', async () => {
  let oldSuccess: PositionCallback | undefined;
  vi.stubGlobal('isSecureContext', true);
  const acquire = vi.fn<Geolocation['getCurrentPosition']>().mockImplementationOnce((ok, fail) => {
    oldSuccess = ok; fail?.({ code: 1, message: '', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
  }).mockImplementation(ok => ok(position()));
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: acquire } });
  await expect(currentLocation(new AbortController().signal)).rejects.toMatchObject({ kind: 'permission-denied' });
  const result = currentLocation(new AbortController().signal); oldSuccess?.(position({ accuracy: 2000 }));
  await expect(result).resolves.toMatchObject({ accuracyMeters: 20 });
});
it.each([1001, 3500, 5000])('accepts approximate accuracy %s without falsifying the payload', async accuracy => {
  vi.stubGlobal('isSecureContext', true);
  const acquire = vi.fn<Geolocation['getCurrentPosition']>().mockImplementation(ok => ok(position({ accuracy })));
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: acquire } });
  await expect(currentLocation(new AbortController().signal)).resolves.toMatchObject({ accuracyMeters: accuracy });
  expect(acquire).toHaveBeenCalledOnce();
});
it('uses a fresh coarse attempt after an excessively inaccurate precise fix', async () => {
  vi.stubGlobal('isSecureContext', true);
  const acquire = vi.fn<Geolocation['getCurrentPosition']>().mockImplementationOnce(ok => ok(position({ accuracy: 6000 }))).mockImplementation(ok => ok(position({ accuracy: 4500 })));
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: acquire } });
  await expect(currentLocation(new AbortController().signal)).resolves.toMatchObject({ accuracyMeters: 4500 });
  expect(acquire.mock.calls[1]?.[2]).toEqual({ enableHighAccuracy: false, timeout: 8000, maximumAge: 0 });
});
it('stops after one failed fallback rather than looping', async () => {
  vi.stubGlobal('isSecureContext', true);
  const acquire = vi.fn<Geolocation['getCurrentPosition']>().mockImplementation((_ok, fail) => fail?.({ code: 2, message: '', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }));
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: acquire } });
  await expect(currentLocation(new AbortController().signal)).rejects.toMatchObject({ kind: 'unavailable' }); expect(acquire).toHaveBeenCalledTimes(2);
});
it('does not try the fallback after permission denial', async () => {
  vi.stubGlobal('isSecureContext', true);
  const acquire = vi.fn<Geolocation['getCurrentPosition']>().mockImplementation((_ok, fail) => fail?.({ code: 1, message: '', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }));
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: acquire } });
  await expect(currentLocation(new AbortController().signal)).rejects.toMatchObject({ kind: 'permission-denied' }); expect(acquire).toHaveBeenCalledOnce();
});
it('abort between failed precise acquisition and fallback prevents another request', async () => {
  const owner = new AbortController(); vi.stubGlobal('isSecureContext', true);
  const acquire = vi.fn<Geolocation['getCurrentPosition']>().mockImplementation((_ok, fail) => {
    fail?.({ code: 3, message: '', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }); owner.abort();
  });
  vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: acquire } });
  await expect(currentLocation(owner.signal)).rejects.toThrow(); expect(acquire).toHaveBeenCalledOnce();
});
