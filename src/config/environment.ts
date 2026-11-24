type EnvironmentVariables = Readonly<Record<string, unknown>>;

export type RealsEnvironment = { readonly legalDocumentOrigin: string | null } & (
  | { readonly name: 'local'; readonly apiOrigin: '' }
  | { readonly name: 'dev' | 'prod'; readonly apiOrigin: string });

const firebaseKeys = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'] as const;
const localOnlyFlags = ['VITE_FIREBASE_APP_CHECK_DEBUG', 'VITE_LOCAL_FIREBASE_EMAIL_AUTO_VERIFICATION'] as const;

export function isLocalVite(env: EnvironmentVariables): boolean {
  return env.DEV === true && env.PROD === false
    && (env.VITE_REALS_ENVIRONMENT === undefined || env.VITE_REALS_ENVIRONMENT === 'local');
}

function remoteOrigin(env: EnvironmentVariables, key: 'VITE_API_BASE_URL' | 'VITE_LEGAL_DOCUMENT_ORIGIN'): string {
  const value = env[key];
  const invalid = () => new Error(`${key} must be a public HTTPS origin, without credentials, a path, query or fragment.`);
  if (typeof value !== 'string' || !/^https:\/\/[a-z0-9.-]+(?::[0-9]+)?\/?$/i.test(value.trim())) throw invalid();
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw invalid(); }

  // Validate the canonical hostname so IPv4 aliases and trailing dots cannot bypass these checks.
  const host = url.hostname.replace(/\.$/, '');
  const dnsName = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  const reserved = /(?:^|\.)(?:localhost|local|internal|lan|invalid|test|example|example\.com|example\.net|example\.org|home\.arpa)$/;
  const placeholder = /(?:^|\.)(?:placeholder|your-[a-z0-9-]+)(?:\.|$)/;
  if (host.length > 253 || !dnsName.test(host) || reserved.test(host) || placeholder.test(host)) throw invalid();
  url.hostname = host;
  return url.origin;
}

function legalDocumentOrigin(env: EnvironmentVariables, name: RealsEnvironment['name']): string | null {
  if (env.VITE_LEGAL_DOCUMENT_ORIGIN === undefined || env.VITE_LEGAL_DOCUMENT_ORIGIN === '') {
    return name === 'prod' ? null : 'https://reals-web.pages.dev';
  }
  return remoteOrigin(env, 'VITE_LEGAL_DOCUMENT_ORIGIN');
}

export function resolveEnvironment(env: EnvironmentVariables, building = false): RealsEnvironment {
  const name = env.VITE_REALS_ENVIRONMENT;
  if (!building && isLocalVite(env)) {
    if (env.VITE_API_BASE_URL !== undefined && env.VITE_API_BASE_URL !== '') {
      throw new Error('Leave VITE_API_BASE_URL unset or empty for local. Vite proxies /api to Spring Boot.');
    }
    return { name: 'local', apiOrigin: '', legalDocumentOrigin: legalDocumentOrigin(env, 'local') };
  }
  if (name !== 'dev' && name !== 'prod') {
    throw new Error('Set VITE_REALS_ENVIRONMENT to local, dev or prod. Builds require an explicit dev or prod selection.');
  }
  const enabledFlags = localOnlyFlags.filter(key => env[key] !== undefined && env[key] !== 'false');
  if (enabledFlags.length) throw new Error(`Unset or set to false for ${name}: ${enabledFlags.join(', ')}.`);
  return { name, apiOrigin: remoteOrigin(env, 'VITE_API_BASE_URL'), legalDocumentOrigin: legalDocumentOrigin(env, name) };
}

function configured(value: unknown): value is string {
  return typeof value === 'string' && !!value.trim() && !value.toUpperCase().includes('YOUR_');
}

export function missingFirebaseSettings(env: EnvironmentVariables) {
  return firebaseKeys.filter(key => !configured(env[key]));
}

export function appCheckSettings(env: EnvironmentVariables) {
  const provider = env.VITE_FIREBASE_APP_CHECK_PROVIDER;
  const siteKey = env.VITE_FIREBASE_APP_CHECK_SITE_KEY;
  if (!configured(siteKey) || (provider !== 'enterprise' && !(provider === 'v3' && isLocalVite(env)))) return null;
  return { provider, siteKey };
}

export function validateBuildEnvironment(env: EnvironmentVariables, pages: EnvironmentVariables = {}): void {
  const { name } = resolveEnvironment(env, true);
  if ([pages.CF_PAGES, pages.CF_PAGES_BRANCH, pages.CF_PAGES_COMMIT_SHA, pages.CF_PAGES_URL].some(value => value !== undefined)) {
    if (pages.CF_PAGES !== '1') throw new Error('Cloudflare Pages builds require CF_PAGES=1.');
    const branch = pages.CF_PAGES_BRANCH;
    if (branch !== 'development' && branch !== 'main') {
      throw new Error('CF_PAGES_BRANCH must be development or main for a Cloudflare Pages build.');
    }
    const expected = branch === 'development' ? 'dev' : 'prod';
    if (name !== expected) throw new Error(`Cloudflare Pages branch ${branch} requires VITE_REALS_ENVIRONMENT=${expected}.`);
  }
  const missing = missingFirebaseSettings(env);
  if (missing.length) throw new Error(`Configure the Firebase Web app for the selected environment: ${missing.join(', ')}.`);
  if (!appCheckSettings(env)) throw new Error('Set VITE_FIREBASE_APP_CHECK_PROVIDER=enterprise and configure VITE_FIREBASE_APP_CHECK_SITE_KEY for the selected Web app.');
}
