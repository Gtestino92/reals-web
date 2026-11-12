# Local development

Use Node.js 24.15+ (24.x) and npm. This scaffold was initialized with Node 24.19.0 and npm 11.17.0. Install reproducibly with `npm ci`, then run `npm run dev` from `reals-web`.

Vite binds explicitly to IPv4 loopback at `127.0.0.1:5173` and fails explicitly if occupied (`strictPort`). Open <http://127.0.0.1:5173/>. Requests to `/api/...` are forwarded to `http://localhost:8080/api/...` unchanged. Real authentication requires the Firebase Web configuration described below. Missing configuration shows an actionable error.

## Android Chrome over USB or wireless ADB

From the repository directory, run:

```sh
npm run dev
```

Vite's development-server plugin starts the dependency-free asynchronous monitor in [`tools/android-tunnel-monitor.ts`](../tools/android-tunnel-monitor.ts). You can start Vite before connecting a phone. It checks immediately, then waits five seconds after each completed check, without overlapping checks. Build and preview do not start monitoring. `npm run dev -- --host 127.0.0.1` remains supported.

The monitor shares ADB discovery and device parsing with the one-shot [`tools/android-tunnel.mjs`](../tools/android-tunnel.mjs) helper. Discovery order is PATH, `ANDROID_SDK_ROOT/platform-tools`, `ANDROID_HOME/platform-tools`, then Windows `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`. It also supports macOS/Linux and does not change PATH or system settings.

For each authorized device (exact state `device`), it inspects `adb -s <serial> reverse --list` and configures `adb -s <serial> reverse tcp:5173 tcp:5173` only if that exact mapping is absent or incorrect. It rechecks actual mappings every cycle, restoring tunnels after reconnects even with the same serial or when a disconnect occurs between polls. Other ports are left alone. Unauthorized/offline devices are skipped; unlock and authorize the phone or restore its wireless ADB connection manually.

All monitor subprocesses are asynchronous, use literal arguments (including serials with spaces), and have two-second timeouts. Missing ADB and failed checks retry on the next cycle, with warnings only when an issue first appears or recurs after recovery. No devices is a quiet waiting state. Closing Vite cancels the monitor timer and its active client subprocess; it leaves existing mappings and the shared ADB server running. It never kills or restarts the global ADB server.

Open **<http://127.0.0.1:5173/>** in Android Chrome. Android localhost and Windows localhost are connected through ADB reverse: the phone's port 5173 reaches Vite on the computer. No LAN binding or `--host 0.0.0.0` is needed. Vite continues forwarding `/api` to the computer's local backend on port 8080; that backend must be running for API requests to work.

The development server explicitly sets `host: '127.0.0.1'` in `vite.config.ts` so ADB reverse can reach the IPv4 listener on Windows. The default `localhost` binding can resolve to IPv6, leaving Android unable to connect even when ADB reports the correct mapping. Plain `npm run dev` uses the IPv4 binding without additional flags and keeps Vite accessible only through loopback, not the LAN.

Wireless ADB requires an existing authorized connection. The helper does not discover disconnected phones, pair devices, request pairing codes or store credentials. If disconnected, enable Wireless debugging on the phone, keep the phone and computer on a network that permits ADB, and reconnect the already authorized device using its current **connection** address/port (not its pairing port):

```sh
adb connect <phone-ip>:<connection-port>
adb devices
npm run android:tunnel
adb reverse --list
```

Replace the placeholders using the address shown in Android's Wireless debugging settings. If authorization/pairing has been lost, restore it manually through your existing Android development setup. For USB, connect the cable, enable USB debugging and accept the authorization prompt on the unlocked phone. Verify that `adb devices` shows state `device`.

`npm run android:tunnel` remains an independent one-shot command for immediate manual setup without restarting Vite. It configures port 5173 on all authorized devices, with a two-second command timeout and ten-second total budget. During development, automatic monitoring normally restores mappings after a phone/ADB restart, wireless reconnection or switching transports. With multiple devices, inspect each with `adb -s <serial> reverse --list`, quoting the serial according to your shell if it contains spaces. Look for `tcp:5173 tcp:5173`. If ADB is outside PATH, use the discovered SDK executable path for manual ADB commands.

Monitoring runs only through Vite's development-server lifecycle. CI's `npm ci`, `npm run typecheck`, `npm test` and `npm run build` do not start it; tests mock subprocesses and need no phone or ADB installation. The old blocking `predev` hook has been removed.

## Existing backend

The read-only references inspected for integration are:

- [`docker-compose.yml`](../../reals-backend/docker-compose.yml).
- [`application-local-firebase.yml`](../../reals-backend/src/main/resources/application-local-firebase.yml).
- [Backend local development](../../reals-backend/docs/local-development.md).

The existing Compose backend publishes `8080:8080` and uses `SPRING_PROFILES_ACTIVE=local-firebase`, PostgreSQL, MinIO and its initialization service. The profile disables automatic schedulers for deterministic local testing. It verifies real Firebase ID tokens; this is not a Firebase Auth emulator or an authentication bypass. App Check is disabled locally, independently of Authentication.

The backend's ignored `secrets/reals-backend-firebase-credentials-dev.json` must already be provisioned on the backend side and is mounted read-only. Do not copy that file into the frontend. Existing Compose storage uses a host-accessible presigned URL endpoint on port 9000; the Vite `/api` proxy does not proxy storage URLs or configure browser storage CORS.

If the services are not already running, the documented backend operator command, run from that repository, is:

```powershell
docker compose up -d --build backend
```

No backend files or configuration need changing for this frontend. Start these services manually when setting up real integration.

With the backend running, compare the public connectivity endpoint directly and through Vite:

```powershell
Invoke-RestMethod http://localhost:8080/api/ping
Invoke-RestMethod http://127.0.0.1:5173/api/ping
```

Matching responses verify connectivity and proxy path preservation, not authenticated behavior. A connection-refused/proxy error usually means the backend is unavailable. Protected endpoints use the current Firebase SDK user ID token through the Web API client.

`npm run build` generates `dist/`; `npm run preview` previews those static files on Vite's preview port (normally 4173). The development proxy is not part of that bundle or preview configuration. A production deployment will need its own API routing. Production HTTPS, storage CORS and deployment routing remain outside this local POC.

## Firebase Web setup (Stage B)

1. In Firebase Console, select the **same existing non-production project** used by Android's `local` flavor and the backend Admin service account. Ask the project owner to confirm the match without sharing secrets. Project settings → General → Your apps → Add app → Web. Register a Web app; do not create another project or copy `google-services.json`. Firebase Hosting is unnecessary.
2. Authentication → Sign-in method: enable Email/Password and Google. Configure Google's support email and any OAuth consent/test-user access required by the existing project.
3. Authentication → Settings → Authorized domains: explicitly add `127.0.0.1` (the actual Android Chrome hostname over ADB reverse) and `localhost` if used. Enter hostnames without scheme/port. Preserve the project's Firebase auth handler domain from its Web configuration. Test popup authorization on the exact URL used by each browser.
4. From `reals-web`, run `Copy-Item .env.example .env.local`. Replace each placeholder with the Web app's `apiKey`, `authDomain`, `projectId`, `appId`. Messaging sender ID is unnecessary for this Auth-only setup. `.env.local` is ignored. All `VITE_*` data becomes public browser code, yet repository policy prohibits committing real Firebase config values. Never put service-account credentials, passwords or tokens there. Restart Vite after changing values.
5. Default `VITE_LOCAL_FIREBASE_EMAIL_AUTO_VERIFICATION=false` sends normal signup verification email. For fictitious local accounts only, set it to `true` in `.env.local`. The Web gate additionally requires Vite DEV and a loopback hostname; production builds always disable it. Backend must run `local-firebase` with `LOCAL_DEV_FIREBASE_EMAIL_AUTO_VERIFICATION_ENABLED=true` (the profile's existing default). It calls POST `/api/me/local-dev/email-verification`, no body, after provisioning/profile load; only a successful 204 followed by Firebase reload, forced token refresh and verified email completes bootstrap. Failures require explicit retry. It never activates profiles or bypasses backend eligibility.
6. Ensure the backend operator has installed the existing ignored Admin service account in that repository as documented above. From `reals-backend`, run `docker compose up -d --build backend`; its existing Compose service uses `SPRING_PROFILES_ACTIVE=local-firebase`. Do not modify sibling files. Verify `Invoke-RestMethod http://localhost:8080/api/ping` returns `status: ok`.
7. From `reals-web`, run `npm ci`, then `npm run dev`. The development-server monitor configures ADB reverse when the authorized phone becomes available. Open `http://127.0.0.1:5173/` on Windows Chrome and Android Chrome. Verify `Invoke-RestMethod http://127.0.0.1:5173/api/ping` and open the same `/api/ping` path on the phone. Both should return `status: ok`. Only port 5173 needs reverse mapping for authentication/API calls.
8. On both browsers: register a disposable email/password account; verify the real email link with local helper disabled (or confirm local verification when explicitly enabled). Confirm backend ready and missing-profile state. Sign out, sign in, reload, close/reopen the browser and confirm SDK restoration. An account with an existing profile should show its authoritative status. Test Google sign-in, popup cancellation/blocking and sign-out; ensure authenticated presentation disappears. Do not capture bearer headers in logs/screenshots.
9. Request password reset with a test email. Only a 202 shows “Si el email está registrado, te enviamos instrucciones para recuperar el acceso.” and a 60-second resend cooldown. Verify actual mailbox behavior separately; the response never promises delivery or reveals existence. Stop backend connectivity to confirm recoverable bootstrap/reset failures, then restart it and retry. Use backend-managed fixture accounts for suspended/deleted/provider-restricted checks; never manipulate database state to bypass restrictions.

### Authentication persistence policy

**Mantener sesión iniciada** is unchecked on every new login screen. For email
sign-in and registration, unchecked selects Firebase `browserSessionPersistence`;
checked selects `browserLocalPersistence`. The selected SDK persistence must
finish configuring before sending credentials. The application never writes
passwords or tokens to custom storage; password-manager autofill remains
browser-owned. A failed persistence setup blocks authentication and shows a
safe error asking the user to reload, without falling back to local storage.

Google always uses session persistence, regardless of the email checkbox (the
screen explains this). Anonymous auth observation prepares session persistence
before showing the login. `google()` then calls `signInWithPopup` synchronously
from the user click; no persistence await is inserted before popup opening.
Failed email authentication resets anonymous persistence to session before
releasing the operation. If reset fails, Google stays blocked until a successful
preparation/reload; it cannot reuse the previous local setting.

Migration policy: preserve already-authenticated users, including legacy local
sessions. There is no forced logout or silent conversion on startup/refresh.
Initialization supplies `[browserSessionPersistence, browserLocalPersistence]`.
In the installed Firebase browser SDK, session storage does not opt into
migration, and local storage migrates only among migration-capable providers;
this order discovers both without promoting session to local or converting
legacy local to session. Authenticated observer events never call setPersistence.
Real-SDK regression tests use synthetic stored users to verify both restorations
and sign-out. Recheck these tests when updating Firebase. Legacy users who want
session-only access must explicitly sign out and sign back in unchecked.

Refresh restores either type in its existing tab. Local persistence survives
ordinary browser restarts until sign-out. Session persistence is scoped to the
current tab/window, not a shared login across all tabs. Browser session recovery
or duplicating a tab may restore/copy sessionStorage: do not treat browser close
as server revocation, an idle timeout or a guaranteed privacy wipe. Origins are
separate: localhost and 127.0.0.1 have distinct sessions. SDK token refresh,
backend bootstrap, email verification and profile handling are unchanged.

Firebase synchronizes local authentication across same-origin tabs. Local
sign-out propagates through SDK notifications. Session tabs are independent;
signing out of one session-only tab does not promise global logout. Switching
a shared local session to session persistence can sign other local tabs out;
a new local login can affect other same-origin tabs. No application cross-tab
token copying or custom storage synchronization is introduced. See
[Firebase persistence semantics](https://firebase.google.com/docs/auth/web/auth-state-persistence).

Chrome desktop / Android smoke checklist (use disposable test accounts):

1. On the exact same origin, sign out first. Sign in and register unchecked;
   refresh and verify restoration/backend bootstrap, email verification and
   profile status. Close/reopen the tab and browser with session recovery off;
   verify a new login is required. Repeat with session recovery enabled and
   document browser-dependent recovery. Test an independently opened second tab.
2. Repeat checked; confirm restoration after refresh and browser restart, local
   synchronization across tabs and sign-out propagation. Never inspect/log token
   values. Confirm an already-existing legacy local login survives this upgrade
   until explicit sign-out, then unchecked login uses session storage.
3. Try Google with the checkbox both ways: the popup must open directly on click,
   cancellation/blocking must release controls, and successful login must use
   session persistence. Try Google after failed checked email login/registration.
4. Deny browser storage and verify safe failure without credential authentication
   or local fallback. Reload after restoring storage. While setup/login is
   pending, double-submit, close/unmount the screen and trigger another-tab
   sign-out; no obsolete bootstrap/profile response may restore the old UI.
5. Test explicit sign-out, background/resume, automatic token refresh and the
   existing single INVALID_TOKEN retry. A unit test can simulate storage events;
   independent tabs, browser restart/recovery and real Google user activation
   still require real-browser/provider verification.

Observed Hardening #1 smoke: headless desktop Chrome with a new temporary
profile loaded the login, rendered the correct label and unchecked checkbox,
and displayed Google sign-in. No credentials were entered. Real provider popup,
Android, independent tabs and restart/recovery checks above remain manual.

Google uses popup only, invoked directly from the click callback. No redirect flow is implemented. Safari/iOS OAuth and cross-origin storage/redirect compatibility require separate validation; do not switch to redirect without implementing Firebase's [redirect browser requirements](https://firebase.google.com/docs/auth/web/redirect-best-practices). SDK persistence reference: [Firebase auth state persistence](https://firebase.google.com/docs/auth/web/auth-state-persistence).

Real provider configuration, authorized domains, Google OAuth, email delivery, persistent browser storage, Docker authorization and device popup behavior cannot be established by unit tests. Stage B automated validation used no credentials; at that stage no `.env.local` was available. The Hardening #1 smoke above is limited to anonymous screen loading; real auth/device checks remain pending.

## Stage C local photo storage

The `/api` Vite proxy still targets Spring Boot on port 8080, including multipart uploads. Photo read URLs come from the backend and are fetched directly without application Authorization headers. `application-local-firebase.yml` defaults the MinIO endpoint, presigned endpoint and public base to `http://localhost:9000` (public base includes `/reals-media`). Environment overrides may change the actual host.

On physical Chrome Android reached through the existing Vite ADB reverse tunnel, `localhost:9000` means the phone. If returned photo URLs use that address, optionally run manually for the selected device:

```powershell
adb -s DEVICE_SERIAL reverse tcp:9000 tcp:9000
adb -s DEVICE_SERIAL reverse --list
```

Remove only that mapping when finished with `adb -s DEVICE_SERIAL reverse --remove tcp:9000`. The existing ADB helper and Vite IPv4/LAN settings are unchanged. Never rewrite a presigned host/path/query: it may invalidate the signature. For expired URLs, use **Actualizar estado** to obtain fresh URLs. HTTPS pages cannot necessarily load an HTTP MinIO endpoint; the current target is local Chrome development. Safari/iOS and HEIC support are not claimed.

Stage C environment probe: `.env.local` exists; backend `/actuator/health` and MinIO `/minio/health/live` returned HTTP 200. No configuration values, credentials or media signatures were printed. This establishes service reachability, not an authenticated end-to-end result.

## Tab ownership during local development

The Vite development server on `localhost`, `127.0.0.1` or IPv6 loopback disables tab ownership by default, allowing multiple session-persistence Firebase identities in separate tabs. No fake manager is installed. Firebase local persistence still shares identities according to Firebase's normal behavior.

To test ownership locally, set `VITE_ENFORCE_TAB_OWNERSHIP=true` in `.env.local` and restart Vite. Passing a real manager explicitly in ownership tests also forces enforcement. This flag only opts loopback Vite development into enforcement; `false` cannot disable it on deployed hosts. A production build/`npm run preview` enforces ownership even on loopback. A remote host served by Vite also enforces it: Vite DEV is not the backend Dev environment. Public client configuration is not a security/anti-fraud boundary.

Targeted Chromium regression: start `npm run dev -- --host 127.0.0.1 --port 5174` with the local flag unset/false, then run `node tools/runtime-refinements-browser.mjs`. It compares baseline/current queue timing with synthetic geolocation/token/HTTP delays, checks two independent local logins, explicit enabled takeover, and the real sign-out modal/Back/Escape/focus behavior. No live Firebase/SQL records are touched.

## Local Web App Check Debug Provider

The ignored `.env.local` uses these public configuration names (never put a debug credential in an environment variable):

```dotenv
VITE_FIREBASE_APP_CHECK_PROVIDER=enterprise
VITE_FIREBASE_APP_CHECK_SITE_KEY=<registered public Enterprise site key>
VITE_FIREBASE_APP_CHECK_DEBUG=true
```

The existing Web Firebase App ID must match the registered Web app; the local configuration has been checked against the supplied ID. The local-only flag requires Vite DEV=true, PROD=false and exactly `localhost` or `127.0.0.1`; LAN IPs, IPv6 loopback, lookalike hosts, preview/production builds and absent/false flags do not enable debug. Initialization sets `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true` before `initializeAppCheck()`. No generated debug token is supplied as a string or stored/logged by application code. Firebase's official SDK generates the credential, prints its local console registration message and manages its own IndexedDB storage. Do not export that storage, put credentials in source/env files or share console captures. See [Firebase's official Web debug workflow](https://firebase.google.com/docs/app-check/web/debug-provider).

Chrome / Firebase Console steps:

1. Restart the Vite process serving your browser to load the new environment: `npm run dev -- --host 127.0.0.1`. Open `http://127.0.0.1:5173/admin` in Chrome (use Vite's reported port if different). Keep the same hostname and browser profile throughout. Open DevTools Console. Sign in with the existing Google/Reals account if needed; the first protected API request invokes App Check.
2. Locate the SDK's **App Check debug token** message in Chrome Console. This is the browser debug credential, not the App Check JWT or Firebase Auth ID token. Keep it private; do not paste it into this repository, `.env.local`, a chat or logs. Web app registration does not register this browser credential automatically.
3. In Firebase Console for the existing project, open **App Check > Apps**, choose the registered Web app matching the configured App ID, open its menu and **Manage debug tokens**, then **Add debug token**. Give it a local Chrome label and paste that browser credential. Save. Do not change enforcement, allowlists, Authentication or MFA configuration.
4. Hard reload the same Chrome origin/profile. In DevTools Network, confirm that the **POST** `exchangeDebugToken` request succeeds with HTTP 200 (an OPTIONS/preflight 200 alone is insufficient). The SDK exchanges the registered debug credential for a genuine Firebase-issued App Check JWT. `getToken()` supplies that JWT; ApiClient forwards it as `X-Firebase-AppCheck`. Never send the debug credential itself as that header. See [Firebase custom backend transport](https://firebase.google.com/docs/app-check/web/custom-resource).
5. Inspect the administrative status request locally: it should carry the App Check header and Firebase Authorization header, with a successful JSON status for an eligible account. A new MFA session normally has `configured=true, grantValid=false`; continue with the existing Google/TOTP flow. Do not share or export headers, response tokens or HAR files. Backend MONITOR does not waive the administrative requirement for a verified allowlisted Web App ID. Other Google, identity, factor or grant errors remain separate checks.
6. If the exchange remains 403, check that the exact browser credential was saved for the correct Web app/project, then reload. Changing host/profile, clearing site data or using an incognito session can generate a different credential requiring registration. Remove obsolete credentials through **Manage debug tokens** when finished. To disable local debug, set the flag to `false`, restart Vite and reload; the SDK must initialize fresh. Production builds never enable it, even if the ignored local flag is true.

Validation of this follow-up used adapter mocks plus actual SDK initialization in disposable Chromium on 127.0.0.1. The disposable credential was not registered, so the real exchange returned 403; genuine JWT issuance and backend acceptance remain the operator steps above. No token, console message, request headers or payloads were captured. The SDK profile was removed after testing. No Firebase Console or backend resource was changed.
