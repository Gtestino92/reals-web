import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function parseManifest(text: string) {
  const entries = new Map<string, string>();
  const categories = new Set<string>();
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  ((terms|privacy|community-guidelines)\/[\w-]+\/document\.html)$/.exec(line);
    if (!match || match[0] !== line) throw new Error('Invalid development legal manifest entry');
    const [, hash, path, category] = match;
    if (!hash || !path || !category || entries.has(path)) throw new Error('Invalid or duplicate development legal path');
    entries.set(path, hash);
    categories.add(category);
  }
  if (categories.size !== 3) throw new Error('Incomplete development legal manifest');
  return entries;
}

export function readPublication(directory: string) {
  const entries = parseManifest(readFileSync(join(directory, 'SHA256SUMS'), 'utf8'));
  return Array.from(entries, ([path, hash]) => {
    const source = readFileSync(join(directory, path));
    if (createHash('sha256').update(source).digest('hex') !== hash) throw new Error('Development legal fixture hash mismatch: ' + path);
    return { path, hash, source };
  });
}

export function verifyHistory(previous: ReadonlyMap<string, string>, current: ReadonlyMap<string, string>) {
  for (const [path, hash] of previous) {
    if (current.get(path) !== hash) throw new Error('Previously published legal document removed or changed: ' + path);
  }
}
