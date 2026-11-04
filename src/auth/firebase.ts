import { getApps, initializeApp } from 'firebase/app';
import { browserLocalPersistence, browserPopupRedirectResolver, createUserWithEmailAndPassword, GoogleAuthProvider, initializeAuth, onAuthStateChanged, sendEmailVerification, signInWithEmailAndPassword, signInWithPopup, signOut } from 'firebase/auth';
import type { User } from 'firebase/auth';

export type Identity = Pick<User, 'uid' | 'emailVerified' | 'getIdToken' | 'reload'>;
export interface AuthService {
  observe: (next: (user: Identity | null) => void, error: (error: unknown) => void) => () => void;
  signIn: (email: string, password: string) => Promise<Identity>;
  signUp: (email: string, password: string) => Promise<Identity>;
  google: () => Promise<Identity>;
  verify: (user: Identity) => Promise<void>;
  signOut: () => Promise<void>;
}
export type FirebaseSetup = { service: AuthService; localVerification: boolean } | { error: string };
export function localVerificationEnabled(dev: boolean, flag: unknown, hostname: string) {
  return dev && flag === 'true' && ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}
export function configureFirebase(env: ImportMetaEnv = import.meta.env): FirebaseSetup {
  const keys = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID'] as const;
  if (keys.some(key => typeof env[key] !== 'string' || !env[key].trim() || env[key].includes('YOUR_'))) {
    return { error: 'Firebase no está configurado. Completá .env.local con la configuración Web del proyecto local y reiniciá Vite. Consultá docs/local-development.md.' };
  }
  try {
    const app = getApps()[0] ?? initializeApp({ apiKey: env.VITE_FIREBASE_API_KEY, authDomain: env.VITE_FIREBASE_AUTH_DOMAIN, projectId: env.VITE_FIREBASE_PROJECT_ID, appId: env.VITE_FIREBASE_APP_ID });
    const auth = initializeAuth(app, { persistence: browserLocalPersistence, popupRedirectResolver: browserPopupRedirectResolver });
    return {
      localVerification: localVerificationEnabled(env.DEV, env.VITE_LOCAL_FIREBASE_EMAIL_AUTO_VERIFICATION, window.location.hostname),
      service: {
        observe: (next, error) => onAuthStateChanged(auth, next, error),
        signIn: async (email, password) => (await signInWithEmailAndPassword(auth, email, password)).user,
        signUp: async (email, password) => (await createUserWithEmailAndPassword(auth, email, password)).user,
        // No await precedes opening the popup from the click callback.
        google: () => signInWithPopup(auth, new GoogleAuthProvider()).then(result => result.user),
        verify: async user => {
          const current = auth.currentUser;
          if (!current || current.uid !== user.uid) throw new Error('Session changed');
          await sendEmailVerification(current);
        },
        signOut: () => signOut(auth),
      },
    };
  } catch {
    return { error: 'No pudimos inicializar Firebase. Revisá la configuración Web en .env.local y reiniciá Vite.' };
  }
}
