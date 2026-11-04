# Local development

Use Node.js 24.15+ (24.x) and npm. This scaffold was initialized with Node 24.19.0 and npm 11.17.0. Install reproducibly with `npm ci`, then run `npm run dev` from `reals-web`.

Vite binds explicitly to IPv4 loopback at `127.0.0.1:5173` and fails explicitly if occupied (`strictPort`). Open <http://127.0.0.1:5173/>. Requests to `/api/...` are forwarded to `http://localhost:8080/api/...` unchanged. Real authentication requires the Firebase Web configuration described below. Missing configuration shows an actionable error.

## Android Chrome over USB or wireless ADB

From the repository directory, run:

```sh
npm run dev
```

The npm `predev` hook runs the dependency-free Node.js helper [`tools/android-tunnel.mjs`](../tools/android-tunnel.mjs) before Vite starts. It works from IntelliJ IDEA's Windows 11 integrated terminal in PowerShell or CMD; it also handles macOS/Linux without PowerShell. It looks for ADB in this order: PATH, `ANDROID_SDK_ROOT/platform-tools`, `ANDROID_HOME/platform-tools`, then Windows `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`. It does not change PATH or system settings.

For every connected device with the exact ADB state `device` (authorized USB, wireless or emulator), it runs `adb -s <serial> reverse tcp:5173 tcp:5173`. Serials containing spaces are passed as a single subprocess argument. It only configures port 5173, leaving mappings such as 8080 and 9000 alone. Missing ADB, no authorized devices, command failures and timeouts produce warnings and allow Vite to start. Each child command has a two-second timeout, with a ten-second total setup budget. A success message means ADB accepted the mapping; Vite must still start successfully.

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

`npm run android:tunnel` uses the same helper and restores the mapping without restarting Vite. Rerun after a phone/ADB restart, wireless reconnection or switching transports. With multiple devices, inspect each with `adb -s <serial> reverse --list`, quoting the serial according to your shell if it contains spaces. Look for `tcp:5173 tcp:5173`. If ADB is outside PATH, use the discovered SDK executable path for manual ADB commands.

The hook runs only for `npm run dev`. CI's `npm ci`, `npm run typecheck`, `npm test` and `npm run build` do not invoke it; helper tests mock subprocesses and need no phone or ADB installation.

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
7. From `reals-web`, run `npm ci`, then `npm run dev`. The existing predev hook configures ADB reverse. Open `http://127.0.0.1:5173/` on Windows Chrome and Android Chrome. Verify `Invoke-RestMethod http://127.0.0.1:5173/api/ping` and open the same `/api/ping` path on the phone. Both should return `status: ok`. Only port 5173 needs reverse mapping for authentication/API calls.
8. On both browsers: register a disposable email/password account; verify the real email link with local helper disabled (or confirm local verification when explicitly enabled). Confirm backend ready and missing-profile state. Sign out, sign in, reload, close/reopen the browser and confirm SDK restoration. An account with an existing profile should show its authoritative status. Test Google sign-in, popup cancellation/blocking and sign-out; ensure authenticated presentation disappears. Do not capture bearer headers in logs/screenshots.
9. Request password reset with a test email. Only a 202 shows “Si el email está registrado, te enviamos instrucciones para recuperar el acceso.” and a 60-second resend cooldown. Verify actual mailbox behavior separately; the response never promises delivery or reveals existence. Stop backend connectivity to confirm recoverable bootstrap/reset failures, then restart it and retry. Use backend-managed fixture accounts for suspended/deleted/provider-restricted checks; never manipulate database state to bypass restrictions.

Firebase uses SDK-managed local persistence until explicit sign-out, regardless of **Recordar credenciales**. This retained Stage A checkbox currently has no behavioral effect: browser password-manager save/autofill is browser-owned, and no raw credentials or ID tokens are stored by application code. Persistence is scoped to browser origin: switching between localhost and 127.0.0.1 uses separate sessions. Sign-out does not sign the user out of their Google account globally.

Google uses popup only, invoked directly from the click callback. No redirect flow is implemented. Safari/iOS OAuth and cross-origin storage/redirect compatibility require separate validation; do not switch to redirect without implementing Firebase's [redirect browser requirements](https://firebase.google.com/docs/auth/web/redirect-best-practices). SDK persistence reference: [Firebase auth state persistence](https://firebase.google.com/docs/auth/web/auth-state-persistence).

Real provider configuration, authorized domains, Google OAuth, email delivery, persistent browser storage, Docker authorization and device popup behavior cannot be established by unit tests. Stage B automated validation uses no credentials. No `.env.local` was available during implementation, so the real auth/device smoke checklist remains pending.
