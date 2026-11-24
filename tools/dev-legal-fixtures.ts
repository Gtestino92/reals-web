import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

export function devLegalFixtures(): Plugin {
  let enabled = false;
  return {
    name: 'dev-legal-fixtures',
    apply: 'build',
    configResolved(config) { enabled = config.env.VITE_REALS_ENVIRONMENT === 'dev'; },
    generateBundle() {
      if (!enabled) return;
      const directory = new URL('../dev-legal/', import.meta.url);
      const manifest = readFileSync(new URL('SHA256SUMS', directory), 'utf8');
      const remaining = new Set(['terms', 'privacy', 'community-guidelines']);
      for (const line of manifest.trim().split(/\r?\n/)) {
        const match = /^([a-f0-9]{64})  (([a-z-]+)\/[\w-]+\/document\.html)$/.exec(line);
        const path = match?.[2], slug = match?.[3];
        if (!path || !slug || !remaining.delete(slug)) throw new Error('Invalid development legal manifest');
        const expected = match[1];
        const source = readFileSync(new URL(path, directory));
        if (createHash('sha256').update(source).digest('hex') !== expected) throw new Error('Development legal fixture hash mismatch: ' + path);
        this.emitFile({ type: 'asset', fileName: 'legal/' + path, source });
      }
      if (remaining.size) throw new Error('Incomplete development legal manifest');
    },
  };
}
