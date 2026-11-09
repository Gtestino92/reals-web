# Admin backoffice security

Production readiness: **BLOCKED**. Cloudflare Access and origin protection have not been configured or verified by this implementation. No deployment changes are included.

## Authentication and authorization

`/admin` is a lazy route inside the existing Firebase/SessionController ready session. The first administrative call is `GET /api/admin/diagnostics/matchmaking`; only a valid HTTP 200 diagnostics DTO grants UI access. No email, UID, storage flag or hidden link grants privileges. Ordinary accounts receive neutral denial. Every endpoint remains protected by Spring Security `ROLE_ADMIN`, even with modified client code.

Backend `FirebaseTokenFilter` requires an active backend account, verified Firebase email in its configured admin allowlist, and matching Firebase UID. See the owning [API contract](../../reals-backend/docs/commons/api.md) and [filter](../../reals-backend/src/main/kotlin/com/reals/backend/config/security/authentication/FirebaseTokenFilter.kt). Backend checkout inspected on `development`; neither backend nor Android was modified.

Admin calls use `SessionController.request`, its identity generations and tab ownership checks. General ready-only restrictions are retained. Admin HTTP responses must be 200; requests disable token replay, use `cache: no-store`, `redirect: error` and omit cookies. INVALID_TOKEN retires the operational session rather than automatically reentering the panel. Other 401/403 responses retire admin access and clear private state. Access redirects/HTML cannot become admin authorization. Recovery is explicit; no automatic mutation retries occur.

## External deployment requirements (pending)

1. Preserve Spring Security `ROLE_ADMIN` for every `/api/admin/**` endpoint.
2. Configure Firebase verified identity and the backend allowlist outside this repository.
3. Configure an additional Cloudflare Access admin identity policy, preferably requiring MFA.
4. Consider a fixed public IP or trusted-device restriction at the edge, never in React.
5. Protect **both `/admin` and `/api/admin/**`**. Configure the frontend host to serve the app for direct `/admin` navigation and refresh.
6. Prevent direct-origin access that bypasses Cloudflare, including alternate hostnames and API origins. Verify it externally.
7. Never rely on client-side email checks, the absence of a public admin link, or a hidden route.
8. Keep secrets, allowlists, credentials and allowed IP addresses out of this repository and all public `VITE_*` values.
9. Verify expired Access sessions preserve authenticated API semantics: return a usable 401/403, not a login page reported as successful JSON. Redirects fail closed in this client. Access login must happen through an intentional top-level flow, followed by manual verification/reload. Check actual same-origin Access cookie handling: the existing API transport uses `credentials: omit`; deployment must provide a compatible authenticated gateway design before release. No service token belongs in React.
10. Test with real admin and ordinary-user accounts, missing/expired/revoked Firebase credentials, UID mismatch, unverified email, Access expiry, direct-origin attempts and backend role revocation. Verify the ordinary account cannot retrieve admin API data directly.

**App Check integration blocker:** the current shared Web API client sends a Firebase ID token but has no App Check token provider. When backend App Check enforcement is enabled, requests require `X-Firebase-AppCheck` using supported Web attestation. Implement and verify that shared integration separately; do not disable App Check or bypass backend filters for the admin panel. Stable missing/invalid attestation errors deny access; verification-unavailable remains an actionable manual recovery error. See the security headers in the owning API contract. No backend relaxation is authorized here.

## Privacy and media

Admin responses and drafts live only in an owned in-memory store. No localStorage, sessionStorage, IndexedDB, persistent application cache, telemetry or report URLs in history are introduced. Route exit, logout, identity replacement, ownership revocation and page disposal abort requests and discard state. Browser history retains only `/admin`, never selected IDs or evidence. Signed media fields accept HTTPS (loopback HTTP only in development); embedded URLs in report text are never links. React renders all content as text.

Photo previews use no-referrer images; thumbnails are lazy. Audio is created only after explicit activation, with `preload=none`, and is released on background/unmount. The admin mount installs a no-referrer document policy for media requests and removes it on disposal. Audio errors require manual report refresh to renew links. Backend/media/CDN must independently deliver private `Cache-Control: no-store`, correct MIME types and suitable cross-origin policy, and exclude signed URLs/evidence from access logs and telemetry. Browser/OS caches and devtools are not controlled by application memory cleanup. Verify actual CDN responses before release.

## Invariants and response installation review

| Path | Invariant and reconciliation |
| --- | --- |
| Authorization | Only validated diagnostics HTTP 200 permits lists; 401/403 clears all admin data. No background polling. |
| List/detail GET | One generation owns each read; previous requests abort. Malformed data fails closed. Out-of-order results cannot install. Filters and selection remain in memory. |
| Confirmation/write | Synchronous store lock plus confirmation claim exclude duplicate writes. UI validates PlainText and lengths; temporary duration is a positive safe integer. Exact selected photoVersion is sent. Backend-confirmed PENDING detail is required for report decisions. |
| Success | Validate/install confirmed response; reconcile via GET. Appeal public DTO is parsed independently of queue items. Confirmed success survives later refresh failure. No optimistic decisions or other-user session changes. |
| Conflict/uncertain write | Clear actionable detail and block decisions until a successful authoritative queue GET. Never replay POST. Photo conflicts refresh queue; appeals use pending list, never an invented detail endpoint. |
| Failed reconciliation | Keep explicit confirmed/uncertain notice and block decisions. Manual refresh can recover. Switching sections loads authoritative data before decisions become available. |
| Disposal/identity/tab | Session and admin abort/generation ownership reject late responses, even when synthetic fetch ignores cancellation. Old write finalizers cannot release a newer generation's lock. Page restore reauthorizes. Cleanup invents no business transition. |

## Pagination and scope

Photos: backend returns at most 100 pending entries, oldest first. Local pages show 20 of that capped response; nothing beyond 100 is fetched. Reports: full-list retrieval and backend in-memory filtering remain authoritative. Local pagination reduces neither network nor database work. No page/size/offset/cursor parameters are invented. True server pagination is future backend work. Appeals also use local 20-item pages. Diagnostics is read-only, manually refreshed, without graphs or polling.

No manual report creation, user/role management, suspended-user appeal UI, deployment resources, backend or Android changes are included.

## Validation and remaining verification

Focused behavior tests: `npm run test:focused -- src/admin/Admin.test.tsx src/admin/store.test.ts src/App.test.tsx src/App.ownership.test.tsx src/auth/api.test.ts` (141 passing). Covers authorization denial, exact version and stale conflicts, every report decision, temporary/permanent validation, appeals public DTO, duplicate writes, uncertain reconciliation, confirmed-write refresh failure, text evidence, pagination, identity replacement, pending-read logout/Back and ownership loss. Admin transport tests verify no cache/redirects/token write replay. Storage assertions plus source review verify no persistent admin writes.

Native Chromium smoke: start `npm run dev -- --host 127.0.0.1 --port 5175`, then `node tools/admin-smoke.mjs`. Synthetic identities and responses exercise mobile 390×844 and desktop 1440×900, direct route, pagination, confirmation focus/Escape, exact-version write, authoritative refresh, report text, identity replacement, ordinary-user denial, storage and horizontal overflow. Captures/results are ignored under `artifacts/admin/`.

Real Firebase, backend transactions/role enforcement, live signed photo/audio, CDN/referrer/cache behavior, Cloudflare policy/expiry, MFA, direct-origin protection, bfcache across real authenticated origins, assistive technology and physical devices remain unverified. Chromium emulation is not device verification. Production stays **BLOCKED** until external access controls and these integration requirements are configured and verified.

Final regression: `npm test` PASS 993 tests / 43 files; `npm run typecheck` PASS; `npm run build` PASS; `git diff --check` PASS. Admin bundle is lazy (16.76 kB minified / 5.64 kB gzip); existing main bundle size warning remains. Backend reference SHA: `5ed46b3abf65950b9744505d5dc254d1eecaf574`.
