import { getApps, initializeApp } from 'firebase/app';
import { browserLocalPersistence, browserSessionPersistence, setPersistence, browserPopupRedirectResolver, createUserWithEmailAndPassword, GoogleAuthProvider, initializeAuth, onAuthStateChanged, sendEmailVerification, signInWithEmailAndPassword, signInWithPopup, signOut } from 'firebase/auth';
import type { User } from 'firebase/auth';

export type Identity = Pick<User, 'uid' | 'emailVerified' | 'getIdToken' | 'reload'> & Partial<Pick<User, 'providerData'>>;
export interface AuthService {
  observe: (next: (user: Identity | null) => void, error: (error: unknown) => void) => () => void;
  signIn: (email: string, password: string, keepSignedIn: boolean) => Promise<Identity>;
  signUp: (email: string, password: string, keepSignedIn: boolean) => Promise<Identity>;
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
    const auth = initializeAuth(app, { persistence: [browserSessionPersistence, browserLocalPersistence], popupRedirectResolver: browserPopupRedirectResolver });
    let googleSessionReady = false;
    let authRevision = 0;
    const persistenceError = () => Object.assign(new Error('Authentication persistence unavailable'), { code: 'auth/persistence-unavailable' });
    const prepareSession = async (revision: number) => {
      googleSessionReady = false;
      try { await setPersistence(auth, browserSessionPersistence); }
      catch { throw persistenceError(); }
      if (revision === authRevision && !auth.currentUser) googleSessionReady = true;
    };
    const emailAuth = async (register: boolean, email: string, password: string, keepSignedIn: boolean) => {
      googleSessionReady = false;
      const revision = ++authRevision;
      try {
        try { await setPersistence(auth, keepSignedIn ? browserLocalPersistence : browserSessionPersistence); }
        catch { throw persistenceError(); }
        if (revision !== authRevision || auth.currentUser) throw persistenceError();
        return (await (register ? createUserWithEmailAndPassword(auth, email, password) : signInWithEmailAndPassword(auth, email, password))).user;
      } catch (error) {
        // A failed local-persistence attempt must not affect the next Google click.
        // Never migrate an identity restored concurrently from another tab.
        if (revision === authRevision && !auth.currentUser) await prepareSession(revision);
        throw error;
      }
    };
    return {
      localVerification: localVerificationEnabled(env.DEV, env.VITE_LOCAL_FIREBASE_EMAIL_AUTO_VERIFICATION, window.location.hostname),
      service: {
        observe: (next, error) => {
          let active = true;
          let revision = 0;
          const unsubscribe = onAuthStateChanged(auth, user => {
            if (!active) return;
            const event = ++revision;
            const authEvent = ++authRevision;
            googleSessionReady = false;
            if (user) { next(user); return; }
            // Keep the login hidden until Google can open synchronously and safely.
            void prepareSession(authEvent).then(() => {
              if (active && event === revision && authEvent === authRevision) next(null);
            }).catch(failure => { if (active && event === revision && authEvent === authRevision) error(failure); });
          }, failure => { revision++; authRevision++; googleSessionReady = false; if (active) error(failure); });
          return () => { active = false; revision++; authRevision++; googleSessionReady = false; unsubscribe(); };
        },
        signIn: (email, password, keepSignedIn) => emailAuth(false, email, password, keepSignedIn),
        signUp: (email, password, keepSignedIn) => emailAuth(true, email, password, keepSignedIn),
        // No await precedes opening the popup from the click callback.
        google: () => {
          if (!googleSessionReady || auth.currentUser) return Promise.reject(persistenceError());
          return signInWithPopup(auth, new GoogleAuthProvider()).then(result => result.user);
        },
        verify: async user => {
          const current = auth.currentUser;
          if (!current || current.uid !== user.uid) throw new Error('Session changed');
          await sendEmailVerification(current);
        },
        signOut: async () => {
          googleSessionReady = false;
          authRevision++;
          await signOut(auth);
          if (!auth.currentUser) await prepareSession(authRevision);
        },
      },
    };
  } catch {
    return { error: 'No pudimos inicializar Firebase. Revisá la configuración Web en .env.local y reiniciá Vite.' };
  }
}
