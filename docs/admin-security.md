# Admin backoffice security

Production readiness: **BLOCKED** until backend MFA and real integration tests are completed. The agreed production design requires Google Sign-In eligibility plus a separate backend-verified TOTP challenge and short-lived, revocable administrative authorization. Cloudflare Access is optional defense in depth. No MFA frontend, backend contract or deployment changes are included here.

## Authentication and authorization

`/admin` is a lazy route inside the existing Firebase/SessionController ready session. The first administrative call is `GET /api/admin/diagnostics/matchmaking`; only a valid HTTP 200 diagnostics DTO grants UI access. No email, UID, storage flag or hidden link grants privileges. Ordinary accounts receive neutral denial. Every endpoint remains protected by Spring Security `ROLE_ADMIN`, even with modified client code.

Backend `FirebaseTokenFilter` requires an active backend account, verified Firebase email in its configured admin allowlist, and matching Firebase UID. See the owning [API contract](../../reals-backend/docs/commons/api.md) and [filter](../../reals-backend/src/main/kotlin/com/reals/backend/config/security/authentication/FirebaseTokenFilter.kt). Backend checkout inspected on `development`; neither backend nor Android was modified.

### Agreed production architecture (pending implementation)

Reuse existing Firebase authentication. Spring Boot must enforce administrative eligibility using verified email and an explicitly authorized Firebase UID, with **Google Sign-In required for administrative eligibility**. Firebase authentication or email eligibility alone must not establish effective administrative access.

An eligible identity must additionally complete a **separate TOTP challenge verified by the backend**. Successful verification must establish **short-lived, revocable administrative authorization**, checked by the backend on protected administrative reads and writes. Expiry or revocation must remove effective access even while the ordinary Firebase session remains valid. No client-side flag, Google provider check, hidden route or locally validated TOTP can replace these backend checks. Cloudflare Access, if deployed, does not replace backend TOTP.

The backend MFA contract is still being designed. Endpoint names, challenge/enrollment/recovery flows, authorization lifetime, credential transport/storage and revocation semantics are intentionally unspecified here. The current client implements only the existing protected-GET authorization check; it does **not** implement or establish Google-only eligibility, TOTP verification or the future administrative authorization lifecycle. Implement the MFA frontend only after the authoritative backend contract exists. Existing Firebase/session and backend role restrictions remain unchanged in the meantime.

Admin calls use `SessionController.request`, its identity generations and tab ownership checks. General ready-only restrictions are retained. Admin HTTP responses must be 200; requests disable token replay, use `cache: no-store`, `redirect: error` and omit cookies. INVALID_TOKEN retires the operational session rather than automatically reentering the panel. Other 401/403 responses retire admin access and clear private state. Access redirects/HTML cannot become admin authorization. Recovery is explicit; no automatic mutation retries occur.

## External deployment requirements (pending)

1. Preserve Spring Security `ROLE_ADMIN` for every `/api/admin/**` endpoint.
2. Configure verified-email and authorized-Firebase-UID eligibility in Spring Boot outside this repository, requiring Google Sign-In for administrators.
3. Implement backend-verified TOTP and short-lived, revocable administrative authorization. Verify enforcement on every protected admin request before production use.
4. Optionally deploy Cloudflare Access as an additional identity/device/edge control. Fixed-public-IP or trusted-device restrictions, if used, belong at the edge, never in React. Cloudflare Access is not a production prerequisite and cannot substitute for backend MFA.
5. Enforce backend authorization for **all `/api/admin/**`** routes. If Access is deployed, cover **both `/admin` and `/api/admin/**`**. Configure the frontend host to serve the app for direct `/admin` navigation and refresh.
6. If an edge policy is deployed, prevent direct-origin bypass, including alternate hostnames and API origins, and verify it externally. Backend MFA must remain enforced regardless of request path through the edge.
7. Never rely on client-side email checks, the absence of a public admin link, or a hidden route.
8. Keep secrets, allowlists, credentials and allowed IP addresses out of this repository and all public `VITE_*` values.
9. Verify backend administrative authorization expiry/revocation returns the contract's authenticated API denial and immediately prevents administrative data access. If optional Access is deployed, also verify Access expiry: usable 401/403, not a login page reported as successful JSON. Redirects fail closed in this client. Access login must happen through an intentional top-level flow, followed by manual verification/reload. The existing API transport uses `credentials: omit`; an optional Access deployment must verify compatible gateway/cookie handling. This conditional integration requirement does not make Access mandatory. No service token belongs in React.
10. Complete real integration tests with eligible Google administrators and ordinary-user accounts: missing/expired/revoked Firebase credentials, UID not authorized or mismatched, unverified email, non-Google sign-in, absent/invalid TOTP, administrative authorization expiry and revocation, and backend role revocation. Verify no effective admin access before MFA and no access after expiry/revocation. Verify ordinary users cannot retrieve admin API data directly. Test optional Access expiry and direct-origin bypass only where that policy is deployed.

**App Check integration blocker:** the current shared Web API client sends a Firebase ID token but has no App Check token provider. When backend App Check enforcement is enabled, requests require `X-Firebase-AppCheck` using supported Web attestation. Implement and verify that shared integration separately; do not disable App Check or bypass backend filters for the admin panel. Stable missing/invalid attestation errors deny access; verification-unavailable remains an actionable manual recovery error. See the security headers in the owning API contract. No backend relaxation is authorized here.

## Privacy and media

Admin responses and drafts live only in an owned in-memory store. No localStorage, sessionStorage, IndexedDB, persistent application cache, telemetry or report URLs in history are introduced. Route exit, logout, identity replacement, ownership revocation and page disposal abort requests and discard state. Browser history retains only `/admin`, never selected IDs or evidence. Signed media fields accept HTTPS (loopback HTTP only in development); embedded URLs in report text are never links. React renders all content as text.

Photo previews use no-referrer images; thumbnails are lazy. Audio is created only after explicit activation, with `preload=none`, and is released on background/unmount. The admin mount installs a no-referrer document policy for media requests and removes it on disposal. Audio errors require manual report refresh to renew links. Backend/media/CDN must independently deliver private `Cache-Control: no-store`, correct MIME types and suitable cross-origin policy, and exclude signed URLs/evidence from access logs and telemetry. Browser/OS caches and devtools are not controlled by application memory cleanup. Verify actual CDN responses before release.

## Invariants and response installation review

| Path | Invariant and reconciliation |
| --- | --- |
| Authorization | Only validated diagnostics HTTP 200 permits lists; 401/403 clears all admin data. No background polling. |
| List/detail GET | One generation owns each read; previous requests abort. Malformed data fails closed. Out-of-order results cannot install. Filters and selection remain in memory. |
| Appeal source report | Atomically replace appeal rows/selection with an in-memory report context. Only the selected appeal's exact source link can open it while authorized, idle and unblocked. Load and refresh only that authoritative report detail, validating its ID; no reports-list GET or appeal items under Reports. The return-to-Appeals button cancels the detail generation and reloads pending appeals. Errors retain a retryable context without stale actionable detail; 401/403/disposal clears it. |
| Confirmation/write | Synchronous store lock plus confirmation claim exclude duplicate writes. UI validates PlainText and lengths; temporary duration is a positive safe integer. Exact selected photoVersion is sent. Backend-confirmed PENDING detail is required for report decisions. |
| Success | Validate/install confirmed response; reconcile via GET. Appeal public DTO is parsed independently of queue items. Confirmed success survives later refresh failure. No optimistic decisions or other-user session changes. |
| Conflict/uncertain write | Clear actionable detail and block decisions until a successful authoritative GET. Never replay POST. Photo conflicts refresh queue; appeals use pending list, never an invented appeal-detail endpoint. Contextual source-report decisions refresh the same report detail, preserving context and blocking further decisions until reconciliation. |
| Failed reconciliation | Keep explicit confirmed/uncertain notice and block decisions. Manual refresh can recover. Switching sections loads authoritative data before decisions become available. |
| Disposal/identity/tab | Session and admin abort/generation ownership reject late responses, even when synthetic fetch ignores cancellation. Old write finalizers cannot release a newer generation's lock. Page restore reauthorizes. Cleanup invents no business transition. |

## Pagination and scope

Photos: backend returns at most 100 pending entries, oldest first. Local pages show 20 of that capped response; nothing beyond 100 is fetched. Reports: full-list retrieval and backend in-memory filtering remain authoritative. Local pagination reduces neither network nor database work. No page/size/offset/cursor parameters are invented. True server pagination is future backend work. Appeals also use local 20-item pages. Diagnostics is read-only, manually refreshed, without graphs or polling.

No manual report creation, user/role management, suspended-user appeal UI, deployment resources, backend or Android changes are included.

## Validation and remaining verification

Focused behavior tests: `npm run test:focused -- src/admin/Admin.test.tsx src/admin/store.test.ts src/App.test.tsx src/App.ownership.test.tsx src/auth/api.test.ts` (141 passing). Covers authorization denial, exact version and stale conflicts, every report decision, temporary/permanent validation, appeals public DTO, duplicate writes, uncertain reconciliation, confirmed-write refresh failure, text evidence, pagination, identity replacement, pending-read logout/Back and ownership loss. Admin transport tests verify no cache/redirects/token write replay. Storage assertions plus source review verify no persistent admin writes.

Native Chromium smoke: start `npm run dev -- --host 127.0.0.1 --port 5175`, then `node tools/admin-smoke.mjs`. Synthetic identities and responses exercise mobile 390×844 and desktop 1440×900, direct route, pagination, confirmation focus/Escape, exact-version write, authoritative refresh, report text, identity replacement, ordinary-user denial, storage and horizontal overflow. Captures/results are ignored under `artifacts/admin/`.

Real Firebase/Google eligibility, backend transactions/role enforcement, backend TOTP, administrative authorization expiry/revocation, live signed photo/audio, CDN/referrer/cache behavior, optional Cloudflare policy/expiry and origin protection, bfcache across real authenticated origins, assistive technology and physical devices remain unverified. Chromium emulation is not device verification. Production stays **BLOCKED** until the backend MFA implementation and real integration tests are completed, alongside applicable App Check/media security requirements. Optional Cloudflare Access is not a mandatory release gate.

Initial backoffice regression: `npm test` PASS 993 tests / 43 files; `npm run typecheck` PASS; `npm run build` PASS; `git diff --check` PASS. Initial Admin bundle was lazy (16.76 kB minified / 5.64 kB gzip); existing main bundle size warning remains. Backend reference SHA: `5ed46b3abf65950b9744505d5dc254d1eecaf574`.

Source-report correction validation: `npm run test:focused -- src/admin/Admin.test.tsx src/admin/store.test.ts` PASS 40 tests; `npm test` PASS 1003 tests / 43 files; `npm run typecheck`, `npm run build` and `git diff --check` PASS. Regression cases cover atomic context/list cleanup, detail-only refresh, cancellation/late responses on return, 401/403, network/404/mismatched detail, mutation exclusion and confirmed/uncertain decision reconciliation. `node tools/admin-smoke.mjs` PASS at 390x844 and 1440x900 (24 explicit checks plus awaited scenarios), including no appeal rows/filters/pagination in the source context, detail-only fetch/refresh and safe return to Appeals. Mobile context capture inspected. No MFA behavior is implemented or verified by these synthetic tests.
