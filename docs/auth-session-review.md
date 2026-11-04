# Stage B session review (before implementation)

| Invariant | Mutation / response paths | Guard |
| --- | --- | --- |
| Firebase identity is distinct from backend readiness | Initial auth observer, restoration, email/register/Google completion, retry | Only bootstrap installs ready; active user and validated profile required |
| One bootstrap per identity/generation | Auth observer and operation completion, StrictMode restart | Synchronous operation lock, identity deduplication; deferred observer bootstrap checks generation |
| Old work cannot restore UI | Sign-out, user replacement, unsubscribe/unmount, HTTP/token completion | AbortController plus generation checks before every installation and next mutation |
| Account authority stays on backend | GET me, conditional provision, profile, local verification | Provision only on Android missing-user cases; unknown/malformed states fail closed |
| Errors release pending and preserve ownership | All auth/reset/bootstrap/sign-out success and failure paths | Atomic snapshot updates, safe Spanish errors; transient errors preserve Firebase identity |
| No blind mutation retries | Provision, reset, local verification | Only INVALID_TOKEN/401 retries once with refreshed token; reset never retries |
| Persistence belongs to Firebase | Startup, sign-in, sign-out, other-tab auth observer | SDK local persistence; no manual credentials/token storage |
| Reset cooldown is advisory | 202 success, deadline, resume | Existing absolute-deadline presentation; only successful reset sets 60s |

No new business transitions occur on cleanup/background. Auth observer owns session replacement; subscriber cleanup owns listener/fetch cancellation. Browser resume uses SDK auth restoration and explicit bootstrap retry; timers never determine account status. Sign-up suppresses observer bootstrap until verification-email work finishes. Verification failures remain recoverable and retryable.

Final review: auth observer callbacks also check their subscription epoch. Identity replacement during bootstrap aborts the old request; external sign-out during authentication invalidates its completion. Repeated observer events/StrictMode provisioning, failed sign-out retry and unmount cancellation are regression-tested. Known account/auth errors override missing-resource status handling, including inconsistent 404s. Validation: 101 tests pass; typecheck/build/diff checks pass. No real Firebase configuration was available for smoke validation.
