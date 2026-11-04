# Architecture — Stage B

Vite serves a React/strict TypeScript application with plain CSS tokens. Login layout, copy and assets remain in `auth/LoginScreen.tsx` and `auth/login.css`. The screen owns form/mode and advisory cooldown presentation; typed callbacks and external operation/error props keep integration outside rendering.

| File | Responsibility |
| --- | --- |
| `src/auth/firebase.ts` | Modular App/Auth initialization, SDK local persistence, email/Google operations and auth observer; safe missing-config result |
| `src/auth/api.ts` | Native fetch, bearer token, structured errors, one INVALID_TOKEN refresh/retry, runtime response validation and bootstrap sequence |
| `src/auth/session.ts` | Per-App controller and atomic snapshots; operation serialization, auth restoration, verification, reset, sign-out and generation invalidation |
| `src/auth/errors.ts` | Safe Spanish messages and terminal-session classification; server detail never displayed verbatim |
| `src/App.tsx` | Configuration error, login, loading, restricted/recoverable states and minimal authenticated checkpoint |
| `src/main.tsx` | StrictMode mount and global token/styles imports |
| `vite.config.ts`, `tools/android-tunnel.mjs` | Existing IPv4 loopback proxy and automatic ADB reverse |

`useSyncExternalStore` observes a controller local to App, without a global state framework. First subscription owns the Firebase observer; final unsubscribe removes it and aborts requests. Auth-state events restore persisted identities. Bootstrap scheduled in a microtask checks generation before starting, so StrictMode cleanup invalidates the first subscription's scheduled work. Synchronous operation locks prevent duplicate submissions. Every async installation checks generation; fetch/token boundaries check abort. See the [invariant and mutation-path matrix](auth-session-review.md).

Firebase authentication alone never means backend readiness. GET `/api/me` may conditionally trigger POST `/api/me/provision` only on Android's missing-user cases. ACTIVE users load GET `/api/me/profile`; expected 404 means missing profile. Unknown/malformed account or profile states fail closed. DELETED and backend ban errors show restricted state; no deletion recovery, appeal, profile editing or activation is implemented. Authentication-method and identity-association restrictions clear Firebase and return to login. Transient failures preserve identity for explicit retry. Sign-out immediately clears backend presentation and aborts its work; a failed Firebase sign-out is visible and can be retried.

Optional local verification requires DEV, explicit flag and loopback hostname. After normal user/profile loading it calls the existing protected helper, reloads Firebase and forces an ID token refresh before accepting verified state. With the helper disabled, new email/password registration sends the standard Firebase verification email; failed sends retain a recoverable retry. Later profile/legal/Home flows remain out of scope.

Only App/Auth SDK modules are imported. No Analytics, Messaging, App Check, cookies, custom tokens, manual credential persistence, router, PWA or deployment infrastructure is introduced. Firebase owns persistent local sessions independently of the remember checkbox. Browser save/autofill is browser-owned; the checkbox is currently presentation-only and controls neither persistence nor password-manager behavior.

Contracts remain in [backend API](../../reals-backend/docs/commons/api.md) and [user flow](../../reals-backend/docs/commons/user-flow.md). Android references: `FirebaseAuthRepository`, `AuthRepository`, `AuthenticatedRepository`, `MeRepository`, `ProfileRepository`, `SessionCoordinator`, `LocalFirebaseEmailVerificationCoordinator`, `LoginScreen`, and [local development](../../reals-app/docs/local-development.md). References were read only. Vite proxying is development-only; production hosting/routing requires a separate design.
