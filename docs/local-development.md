# Local development

Use Node.js 24.15+ (24.x) and npm. This scaffold was initialized with Node 24.19.0 and npm 11.17.0. Install reproducibly with `npm ci`, then run `npm run dev` from `reals-web`.

Vite binds explicitly to IPv4 loopback at `127.0.0.1:5173` and fails explicitly if occupied (`strictPort`). Open <http://127.0.0.1:5173/>. Requests to `/api/...` are forwarded to `http://localhost:8080/api/...` unchanged. No frontend environment variables or Firebase configuration are needed for this scaffold.

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

No backend files or configuration need changing for this frontend. This scaffolding task does not start or rebuild those services.

With the backend running, compare the public connectivity endpoint directly and through Vite:

```powershell
Invoke-RestMethod http://localhost:8080/api/ping
Invoke-RestMethod http://localhost:5173/api/ping
```

Matching responses verify connectivity and proxy path preservation, not authenticated behavior. A connection-refused/proxy error usually means the backend is unavailable. Protected endpoints still require real Firebase tokens; no token acquisition is implemented here.

`npm run build` generates `dist/`; `npm run preview` previews those static files on Vite's preview port (normally 4173). The development proxy is not part of that bundle or preview configuration. A production deployment will need its own API routing. Browser/device testing beyond localhost, HTTPS, storage CORS and Firebase authorized domains belong to later integration work.
