import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const filters = process.argv.slice(2);
if (!filters.some(value => !value.startsWith('-') && existsSync(value))) {
  console.error('Provide test file paths: npm run test:focused -- src/home/location.test.ts');
  process.exit(2);
}
const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)), 'run', ...filters], { stdio: 'inherit', windowsHide: true });
if (result.error) { console.error(result.error.message); process.exit(1); }
process.exit(result.status ?? 1);
