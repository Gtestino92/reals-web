# Web environments and deployment

`VITE_REALS_ENVIRONMENT` selects the Reals environment independently of Vite's `DEV`, `PROD` and `MODE`. The same `npm run build` compiles both remote environments, normally with Vite `PROD=true`. Settings are compiled into the bundle. Rebuild to switch environments.

| Reals environment | Branch and frontend | API routing | Firebase App Check |
| --- | --- | --- | --- |
| `local` | Any working branch using `npm run dev` on loopback. See [local development](local-development.md) for ADB reverse. | Leave `VITE_API_BASE_URL` empty. Vite forwards relative `/api/...` to Spring Boot at `http://localhost:8080`. | Use the local Web app's registered provider. SDK debug is opt-in on localhost or 127.0.0.1. |
| `dev` | `development` on the existing Pages project at `https://reals-web.pages.dev`. | Enter the Railway development backend's public HTTPS origin when available. | reCAPTCHA Enterprise for the development Firebase Web app. |
| `prod` | `main` on a future independent Pages project. | Enter the production backend's public HTTPS origin. | reCAPTCHA Enterprise for the production Firebase Web app. |

For local use, copy [`.env.example`](../.env.example) to `.env.local`, leave the API base empty and enter your local Firebase settings. Existing local setups can omit the selector on the Vite dev server. Compiled builds require an explicit remote environment, an HTTPS origin with a public DNS hostname, Firebase Web app settings and an Enterprise site key. Enter the origin alone, with an optional trailing slash. The client appends `/api/...`. URL validation rejects paths, user info, queries, fragments, IP literals, local-only names and reserved or common placeholder names. For a local shell build, supply remote values through the shell or Vite's ignored mode-specific env files and override any local flags inherited from `.env.local`. Preview uses the settings compiled into `dist/`.

## Integration and release workflow

Branch `feature/*` and `fix/*` from `development` and open PRs targeting `development`. Promote a tested release from `development` to `main` through a separate PR. The **Web validation** check runs architecture checks, typecheck, tests and both synthetic `dev` and `prod` builds on PRs and pushes to either integration branch. Where the repository plan and visibility support it, require PRs and a successful **Web validation** check on both branches with branch protection or repository rules. Restrict direct pushes and review who can bypass the rules. [CI details](testing.md#continuous-integration) · [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

When automatic deployments are enabled, Cloudflare Pages builds as its configured integration branch advances. GitHub Actions runs validation only. A push can trigger Pages while the push checks are still running, so GitHub branch protection must enforce passing PR checks **before** a change reaches the branch.

## Cloudflare Pages settings

The existing project's **production branch** is already set to `development`. Its **Production** configuration scope is for **Reals `dev`** at the same Pages URL, using the existing development Firebase Web app and registration. Automatic deployments are paused while the Railway integration is finalized. Ensure automatic Preview branch deployments are set to **None** before resuming. Keep repository `Gtestino92/reals-web`, Node.js 24, build command `npm ci && npm run build` and output directory `dist`. When production is ready, configure a separate Pages project with `main` as its production branch, its own backend origin and its production Firebase configuration. [Pages branch deployment controls](https://developers.cloudflare.com/pages/configuration/branch-build-controls/) · [Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/)

| Pages Production scope variable | Existing development project | Future production project |
| --- | --- | --- |
| `VITE_REALS_ENVIRONMENT` | `dev` | `prod` |
| `VITE_API_BASE_URL` | Railway development backend's public HTTPS origin, pending availability | Production backend's public HTTPS origin |
| `VITE_FIREBASE_API_KEY` | Development Web app `apiKey` | Production Web app `apiKey` |
| `VITE_FIREBASE_AUTH_DOMAIN` | Development Web app `authDomain` | Production Web app `authDomain` |
| `VITE_FIREBASE_PROJECT_ID` | Development Web app `projectId` | Production Web app `projectId` |
| `VITE_FIREBASE_APP_ID` | Development Web app `appId` | Production Web app `appId` |
| `VITE_FIREBASE_APP_CHECK_PROVIDER` | `enterprise` | `enterprise` |
| `VITE_FIREBASE_APP_CHECK_SITE_KEY` | Registered development Enterprise site key | Registered production Enterprise site key |
| `VITE_FIREBASE_APP_CHECK_DEBUG`, `VITE_LOCAL_FIREBASE_EMAIL_AUTO_VERIFICATION` | Unset or `false` | Unset or `false` |

Keep Cloudflare's injected `CF_PAGES*` metadata intact. The build requires `CF_PAGES=1` and an exact supported `CF_PAGES_BRANCH` if any Pages metadata is present. It checks the branch against the resolved Reals environment regardless of Vite mode. Local and GitHub Actions builds without Pages metadata use the usual environment validation. Build validation checks the configuration shape. Verify that each backend and Firebase app actually belongs to the intended environment when configuring the project.

All `VITE_*` values are public browser data. Keep service accounts, passwords, private keys and debug credentials out of these variables. GitHub CI uses synthetic Firebase values and an HTTPS syntax fixture. Its bundles are for validation only.

## Remaining rollout steps

1. Use the existing `development` branch for the workflow PR, wait for **Web validation** to pass on GitHub, and enforce required PR checks on both branches where supported before merging.
2. Once the Railway development backend, CORS and dependencies are ready, verify the development variables above and resume automatic deployments from `development`. Keep the existing development URL and Firebase settings.
3. Verify the Pages build and deployed browser against the development backend. Set up the independent production project when its backend and Firebase configuration are ready, then promote a verified release via a `development` → `main` PR.

## Remaining integration

1. Deploy the development backend to Railway and obtain its public HTTPS origin. Aiven PostgreSQL and R2 integration for that backend are pending.
2. Coordinate backend CORS for `https://reals-web.pages.dev`. The browser calls Railway directly. The backend needs to answer preflights for the API's methods and headers, including `Authorization`, `X-Firebase-AppCheck`, `Content-Type` and `X-Reals-Admin-Grant` where applicable. Expose `Retry-After` so the Web client can read it on cross-origin responses. API fetches omit credentials.
3. Verify the existing development Firebase Auth and reCAPTCHA Enterprise registrations cover the unchanged Pages domain and exact development Web App ID. Confirm the backend trusts the matching Firebase project and Web App ID where required. See [Firebase Web App Check setup](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider).
4. Verify a deployed browser can sign in, obtain and refresh real App Check tokens, and call a protected Railway endpoint. Confirm preflight, JSON errors and `Retry-After` where used.
