# Local development

Use Node.js 24.15+ (24.x) and npm. This scaffold was initialized with Node 24.19.0 and npm 11.17.0. Install reproducibly with `npm ci`, then run `npm run dev` from `reals-web`.

Vite listens on port 5173 and fails explicitly if occupied (`strictPort`). Open <http://localhost:5173>. Requests to `/api/...` are forwarded to `http://localhost:8080/api/...` unchanged. No frontend environment variables or Firebase configuration are needed for this scaffold.

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
