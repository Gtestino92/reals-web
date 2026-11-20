import { describe, expect, it } from 'vitest';
import { resolveEnvironment, validateBuildEnvironment } from './environment';

const local = { DEV: true, PROD: false, MODE: 'development' };
const deployment = {
  DEV: false, PROD: true, MODE: 'production',
  VITE_REALS_ENVIRONMENT: 'dev',
  VITE_API_BASE_URL: 'https://reals-web.pages.dev',
  VITE_FIREBASE_API_KEY: 'synthetic-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'synthetic.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'synthetic',
  VITE_FIREBASE_APP_ID: 'synthetic-app-id',
  VITE_FIREBASE_APP_CHECK_PROVIDER: 'enterprise',
  VITE_FIREBASE_APP_CHECK_SITE_KEY: 'synthetic-site-key',
};

describe('Reals environment selection', () => {
  it('accepts explicit local and keeps the existing unset local Vite workflow', () => {
    expect(resolveEnvironment(local)).toEqual({ name: 'local', apiOrigin: '' });
    expect(resolveEnvironment({ ...local, VITE_REALS_ENVIRONMENT: 'local', VITE_API_BASE_URL: '' })).toEqual({ name: 'local', apiOrigin: '' });
  });

  it.each(['dev', 'prod'])('selects %s independently of Vite mode and flags', name => {
    for (const vite of [local, deployment, { DEV: false, PROD: true, MODE: 'development' }]) {
      expect(resolveEnvironment({ ...vite, VITE_REALS_ENVIRONMENT: name, VITE_API_BASE_URL: ' HTTPS://REALS-WEB.PAGES.DEV.:443/ ' }))
        .toEqual({ name, apiOrigin: 'https://reals-web.pages.dev' });
    }
  });

  it('retains an explicit non-default HTTPS port', () => {
    expect(resolveEnvironment({ ...deployment, VITE_API_BASE_URL: 'https://reals-web.pages.dev:8443/' }).apiOrigin)
      .toBe('https://reals-web.pages.dev:8443');
  });

  it.each([undefined, '', 'development', 'PROD', 'local'])('rejects selector %j in a compiled bundle', name => {
    expect(() => resolveEnvironment({ ...deployment, VITE_REALS_ENVIRONMENT: name })).toThrow('VITE_REALS_ENVIRONMENT');
  });

  it('rejects unknown explicit local selectors and local/remote conflicts', () => {
    expect(() => resolveEnvironment({ ...local, VITE_REALS_ENVIRONMENT: '' })).toThrow('VITE_REALS_ENVIRONMENT');
    expect(() => resolveEnvironment({ ...local, VITE_API_BASE_URL: deployment.VITE_API_BASE_URL })).toThrow('VITE_API_BASE_URL');
    expect(() => validateBuildEnvironment({ ...local, VITE_REALS_ENVIRONMENT: 'local' })).toThrow('VITE_REALS_ENVIRONMENT');
  });

  it.each([
    undefined, '', '//reals-web.pages.dev', 'http://reals-web.pages.dev',
    'https:///reals-web.pages.dev', 'https://reals-web.pages.dev:65536', 'https://reals-web..pages.dev',
    'https://user:pass@reals-web.pages.dev', 'https://@reals-web.pages.dev', 'https://reals-web.pages.dev/api',
    'https://reals-web.pages.dev/.', 'https://reals-web.pages.dev/?x=1', 'https://reals-web.pages.dev?',
    'https://reals-web.pages.dev/#token', 'https://reals-web.pages.dev#', 'https://reals-web.pages.dev\\',
    'https://reals-web.pa\nges.dev', 'https://%72eals-web.pages.dev',
    'https://localhost', 'https://api.localhost.', 'https://127.0.0.2', 'https://127.1',
    'https://2130706433', 'https://[::1]', 'https://0.0.0.0', 'https://10.0.2.2',
    'https://reals.internal', 'https://api.home.arpa', 'https://api.example.com.',
    'https://api.example.org', 'https://api.invalid', 'https://api.example', 'https://api.test',
    'https://placeholder.domain.org', 'https://your-backend.domain.org',
  ])('rejects unsafe or missing remote origin %j', origin => {
    expect(() => resolveEnvironment({ ...deployment, VITE_API_BASE_URL: origin })).toThrow('VITE_API_BASE_URL');
  });
});

describe('public builds', () => {
  it.each(['dev', 'prod'])('accepts synthetic %s CI build settings without Pages metadata', name => {
    expect(() => validateBuildEnvironment({ ...deployment, VITE_REALS_ENVIRONMENT: name }, { CI: 'true', GITHUB_ACTIONS: 'true' })).not.toThrow();
  });

  it.each([
    ['VITE_REALS_ENVIRONMENT', undefined], ['VITE_API_BASE_URL', undefined],
    ['VITE_FIREBASE_API_KEY', ''], ['VITE_FIREBASE_PROJECT_ID', undefined],
    ['VITE_FIREBASE_AUTH_DOMAIN', 'YOUR_PROJECT.firebaseapp.com'], ['VITE_FIREBASE_APP_ID', undefined],
    ['VITE_FIREBASE_APP_CHECK_PROVIDER', 'v3'], ['VITE_FIREBASE_APP_CHECK_PROVIDER', undefined],
    ['VITE_FIREBASE_APP_CHECK_SITE_KEY', undefined], ['VITE_FIREBASE_APP_CHECK_SITE_KEY', 'YOUR_SITE_KEY'],
    ['VITE_FIREBASE_APP_CHECK_DEBUG', 'true'], ['VITE_LOCAL_FIREBASE_EMAIL_AUTO_VERIFICATION', 'true'],
  ])('fails closed for invalid %s', (key, value) => {
    expect(() => validateBuildEnvironment({ ...deployment, [key]: value })).toThrow(key);
  });
});

describe('Cloudflare Pages builds', () => {
  it.each([
    ['development', 'dev'],
    ['main', 'prod'],
  ])('accepts %s with Reals %s', (branch, name) => {
    expect(() => validateBuildEnvironment({ ...deployment, VITE_REALS_ENVIRONMENT: name }, {
      CF_PAGES: '1', CF_PAGES_BRANCH: branch,
    })).not.toThrow();
  });

  it.each([
    ['development', 'prod', 'dev'],
    ['main', 'dev', 'prod'],
  ])('rejects %s with Reals %s regardless of Vite mode', (branch, name, expected) => {
    const pages = { CF_PAGES: '1', CF_PAGES_BRANCH: branch };
    const env = { ...deployment, VITE_REALS_ENVIRONMENT: name };
    expect(() => validateBuildEnvironment(env, pages)).toThrow(`VITE_REALS_ENVIRONMENT=${expected}`);
    expect(() => validateBuildEnvironment({ ...env, ...local }, pages)).toThrow(`VITE_REALS_ENVIRONMENT=${expected}`);
  });

  it.each([undefined, '', 'Development', 'main ', 'feature/preview', 'refs/heads/main'])('rejects missing or unsupported Pages branch %j', branch => {
    expect(() => validateBuildEnvironment(deployment, { CF_PAGES: '1', CF_PAGES_BRANCH: branch })).toThrow('CF_PAGES_BRANCH');
  });

  it.each([undefined, '', '0', 'true', ' 1 '])('rejects incomplete or malformed Pages marker %j', marker => {
    expect(() => validateBuildEnvironment(deployment, { CF_PAGES: marker, CF_PAGES_BRANCH: 'development' })).toThrow('CF_PAGES=1');
  });

  it.each(['CF_PAGES_COMMIT_SHA', 'CF_PAGES_URL'])('recognizes incomplete Pages metadata from %s alone', key => {
    expect(() => validateBuildEnvironment(deployment, { [key]: 'fixture' })).toThrow('CF_PAGES=1');
  });

  it.each(['local', '', 'DEV', 'dev '])('rejects malformed or local Reals selection %j on Pages', name => {
    expect(() => validateBuildEnvironment({ ...deployment, ...local, VITE_REALS_ENVIRONMENT: name }, {
      CF_PAGES: '1', CF_PAGES_BRANCH: 'development',
    })).toThrow('VITE_REALS_ENVIRONMENT');
  });
});
