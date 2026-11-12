import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync } from 'vite';

// Match tsconfig's verbatimModuleSyntax: explicit `import type` is erased,
// while `import { type T }` retains the module's side effects (import {}).
export function runtimeImports(source, filename) {
  const { program, errors } = parseSync(filename, source);
  if (errors.length) throw new Error(`Cannot parse ${filename}: ${errors[0].message}`);
  const imports = [];
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ImportDeclaration' && node.importKind !== 'type') imports.push(node.source.value);
    if (['ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source && node.exportKind !== 'type') imports.push(node.source.value);
    if (node.type === 'ImportExpression') {
      if (typeof node.source.value !== 'string') throw new Error(`Nonliteral dynamic import in ${filename}: extend the cycle check before using it`);
      imports.push(node.source.value);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  };
  visit(program);
  return [...new Set(imports)];
}

export function findCycles(graph) {
  const done = new Set(), stack = [], active = new Set(), cycles = [];
  const visit = file => {
    if (active.has(file)) { cycles.push([...stack.slice(stack.indexOf(file)), file]); return; }
    if (done.has(file)) return;
    active.add(file); stack.push(file);
    for (const dependency of graph.get(file) ?? []) visit(dependency);
    stack.pop(); active.delete(file); done.add(file);
  };
  for (const file of graph.keys()) visit(file);
  return cycles;
}

export function productionGraph(root) {
  const files = new Set();
  const collect = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) collect(path);
      else if (/\.[cm]?[jt]sx?$/.test(path) && !/\.d\.ts$/.test(path)) files.add(path);
    }
  };
  collect(root);
  const graph = new Map();
  const visit = file => {
    if (graph.has(file)) return;
    graph.set(file, []);
    for (const specifier of runtimeImports(readFileSync(file, 'utf8'), file)) {
      if (!specifier.startsWith('.')) {
        if (specifier.startsWith('/') || specifier.startsWith('@/') || specifier.startsWith('~/')) throw new Error(`Unsupported source alias: ${specifier} in ${file}`);
        continue; // Package imports are outside application ownership.
      }
      const target = resolve(dirname(file), specifier.split(/[?#]/)[0]);
      const candidates = [target, ...['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'].map(ext => resolve(target + ext))];
      const dependency = candidates.find(candidate => files.has(candidate));
      if (!dependency) {
        if (/\.(css|png|svg|jpg|jpeg|webp|woff2?|mp3)$/.test(target)) continue;
        throw new Error(`Unresolved source import: ${specifier} in ${file}`);
      }
      graph.get(file).push(dependency);
      visit(dependency);
    }
  };
  // Follow lazy imports too; tests/fixtures not reachable from the app are excluded.
  visit(resolve(root, 'main.tsx'));
  return graph;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve('src');
  const graph = productionGraph(root), cycles = findCycles(graph);
  for (const cycle of cycles) console.error(cycle.map(file => relative(root, file).replaceAll('\\', '/')).join(' -> '));
  console.log(`Architecture: ${graph.size} production modules, ${cycles.length} runtime cycles.`);
  if (cycles.length) process.exitCode = 1;
}
