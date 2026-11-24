// @vitest-environment node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { build } from 'vite';
import { afterEach, expect, it, vi } from 'vitest';
import { devLegalFixtures } from './dev-legal-fixtures.ts';
import { parseManifest, readPublication, verifyHistory } from './dev-legal-publication.ts';
import { verifyPublication } from './verify-dev-legal.mjs';

const paths = ['terms/v1/document.html', 'privacy/v1/document.html', 'community-guidelines/v1/document.html'];
const previous = paths.map(path => line(path)).join('\n') + '\n';
const nextPath = 'terms/v2/document.html';
const current = previous + line(nextPath) + '\n';

function html(path) { return Buffer.from('<p>Prueba técnica · ' + path + '</p>\r\n'); }
function line(path) { return createHash('sha256').update(html(path)).digest('hex') + '  ' + path; }

let root;
function fixture() {
  root = mkdtempSync(join(tmpdir(), 'reals-publication-'));
  const directory = join(root, 'dev-legal');
  for (const path of [...paths, nextPath]) {
    mkdirSync(dirname(join(directory, path)), { recursive: true });
    writeFileSync(join(directory, path), html(path));
  }
  writeFileSync(join(directory, 'SHA256SUMS'), current);
  return directory;
}
afterEach(() => {
  vi.unstubAllEnvs();
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

it('builds and verifies both historical and current URLs byte-for-byte, then excludes both in prod', async () => {
  const directory = fixture();
  writeFileSync(join(root, 'index.html'), '<title>SPA</title>');
  const options = { root, configFile: false, logLevel: 'silent', plugins: [devLegalFixtures(directory)] };
  vi.stubEnv('VITE_REALS_ENVIRONMENT', 'dev');
  await build(options);
  const dist = join(root, 'dist/legal');
  await verifyPublication(directory, '--canonical', dist);

  const requests = [];
  const server = createServer((req, res) => {
    const path = req.url.slice('/legal/'.length);
    requests.push(path);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end([...paths, nextPath].includes(path) ? readFileSync(join(dist, path)) : '<title>SPA</title>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const origin = 'http://127.0.0.1:' + server.address().port;
    await verifyPublication(directory, '--origin', origin);
    expect(requests).toEqual([...paths, nextPath]);
    writeFileSync(join(dist, paths[0]), '<title>SPA</title>');
    await expect(verifyPublication(directory, '--origin', origin)).rejects.toThrow('Published bytes differ');
  } finally { await new Promise(resolve => server.close(resolve)); }

  vi.stubEnv('VITE_REALS_ENVIRONMENT', 'prod');
  await build(options);
  expect(existsSync(dist)).toBe(false);
});

it('allows additions but rejects loss or repinning of an older version', () => {
  const prior = parseManifest(previous);
  expect(() => verifyHistory(prior, parseManifest(current))).not.toThrow();
  const removed = current.replace(line(paths[0]) + '\n', '');
  const repinned = current.replace(line(paths[0]), '0'.repeat(64) + '  ' + paths[0]);
  for (const manifest of [removed, repinned]) {
    expect(() => verifyHistory(prior, parseManifest(manifest))).toThrow(paths[0]);
  }
});

it('rejects a historical entry whose bytes no longer match its digest', () => {
  const directory = fixture();
  writeFileSync(join(directory, paths[0]), html(nextPath));
  expect(() => readPublication(directory)).toThrow('hash mismatch');
});

it.each([
  previous + line(paths[0]), previous.replace(line(paths[1]) + '\n', ''),
  previous + line('other/v1/document.html'), previous + line('terms/../document.html'),
  previous + line('terms/%2f/document.html'), previous + line('terms/v2/document.html.bak'),
  previous + line('terms/v2/document.html') + ' ', previous.replace(/^[a-f0-9]/, 'G'),
])('rejects an invalid publication manifest %#', manifest => {
  expect(() => parseManifest(manifest)).toThrow();
});
