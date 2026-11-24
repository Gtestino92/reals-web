import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseManifest, readPublication, verifyHistory } from './dev-legal-publication.ts';

export async function verifyPublication(directory, kind, target) {
  if (!target || !['--previous', '--canonical', '--origin'].includes(kind)) {
    throw Error('Use --previous <prior SHA256SUMS>, --canonical <backend legal-documents directory> or --origin <published origin>');
  }
  const documents = readPublication(directory);
  if (kind === '--previous') {
    const previous = parseManifest(await readFile(target, 'utf8'));
    verifyHistory(previous, new Map(documents.map(({ path, hash }) => [path, hash])));
    return;
  }
  for (const { path, hash, source } of documents) {
    if (kind === '--canonical') {
      assert.ok((await readFile(resolve(target, path))).equals(source), 'Canonical bytes differ: ' + path);
    } else {
      const url = new URL('/legal/' + path, target);
      const response = await fetch(url, { cache: 'no-store' });
      assert.equal(response.status, 200, path);
      assert.equal(new URL(response.url).origin, url.origin);
      assert.match(response.headers.get('content-type') ?? '', /^text\/html\b/i);
      assert.ok(Buffer.from(await response.arrayBuffer()).equals(source), 'Published bytes differ: ' + path);
    }
    console.log(hash, path);
  }
}

if (import.meta.main) {
  const [kind, target] = process.argv.slice(2);
  await verifyPublication(fileURLToPath(new URL('../dev-legal/', import.meta.url)), kind, target);
}
