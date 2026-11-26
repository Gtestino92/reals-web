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

## iPhone Safari session investigation

The report did not establish the iOS version, sign-in provider, remember
selection, suspension duration, document recreation or which screen appeared.
The original lock/unlock report remains unconfirmed. A separate BFCache defect
was reproduced: the returning owner used the takeover handshake and displaced
the tab that acquired the lock during its absence. The focused regression
observed the old tab become active on the base. The correction uses one
exclusive Web Locks vacancy check on persisted return. Current owners and
queued contenders keep their priority. See the [ownership review](single-active-tab.md#invariants-and-mutation-review).

| Path | Evidence and behavior |
| --- | --- |
| SDK startup and restoration | Installed `firebase@13.2.0`, `@firebase/auth@1.13.9` and `@firebase/app-check@0.13.1` inspected. Auth scans session then local storage for a user and keeps the selected Web Storage implementation. The initial observer waits for initialization. SDK integration tests restore both persistence types and retain the same Auth instance and identity across wrapper creation. |
| Policy and anonymous preparation | Google and email without **Mantener sesión iniciada** use session persistence. Email opt-in uses local persistence. The checkbox defaults off. The Firebase adapter prepares session persistence after an anonymous notification before exposing Google sign-in. Observer revisions, subscription epochs and the captured grant reject obsolete completions. An observer error is recoverable. An SDK initialization error before any identity is known may require reloading the page to run SDK initialization again. |
| Cold remount and background return | A visibility round trip leaves ownership, the observer and the existing Home DOM in place. An ownership interruption retires the in-memory controller, then confirmed reacquisition mounts a fresh controller and bootstraps from the SDK identity. Explicit logout followed by remount stays signed out. |
| Expiration, network and App Check | The SDK refreshes an expired ID token on demand. In the real SDK with synthetic HTTP, a network error while restoring an expired stored session retained the identity, renewal succeeded on a later request and terminal renewal rejection removed the identity and storage. Transient backend and App Check failures enter recoverable bootstrap with explicit retry. App Check rejection does not enter the Firebase `INVALID_TOKEN` retry path. |
| Security and pending work | `pagehide` and transfer abort the old grant synchronously. The old controller, observer epochs and request generations cannot install results. Firebase revocation, explicit sign-out and backend account/profile restrictions remain authoritative. Administrative grants are cleared with the old controller and require existing authorization on reentry. The browser fixture verified locally aborted admission recovered from reads without replay. |
| Page lifecycle and storage loss | `pagehide` delivery is unreliable on mobile. Healthy same-document visibility return has no takeover listener. BFCache return and document recreation use different paths. When Safari destroys the tab's storage session, Firebase session persistence can legitimately restore no user. Installed Reals has its own storage context. |

Sources: [Firebase persistence](https://firebase.google.com/docs/auth/web/auth-state-persistence),
[MDN pageshow](https://developer.mozilla.org/en-US/docs/Web/API/Window/pageshow_event),
[MDN pagehide](https://developer.mozilla.org/en-US/docs/Web/API/Window/pagehide_event),
[WebKit web app storage](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/#web-apps).

### Validation

- Baseline reproduction before the fix: `npm run test:focused -- src/tabs/TabOwnershipManager.test.tsx -t 'leaves the current owner'` failed as expected because the old owner became active.
- `npm run test:focused -- src/App.test.tsx src/App.ownership.test.tsx src/auth/firebase.test.ts src/auth/persistence-sdk.test.ts src/auth/LoginScreen.test.tsx src/auth/api.test.ts src/auth/appCheck.test.ts src/tabs/TabOwnershipManager.test.tsx --maxWorkers=2` passed 254 tests.
- `npm run test:focused -- src/admin/lifecycle.test.tsx --maxWorkers=1` passed 11 tests.
- `node tools/tab-ownership-browser.mjs` passed real Chromium Back with a verified BFCache hit and vacant-lock reacquisition. Synthetic persisted events exercised both vacant and occupied locks with real Web Locks and BroadcastChannel. The five two-tab screen combinations, reload, explicit transfer, focus, close and pending queue admission passed using synthetic identity and backend responses. Exactly one intentional queue POST and zero replay or cancellation writes.
- `npm run typecheck` and `npm run check:architecture` passed.

### Physical iPhone reproduction

1. Record iOS/Safari version, provider, email remember choice, number of Reals
   tabs and whether the app is in regular Safari or launched from Home Screen.
   Use a test account on an authorized HTTPS test origin.
2. From ordinary Home, lock and unlock briefly with the same tab open. Repeat
   after a longer interval spanning token renewal, and repeat while offline
   before reconnecting. Record whether Home stays up, Reals shows the ownership
   gate, recovery offers a retry or the login form appears.
3. Compare actual navigation away and Back with Safari termination or forced
   tab recreation. In Web Inspector, record a changed document time origin,
   lifecycle event names and `persisted` flags, observer outcome
   (present, absent or error) and allowlisted HTTP error categories only.
   Repeat with email remember off/on and Google. Never collect identifying
   payloads, storage contents or authentication headers.
4. With two tabs, verify visibility alone leaves the blocked tab blocked and
   Back to a cached tab with a current owner leaves it blocked. Close the
   other tab and use **Usar Reals acá**. Confirm explicit sign-out followed by
   resume returns to Login. Verify Share → **Agregar a Inicio** separately,
   then launch the icon and confirm the notice is absent in standalone.

Remaining hypotheses include Safari process or storage-session termination,
SDK storage initialization failure, a competing owner, attestation/network
failure or genuine Firebase/backend rejection. Device evidence is needed to
distinguish these. Neither synthetic lifecycle events, Chromium BFCache nor
the jsdom SDK tests emulate physical Safari suspension or live credentials.
