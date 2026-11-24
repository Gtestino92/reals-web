import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [kind, target] = process.argv.slice(2);
if (!target || !['--canonical', '--origin'].includes(kind)) {
  throw Error('Use --canonical <backend legal-documents directory> or --origin <published origin>');
}
const copy = fileURLToPath(new URL('../dev-legal/', import.meta.url));
const manifest = await readFile(resolve(copy, 'SHA256SUMS'), 'utf8');
const entries = manifest.trim().split(/\r?\n/);
assert.equal(entries.length, 3);
for (const line of entries) {
  const [hash, path] = line.split('  ');
  const expected = await readFile(resolve(copy, path));
  assert.equal(createHash('sha256').update(expected).digest('hex'), hash);
  if (kind === '--canonical') {
    assert.ok((await readFile(resolve(target, path))).equals(expected), 'Canonical bytes differ: ' + path);
  } else {
    const url = new URL('/legal/' + path, target);
    const response = await fetch(url, { cache: 'no-store' });
    assert.equal(response.status, 200, path);
    assert.equal(new URL(response.url).origin, url.origin);
    assert.match(response.headers.get('content-type') ?? '', /^text\/html\b/i);
    assert.ok(Buffer.from(await response.arrayBuffer()).equals(expected), 'Published bytes differ: ' + path);
  }
  console.log(hash, path);
}
