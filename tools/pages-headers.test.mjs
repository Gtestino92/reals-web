// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = join(root, 'public', '_headers');

it('defines the baseline on every host and the exact report-only policy on DEV', () => {
  const lines = readFileSync(source, 'utf8').trimEnd().split(/\r?\n/);
  // A path rule belongs to the Pages deployment. The Railway API has its own ingress.
  // Checking the whole rule catches extra or duplicate headers and permission directives.
  expect(lines.every(line => Buffer.byteLength(line) <= 2000)).toBe(true);
  const policy = [
    "default-src 'none'",
    "script-src 'self' https://apis.google.com https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/ https://accounts.google.com/gsi/client",
    "style-src 'self'",
    "img-src 'self' data:",
    "media-src 'self' blob: https://d8ff7ef04413af6626533c4f2fab3e5a.r2.cloudflarestorage.com",
    "connect-src 'self' https://reals-backend-dev.up.railway.app https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://content-firebaseappcheck.googleapis.com https://www.google.com/recaptcha/ https://accounts.google.com/gsi/ https://people.googleapis.com",
    "frame-src https://reals-backend-firebase.firebaseapp.com/__/auth/iframe https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/ https://accounts.google.com/gsi/",
    "font-src 'self'",
    "manifest-src 'self'",
    "worker-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  expect(lines).toEqual([
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  X-Frame-Options: DENY',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), payment=(), geolocation=(self), microphone=(self)',
    '',
    'https://reals-web.pages.dev/*',
    `  Content-Security-Policy-Report-Only: ${policy}`,
  ]);
});

it('copies the Pages policy byte for byte into dist with the real Vite build', () => {
  const temp = mkdtempSync(join(tmpdir(), 'reals-pages-headers-'));
  const dist = join(temp, 'dist');
  try {
    execFileSync(process.execPath, [
      join(root, 'node_modules', 'vite', 'bin', 'vite.js'),
      'build', '--outDir', dist, '--logLevel', 'error',
    ], {
      cwd: root,
      windowsHide: true,
      timeout: 30_000,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        CF_PAGES: '1',
        CF_PAGES_BRANCH: 'development',
        VITE_REALS_ENVIRONMENT: 'dev',
        VITE_API_BASE_URL: 'https://reals-backend-dev.up.railway.app',
        VITE_FIREBASE_API_KEY: 'synthetic-key',
        VITE_FIREBASE_AUTH_DOMAIN: 'synthetic.firebaseapp.com',
        VITE_FIREBASE_PROJECT_ID: 'synthetic',
        VITE_FIREBASE_APP_ID: 'synthetic-app-id',
        VITE_FIREBASE_APP_CHECK_PROVIDER: 'enterprise',
        VITE_FIREBASE_APP_CHECK_SITE_KEY: 'synthetic-site-key',
        VITE_FIREBASE_APP_CHECK_DEBUG: 'false',
        VITE_LOCAL_FIREBASE_EMAIL_AUTO_VERIFICATION: 'false',
      },
    });
    expect(readFileSync(join(dist, '_headers'))).toEqual(readFileSync(source));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}, 35_000);
