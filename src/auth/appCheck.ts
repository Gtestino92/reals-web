import type { FirebaseApp } from 'firebase/app';
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider, ReCaptchaV3Provider } from 'firebase/app-check';
import type { AppCheck } from 'firebase/app-check';
import { ApiError } from './api';

export type AppCheckTokenProvider = () => Promise<string>;
declare global {
  interface Window { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean }
}
const instances = new WeakMap<FirebaseApp, AppCheck>();
export function localAppCheckDebugEnabled(env: ImportMetaEnv, hostname: string): boolean {
  return env.DEV === true && env.PROD === false && env.VITE_FIREBASE_APP_CHECK_DEBUG === 'true' && (hostname === 'localhost' || hostname === '127.0.0.1');
}
export function appCheckTokens(app: FirebaseApp, env: ImportMetaEnv): AppCheckTokenProvider {
  // Debug is explicit and local-only; the SDK owns generation/exchange of its debug credential.
  return async () => {
    const key: unknown = env.VITE_FIREBASE_APP_CHECK_SITE_KEY;
    const provider: unknown = env.VITE_FIREBASE_APP_CHECK_PROVIDER;
    if (typeof key !== 'string' || !key.trim() || !['enterprise', 'v3'].includes(String(provider))) throw new ApiError('authorization', 0, 'APP_CHECK_NOT_CONFIGURED');
    try {
      let instance = instances.get(app);
      if (!instance) {
        if (localAppCheckDebugEnabled(env, self.location.hostname)) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
        instance = initializeAppCheck(app, { provider: provider === 'v3' ? new ReCaptchaV3Provider(key) : new ReCaptchaEnterpriseProvider(key), isTokenAutoRefreshEnabled: true });
        instances.set(app, instance);
      }
      const result = await getToken(instance);
      if (!result.token.trim()) throw new Error('Empty attestation');
      return result.token;
    } catch { throw new ApiError('backend', 503, 'APP_CHECK_VERIFICATION_UNAVAILABLE'); }
  };
}
