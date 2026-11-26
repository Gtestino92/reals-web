# Web environments and deployment

`VITE_REALS_ENVIRONMENT` selects the Reals environment independently of Vite's `DEV`, `PROD` and `MODE`. The same `npm run build` compiles both remote environments, normally with Vite `PROD=true`. Settings are compiled into the bundle. Rebuild to switch environments.

| Reals environment | Branch and frontend | API routing | Firebase App Check |
| --- | --- | --- | --- |
| `local` | Any working branch using `npm run dev` on loopback. See [local development](local-development.md) for ADB reverse. | Leave `VITE_API_BASE_URL` empty. Vite forwards relative `/api/...` to Spring Boot at `http://localhost:8080`. | Use the local Web app's registered provider. SDK debug is opt-in on localhost or 127.0.0.1. |
| `dev` | `development` on the existing Pages project at `https://reals-web.pages.dev`. | The deployed bundle calls `https://reals-backend-dev.up.railway.app` directly. | reCAPTCHA Enterprise for the development Firebase Web app. |
| `prod` | `main` on a future independent Pages project. | Enter the production backend's public HTTPS origin. | reCAPTCHA Enterprise for the production Firebase Web app. |

For local use, copy [`.env.example`](../.env.example) to `.env.local`, leave the API base empty and enter your local Firebase settings. Existing local setups can omit the selector on the Vite dev server. Compiled builds require an explicit remote environment, an HTTPS origin with a public DNS hostname, Firebase Web app settings and an Enterprise site key. Enter the origin alone, with an optional trailing slash. The client appends `/api/...`. URL validation rejects paths, user info, queries, fragments, IP literals, local-only names and reserved or common placeholder names. For a local shell build, supply remote values through the shell or Vite's ignored mode-specific env files and override any local flags inherited from `.env.local`. Preview uses the settings compiled into `dist/`.

## Integration and release workflow

Branch `feature/*` and `fix/*` from `development` and open PRs targeting `development`. Promote a tested release from `development` to `main` through a separate PR. The **Web validation** check runs architecture checks, typecheck, tests and both synthetic `dev` and `prod` builds on PRs and pushes to either integration branch. Where the repository plan and visibility support it, require PRs and a successful **Web validation** check on both branches with branch protection or repository rules. Restrict direct pushes and review who can bypass the rules. [CI details](testing.md#continuous-integration) · [GitHub protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

When automatic deployments are enabled, Cloudflare Pages builds as its configured integration branch advances. GitHub Actions runs validation only. A push can trigger Pages while the push checks are still running, so GitHub branch protection must enforce passing PR checks **before** a change reaches the branch.

## Cloudflare Pages settings

The existing project's **production branch** is already set to `development`. Its **Production** configuration scope is for **Reals `dev`** at the same Pages URL, using the existing development Firebase Web app and registration. Automatic deployments from `development` have been re-enabled for this Dev Pages project. Keep automatic Preview branch deployments set to **None**. Keep repository `Gtestino92/reals-web`, Node.js 24, build command `npm ci && npm run build` and output directory `dist`. When production is ready, configure a separate Pages project with `main` as its production branch, its own backend origin and its production Firebase configuration. [Pages branch deployment controls](https://developers.cloudflare.com/pages/configuration/branch-build-controls/) · [Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/)

| Pages Production scope variable | Existing development project | Future production project |
| --- | --- | --- |
| `VITE_REALS_ENVIRONMENT` | `dev` | `prod` |
| `VITE_API_BASE_URL` | `https://reals-backend-dev.up.railway.app` | Production backend's public HTTPS origin |
| `VITE_LEGAL_DOCUMENT_ORIGIN` | Optional. Defaults to `https://reals-web.pages.dev` in dev and local. | Set to the production publisher's public HTTPS origin before enabling legal documents. |
| `VITE_FIREBASE_API_KEY` | Development Web app `apiKey` | Production Web app `apiKey` |
| `VITE_FIREBASE_AUTH_DOMAIN` | Development Web app `authDomain` | Production Web app `authDomain` |
| `VITE_FIREBASE_PROJECT_ID` | Development Web app `projectId` | Production Web app `projectId` |
| `VITE_FIREBASE_APP_ID` | Development Web app `appId` | Production Web app `appId` |
| `VITE_FIREBASE_APP_CHECK_PROVIDER` | `enterprise` | `enterprise` |
| `VITE_FIREBASE_APP_CHECK_SITE_KEY` | Registered development Enterprise site key | Registered production Enterprise site key |
| `VITE_FIREBASE_APP_CHECK_DEBUG`, `VITE_LOCAL_FIREBASE_EMAIL_AUTO_VERIFICATION` | Unset or `false` | Unset or `false` |

Keep Cloudflare's injected `CF_PAGES*` metadata intact. The build requires `CF_PAGES=1` and an exact supported `CF_PAGES_BRANCH` if any Pages metadata is present. It checks the branch against the resolved Reals environment regardless of Vite mode. Local and GitHub Actions builds without Pages metadata use the usual environment validation. Build validation checks the configuration shape. Verify that each backend and Firebase app actually belongs to the intended environment when configuring the project.

All `VITE_*` values are public browser data. Keep service accounts, passwords, private keys and debug credentials out of these variables. GitHub CI uses synthetic Firebase values and an HTTPS syntax fixture. Its bundles are for validation only.

## HTTP security headers

### Deployed development baseline

Unauthenticated GETs on 2026-11-23 returned the following headers from `reals-web.pages.dev`. “Absent” refers to the named header on that response.

| Header | HTTPS document `/`, JS, CSS, manifest, favicon and SPA fallback (200) | HTTP `/` (301 to HTTPS) | HTTPS `/index.html` (308 to `/`) |
| --- | --- | --- | --- |
| Content-Security-Policy | Absent | Absent | Absent |
| Content-Security-Policy-Report-Only | Absent | Absent | Absent |
| X-Frame-Options | Absent | Absent | Absent |
| X-Content-Type-Options | `nosniff` | Absent | Absent |
| Referrer-Policy | `strict-origin-when-cross-origin` | Absent | `strict-origin-when-cross-origin` |
| Permissions-Policy | Absent | Absent | Absent |
| Strict-Transport-Security | Absent | Absent | Absent |
| Cross-Origin-Opener-Policy | Absent | Absent | Absent |
| Cache-Control | `public, max-age=0, must-revalidate` | Absent | Absent |

A missing route and a missing `/assets/*.js` path both returned the SPA HTML with HTTP 200. The missing script's body matched the root document. A request to `/sw.js` also returned HTML. The observed 200 response headers match documented Cloudflare Pages defaults. The audited base commit had no `_headers` or Pages Functions, and neither its HTML nor Vite config configured these headers. Dashboard rules and the independent production environment were outside the audit. [Cloudflare Pages serving and default headers](https://developers.cloudflare.com/pages/configuration/serving-pages/)

### First increment in source

Vite copies [`public/_headers`](../public/_headers) to `dist/_headers`. Pages interprets the shared `/*` rule for static responses on its own host. The rule pins `X-Content-Type-Options: nosniff` and `Referrer-Policy: strict-origin-when-cross-origin` to their observed values. It sets `X-Frame-Options: DENY` because the Web app is a top-level destination with no embedding requirement identified. The policy applies to pages that embed Reals. Firebase Auth and reCAPTCHA frames are served by their own origins.

The Permissions Policy disables camera capture and Payment Request, which the current app does not use. Photo selection uses a file input and local canvas cropping. Geolocation and microphone are available to the same origin, subject to normal browser permission prompts, with no cross-origin delegation. The additional `https://reals-web.pages.dev/*` rule sends the [candidate policy](../public/_headers) in Report-Only mode. Pages combines both matching rules. Other hosts receive only the shared rule.

Railway keeps its own headers and CORS. For comparison, its public `/api/ping` returned JSON with `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, and `Cache-Control: no-cache, no-store, max-age=0, must-revalidate`. Pages applies redirects ahead of custom header rules. Its asset rules also have no effect on a Pages Function response. [Cloudflare Pages header scope](https://developers.cloudflare.com/pages/configuration/headers/)

### Verification and rollout

- The automated check asserts both rules with exactly the reviewed headers and permissions and compares the source file with the Vite build output. API transport tests exercise the separate Railway origin. Synthetic `dev` and `prod` builds both copied the file byte for byte.
- The deployed baseline rendered the login form without horizontal overflow in clean Chromium at desktop and mobile emulated viewports. The Google popup reached Google's sign-in page. No CSP violations were observed on anonymous startup, where both CSP headers were absent. Local Chromium with the built headers denied framing and confirmed the camera, payment, microphone and geolocation policy settings.

### Hosted DEV smoke checklist

Use a clean profile and an approved account after an authorized release. Inspect violations locally. Record only directive and origin, omitting paths, queries, tokens, console exports and HARs.

1. Check the document, fallback and assets for the exact Report-Only header and four baseline headers. Confirm the enforcing header is absent. Check redirects separately.
2. Complete email and Google sign-in, popup return and token refresh. Verify App Check exchange, refresh and authenticated Railway traffic.
3. Open profile images and verify the initial and final photo origins independently of audio. Exercise selection and crop.
4. In both chats play received audio, record, preview and send. Check microphone permission, geolocation and the tab favicon.
5. Open a legal document in the reader and its browser link. Open Google Calendar and return to Reals.

Enforcement requires separate review after these flows pass and unexplained violations, including provider styles and media redirects, are resolved. Inventory production independently. To roll back, remove the hostname-specific rule and its test expectation in a reviewed revision, release through the normal DEV process and recheck the shared headers. See the [resource inventory and local evidence](security-technical-debt.md#1-content-security-policy-csp).

## Remaining rollout steps

1. Use the existing `development` branch for the workflow PR, wait for **Web validation** to pass on GitHub, and enforce required PR checks on both branches where supported before merging.
2. Verify the development variables above and the automatic build from `development`. Keep the existing development URL and Firebase settings.
3. Verify the Pages build and deployed browser against the development backend. Set up the independent production project when its backend and Firebase configuration are ready, then promote a verified release via a `development` → `main` PR.

## Remaining integration

1. The deployed Pages bundle points to Railway and `GET /api/ping` returned HTTP 200 on 2026-11-23. The database provider and private R2 integration require separate verification.
2. A Pages-origin preflight for `GET /api/me` with `Authorization` and `X-Firebase-AppCheck` returned HTTP 200 with the expected allowed origin and headers and exposed `Retry-After`. Verify other authenticated CORS paths and headers, including `Content-Type` and `X-Reals-Admin-Grant` where applicable. API fetches omit credentials.
3. Verify the existing development Firebase Auth and reCAPTCHA Enterprise registrations cover the unchanged Pages domain and exact development Web App ID. Confirm the backend trusts the matching Firebase project and Web App ID where required. See [Firebase Web App Check setup](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider).
4. Verify a deployed browser can sign in, obtain and refresh real App Check tokens, and call a protected Railway endpoint. Confirm preflight, JSON errors and `Retry-After` where used.

## Development legal validation

The backend owns the immutable HTML and the opt-in Spring catalog. Every publication copy in `dev-legal/` uses its canonical backend category, immutable version directory and filename. The manifest lists all published versions. The backend catalog selects the current version of each type. Exact public URLs, action types and SHA-256 values are listed in the [backend fixture catalog](https://github.com/Gtestino92/reals-backend/blob/b4630ba1f2974b1260b42ca3aaa97c0c2a396bac/legal-documents/README.md#development-fixture-catalog). The opt-in catalog selects `dev-fixture-2026-11-24-v2`. Keep the three v1 routes public.

1. Check out both reviewed revisions. From Web run `node tools/verify-dev-legal.mjs --canonical ../reals-backend/legal-documents`, substituting the backend worktree path when needed. For a future version, copy each new canonical file byte-for-byte into a new version directory and append its SHA-256 and path to `dev-legal/SHA256SUMS`. Keep each historical file and its original digest. The build verifies every entry and emits every listed version. CI compares the manifest to the pull request base or previous push revision. To run that check locally, pass a saved copy of the previous manifest to `node tools/verify-dev-legal.mjs --previous <prior-SHA256SUMS>`.
2. With separate release authorization, publish Web on the existing development Pages project using the settings above. A `dev` build emits `dist/legal/<directory>/<version>/document.html`. A `prod` build omits the fixture assets. CI checks the emitted dev hashes and production exclusion.
3. Run `node tools/verify-dev-legal.mjs --origin https://reals-web.pages.dev`. It follows same-origin publication redirects, checks HTTP 200 and HTML content type and compares the body bytes with every pinned file. A successful status from an SPA fallback fails this check. Verify all six URLs before deploying the backend revision. If the opt-in profile is already active, that deployment immediately selects v2.
4. Deploy the reviewed backend revision to the **development** Railway service with the intended development profiles. For first activation, start with `SPRING_PROFILES_ACTIVE=dev`. Confirm readiness and the expected baseline catalog. Record the service revision and prior variable value. Set `SPRING_PROFILES_ACTIVE=dev,dev-legal-fixtures` on that service and redeploy. Confirm readiness and that the running revision includes the canonical files. The startup verifier rejects a missing or mismatched resource.
5. Using the development PWA with its normal App Check and a disposable account, inspect `GET /api/legal/documents/current` and `GET /api/me/legal-status`. Check all three types, v2 versions, URLs and required actions. An account that completed all three v1 documents must now have three pending requirements. Open each reader and its secondary browser link. On an ACTIVE account with known pending documents, choose Ahora no and then Buscar chat. Verify that the legal cards appear directly without a location request or queue admission. Complete the documents and verify that a fresh click on Buscar chat is required. With a previously satisfied client and a newly pending server version, verify that a protected write receiving LEGAL_ACTION_REQUIRED opens the same prompt. Verify account management, chat exit and safety controls are reachable after deferral. Check the Network panel for zero legal writes on deferral and one explicit POST per chosen action. Reopen after one action and verify partial completion. After deferring, open Cuenta → Documentos vigentes and explicitly complete a pending document there. Verify partial completion after the status reload. Complete the remaining actions, check that each completed document keeps its link and loses its action button, then use Volver a Cuenta. A second account has its own status. Use a disposable account for a confirmed deletion test.
6. To resume v1, restore the reviewed v1 backend revision with its prior development profiles. To disable fixtures, restore `SPRING_PROFILES_ACTIVE=dev` and redeploy. Verify the selected catalog after reload: three v1 entries when restoring v1, or an empty catalog and satisfied status when disabling fixtures. Keep versioned public files available. Existing action and audit rows survive the rollback. A future changed-text test requires a new version directory and digest.

For local HTTP rehearsal, serve a development build with `npm run preview` and pass its loopback origin to the same verifier. Browser UI checks use `npm run dev -- --port 5174` and `node tools/legal-browser.mjs` with a synthetic identity and transport.

The reader fetches UTF-8 HTML under `/legal/` on the origin selected at build time. Set `VITE_LEGAL_DOCUMENT_ORIGIN` to a single public HTTPS origin using the same syntax as `VITE_API_BASE_URL`. A malformed setting fails build validation. Leaving it unset or empty in production permits builds and sessions with an empty catalog. If a document is opened, the reader displays its load error before making a request.

On `*.pages.dev`, the reader requests the extensionless `/document` route for catalog files ending in `/document.html`. Other hosts must serve the exact catalog URL directly. Requests omit credentials, reject redirects and enforce a 512 KiB decoded-body limit. The secondary browser link retains the catalog URL. When switching publishers, review CORS and CSP and rebuild the Web bundle with the new origin.

The public catalog omits the canonical SHA-256. The reader can check the destination, response and supported formatting. It cannot compare the downloaded bytes to the backend's canonical digest. Use the publication verifier for that comparison during release.
