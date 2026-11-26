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
- The [DEV candidate](../public/_headers) requests browser observation on the exact Pages hostname. It provides no enforced CSP protection and sends no reports. See the [hosted checklist, enforcement criteria and rollback](deployment.md#hosted-dev-smoke-checklist).
- In clean local Chromium the synthetic build displayed the password field and Google button. A same-origin image decoded, a DOM style property took effect, and MediaRecorder captured generated audio whose blob preview played to completion. No violations fired during these checks. An image on a second loopback port decoded and raised `img-src` with disposition `report`. Component tests separately exercised login, photo grid and audio composer behavior. Hosted identity, physical microphone and signed-media flows remain pending.

### Resource inventory for the DEV candidate

| Flow | CSP surface | Evidence and gaps |
| --- | --- | --- |
| Pages application shell | `script-src`, `style-src`, `img-src`, `manifest-src` | `'self'` for the built JS, CSS, local images and manifest. Static URLs and anonymous startup were observed on Pages. The slider, photo grid, reply swipe and legal dialog use DOM style properties. The candidate permits same-origin CSS without inline style exceptions. Verify provider-injected styles during hosted challenges. |
| Firebase email/password and session refresh | `connect-src` | The installed Firebase SDK targets `https://identitytoolkit.googleapis.com` and `https://securetoken.googleapis.com`. The built app includes these hosts. Real sign-in and token refresh were outside the signed-out browser check. |
| Google OAuth | `script-src`, `frame-src`, popup navigation | The SDK config uses `https://apis.google.com/js/api.js` and creates an auth iframe at `https://reals-backend-firebase.firebaseapp.com/__/auth/iframe` using the deployed Auth domain. It opens the same domain's `/__/auth/handler` in a popup. Deployed Chromium reached `https://accounts.google.com` as a popup destination. Account selection, return to the opener, and the complete SDK iframe/script chain remain to be verified. |
| Firebase App Check | `script-src`, `frame-src`, `connect-src` | The installed SDK loads `https://www.google.com/recaptcha/enterprise.js` and exchanges attestations at `https://content-firebaseappcheck.googleapis.com`. Google's documented CSP path allowances also cover script resources from `https://www.gstatic.com/recaptcha/`, frames from `https://www.google.com/recaptcha/` and `https://recaptcha.google.com/recaptcha/`, and connections to `https://www.google.com/recaptcha/`. Actual authenticated request, refresh and auxiliary resource traces are pending. [Google's reCAPTCHA CSP guidance](https://docs.cloud.google.com/recaptcha/docs/faq) |
| Railway API | `connect-src` | `https://reals-backend-dev.up.railway.app` is compiled into the deployed client. Public ping and an unauthenticated Pages-origin CORS preflight succeeded. Authenticated responses and the production API host remain pending. |
| Signed photos and remote audio | `img-src`, `media-src` | Profile, discovery and admin images load backend-issued HTTPS URLs in image elements. Chat and admin audio use native audio elements and backend-issued HTTPS URLs. Uploads go through the API. The [backend R2 runbook](../../reals-backend/docs/storage-r2-configuration.md) describes an account-specific origin. The observed DEV audio origin is allowed only for media. The runbook does not establish the deployed photo hostname. Verify photo and redirect origins before expanding `img-src`. |
| Local image and audio previews | `img-src`, `media-src` | The crop dialog decodes a selected file with `createImageBitmap` and renders to canvas. It needs no external image origin. Tab indicators generate a `data:` PNG favicon, and the audio recorder uses a local `blob:` URL for playback. Check these uses in the target browser before allowing either scheme where needed. Microphone and geolocation are separate browser permissions. |
| Calendar and legal links | Top-level navigation | `https://calendar.google.com` and backend-supplied HTTPS legal document URLs open in new tabs. The Cafecito link exists only on the local Vite dev server. These links are destinations, separate from subresource source lists. The reader also fetches same-origin DEV documents and renders allowlisted elements as React content without copying styles or loading embedded resources. |

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
- Status: Scheme and credential validation implemented. The legal reader and standalone link share the publication origin and path check. Hosted media origin policy remains pending.
- Implemented: `src/shared/browserUrl.ts` validates backend profile-photo and legal-document URLs through onboarding contracts, chat audio through chat contracts, and admin photo/audio through `mediaUrl`. Production requires absolute HTTPS. Only Vite development (`DEV && !PROD`) permits HTTP on exactly `localhost` or `127.0.0.1`, with optional ports for the [local MinIO / ADB workflow](local-development.md#existing-backend). LAN hosts, emulator addresses and loopback aliases are not exceptions.
- Rejected: Unsupported schemes, relative/protocol-relative URLs, missing authority, invalid hosts/ports/percent escapes, whitespace/control characters, backslashes and embedded credentials (including empty userinfo). Valid strings are returned unchanged; the parsed URL is never serialized, preserving signed paths and query bytes/order/duplicates.
- Compatibility: Existing onboarding/chat invalid-response errors and admin null/hidden-media behavior remain intact. Existing `no-referrer` media protections and legal-link `noopener noreferrer` remain unchanged. `.env.local`, Firebase, hosting and sibling repositories are untouched. This is targeted defensive hardening, not a complete URL-sink or redirect audit.
- Validation: `src/shared/browserUrl.test.ts` covers all four consumer boundaries in production/development, HTTPS, local MinIO signed URLs, forbidden HTTP, dangerous/malformed URLs and credentials, with exact complex-query preservation. These are simulated contract tests, not deployed storage/browser verification.
- Confirmed low-severity navigation gap in `src/legal/DocumentReader.tsx`: a catalog URL could remain clickable after the reader rejected it as outside the configured publication. Both paths now require the shared URL check, exact configured origin, normalized `/legal/` path and no fragment. Regression cases cover other origins, wrong paths, encoded dot segments, credentials, fragments and unsupported schemes. Valid navigation keeps its original URL and no-referrer policy. The embedded reader rejects redirects. The standalone browser link relies on the trusted publisher for subsequent redirects.
- Pending mitigation: Establish actual storage/CDN/legal-document origins before defining a production origin allowlist; inventory remaining sinks and redirect behavior. No fixed production-domain allowlist is introduced.
- Deployment dependency: Actual production origins, TLS, redirects, storage CORS and HTTP response headers (CSP, Referrer-Policy, cache policy and other controls in sections 1–3 and 7) still require deployment verification.
- Remaining acceptance criteria: Deployed origin/redirect/header checks and real signed-media/legal navigation succeed with approved origins and unchanged signatures. Unit tests do not establish these controls.

## 5. XSS and untrusted-content audit

- Priority: P1.
- Status: Source trace complete for the reviewed surfaces. No executable-markup sink found.
- Profile display names, locations, biography and question/answer strings render as React text. Chat text, reply excerpts and admin evidence follow the same boundary. Notification projections use validated activity types, account-scoped IDs and counts for title/favicon presentation. The favicon's data URL is drawn locally.
- Legal HTML is parsed off-DOM with parse5 and rebuilt as React text and allowlisted formatting. Links inside content become text. Scripts, forms, frames and embedded resources are rejected in the body. Focused tests cover hostile chat/profile/admin text and legal content. Calendar navigation builds a fixed Google Calendar endpoint with encoded parameters. The development Cafecito link is static.

## 6. Firebase App Check for Web

- Priority: P1.
- The app initializes Firebase App Check on demand via `src/auth/appCheck.ts`. Remote builds require reCAPTCHA Enterprise. Automatic refresh is enabled, and `src/auth/api.ts` attaches `X-Firebase-AppCheck` on applicable requests. SDK debug is local and opt-in. SDK and transport tests cover configuration, token failures and header forwarding.
- Risk: Potential automated/unofficial client abuse; attestation is separate from identity and authorization.
- Confirm live provider/domain registration, Web App ID acceptance and the backend's enforcement mode. Verify real token acquisition and refresh, protected API acceptance and agreed missing/invalid-token handling with an approved account.

## 7. Sensitive media URL handling

- Priority: P1.
- Status: PARTIAL.
- Source review found signed media URLs held in owned in-memory models and native media elements, with no application-controlled durable store. Image sinks set `no-referrer`. Native audio uses the page referrer policy. The API transport now explicitly bypasses the browser HTTP cache for authenticated responses carrying signed URLs.
- Remaining risk: Signed URLs are bearer capabilities until expiry. Media-element requests use the storage response's HTTP cache directives. Verify deployed cache directives, redirects, TTL and telemetry before production.
- Deployment dependency: Storage/CDN headers, backend URL TTLs and telemetry configuration.
- Acceptance criteria: Expired access fails as intended; URLs absent from logs/analytics/durable caches; sign-out/account-switch behavior reviewed; valid media works unchanged.

### Participant chat playback after a block

Deploy the participant history endpoint and its CORS exposed-header configuration before this Web build. Every successful bounded or incremental GET, including an empty page, must carry `X-Reals-Counterpart-Audio-Access` and `Cache-Control: no-store`. An older backend or an intermediary hiding the header makes counterpart audio unavailable. Check both history shapes from the deployed Web origin.

| Observation for the current chat owner | Timeline and player behavior |
| --- | --- |
| `ALLOWED` | Merge fresh media within the existing lifecycle window. Bounded or empty history can omit a previously authorized row. |
| Absent, unrecognized or combined header | Remove counterpart audio and release its player. A fresh authorized read can restore only media it supplies. Recovery on an incremental page schedules a bounded read. |
| `RESTRICTED` or owned `409 USER_PAIR_BLOCKED` | Retire counterpart audio for the owned session, including during page draining and parallel exit reads. Later headers and mutation responses cannot reverse the restriction. |
| Transport failure | Keep the existing error and recovery behavior. A failure carries no new access decision. |

The timeline retains sender order for HEART eligibility and cursor progression. An inaccessible audio row has no playable source. Removing its player invalidates play and renewal callbacks. The remaining keyed players, text, quotes, reactions and draft stay under the existing chat lifecycle rules.

Local regression evidence includes both chat sessions, real response headers, authenticated request cancellation, StrictMode player cleanup and synthetic MP4 playback in desktop Chromium at 390 and 1280 CSS pixels. An issued signed URL remains a bearer capability outside the application until expiry. Hosted CORS, HTTP caches, R2 policies and real-device playback require independent validation.

## 8. Dependency vulnerability scanning

- Priority: P1.
- Status: Recurring scanning implemented. Upstream remediation remains open.
- The `7d933ae` / PR #65 baseline was reproduced on 2026-11-26. Production and full scans each counted four high-severity package entries from two underlying advisories. Including development dependencies added zero findings.
- The production tree contains `firebase@13.2.0` → `@firebase/firestore@4.19.1` → `@grpc/grpc-js@1.9.16`, also via `@firebase/firestore-compat@0.4.17`. The four entries include inherited findings. The static Web app imports modular Auth and App Check and has no identified Node gRPC server execution path.
- High, CVE-2026-101916. Certain server configurations can treat unauthorized client certificates as authorized. [GHSA-m9gg-hp2v-232j](https://github.com/advisories/GHSA-m9gg-hp2v-232j)
- Low, CVE-2026-101915. A server can disclose handler error details to clients. [GHSA-f596-whhp-79r4](https://github.com/advisories/GHSA-f596-whhp-79r4)
- Both affect versions below 1.13.6 and 1.14.0 through 1.14.4. Current registry release Firebase 13.4.0 brings Firestore 4.20.0, which still requires `~1.9.0`. npm proposes Firebase 9.14.0. Keep the reviewed lockfile pending a supported release that admits a patched gRPC version. Direct dependencies are in use, including the public Firebase SDK entry points.
- Reachability evidence: The source imports Firebase App, Auth and App Check. Source maps across all emitted DEV and PROD JavaScript chunks show Auth and App Check and contain no Firestore or gRPC modules. The Pages app serves static assets. Both advisories concern Node server behavior.
- The [audit runner](../tools/dependency-audit.mjs) reports every npm package finding and fails on unexcepted moderate or higher production findings and high or critical findings in the full tree. Registry or scanner failure returns exit 2. A blocked finding returns exit 1. CodeQL continues to scan source and Actions independently.
- The two advisory URLs, severities, affected lockfile nodes and exact versions qualify for the exception through 2027-02-25 UTC. Only inherited entries whose entire reported cause chain qualifies can inherit that exception. Web maintainers should reassess on any Firebase or dependency-tree change, any Firestore or Node server adoption, or by 2027-02-26. When a compatible patched release ships, update the lockfile, remove the exception, rerun both scans and verify Auth, persistence, App Check and token refresh.
- Dependabot version updates were considered. Scan-first keeps the maintenance change small while the blocker is an upstream pin. A later weekly npm configuration targeting `development` can propose updates through the existing review flow. Repository alert settings remain unverified.

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
- Status: Application-controlled storage reviewed. Real browser restart and provider checks remain release verification.
- Calendar stores a bounded opened flag keyed by date, account and connection, with a bounded in-memory fallback. Notifications store switches, seen IDs and presentation metadata under the account ID. These flags intentionally survive reload; they contain no message text or signed media URLs. Calendar and notification tests cover account isolation.
- The app has no custom sessionStorage, IndexedDB, Cache Storage or service worker. Firebase owns authentication and App Check persistence. The email remember-me choice, Google session default and legacy restoration remain supported.
- Private snapshots live under session and tab ownership. Ownership transfer, sign-out and account replacement retire the mounted session and abort its work. Chat teardown releases playback and recorder tracks and revokes preview blob URLs. Existing same-owner resume behavior preserves mounted content and drafts.
- Low-severity defense in depth in `src/auth/api.ts`: some authenticated endpoints, such as profile photo metadata, previously used the browser's default HTTP cache mode. The transport now requests `no-store` for authenticated API traffic so account data and signed URLs bypass cache even if response directives are absent. The backend already applies cache protections. No hosted cross-account cache disclosure was observed or reproduced.

| Request path | Reviewed invariant |
| --- | --- |
| Initial, resume, concurrent reads and mutations | Each request retains its signal, bearer and App Check ownership. Changing cache mode adds no response installer, refresh trigger, retry or state reset. |
| Token refresh | The one allowed retry acquires current tokens and applies the same cache policy. Multipart bodies, admin redirect rules and history access metadata follow existing paths. |
| Sign-out, identity or tab replacement | The controller and tab gate still abort old requests and reject obsolete results. Consecutive identities fetching the same private route bypass the shared browser HTTP cache. |
| Legal open, retry and close | Both sinks require the same validated destination. Loading and retry retain cancellation under the dialog owner. Only a successfully rendered document enables its explicit action. |

## 11. Security regression and E2E tests

- Priority: P1.
- Status: PARTIAL.
- Current evidence: Vitest/RTL authentication/API/race tests and new persistence regressions exist. No real-provider browser E2E suite or DAST stage was found in reviewed Web CI.
- CodeQL Advanced is active. The default setup API returned `not-configured`, and both Actions and JavaScript/TypeScript jobs passed for the audited `development` commit. The checked-in configuration excludes root `tools/**` from CodeQL analysis, and the Web validation suite still tests those tools. CodeQL is static analysis, separate from dependency scanning and browser validation. [Successful CodeQL run](https://github.com/Gtestino92/reals-web/actions/runs/45115596187)
- Risk: Potential security regressions that mocked SDK, jsdom and build checks cannot detect.
- Recommended mitigation: Add isolated browser E2E for auth persistence, popup timing, cross-tab logout, URL handling and private caching; consider scoped DAST with synthetic identities.
- Deployment dependency: Disposable Firebase/test environment, approved accounts and CI browser setup.
- Acceptance criteria: Repeatable Chrome desktop/Android coverage where supported; no real-user data mutations or secret artifacts; confirmed issues get focused regression tests.

### Visual block-denial hardening (2026-11-25)

Source baseline: fetched `origin/development` at `8abd435`, following reviewed
`3428218` (intervening photo-text change). Both visual and scheduling denial
regressions failed before the classifier change and passed afterwards.
Owned HTTP 409 `USER_PAIR_BLOCKED` now retires the loaded profile, photo tree
and personal message. Scheduling disables retry/resume restoration for the
mounted retired profile. Visual review preserves its existing terminal outcome.

| Path / invariant | Review |
| --- | --- |
| Profile refresh | Only current request/context may install; denial clears the snapshot. |
| Visual personal-message read/write | Shared denial classifier ends the visual session; mutation and background read are serialized. |
| Scheduling message read | Denial propagates to the same retirement path; superseded reads are aborted. |
| Images / retries | Unmount discards retained request state. Callback state updates compare request identity. Successful same-session signature renewal remains pinned without another image request. |
| Account / sign-out | App ready tree is keyed by account/profile; visual disposal clears profile/message and aborts requests. Existing session/ownership tests remain the evidence for tab transfer. |

Bounded source audit: visual profile/message API GETs use `cache: no-store`.
Image elements rely on object response headers; application retirement is not
HTTP cache eviction. `photoIdentity`, `ProfileImage`, `PublicProfileView` and
own-profile `PhotoSlot` keep their existing signature-insensitive identity and
loaded-request retention. No media URL persistence was found in application
localStorage writes (calendar markers and activity metadata). Firebase owns its
auth persistence. No application IndexedDB, Cache Storage or Service Worker
usage was found by source search. This does not inventory SDK or hosted storage.
AudioComposer revokes its preview object URL on replacement/cleanup.

Synthetic Chromium navigation observed stable image/profile DOM and scroll on
tab return and token notification. The command failed cleaning up a locked
Chromium temporary profile; this is partial evidence, not a passing browser run.
No hosted objects or credentials were accessed. A dedicated HTTP-cache/storage
browser audit, denial concurrency browser scenarios and hosted validation remain
outstanding. The reported R2 `no-store` header applies to new objects; it neither
retroactively removes old cached bytes nor revokes issued signed URLs.
Android Coil account isolation remains deferred until before public production.

Validation commands: `npm run test:focused -- src/visual/VisualReview.test.tsx
src/scheduling/Scheduling.test.tsx` (83 passed); `npm run typecheck` (passed);
`npm run check:architecture` (105 modules, zero cycles); `npm run build` with
CI synthetic environment and explicit `VITE_REALS_ENVIRONMENT=dev`, then `prod`
(both passed, chunk-size warning). Unconfigured builds correctly failed.
`npm test -- --reporter=dot` had 2099 passes and two onboarding timeouts;
a two-worker rerun was requested. `node tools/visual-navigation-browser.mjs`
had the cleanup failure described above.
The full rerun `npm test -- --reporter=dot --maxWorkers=2` passed all
2103 tests in 83 files (186.84 seconds), including own-profile, session and tab
ownership regressions. The focused follow-up below completes deferred block-denial races and
scheduling personal-message denial coverage.


### Focused visual-access follow-up (2026-11-25)

Based on `61a3fb1`, verified against the remote task branch. Immediate withdrawal
is distinct from irreversible retirement: PartnerProfile clears content for all
classified denials, but only owned HTTP 409 USER_PAIR_BLOCKED disables retry and
resume for that interaction owner. HTTP 401/403/404 recovery requires a fresh
successful profile response. Authentication/session invalidation is unchanged.
The VISUAL_CONTENT_NOT_AVAILABLE regression is retained alongside the block case.

Confirmed enclosing-owner gap: SchedulingSession previously treated pair block
as a generic failure and could leave a mounted gallery visible. An owned block
from reads, mutations or mutation recovery now sets its existing terminal state;
the existing Scheduling terminal branch unmounts the gallery and aborts its read.
Further refresh/poll operations cannot restore that blocked owner. No polling
interval, image identity, same-session retention or transient-error policy changed.

| Installation / mutation path | Invariant and focused evidence |
| --- | --- |
| Scheduling profile / personal-message GET | Deferred message block removes already-installed images; obsolete profile success after a newer denial is ignored and its signal is aborted. |
| Visual profile / message mutation | A message mutation preempts a background profile request; block ends the session; late successful profile response cannot restore images. |
| Retired image / retry / resume | Detached image load/error events do not restore DOM; retry controls disappear and visibility/online events issue no new requests after block retirement. |
| Recoverable authorization denial | 401/403/404 remove images immediately; retry remains empty while a deferred fresh read is pending and restores only on success. |
| Enclosing scheduling owner | Read denial unmounts gallery; mutation and recovery-read denial remain terminal; refresh/poll/mutation attempts issue no subsequent requests. |

Validation: `npm run test:focused -- src/scheduling/PartnerProfile.test.tsx
src/scheduling/Scheduling.test.tsx src/scheduling/SchedulingSession.test.ts
src/visual/VisualReview.test.tsx` passed 151 tests in four files. `npm run
typecheck` passed; `npm run check:architecture` reported 105 production modules
and zero runtime cycles. These are synthetic Vitest/RTL tests, not hosted browser
validation. Full-suite validation is left to PR CI for this follow-up. The
comprehensive HTTP cache/storage browser audit, hosted checks and Android Coil
account-isolation release gate remain as documented above. No tooling changes,
credentials, backend contracts, deployment or media TTL changes are included.
