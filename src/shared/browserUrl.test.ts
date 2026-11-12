import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../auth/api';
import { mediaUrl } from '../admin/model';
import { parseMessage } from '../chat/contracts';
import { legal, photos } from '../onboarding/contracts';
import { browserUrl } from './browserUrl';

afterEach(() => vi.unstubAllEnvs());
const signedQuery = '?X-Amz-Credential=test%2F20261112%2Fauto%2Fs3%2Faws4_request&z=two+words&x=%2b%2F%3D&x=&X-Amz-Signature=abc123&response-content-disposition=inline%3B%20filename%3D%22a.jpg%22';
const consumers = [
  { name: 'profile photos', parse: (url: unknown) => photos([{ id: 'p', url, position: 1, validationStatus: 'VALIDATED', moderationStatus: 'APPROVED', isPersonPhoto: true, isFullBody: true }])[0]?.url },
  { name: 'legal documents', parse: (url: unknown) => {
    const document = { type: 'TERMS_OF_USE', version: 'v1', requiredAction: 'ACCEPTED', satisfied: false };
    return legal({ requirementsSatisfied: false, documents: [document] }, { documents: [{ ...document, url }] }).documents[0]?.url;
  } },
  { name: 'chat audio', parse: (url: unknown) => parseMessage({ id: '1', chatSessionId: 'c', senderId: 'me', messageType: 'AUDIO', sentAt: '2026-11-12T00:00:00Z', audio: { url, durationMillis: 1000, sizeBytes: 100, contentType: 'audio/mp4' } }, 'c', ['me', 'them']).audio?.url },
  { name: 'admin media', parse: mediaUrl },
];
function environment(dev: boolean, prod = !dev) {
  vi.stubEnv('DEV', dev);
  vi.stubEnv('PROD', prod);
}

describe.each(consumers)('$name URL boundary', ({ name, parse }) => {
  function rejected(value: unknown) {
    if (name === 'admin media') expect(parse(value)).toBeNull();
    else expect(() => parse(value)).toThrow(ApiError);
  }
  it('preserves production HTTPS signed URLs exactly', () => {
    environment(false);
    const value = `https://CDN.example.test:443/private/a%2Fb.jpg${signedQuery}`;
    expect(parse(value)).toBe(value);
  });
  it.each(['localhost', '127.0.0.1'])('keeps local MinIO / ADB HTTP on %s only in development', host => {
    const value = `http://${host}:9000/reals-media/a%2Fb${signedQuery}`;
    environment(true);
    expect(parse(value)).toBe(value);
    environment(false);
    rejected(value);
  });
  it.each([null, 42, '', '/photo', '//cdn.test/photo', 'https:cdn.test/photo', 'https:///photo', 'https://', 'https://[invalid]/a', 'https://cdn.test:99999/a', 'https://cdn.test/%zz', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'blob:https://cdn.test/id', 'file:///a', 'ftp://cdn.test/a', 'https://user:pass@cdn.test/a', 'https://user@cdn.test/a', 'https://:pass@cdn.test/a', 'https://@cdn.test/a', 'https://cdn.test\\@other.test/a', ' https://cdn.test/a', 'https://cdn.test/a\n', 'https://cdn.\ttest/a', 'http://cdn.test/a', 'http://localhost.evil.test/a', 'http://localhost@evil.test/a', 'http://192.168.1.2:9000/a', 'http://127.1:9000/a', 'http://0x7f000001:9000/a'])('rejects unsafe/malformed URL %# in development and production', value => {
    environment(true);
    rejected(value);
    environment(false);
    rejected(value);
  });
});

it('does not enable HTTP when both production and development flags are true, or neither is true', () => {
  environment(true, true);
  expect(browserUrl('http://localhost:9000/a')).toBeNull();
  environment(false, false);
  expect(browserUrl('http://localhost:9000/a')).toBeNull();
});
