# Single active application tab

This is a Web-specific product requirement. Scope: one same-origin browser storage partition, across all identities and login/onboarding/application screens. It is cooperative client-side enforcement, **not server-enforced anti-fraud protection**. Other origins, profiles, private contexts, partitions and old/non-cooperating clients are outside this guarantee. Same-origin script can request release or bypass the application; messages are not an authentication boundary.

## Authority and state

`TabOwnershipManager` owns the exclusive Web Lock `reals:application:v1`. The lock name never includes a UID. Only entry into the browser's exclusive lock callback installs `active`; BroadcastChannel cannot grant ownership. A fresh random grant identifies each acquisition, lives only in document memory and is the only identifier sent over `reals:tab-transfer:v1`. Messages contain only `type` and optional `grant`, never credentials, tokens, identity, drafts or chat data. No storage mutex, lease expiry or lock stealing is used.

State transitions: initializing -> requesting-transfer -> active; active -> blocked on release/pagehide; blocked -> requesting-transfer only on button; acquisition/channel failure -> error; absent APIs/insecure context -> unsupported. React StrictMode cleanup stops the manager, aborts queued acquisition, closes the channel and releases owned resources; the next setup can start it again.

Startup queues a lock request before broadcasting `ask`. Current owners answer `owner(grant)`; queued requesters answer `release(grant)`. Only the owner of that exact grant honors release. Owners also announce each new grant, allowing already queued competitors to proceed even if their startup message preceded acquisition. Stale/duplicate releases cannot release a different grant. Web Locks serialize simultaneous contenders; intermediate contenders can acquire and then relinquish to another queued requester. Duplicate clicks do not queue duplicate requests. No focus/visibility listener requests takeover.

While queued, repeat discovery every 250ms to handle missed startup discovery; after 8 seconds cancel the queued request and present an actionable retry. These timers are coordination feedback, never domain truth. A suspended/frozen owner cannot be safely force-unlocked: close it or let it resume, then retry. Closing/crashing a document releases its native lock. Blocked tabs do not automatically claim a vacant lock; use the button. `pagehide` revokes and releases, and a persisted `pageshow` requests again only if that document had been active or requesting before pagehide. An already blocked BFCache document stays blocked.

## Invariants and mutation review

| Path | Invariant / invalidation | Completion / recovery |
| --- | --- | --- |
| Root rendering / lifecycle | Each operational mount creates its own Firebase service wrapper bound to the current manager; only SDK app/Auth instances are shared. OperationalApp mounts only during confirmed active ownership; pending, blocked and incompatible states expose no identity or chat UI. | New operational mount observes the document's existing Firebase session and bootstraps backend state; no old app model is reused. |
| Ownership loss | Mark blocked, abort the acquisition's signal, invalidate session observer/generation and abort requests synchronously **before** resolving the held lock promise. | React removes Home/Activity/Onboarding/Chat/Login; their timers, listeners, media and local read resources are disposed. Enforcement does not depend on React's cleanup timing. |
| API entry / token refresh / body parsing | Root binds ApiClient to ownership. Every request asserts active and captures the current grant's abort signal. Check abort before fetch/retry, after fetch and after both success/error body parsing. SessionController also checks ownership/generation and captures its original grant signal, so callbacks from an old controller stay invalid even after the document acquires another grant. | Late responses cannot install a session/profile or launch a follow-up request. Old signals stay aborted after reacquisition. |
| Login/signup/Google/password reset/sign-out/verification/password change | Session entry points reject inactive use. Firebase adapter checks the grant before operations, after persistence selection and between reauthentication/password update/token refresh steps. | SDK calls already started may settle and change the document's identity; stale results do not bootstrap or install UI. The next active observer uses actual Firebase state. |
| Pending backend write | Abort HTTP locally; do not infer that the server rolled back. No replay or compensating mutation is scheduled. | Reacquisition reads authoritative state. An accepted queue admission or message may exist despite the local AbortError. |
| Chat / matchmaking cleanup | Existing ChatSession.dispose and useHome cleanup abort resources, not domain operations. FirstChat timers become unable to send requests immediately on revocation. | No approval, rejection, exit, queue DELETE, penalty or sign-out is generated by transfer. Existing Home/FirstChat recovery decides where to navigate from backend reads. |
| Profile/session installation | Session generation and ownership guard profile and bootstrap installs; controller-local identity reference is cleared without Firebase sign-out. | A remounted controller observes its own session, never the former owner's credentials. |

The root is the production composition boundary. `OperationalApp` is exported for existing isolated session/feature tests; those tests intentionally omit coordination and are complemented by manager/gate and real two-page integration tests. Do not add production mounts that bypass App or unbound API clients. All current domain network calls go through SessionController/ApiClient; Firebase adapter is the other authentication entry point.

## Identity and compatibility

Firebase's session-first restoration and opt-in local persistence remain unchanged. Transfer never selects persistence, signs out, copies identities or moves credentials between tabs. Firebase's existing local-persistence synchronization still applies: local sessions are inherently shared by Firebase, while session storage can isolate identities per tab. This feature does not promise independent accounts under shared local persistence. SDK-internal token/session synchronization may continue while inactive; application backend requests and user authentication actions are gated.

HTTPS (or a trustworthy localhost origin), Web Locks, BroadcastChannel and the existing AbortSignal APIs are required. Unsupported contexts fail closed with an explanation; they never claim exclusivity. Construction, messaging and lock errors also fail closed and allow explicit retry. No localStorage or IndexedDB owner record can become stale. No backend contract changes.

Unsaved form/chat drafts and recorded media are discarded on operational unmount; they are not persisted, transferred or silently sent. Server chat inactivity/absolute timers continue normally while the user is away. Transfer is not a business transition and does not exempt server lifecycle policies.

## Validation and reproduction

Run `npx vitest run src/tabs/TabOwnershipManager.test.tsx` for deterministic coordination, StrictMode, BFCache events, timeout/error/compatibility, stale authentication/bootstrap, pending reads/writes and inactive request checks. Existing Firebase adapter and real Firebase SDK persistence suites cover session/local storage behavior with synthetic fixtures, without live accounts.

Run Vite with `npm run dev -- --host 127.0.0.1 --port 5174`, then `node tools/tab-ownership-browser.mjs`. The script launches installed Windows Chrome through CDP and creates pages in the **same default browser context**, using real Web Locks/BroadcastChannel and synthetic auth plus a local HTTP backend. It checks rendered operational/blocked UI, focus without takeover, explicit/rapid takeover, reload/close, inactive API rejection, stopped requests, and uncertain queue writes recovered from backend reads. It covers login/login, login/home, home/home, first-chat/home and onboarding/home with mobile (390px) and desktop (1280px) viewports and two synthetic per-document Firebase UIDs. It does not exercise live Firebase credentials. Fixture modules are developer tools, not production entry points or build inputs. Temporary screenshots are printed by the runner; no real personal data is used.

Manual: open two same-origin tabs, optionally with independently signed-in session-persistence test accounts. Verify new tab takes over, previous tab hides all account details, focus stays blocked, keyboard/Enter activates the single action, and return reboots the correct account. Repeat during bootstrap, polling, message upload and queue admission; reconcile before retrying uncertain writes. Close/reload the owner, background it, and test browser Back/BFCache and process termination. On unsupported/insecure origins expect a compatibility message and no operational UI. Test a deliberately frozen owner: pending feedback then recoverable error; close/resume it and explicitly retry. Real-device/mobile Safari/Firefox, physical keyboard/screen-reader and live different-account Firebase testing remain manual validation.

### Recorded checks (2026-11-07 Argentina)

- Base `origin/main` / initial HEAD: `298f131`; clean initial tree. Work branch: `feature/single-active-tab`, created with `--no-track`. No commit, push, PR, merge or deployment.
- `npm run typecheck`: passed.
- Final focused command: `npx vitest run src/tabs/TabOwnershipManager.test.tsx src/App.test.tsx src/auth/api.test.ts src/auth/firebase.test.ts src/auth/persistence-sdk.test.ts src/home/Home.test.tsx src/onboarding/Onboarding.test.tsx src/chat/ChatSession.test.ts`: 8 files, 346 tests passed. The final focused ownership/Firebase run passes 41 tests (including 16 ownership tests).
- `npm test`: intermittent failures in unchanged `CropDialog.test.tsx` preview-error assertions and `useHomeNavigation.test.tsx` history timing. Both files passed focused (59 tests including ownership). A complete `npm test -- --maxWorkers=1` run passed 754 tests before the final added regressions; a later serial run also hit a CropDialog cancellation timing failure. Latest serial result: 757 passed / 1 failed out of 758 (CropDialog cancellation resource test). Latest default-worker result: 756 passed / 1 failed out of 757 before the additional regression (useHomeNavigation blocked Back). These test timing failures remain unresolved. No unrelated test timing changes were made.
- `npm run build` and `git diff --check`: passed.
- `node tools/tab-ownership-browser.mjs`: same-context real Chromium run passed all five screen combinations and pending-write recovery, 190-191 HTTP requests across successful runs and exactly one intentional queue POST; zero transfer-generated writes/cancellations. Mobile Home and desktop blocked screenshots inspected. Synthetic identities only; no live Firebase accounts or production backend.

Remaining validation: real different-account Firebase sessions, real browser crash/freeze/BFCache eligibility (unit tests simulate lifecycle), screen readers and physical mobile devices. No Android/backend files changed. This browser-specific addition does not resolve the pre-existing Android visual/interaction gaps recorded in the parity matrix.

### Final review against main 298f131 (2026-11-08 Argentina)

Review started on `feature/single-active-tab` at `2d7d6dc` with a clean tree. No changes to Web Locks/BroadcastChannel, session revocation, captured grant signals or stale-controller protection were needed. The review fixes are intentionally limited to root Firebase composition and test synchronization.

The former module-level `defaultSetup` retained the first mount's manager. A same-document App unmount/remount with a fresh manager therefore restored a wrapper whose checkpoints still called the stopped authority. `App.ownership.test.tsx` reproduced the failure before the fix. OperationalApp now constructs its wrapper and SessionController together in the mount initializer. `getApps` reuses the Firebase app; installed Firebase `initializeAuth` returns the existing Auth instance for the same persistence/resolver dependencies. No mutable global ownership pointer can redirect old callbacks into a new grant. Existing session abort/generation rules still reject completions from old controllers. New tests remount the real App/gate under StrictMode for Google, email sign-in and registration; Google opens in the click stack, and email operations retain explicit remember selection. A real SDK regression in `persistence-sdk.test.ts` also verifies that repeated wrapper creation keeps the same app/Auth, restored user object and session-only storage without sign-out or migration.

Two pre-existing test synchronization races were corrected, with no production CropDialog or navigation changes and no timeout increases:

- CropDialog tests found the canvas DOM before its passive effect had queued the preview frame. Flushing an empty fake frame queue could leave confirmation disabled indefinitely or assert a draw error before drawing. The helper now waits for the owned frame to exist, then drives it inside `act`.
- The blocked Back test waited for a history trail that already existed before asynchronous traversal began. It could clear the guard or initiate another traversal before Back/restoring Forward settled. It now observes both real popstate events, removes its listener in `finally`, then checks the restored trail and requests the next navigation.

Baseline: a detached, unchanged worktree of `298f131`, using the same installed dependencies (node_modules junction), Node/npm, Vite/Vitest configuration, jsdom environment, default workers and JSON reporter. Suites ran sequentially, not against each other. An initial worktree under `.git` was rejected by Vite before React tests could execute; those setup-only failures were discarded and the unchanged worktree was relocated to the OS temporary directory before the comparisons below.

| Full suite | Result | Failures |
| --- | --- | --- |
| main 1 | 739/739 | none |
| main 2 | 738/739 | CropDialog draw-error assertion |
| main 3 | 737/739 | CropDialog retry readiness; blocked Back |
| main 4 | 738/739 | blocked Back |
| feature 1, 2 | 761/761 each | none; before the additional real-SDK singleton regression |
| feature 3, 4 (final) | 762/762 each | none |

Commands: `npm test -- --reporter=json --outputFile=<report-path>` on each tree, with no test settings changed. Baseline failure reproduction establishes that both races precede this feature. Their scheduling sensitivity explains intermittent suite failures; no evidence points to ownership tests leaking into these isolated environments. Resource contention can change scheduling, but was not separately benchmarked. Correct synchronization avoids depending on it. These observations supersede the unresolved timing-failure status in the historical checks above.

Final validation:

- `npm run typecheck`: passed.
- `npx vitest run src/App.ownership.test.tsx src/App.test.tsx src/auth/firebase.test.ts src/auth/persistence-sdk.test.ts src/auth/api.test.ts src/tabs/TabOwnershipManager.test.tsx src/onboarding/CropDialog.test.tsx src/home/useHomeNavigation.test.tsx`: 157/157 tests, 8 files passed.
- Four complete feature runs passed; the last two include all 762 tests. Four unchanged-main runs are recorded above. JSON reports were kept under `.git/review-validation/` as local review artifacts, not source changes.
- `npm run build`: passed (including typecheck). `git diff --check`: passed.
- `node tools/tab-ownership-browser.mjs`: passed after the fix in real Chromium, same-context pages. Login/login, login/home, home/home, first-chat/home, onboarding/home, background/foreground focus, explicit/rapid takeover, reload/close, inactive request rejection, stopped polling and uncertain queue-write recovery all passed. 192 actual HTTP requests; exactly one intentional queue POST and no DELETE or transfer-generated writes. Synthetic identities and mobile/desktop viewports; existing live-Firebase/device/BFCache limitations still apply.

Review changes: `src/App.tsx`, new `src/App.ownership.test.tsx`, `src/auth/persistence-sdk.test.ts`, `src/onboarding/CropDialog.test.tsx`, `src/home/useHomeNavigation.test.tsx`, this document and the parity matrix. No changes to Android/backend, product crop/navigation behavior, tab protocol, session/request enforcement, persistence policy or Google popup timing. No commit, push, merge or deployment during this review.
