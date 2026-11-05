# Stage B session review (before implementation)

| Invariant | Mutation / response paths | Guard |
| --- | --- | --- |
| Firebase identity is distinct from backend readiness | Initial auth observer, restoration, email/register/Google completion, retry | Only bootstrap installs ready; active user and validated profile required |
| One bootstrap per identity/generation | Auth observer and operation completion, StrictMode restart | Synchronous operation lock, identity deduplication; deferred observer bootstrap checks generation |
| Old work cannot restore UI | Sign-out, user replacement, unsubscribe/unmount, HTTP/token completion | AbortController plus generation checks before every installation and next mutation |
| Account authority stays on backend | GET me, conditional provision, profile, local verification | Provision only on Android missing-user cases; unknown/malformed states fail closed |
| Errors release pending and preserve ownership | All auth/reset/bootstrap/sign-out success and failure paths | Atomic snapshot updates, safe Spanish errors; transient errors preserve Firebase identity |
| No blind mutation retries | Provision, reset, local verification | Only INVALID_TOKEN/401 retries once with refreshed token; reset never retries |
| Persistence belongs to Firebase | Startup, sign-in, sign-out, other-tab auth observer | SDK session/local persistence selected before authentication; no manual credentials/token storage |
| Reset cooldown is advisory | 202 success, deadline, resume | Existing absolute-deadline presentation; only successful reset sets 60s |

No new business transitions occur on cleanup/background. Auth observer owns session replacement; subscriber cleanup owns listener/fetch cancellation. Browser resume uses SDK auth restoration and explicit bootstrap retry; timers never determine account status. Sign-up suppresses observer bootstrap until verification-email work finishes. Verification failures remain recoverable and retryable.

Final review: auth observer callbacks also check their subscription epoch. Identity replacement during bootstrap aborts the old request; external sign-out during authentication invalidates its completion. Repeated observer events/StrictMode provisioning, failed sign-out retry and unmount cancellation are regression-tested. Known account/auth errors override missing-resource status handling, including inconsistent 404s. Validation: 101 tests pass; typecheck/build/diff checks pass. No real Firebase configuration was available for smoke validation.

## Hardening #1 mutation review (before implementation)

| Invariant | Mutation / response paths | Guard |
| --- | --- | --- |
| Checkbox choice reaches Firebase | Login submit ? App ? authenticate ? email sign-in/signup | Pass a boolean unchanged; await SDK setPersistence before either credential operation |
| No persistence failure can authenticate using an old local setting | Initial anonymous observer, email persistence setup/failure, sign-out completion, Google click | Reject with safe error; never invoke credential operation on setup failure; Google requires prepared session persistence |
| Restored identities keep their persistence | SDK initialization and auth observer | Initialize with session then local SDK providers; do not call setPersistence for authenticated observer events |
| Google popup retains user activation | Anonymous observer prepares session; Google click invokes popup | Finish preparation before delivering anonymous login; no await in google() before signInWithPopup; checkbox applies only to email |
| Failed email login cannot leave Google using local persistence | Email/register failure after selecting local | Restore anonymous session persistence before returning error; if restoration fails, Google remains blocked until reload |
| Obsolete observer preparation cannot restore UI | New SDK event, unsubscribe/StrictMode | Active flag plus event revision; check again after async preparation; keep controller epoch/generation guards |
| Existing cancellation/locking remains authoritative | Auth completion, bootstrap, retry, sign-out, background/resume | Retain SessionController lock/abort/generation paths; no timers or new business state |

Browser storage and cross-tab synchronization belong to Firebase. Unit tests
cover delegation and observer ordering; real tab/browser-close behavior remains
a browser smoke check. See [session policy](local-development.md#authentication-persistence-policy).
