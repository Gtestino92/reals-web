// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runtimeImports, findCycles, productionGraph } from './check-cycles.mjs';

describe('runtime dependency policy', () => {
  it('ignores erased imports, exports and type queries, but retains mixed and side-effect imports', () => {
    expect(runtimeImports(`
      import type { Home } from './home';
      export type { Profile } from './profile';
      export type * from './contracts';
      type T = import('./types').T;
      import { type A, B } from './mixed';
      import { type C } from './side-effects';
      import './setup';
      export { value } from './barrel';
      export * from './all';
      const Screen = () => <div>{B}</div>;
      const lazy = () => import('./lazy');
      const text = "import('./not-a-dependency')";
      // import './comment';
    `, 'screen.tsx')).toEqual(['./mixed', './side-effects', './setup', './barrel', './all', './lazy']);
  });

  it('reports cycles, including self-imports, without rejecting shared acyclic dependencies', () => {
    expect(findCycles(new Map([['a', ['b', 'c']], ['b', ['c']], ['c', []]]))).toEqual([]);
    expect(findCycles(new Map([['a', ['b']], ['b', ['a']], ['c', ['c']]]))).toEqual([['a', 'b', 'a'], ['c', 'c']]);
  });

  it('fails closed on malformed syntax and nonliteral dynamic imports', () => {
    expect(() => runtimeImports('import {', 'bad.ts')).toThrow('Cannot parse');
    expect(() => runtimeImports('import(path)', 'bad.ts')).toThrow('Nonliteral dynamic import');
  });

  it('follows app entry, barrels and lazy chunks, and exits nonzero on a runtime cycle', () => {
    const dir = mkdtempSync(join(tmpdir(), 'reals-architecture-'));
    try {
      mkdirSync(join(dir, 'src', 'feature'), { recursive: true });
      const write = (name, value) => writeFileSync(join(dir, 'src', name), value, 'utf8');
      write('main.tsx', `import './feature'; const screen = () => import('./lazy');`);
      write('feature/index.ts', `export type { T } from '../types'; export * from '../shared';`);
      write('types.ts', 'export type T = string;');
      write('shared.ts', 'export const value = 1;');
      write('lazy.ts', `import './main';`);
      write('ignored.test.ts', `import './ignored.test';`);
      const graph = productionGraph(join(dir, 'src'));
      expect(graph.size).toBe(4);
      expect(findCycles(graph)).toHaveLength(1);
      const command = spawnSync(process.execPath, [fileURLToPath(new URL('./check-cycles.mjs', import.meta.url))], { cwd: dir, encoding: 'utf8', windowsHide: true });
      expect(command.status, command.stderr).toBe(1);
      expect(command.stderr).toContain('main.tsx -> lazy.ts -> main.tsx');
      write('lazy.ts', `import type { T } from './types';`);
      expect(findCycles(productionGraph(join(dir, 'src')))).toEqual([]);
      write('lazy.ts', `import './missing';`);
      expect(() => productionGraph(join(dir, 'src'))).toThrow('Unresolved source import');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
