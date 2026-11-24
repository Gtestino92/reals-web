import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { readPublication } from './dev-legal-publication.ts';

export function devLegalFixtures(directory = fileURLToPath(new URL('../dev-legal/', import.meta.url))): Plugin {
  let enabled = false;
  return {
    name: 'dev-legal-fixtures',
    apply: 'build',
    configResolved(config) { enabled = config.env.VITE_REALS_ENVIRONMENT === 'dev'; },
    generateBundle() {
      if (!enabled) return;
      for (const { path, source } of readPublication(directory)) {
        this.emitFile({ type: 'asset', fileName: 'legal/' + path, source });
      }
    },
  };
}
