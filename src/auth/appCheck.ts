import type { FirebaseApp } from 'firebase/app';
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider, ReCaptchaV3Provider } from 'firebase/app-check';
import type { AppCheck } from 'firebase/app-check';
import { appCheckSettings, isLocalVite } from '../config/environment';
import { ApiError } from './api';

export type AppCheckTokenProvider = () => Promise<string>;
declare global {
  interface Window { FIREBASE_APPCHECK_DEBUG_TOKEN?: boolean | string }
}
const instances = new WeakMap<FirebaseApp, AppCheck>();
export function localAppCheckDebugEnabled(env: ImportMetaEnv, hostname: string): boolean {
  return isLocalVite(env) && env.VITE_FIREBASE_APP_CHECK_DEBUG === 'true' && (hostname === 'localhost' || hostname === '127.0.0.1');
}
export function appCheckTokens(app: FirebaseApp, env: ImportMetaEnv): AppCheckTokenProvider {
  // Debug is explicit and local-only; the SDK owns generation/exchange of its debug credential.
  return async () => {
    const settings = appCheckSettings(env);
    if (!settings) throw new ApiError('authorization', 0, 'APP_CHECK_NOT_CONFIGURED');
    const { provider, siteKey } = settings;
    try {
      let instance = instances.get(app);
      if (!instance) {
        if (localAppCheckDebugEnabled(env, self.location.hostname)) self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
        else if (self.FIREBASE_APPCHECK_DEBUG_TOKEN !== undefined) self.FIREBASE_APPCHECK_DEBUG_TOKEN = false;
        instance = initializeAppCheck(app, { provider: provider === 'v3' ? new ReCaptchaV3Provider(siteKey) : new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true });
        instances.set(app, instance);
      }
      const result = await getToken(instance);
      if (!result.token.trim()) throw new Error('Empty attestation');
      return result.token;
    } catch { throw new ApiError('backend', 503, 'APP_CHECK_VERIFICATION_UNAVAILABLE'); }
  };
}
