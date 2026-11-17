# Visual Review availability polling investigation

Normal application behavior reproduced successfully on `feature/second-chat`.
No production code, backend code, schema, API contract, transaction or lock changes
are justified by this investigation. The reported production failure is not yet
reproduced. Tests use synthetic identities/API responses, never private profiles.

## Contract and trace

- Backend inspected at `origin/development` (`42dd4d3`). The local backend checkout
  is `feature/password-reset-async` (`21a1a32`); affected implementation files match
  the inspected development ref. No checkout or backend mutation was performed.
- `VisualReviewService.initializeForMatch()` persists availability, schedules the
  earliest Home wake-up for both participants and bumps both Home versions in the
  transactional application path. Existing-review replay returns the same review.
- `/me/home/status` returns persisted version/dirty/wake-up plus current server time.
  `/me/home` projects Home and reconciles dirty/wake-up only if the version still
  matches its pre-projection baseline. A concurrent version bump survives this
  compare-and-set. See backend `docs/commons/api.md` and `state-machine.md`.
- `nextHiddenHomeTransitionAt()` includes future pending visual reviews on active
  visual matches, with a nonexpired review. Eligibility is
  `availableAt <= now < expiresAt`, with a pending decision for the current user.
  Reads do not resolve the domain lifecycle.
- `useHome` polls status every 5000 ms while active and visible. Version change,
  dirty, reconciliation uncertainty or `serverTime >= nextRefreshAt` requests full
  Home. It does not depend on local wall-clock advancement for this decision.
  A full load captures a status baseline before fetching Home/profile.
- Home and Activity retain the same `HomeOverview/useHome` owner. Activity renders
  each returned visual pending action; Home updates its Activity summary. Home's
  individual visual priority card is intentionally limited to the last 10% of the
  visual window (`presentation.ts`); a fresh review need not become a priority card.
- Android reference: `ui/root/HomeCoordinator.kt` (`pollHomeStateSilently`,
  `isHomeWakeUpDue`), `ui/matchmaking/HomePendingScreens.kt` and
  `HomeScreenModel.kt`. Status-first due detection and the summary/detail split are
  functionally equivalent for this scoped flow. Device/visual parity was not tested.

## State and race review

| Path | Invariant / evidence |
| --- | --- |
| Initial load | Future marker, empty pending list; full Home installs a baseline. |
| Status-only poll | Unchanged version, clean status, future marker causes no full read. |
| Deadline | Tests at -1 ms, equality, +1 ms; equality triggers a full authoritative read. |
| Full response | Version is captured before projection; future polls can detect invalidation. |
| Concurrent refresh | One read lane; interval/online/manual refresh cannot overlap it. |
| Hidden/resume | Hidden reads abort; no hidden polling. Visible resume checks status immediately. |
| Stale response | Serial/owner and abort checks reject delayed pre-transition/replaced-owner responses. |
| Network failure | Blocks actions with an error; later poll retries reconciliation and clears the error. |
| Direct database edit | Without a version bump or due marker, status-only polling cannot discover the edit. Manual full refresh discovers it. This synthetic bypass case is distinguishable from normal initialization. |

`src/home/useHome.polling.test.tsx` adds 13 regression scenarios including mounted
Home/Activity rendering, server-time boundaries, failures, ownership and races.
Fixtures retain an unrelated visible Scheduling connection so Activity is
reachable before the visual review appears. Initial-action summary counts equal
the actual pending-action list (zero before availability, one afterward); the
affinity reference responses also satisfy their full parser contract.
`tools/home-availability-browser.mjs` runs Chromium with native five-second timers,
real tab visibility and synthetic API/server clock. Start Vite on port 5177, then
run the script. It prints request paths, monotonic times, due flags and counts only.

Observed browser trace (milliseconds since navigation, rounded):

| Screen | Initial full Home | Future status-only poll | Due status + full Home |
| --- | --- | --- | --- |
| Home | 1762, pending=0 | 6761 | 11756 / 11757, pending=1 |
| Activity | 469, pending=0 | 5468 | 10465 / 10466, pending=1 |

Version remained 1 and dirty false throughout. The extra status request in the due
cycle is the existing pre-projection baseline read. No remount/reload occurred.
Real background tabs stopped requesting and resumed on foreground. A separate
Chromium scenario crossed availability while hidden and discovered it on resume;
the unit tests cover that transition too. This establishes frontend
behavior against the contract; it does not prove a live database or deployment.

## Required production evidence if it recurs

Collect a short, sanitized request/state timeline spanning availability and one
following poll. Do not export raw HAR files, auth headers, tokens, profile bodies,
names, media URLs or message content.

1. Web build SHA and backend build SHA; relative request start/end times and HTTP
   status for `/me/home/status` and `/me/home` (also whether canceled/failed).
2. Each status response's `version`, `dirty`, `nextRefreshAt`, `serverTime`, and
   whether the due comparison is true. Record the last installed Home version.
3. Home route, active flag, `document.visibilityState`, tab ownership, read/mutation
   lane occupancy and serial generation. Note resume/online/ownership events.
4. For full Home, pending-action type counts only and whether the target visual
   action exists; use an ephemeral local correlation label instead of user/match IDs.
5. Backend-only confirmation of target `available_at`, `expires_at`, match phase,
   current-user decision pendingness, and Home wake-up/version before and after
   initialization/full projection. Confirm whether availability was edited with SQL
   or through a helper that bypassed normal initialization/invalidation.

Interpretation: no status requests suggests visibility/ownership/read-lane issues;
unchanged clean status with no due marker suggests missing scheduling/invalidation
or a direct edit; due status without full Home suggests frontend ownership/cancellation
or an obsolete build; successful full Home without the action suggests backend
eligibility; action present in the response but absent in Activity suggests response
installation, local suppression or presentation. A Home priority card alone is not
the availability indicator.

## Validation and repository state

- `npm run test:focused -- src/home/useHome.polling.test.tsx`: 13/13 passed.
- `node tools/home-availability-browser.mjs`: passed Home, Activity, native tab
  background/foreground and becoming-due-while-hidden scenarios. Run Vite with
  `npm run dev -- --port 5177` first. No real Firebase/backend requests occur.
- `npm run typecheck`, `npm run build`: passed. Build reports the existing large
  bundle warning. `npm run check:architecture`: 82 modules, zero runtime cycles.
- Original investigation's `npm test -- --maxWorkers=2`: 1600 passed, one unrelated onboarding test timed
  out at 5000 ms (65 files, 159.15 s). Exact investigation rerun:
  `npm run test:focused -- src/onboarding/Onboarding.test.tsx -t 'edits and resaves outdated answers'`
  passed (one test, 105 skipped). That full-suite invocation failed; no
  unrelated code or timeout was changed at that stage. Follow-up review and
  validation after integrating main are recorded below.
- No Maven/database tests or physical-device tests were run. Backend inspection
  is read-only; no backend fix was proposed or required by this reproduction.
- Work branch: `feature/second-chat`, tracking its same-named remote. Web has no
  `development` ref, so comparison uses `origin/main`; task additions are measured
  against current HEAD. Backend comparison uses `origin/development`.
- Web HEAD moved externally from `78dbb45` to `ebe091d` during investigation. The
  initial user-owned scheduling/visual edits became part of that external commit;
  this agent did not commit or push them. Investigation adds tests/harness/docs
  only; no commit, push, merge, PR or deployment was performed by this agent.

## Follow-up review and delivery validation

Reviewed on top of `origin/main` `8d8cde6`, integrated into `feature/second-chat`
by fast-forward without conflicts. This includes the previously remote-only
browser-runner change `5e3f8ef`; no application production code changed.

Review corrected two fixture details: the initial-action count now matches the
pending-action list, with an unrelated Scheduling connection keeping Activity
reachable; affinity catalog responses now satisfy the real contract. Boundary
tests assert the summary count as well as the returned actions. Chromium page
cleanup accepts socket closure as well as a Page.close reply, avoiding a native
target-close acknowledgment race. Read-lane, serial, cancellation and controller
replacement policies remain unchanged.

- `npm run test:focused -- src/home/useHome.polling.test.tsx src/home/Home.test.tsx`:
  103/103 PASS. Final full suite includes the added summary assertions.
- `npm test -- --maxWorkers=2`: **1601/1601 PASS in 65 files**, 208.95 s.
  The previously timed-out onboarding scenario passes in this integrated run;
  no onboarding code, tests or timeouts were changed.
- `node tools/home-availability-browser.mjs`: PASS for Home, Activity, native
  hidden/resume and becoming-due-while-hidden; the trace above is this rerun.
- `node tools/second-chat-browser.mjs`: **540 checks / 40 scenario-viewport
  combinations PASS** after main integration.
- Typecheck, production build, architecture (82 modules, zero runtime cycles),
  diff check and UTF-8/whitespace scan PASS. The existing bundle-size advisory
  remains. Backend/Android worktrees and environment files are unchanged.

This supersedes the original failed validation result for the reviewed delivery;
it does not establish live production reproduction or backend/device parity.
