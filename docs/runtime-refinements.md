# Queue latency, environment ownership and sign-out review

Base: main `298f131`; task HEAD `a6864fe`, clean tree on `feature/single-active-tab`. Sibling repositories are read-only. This is a scoped Web change; no backend or Android mutation is authorized.

## Async/mutation review

| Path | Invariant and installation | Cancellation / failure |
| --- | --- | --- |
| Location | Only explicit Search obtains location; same coordinate/quality/time/security bounds, browser cache only | One sequential fallback; abort prevents fallback/POST; no application persistence or prefetch |
| Queue admission | Existing one-mutation lane and serialized POST then DELETE retained | Never replay uncertain writes; revoke/sign-out/unmount invalidates controller; queue remains authoritative |
| Reconciliation | Capture status/version baseline first, then independent profile/queue/Home projections in parallel; validate consistency and install fields together | Reject aborted/stale serial; mismatch blocks and requires refresh; no speculative queue success |
| Environment gate | Disabled only in Vite dev server on loopback unless opted in; deployed builds always enabled | Disabled branch passes no fake manager; explicit test manager forces real gate |
| Explicit sign-out | Confirmation is presentational; existing controller owns the actual operation/error recovery | Cancel/Escape/Back dismiss idle dialog; no automatic sign-out interception, deletion flow unchanged; lock duplicate clicks |
| Dialog lifecycle/history | Home owns history, modal blocks its navigation guard and listens for restored Back | Restore trigger focus; remove listeners/close modal on unmount; no invented domain transitions |

## Reference audit before implementation

Android `HomeCoordinator` distinguishes location resolution, queue admission and Searching, and owns explicit leaveQueue. `SignOutConfirmationDialog.kt` supplies title/body/Cancel/Confirm; Account/setup/root call sites govern confirmation state. Backend `MatchmakingController`, transactional `MatchmakingService.enqueue`, queue repository and availability service validate legal compliance, lock active user, validate location and check profile/ban/capacity before saving and invalidating Home. API contract: `docs/commons/api.md#matchmaking` in backend. Source inspection does not measure database latency.

Prior Web parity: queue lifecycle and cancellation COMPLETE within existing tested paths; preparation copy PARTIAL (same searching headline before admission); sign-out confirmation PARTIAL (native confirm in Account/Home failure, direct root action); native keyboard/focus/modal semantics PLATFORM-LIMITED until browser checks. This task preserves layout and business policy, adds requested preparation copy and Android sign-out copy, and changes ownership only by environment.

## Admission diagnosis and measured fixture evidence

No live SQL/Firebase experiment was performed. The browser harness imports actual pre-task `a6864fe` location/useHome code into temporary modules and runs it against current code with the same real HTTP fixture server. It injects a high-accuracy timeout, a valid coarse fix after 300 ms, 40 ms token work and 100 ms per HTTP response. Logs contain only static request paths/methods, phases and timings; no identity, coordinates, payloads or tokens. Browser waiting/paint and timer scheduling add some overhead to total time.

| Measured Chromium phase | Before | After |
| --- | --- | --- |
| Location acquisition | 5002 ms high timeout + 302 ms coarse | 307 ms coarse |
| First token preparation | 49 ms | 49 ms |
| POST fetch/response | 121 ms | 119 ms |
| Click to HTTP server receipt of POST | 5362 ms | 362 ms |
| Post-response authoritative reconciliation | 666 ms | 323 ms |
| Click to observed confirmed UI | 6260 ms | 910 ms |

These are controlled fixture measurements, not a claim about the reported production/PostgreSQL delay. In this scenario the bottleneck precedes POST, not the backend POST. Real admission time could also include permission prompts, token refresh, network latency, legal checks, active-user row-lock waits, capacity/profile/ban queries and transaction commit. The transactional service enqueues before the controller returns true; persistence is not deferred by a frontend timer. If a live trace instead shows a slow POST, correlate server transaction/SQL/lock timings separately; no backend change or frontend compensation was made here.

Optimization: try low-power/browser cache first (3 s), then a single high-accuracy attempt (8 s) on timeout/unavailable/inaccurate; inaccurate fallback and explicit quality retries request a fresh fix. Existing 15-minute timestamp and 5-km accuracy limits, finite/range/future-time checks and secure-context checks remain. No location request on Home load, no memory/localStorage coordinate cache, no concurrent sensor requests or permission retry. Browser geolocation cannot cancel an underlying getCurrentPosition acquisition; abort rejects local callbacks and prevents fallback/POST. A device requiring GPS can still take longer than a fast cached coarse fix; permission wait and device behavior are not bounded by these measured numbers.

Reconciliation captures the persisted status/version baseline first, then reads independent profile, optional queue status and Home projections in parallel. It installs only after all succeed and profile/queue/Home agree, retaining original owner/serial/session checks and ambiguity handling. It is not a transactional snapshot: concurrent matching may cause disagreement and require authoritative refresh, as before. Existing serialized writes, cancellation and no-replay policies remain intact.

The preparation surface keeps its DOM/animation while the title/body distinguish location, admission and confirmation. Only the confirmed queued state says Buscando chat. Android HomeLocation also tries validated cached/last-known positions first (15 min); Android's 1-km quality cutoff differs from Web's pre-existing 5-km policy. This task preserves that Web policy rather than silently changing eligibility.

## Environment policy and sign-out

Ownership is disabled only when Vite DEV is true and the hostname is exact localhost, 127.0.0.1 or IPv6 loopback, unless VITE_ENFORCE_TAB_OWNERSHIP=true. Builds/preview and every deployed/non-loopback host always enforce. An explicit test manager also forces enforcement. Bypass uses OperationalApp with no manager; auth/API/session behavior is unchanged. Existing local-persistence identity sharing still belongs to Firebase; use session persistence for separate local accounts. This is cooperative client-side enforcement, never a server antifraud boundary.

SignOutButton uses native showModal with shared Reals tokens and Android title/body/actions across Account, setup Account, root session recovery/loading and exceptional initial Home failure. Focus starts on Cancel and returns to the trigger. Escape/Cancel/owned-history Back dismiss idle confirmation. The Account navigation guard restores its existing history entry; the dialog adds no synthetic entries. Native navigation away from the document remains browser-controlled. Confirm closes once and delegates to the existing controller; pending relevant operations disable interaction and existing failure recovery permits a later attempt. Cleanup closes the dialog and removes Back listeners without sign-out. Automatic invalid-session/external sign-out and account-deletion confirmation remain unchanged.

## Validation scope and testing workflow

Two duplicate standalone geolocation tests were folded into the error table's exact-attempt-count assertions (permission denial = one request, unavailable/timeout = at most two). No boundary or critical mutation scenario was removed. Shared jsdom modal support replaces repeated Account mock setup, and one helper now confirms sign-out in integration tests. The default dot reporter/short DOM diagnostics and guarded test:focused command reduce noise; the complete CI suite is unchanged. AGENTS.md now requires focused iteration and one final full suite, not repeated full runs after every change.

Browser commands: start `npm run dev -- --host 127.0.0.1 --port 5174` with the local ownership opt-in unset/false, then `node tools/runtime-refinements-browser.mjs`. It checks actual before/after queue timing and UI, two local login tabs, two synthetic authenticated local identities, enabled takeover with no focus stealing, Escape/Back/restored focus, one sign-out and mobile/desktop modal layout (390/1280 px) with no horizontal overflow. Modal screenshots were inspected. To validate the real environment opt-in, restart Vite with VITE_ENFORCE_TAB_OWNERSHIP=true and run the same script with `--opt-in`. The original full ownership runner remains available but unrelated chat/onboarding scenarios need not be replayed for every change.

Remaining manual checks: real user-reported SQL latency and live token/GPS conditions; distinct live Firebase accounts; physical mobile/desktop keyboard and screen readers; actual deployed-host and production-preview smoke; browser engines beyond Chromium. Unit policy tests cover build/preview/non-loopback enforcement, but are not a deployment test. No browser/API guarantee is described as server-enforced security.

## Final results and files

- Focused command `npm run test:focused -- src/home/location.test.ts src/auth/SignOutButton.test.tsx src/home/AccountSection.test.tsx src/home/useHomeNavigation.test.tsx`: 40 passed.
- Focused command `npm run test:focused -- src/home/Home.test.tsx src/auth/SignOutButton.test.tsx src/tabs/policy.test.ts src/App.ownership.test.tsx`: 88 passed.
- The first final full run loaded 750 frontend tests successfully but two Node-only tool suites failed because the shared modal shim assumed a DOM. The shim now checks that HTMLDialogElement exists; no timeouts were increased. Focused command `npm run test:focused -- tools/android-tunnel.test.mjs tools/android-tunnel-monitor.test.mjs src/auth/SignOutButton.test.tsx`: 35 passed.
- Final `npm run typecheck`: passed. Final `npm test`: 780/780 in 35 files (35.62 s). This full repeat was justified by the Node setup correction; no further full runs were needed. `npm run build` and `git diff --check`: passed.
- Suite before: 762 tests. Two redundant cases consolidated, 20 cases added for changed policy/dialog/location/parallel-read/history paths; final 780. CI still invokes the whole suite. `node tools/test-focused.mjs` without filters deliberately exits 2 with usage guidance.
- Real Chromium normal-mode runner and `--opt-in` runner: passed. The latter used Vite restarted with the actual environment flag true and no explicit test manager. The normal runner used the flag false and verified disabled tabs plus explicitly enabled manager scenarios. The harness generates only two fixed baseline files and removes them; generated files are not needed by normal Vite startup or the production build.

Production changes: `src/home/location.ts`, `useHome.ts`, `SearchingScreen.tsx`; `src/tabs/policy.ts`, `src/App.tsx`; `src/auth/SignOutButton.tsx`/`sign-out.css`, `src/home/AccountSection.tsx` and `Home.tsx`. Tests: policy/dialog, App ownership/session, Home/location/Account, onboarding confirmation, shared DOM setup/sign-out helper. Tooling/config: package scripts, Vitest compact reporting, focused runner, synthetic queue/ownership browser fixtures and timing runner. Documentation: AGENTS.md, .env.example, testing/local-development/ownership/parity docs and this review.

HEAD remains `a6864fe3188e5ca2e3700507bff74cac3ece1cae`; no commit/push/PR/merge/deploy. Android checkout was on development; backend checkout was on feature/local-docker-network-hardening, with the reviewed matchmaking sources and API contract identical to its development ref. Both were read-only. No .env.local contents were printed or modified.
