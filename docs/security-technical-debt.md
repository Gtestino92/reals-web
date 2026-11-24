# Web Security Technical Debt

This register tracks partial controls and deferred tasks. The original review
covered Web source at main `6600428`; section 4 now records URL hardening based
on main `531f277`. Firebase session-persistence control is also implemented.
Live Firebase settings and production infrastructure were not audited. Potential
risks are investigation targets, not confirmed vulnerabilities.

P0 denotes a release gate where applicable, P1 the next hardening work, and P2
conditional/follow-up work; these are planning priorities, not severity ratings.
NOT STARTED means the proposed task has no verified implementation in this
review. PARTIAL means concrete controls/tests exist but acceptance remains
incomplete. Completed source controls do not establish deployed protection.

## 1. Content Security Policy (CSP)

- Priority: P1.
- The development Pages document, assets and SPA fallback served neither CSP header in the [deployed baseline](deployment.md#http-security-headers). Production remains unverified.
- Risk: Potential script/resource injection impact if an unsafe sink exists; no exploitable XSS is confirmed.
- The first increment leaves both CSP headers unset. The inventory below covers the known development origins. Exact signed photo/audio origins and redirect destinations, production origins, and the full authenticated Firebase/reCAPTCHA resource trace are pending. An origin policy based on guesses would make report-only results difficult to interpret.
- With an approved test account, confirm hostnames and redirect destinations without retaining signed paths, queries, credentials or HARs. Test a narrow report-only policy in a clean Chromium profile, inspect directive names and sanitized origins locally, and validate the authenticated workflows before enforcing. External reporting is deferred because reports can disclose signed media URLs.

### Resource inventory for a future policy

| Flow | CSP surface | Evidence and gaps |
| --- | --- | --- |
| Pages application shell | `script-src`, `style-src`, `img-src`, `manifest-src` | `'self'` for the built JS, CSS, local images and manifest. Static URLs and anonymous startup were observed on Pages. Some components use dynamic DOM styles. Check the actual style sinks in Chromium before choosing a style policy. |
| Firebase email/password and session refresh | `connect-src` | The installed Firebase SDK targets `https://identitytoolkit.googleapis.com` and `https://securetoken.googleapis.com`. The built app includes these hosts. Real sign-in and token refresh were outside the signed-out browser check. |
| Google OAuth | `script-src`, `frame-src`, popup navigation | The SDK config uses `https://apis.google.com/js/api.js` and creates an auth iframe at `https://reals-backend-firebase.firebaseapp.com/__/auth/iframe` using the deployed Auth domain. It opens the same domain's `/__/auth/handler` in a popup. Deployed Chromium reached `https://accounts.google.com` as a popup destination. Account selection, return to the opener, and the complete SDK iframe/script chain remain to be verified. |
| Firebase App Check | `script-src`, `frame-src`, `connect-src` | The installed SDK loads `https://www.google.com/recaptcha/enterprise.js` and exchanges attestations at `https://content-firebaseappcheck.googleapis.com`. Google's documented CSP path allowances also cover script resources from `https://www.gstatic.com/recaptcha/`, frames from `https://www.google.com/recaptcha/` and `https://recaptcha.google.com/recaptcha/`, and connections to `https://www.google.com/recaptcha/`. Actual authenticated request, refresh and auxiliary resource traces are pending. [Google's reCAPTCHA CSP guidance](https://docs.cloud.google.com/recaptcha/docs/faq) |
| Railway API | `connect-src` | `https://reals-backend-dev.up.railway.app` is compiled into the deployed client. Public ping and an unauthenticated Pages-origin CORS preflight succeeded. Authenticated responses and the production API host remain pending. |
| Signed photos and remote audio | `img-src`, `media-src` | Profile, discovery and admin images load backend-issued HTTPS URLs in image elements. Chat and admin audio use native audio elements and backend-issued HTTPS URLs. Uploads go through the API. The [backend R2 runbook](../../reals-backend/docs/storage-r2-configuration.md) describes an account-specific origin. The exact photo/audio hosts and any redirects need authenticated confirmation. |
| Local image and audio previews | `img-src`, `media-src` | The crop dialog decodes a selected file with `createImageBitmap` and renders to canvas. It needs no external image origin. Tab indicators generate a `data:` PNG favicon, and the audio recorder uses a local `blob:` URL for playback. Check these uses in the target browser before allowing either scheme where needed. Microphone and geolocation are separate browser permissions. |
| Calendar and legal links | Top-level navigation | `https://calendar.google.com` and backend-supplied HTTPS legal document URLs open in new tabs. The Cafecito link exists only on the local Vite dev server. These links are destinations, separate from subresource source lists. |

## 2. Production HTTP security headers

- Priority: P1.
- The first increment is implemented in `public/_headers`. It adds explicit framing and permissions controls and pins the existing Pages MIME and referrer defaults. The scope is Pages static responses. See [deployed baseline and verification](deployment.md#http-security-headers).
- A focused test checks the exact header and permission list, rejects additional or conflicting rules, and verifies a byte-for-byte copy in a real Vite build. The API transport test uses Railway as a separate origin. A local Chromium check confirmed framing denial and top-level microphone and geolocation eligibility.
- Post-deployment verification remains pending. Check the document, fallback and assets again after rollout, then complete the authenticated browser checks. Revisit opener and embedder policies only with successful OAuth, reCAPTCHA and media compatibility evidence.

## 3. HTTPS/HSTS and deployment configuration

- Priority: P0 before production exposure.
- Live development Pages HTTPS and its HTTP-to-HTTPS redirect were verified. The sampled responses had no HSTS. The deployed client points directly to the HTTPS Railway development API. Local development uses HTTP and a Vite `/api` proxy.
- Risk: Potential transport interception, mixed content or incorrect routing if deployment is misconfigured.
- Verify production TLS, routing, redirects and media HTTPS when the production hosts are known. Review HSTS with the production domain and subdomain strategy before adopting it.
- Deployment dependency: Hosting, DNS, certificates, backend/API and media origins.
- Acceptance criteria: HTTPS, routing, redirect and certificate checks pass; HSTS scope/subdomain policy tested; no mixed-content failures.

## 4. External URL and media origin validation

- Priority: P1.
- Status: PARTIAL (shared scheme/credential validation implemented; deployment origin policy pending).
- Implemented: `src/shared/browserUrl.ts` validates backend profile-photo and legal-document URLs through onboarding contracts, chat audio through chat contracts, and admin photo/audio through `mediaUrl`. Production requires absolute HTTPS. Only Vite development (`DEV && !PROD`) permits HTTP on exactly `localhost` or `127.0.0.1`, with optional ports for the [local MinIO / ADB workflow](local-development.md#existing-backend). LAN hosts, emulator addresses and loopback aliases are not exceptions.
- Rejected: Unsupported schemes, relative/protocol-relative URLs, missing authority, invalid hosts/ports/percent escapes, whitespace/control characters, backslashes and embedded credentials (including empty userinfo). Valid strings are returned unchanged; the parsed URL is never serialized, preserving signed paths and query bytes/order/duplicates.
- Compatibility: Existing onboarding/chat invalid-response errors and admin null/hidden-media behavior remain intact. Existing `no-referrer` media protections and legal-link `noopener noreferrer` remain unchanged. `.env.local`, Firebase, hosting and sibling repositories are untouched. This is targeted defensive hardening, not a complete URL-sink or redirect audit.
- Validation: `src/shared/browserUrl.test.ts` covers all four consumer boundaries in production/development, HTTPS, local MinIO signed URLs, forbidden HTTP, dangerous/malformed URLs and credentials, with exact complex-query preservation. These are simulated contract tests, not deployed storage/browser verification.
- Risk: Potential navigation or resource loading from unintended schemes/origins; no unsafe exploit path confirmed.
- Pending mitigation: Establish actual storage/CDN/legal-document origins before defining a production origin allowlist; inventory remaining sinks and redirect behavior. No fixed production-domain allowlist is introduced.
- Deployment dependency: Actual production origins, TLS, redirects, storage CORS and HTTP response headers (CSP, Referrer-Policy, cache policy and other controls in sections 1–3 and 7) still require deployment verification.
- Remaining acceptance criteria: Deployed origin/redirect/header checks and real signed-media/legal navigation succeed with approved origins and unchanged signatures. Unit tests do not establish these controls.

## 5. XSS and untrusted-content audit

- Priority: P1.
- Status: PARTIAL.
- Current evidence: Reviewed React surfaces render text; LoginScreen tests verify error text is not HTML. No raw-HTML sink was found by source search, but no comprehensive data-flow audit was performed.
- Risk: Potential future unsafe rendering or URL sinks; no XSS vulnerability established.
- Recommended mitigation: Trace backend/user text through rendering and navigation; retain React escaping; separately review any future raw HTML/sanitization need.
- Deployment dependency: None for source review; final browser policies for end-to-end verification.
- Acceptance criteria: Reviewed sink inventory and hostile text/URL regression tests cover profile, legal, errors and media without executing markup.

## 6. Firebase App Check for Web

- Priority: P1.
- The app initializes Firebase App Check on demand via `src/auth/appCheck.ts`. Remote builds require reCAPTCHA Enterprise. Automatic refresh is enabled, and `src/auth/api.ts` attaches `X-Firebase-AppCheck` on applicable requests. SDK debug is local and opt-in. SDK and transport tests cover configuration, token failures and header forwarding.
- Risk: Potential automated/unofficial client abuse; attestation is separate from identity and authorization.
- Confirm live provider/domain registration, Web App ID acceptance and the backend's enforcement mode. Verify real token acquisition and refresh, protected API acceptance and agreed missing/invalid-token handling with an approved account.

## 7. Sensitive media URL handling

- Priority: P1.
- Status: PARTIAL.
- Current evidence: Local development docs already prohibit rewriting presigned URLs and describe fetching fresh URLs. Production caching, referrers, analytics and browser persistence were not audited.
- Risk: Potential disclosure/reuse of bearer media URLs through logs, caches, referrers or analytics; no leak confirmed.
- Recommended mitigation: Audit media lifetime, cache/referrer rules and telemetry; avoid durable URL storage; request fresh URLs after expiry using existing contracts.
- Deployment dependency: Storage/CDN headers, backend URL TTLs and telemetry configuration.
- Acceptance criteria: Expired access fails as intended; URLs absent from logs/analytics/durable caches; sign-out/account-switch behavior reviewed; valid media works unchanged.

## 8. Dependency vulnerability scanning

- Priority: P1.
- Status: NOT STARTED.
- Current evidence: package-lock.json and npm ci in .github/workflows/ci.yml provide repeatable installs. Reviewed Web CI has typecheck/tests/build, with no vulnerability scan stage; no vulnerable package is asserted.
- Risk: Potential vulnerable dependencies or compromised upstream artifacts.
- Recommended mitigation: Add reviewed audit/dependency gates, automated updates, severity/exception ownership and assess action pinning/provenance.
- Deployment dependency: CI permissions, vulnerability advisory availability and release policy.
- Acceptance criteria: Repeatable scans cover runtime/dev dependencies; high-risk findings gate releases with time-bounded reviewed exceptions and patch ownership.

## 9. PWA Service Worker and offline cache security

- Priority: P2; gate before offline private data.
- Status: NOT STARTED.
- Current evidence: No Service Worker registration was found in reviewed src/ and no PWA dependency appears in package.json. No deployed worker/cache audit was performed.
- Risk: Conditional risk of private content persisting across logout or account changes if offline caching is introduced.
- Recommended mitigation: Inventory deployed workers/caches; define private-data exclusions and update/logout/account-switch cleanup before introducing offline behavior.
- Deployment dependency: PWA scope and HTTPS hosting if introduced.
- Acceptance criteria: Worker/cache inventory verified; offline/reload/update/logout tests show no cross-account private data or credential caching.

## 10. Browser storage/privacy review

- Priority: P1.
- Status: PARTIAL.
- Current evidence: Hardening #1 now passes the email checkbox choice to SDK persistence, defaults new logins/Google to session and preserves legacy sessions. Tests cover SDK restoration; no application token/password storage was introduced. This is not a full browser privacy audit.
- Risk: Confirmed prior mismatch between checkbox and fixed local persistence is addressed here. Residual potential risks include shared devices, browser recovery, copied tabs and retained non-auth data.
- Recommended mitigation: Audit all durable/temporary browser data, retention and account boundaries; review shared-device UX and legacy migration policy without custom Firebase storage.
- Deployment dependency: Browser recovery/privacy policy and product retention decisions.
- Acceptance criteria: Documented data inventory and retention; desktop/Android restart/recovery/multiple-tab checks pass; no token/password values in application storage or telemetry.

## 11. Security regression and E2E tests

- Priority: P1.
- Status: PARTIAL.
- Current evidence: Vitest/RTL authentication/API/race tests and new persistence regressions exist. No real-provider browser E2E suite or DAST stage was found in reviewed Web CI.
- CodeQL Advanced is active. The default setup API returned `not-configured`, and both Actions and JavaScript/TypeScript jobs passed for the audited `development` commit. The checked-in configuration excludes root `tools/**` from CodeQL analysis, and the Web validation suite still tests those tools. CodeQL is static analysis, separate from dependency scanning and browser validation. [Successful CodeQL run](https://github.com/Gtestino92/reals-web/actions/runs/45115596187)
- Risk: Potential security regressions that mocked SDK, jsdom and build checks cannot detect.
- Recommended mitigation: Add isolated browser E2E for auth persistence, popup timing, cross-tab logout, URL handling and private caching; consider scoped DAST with synthetic identities.
- Deployment dependency: Disposable Firebase/test environment, approved accounts and CI browser setup.
- Acceptance criteria: Repeatable Chrome desktop/Android coverage where supported; no real-user data mutations or secret artifacts; confirmed issues get focused regression tests.
