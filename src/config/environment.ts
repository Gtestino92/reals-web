type EnvironmentVariables = Readonly<Record<string, unknown>>;

export type RealsEnvironment =
  | { readonly name: 'local'; readonly apiOrigin: '' }
  | { readonly name: 'dev' | 'prod'; readonly apiOrigin: string };

const firebaseKeys = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'] as const;
const localOnlyFlags = ['VITE_FIREBASE_APP_CHECK_DEBUG', 'VITE_LOCAL_FIREBASE_EMAIL_AUTO_VERIFICATION'] as const;

export function isLocalVite(env: EnvironmentVariables): boolean {
  return env.DEV === true && env.PROD === false
    && (env.VITE_REALS_ENVIRONMENT === undefined || env.VITE_REALS_ENVIRONMENT === 'local');
}

function remoteOrigin(value: unknown): string {
  const invalid = () => new Error('VITE_API_BASE_URL must be a public HTTPS backend origin, without credentials, a path, query or fragment.');
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

export function resolveEnvironment(env: EnvironmentVariables, building = false): RealsEnvironment {
  const name = env.VITE_REALS_ENVIRONMENT;
  if (!building && isLocalVite(env)) {
    if (env.VITE_API_BASE_URL !== undefined && env.VITE_API_BASE_URL !== '') {
      throw new Error('Leave VITE_API_BASE_URL unset or empty for local. Vite proxies /api to Spring Boot.');
    }
    return { name: 'local', apiOrigin: '' };
  }
  if (name !== 'dev' && name !== 'prod') {
    throw new Error('Set VITE_REALS_ENVIRONMENT to local, dev or prod. Builds require an explicit dev or prod selection.');
  }
  const enabledFlags = localOnlyFlags.filter(key => env[key] !== undefined && env[key] !== 'false');
  if (enabledFlags.length) throw new Error(`Unset or set to false for ${name}: ${enabledFlags.join(', ')}.`);
  return { name, apiOrigin: remoteOrigin(env.VITE_API_BASE_URL) };
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

export function validateBuildEnvironment(env: EnvironmentVariables): void {
  resolveEnvironment(env, true);
  const missing = missingFirebaseSettings(env);
  if (missing.length) throw new Error(`Configure the Firebase Web app for the selected environment: ${missing.join(', ')}.`);
  if (!appCheckSettings(env)) throw new Error('Set VITE_FIREBASE_APP_CHECK_PROVIDER=enterprise and configure VITE_FIREBASE_APP_CHECK_SITE_KEY for the selected Web app.');
}
