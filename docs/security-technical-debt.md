# Web Security Technical Debt

Deferred tasks only. This change implements Firebase session-persistence control;
it does not implement the hardening proposals below. Evidence is limited to the
Web source at main `6600428` plus this working change. Backend, Android, live
Firebase settings and production infrastructure were not audited. Potential
risks are investigation targets, not confirmed vulnerabilities.

P0 denotes a release gate where applicable, P1 the next hardening work, and P2
conditional/follow-up work; these are planning priorities, not severity ratings.
NOT STARTED means the proposed task has no verified implementation in this
review. PARTIAL means concrete controls/tests exist but acceptance remains
incomplete. No deferred task is claimed IMPLEMENTED.

## 1. Content Security Policy (CSP)

- Priority: P1.
- Status: NOT STARTED.
- Current evidence: No CSP implementation was identified in the reviewed Vite configuration or index.html; deployed headers were not inspected.
- Risk: Potential script/resource injection impact if an unsafe sink exists; no exploitable XSS is confirmed.
- Recommended mitigation: Inventory required Firebase, API and media origins; stage report-only then enforce a reviewed policy without unsafe broad allowlists.
- Deployment dependency: Deployment host/CDN header support and final service origins.
- Acceptance criteria: Enforced CSP response verified in deployment; login, popup, media and navigation pass; violations reviewed.

## 2. Production HTTP security headers

- Priority: P1.
- Status: NOT STARTED.
- Current evidence: The repository contains a local Vite server; production response-header policy was not verified.
- Risk: Potential framing, MIME sniffing or referrer leakage; missing production headers are not established.
- Recommended mitigation: Review framing restrictions, nosniff, Referrer-Policy, Permissions-Policy and OAuth-compatible opener policy.
- Deployment dependency: Production hosting/ingress configuration.
- Acceptance criteria: Automated deployed-response assertions and real Google popup/media tests pass with documented exceptions.

## 3. HTTPS/HSTS and deployment configuration

- Priority: P0 before production exposure.
- Status: NOT STARTED.
- Current evidence: Local development uses HTTP and a Vite /api proxy; the build has no development proxy. Live TLS/production routing was not audited.
- Risk: Potential transport interception, mixed content or incorrect routing if deployment is misconfigured.
- Recommended mitigation: Validate TLS termination, HTTP redirects, same-origin API routing, media HTTPS and certificates; introduce HSTS after affected domains are ready.
- Deployment dependency: Hosting, DNS, certificates, backend/API and media origins.
- Acceptance criteria: HTTPS, routing, redirect and certificate checks pass; HSTS scope/subdomain policy tested; no mixed-content failures.

## 4. External URL and media origin validation

- Priority: P1.
- Status: NOT STARTED.
- Current evidence: Photo URLs come from backend responses and are consumed directly. A complete URL-sink and origin-policy audit was not performed.
- Risk: Potential navigation or resource loading from unintended schemes/origins; no unsafe exploit path confirmed.
- Recommended mitigation: Inventory links, redirects and image/media sinks; define allowed schemes/origins from contracts without rewriting signed URLs.
- Deployment dependency: Known development and production storage origins.
- Acceptance criteria: Tests reject forbidden schemes/origins and accept approved signed URLs unchanged; external links use appropriate opener controls.

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
- Status: NOT STARTED.
- Current evidence: Reviewed src/auth/firebase.ts initializes Firebase App/Auth only; no Web App Check setup was found. Backend/Android and live Firebase console were not inspected for this task.
- Risk: Potential automated/unofficial client abuse; attestation is separate from identity and authorization.
- Recommended mitigation: Choose/register Web provider, attach and refresh tokens, handle errors safely, coordinate an incremental enforcement rollout.
- Deployment dependency: Firebase console provider/domain configuration and backend acceptance of the Web App ID.
- Acceptance criteria: Valid Web attestation accepted; missing/invalid tokens handled as agreed; refresh/local debug/Android compatibility checked without secrets in Git.

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
- Risk: Potential security regressions that mocked SDK, jsdom and build checks cannot detect.
- Recommended mitigation: Add isolated browser E2E for auth persistence, popup timing, cross-tab logout, URL handling and private caching; consider scoped DAST with synthetic identities.
- Deployment dependency: Disposable Firebase/test environment, approved accounts and CI browser setup.
- Acceptance criteria: Repeatable Chrome desktop/Android coverage where supported; no real-user data mutations or secret artifacts; confirmed issues get focused regression tests.
