# Web environments and deployment

`VITE_REALS_ENVIRONMENT` selects the Reals environment independently of Vite's `DEV`, `PROD` and `MODE`. The same `npm run build` compiles both remote environments, normally with Vite `PROD=true`. Settings are compiled into the bundle. Rebuild to switch environments.

| Reals environment | Frontend | API routing | Firebase App Check |
| --- | --- | --- | --- |
| `local` | `npm run dev` on loopback. See [local development](local-development.md) for ADB reverse. | Leave `VITE_API_BASE_URL` empty. Vite forwards relative `/api/...` to Spring Boot at `http://localhost:8080`. | Use the local Web app's registered provider. SDK debug is opt-in on localhost or 127.0.0.1. |
| `dev` | Current Cloudflare Pages site at `https://reals-web.pages.dev`. | Enter the Railway development backend's public HTTPS origin when available. | reCAPTCHA Enterprise for the development Firebase Web app. |
| `prod` | Future separate production deployment. | Enter the production backend's public HTTPS origin. | reCAPTCHA Enterprise for the production Firebase Web app. |

For local use, copy [`.env.example`](../.env.example) to `.env.local`, leave the API base empty and enter your local Firebase settings. Existing local setups can omit the selector on the Vite dev server. Compiled builds require an explicit remote environment, an HTTPS origin with a public DNS hostname, Firebase Web app settings and an Enterprise site key. Enter the origin alone, with an optional trailing slash. The client appends `/api/...`. URL validation rejects paths, user info, queries, fragments, IP literals, local-only names and reserved or common placeholder names. For a local shell build, supply remote values through the shell or Vite's ignored mode-specific env files and override any local flags inherited from `.env.local`. Preview uses the settings compiled into `dist/`.

## Configure Cloudflare Pages before merging to main

Cloudflare calls its deployment from `main` **Production**. On the existing Pages project, that scope runs Reals **`dev`**. Keep the repository `Gtestino92/reals-web`, production branch `main`, build command `npm ci && npm run build`, output directory `dist` and Node.js 24. See [Cloudflare Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/).

| Pages Production scope variable | Value |
| --- | --- |
| `VITE_REALS_ENVIRONMENT` | `dev` |
| `VITE_API_BASE_URL` | Railway development backend's public HTTPS origin, pending availability |
| `VITE_FIREBASE_API_KEY` | Development Firebase Web app `apiKey` |
| `VITE_FIREBASE_AUTH_DOMAIN` | Development Firebase Web app `authDomain` |
| `VITE_FIREBASE_PROJECT_ID` | Development Firebase Web app `projectId` |
| `VITE_FIREBASE_APP_ID` | Development Firebase Web app `appId` |
| `VITE_FIREBASE_APP_CHECK_PROVIDER` | `enterprise` |
| `VITE_FIREBASE_APP_CHECK_SITE_KEY` | Public reCAPTCHA Enterprise site key registered for the development Web app |
| `VITE_FIREBASE_APP_CHECK_DEBUG` | Unset or `false` |
| `VITE_LOCAL_FIREBASE_EMAIL_AUTO_VERIFICATION` | Unset or `false` |

Keep the Pages Node.js version setting at 24. If Pages Preview builds are enabled, supply valid Reals development settings in that scope too. Include only approved preview origins in backend and Firebase configuration if those previews will make authenticated requests. A future separate production deployment uses the same variable names with `VITE_REALS_ENVIRONMENT=prod`, its own backend origin and production Firebase settings.

All `VITE_*` values are public browser data. Keep service accounts, passwords, private keys and debug credentials out of these variables. CI builds with synthetic Firebase values and uses the existing Web hostname as a syntax fixture. CI performs no requests to that hostname and its bundle is for validation only.

## Remaining integration

1. Obtain the Railway development backend HTTPS origin and configure the Pages variables above before merging.
2. Coordinate backend CORS for `https://reals-web.pages.dev`. The browser calls Railway directly. The backend needs to answer preflights for the API's methods and headers, including `Authorization`, `X-Firebase-AppCheck`, `Content-Type` and `X-Reals-Admin-Grant` where applicable. Expose `Retry-After` so the Web client can read it on cross-origin responses. API fetches omit credentials.
3. Configure the development Firebase Auth authorized domain and register the exact development Web App ID and Pages domain for reCAPTCHA Enterprise. Confirm the backend trusts the matching Firebase project and Web App ID where required. See [Firebase Web App Check setup](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider).
4. Verify a deployed browser can sign in, obtain and refresh real App Check tokens, and call a protected Railway endpoint. Confirm preflight, JSON errors and `Retry-After` where used. Build validation checks configuration shape and cannot confirm reachability, matching Firebase registrations or CORS.
