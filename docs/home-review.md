# Home D1

## UX refinement review (before changes)

| Path | Invariant / response installation | Cancellation / failure |
| --- | --- | --- |
| Overview ↔ Activity | One mounted useHome and one poller; navigation holds no domain copies | Session/profile remount resets navigation; focus moves to screen heading |
| Locate | Separate abort owner; cancel invalidates location callback before any POST | Reconcile reads; never submit a late location |
| Admit | One serialized POST; UI says admission pending, never confirmed | Cancel records intent synchronously, waits for POST settlement, then DELETE |
| Cancel/reconcile | DELETE follows the owned POST, never runs ahead of it | Validate queue and Home; uncertain writes stay recoverable and block new search |
| Queue refresh/restoration | Backend inQueue overrides local navigation; false returns to overview with activity/priority | No local timer ends queue membership; no dequeue on unmount |
| Late responses / sign-out | Existing read serial and session generation gate every install | Abort owned reads/location; do not invent a server transition |

The queue API has no cancellation fence or mutation-status endpoint. If a POST
loses its response, its server completion time cannot be proven by a subsequent
read. Keep an explicit uncertainty notice and require reconciliation; never claim
cancellation succeeded solely because local work was aborted.

## Invariants and mutation review (before implementation)

| Path | Invariant / installation rule | Failure / cleanup |
| --- | --- | --- |
| Entry, retry, visible tab | Install profile name, full Home and status baseline together; one request lane per mounted owner | Abort replaced reads; reject obsolete owners |
| Status polling | Compare persisted version, dirty and serverTime/nextRefreshAt; timers never advance domain state | Visible tabs only; failures block search until reconciliation |
| Enqueue | Require current Home eligibility, valid browser location and synchronous operation lock | No mutation retry; read queue + full Home on success or failure |
| Cancel | Same lock; never fabricate a queue transition | Reconcile even after uncertain failure |
| Sign-out / unmount | Session owns identity; Home owns requests, timer and visibility listener | Abort reads and ignore late location callbacks; never dequeue during cleanup |
| Profile becomes DRAFT/INACTIVE | Preserve Home interactions and show profile warning | Explicit profile return; onboarding retains read-only summaries |

Canonical contracts: [backend API](../../reals-backend/docs/commons/api.md),
[Home DTOs](../../reals-backend/src/main/kotlin/com/reals/backend/controller/dto/HomeDtos.kt).
Android references: `ui/matchmaking/{MatchmakingHomeScreen,HomeScreenModel,HomeUiMapper,HomePendingPresentation,HomeCards,HomeRules,HomeLocation}.kt`.
UX navigation additionally follows `HomeLoadingScreens.kt`, `HomePendingScreens.kt`
and `HomeRouter.kt` in the same Android directory.

## Implemented flow

ACTIVE bootstrap enters Home directly. DRAFT and INACTIVE retain onboarding and
load Home summaries when existing interactions are reported. A profile that changes
while Home is open retains its interactions and shows a completion warning; the
explicit completion action reboots backend routing through the existing controller.
No router or dependency was added. Firebase persistence/authentication is unchanged.

Home now has three surfaces, all rendered from that same mounted `useHome`:

- Inicio: greeting, at most two priority summaries, search hero, conditional
  Actividad entry and backend notices. Empty counts/lists are omitted.
- Search: location → admission → confirmed queue; cancellation/reconciliation
  and recoverable failure have separate copy. Backend queue membership always
  overrides local Activity navigation. Restored queue membership shows this screen.
  Branding is centered, other page controls are hidden during waiting, and dots
  stop animating with `prefers-reduced-motion`. Session exit remains available
  on recovery errors.
- Actividad: populated groups for action required, in progress, upcoming, recent
  and unknown items. Read-only cards retain the full parsed identifiers and lifecycle
  fields. Back returns to Inicio; transitions focus the screen heading. Navigation
  is session-local and does not change the URL or add fetch loops.

First chats retain Android's priority, followed by at most two total priority
summaries ordered by advisory deadline. Critical visual review uses Android's
last 10% threshold; scheduled second chats within 15 minutes receive advisory
priority. These dates never change backend types or remove interactions. Grouping
uses backend types/status, including active second chats, without local expiry.
Pending scheduling without an action is shown in progress. A summary-only backend
interaction remains represented even when no detail items were projected.

Cancel during location aborts only its location owner and performs a read
reconciliation. Cancel during admission records intent immediately and waits for
the owned POST before DELETE; repeated clicks never create a second writer.
Cancellation arriving during reconciliation is handled by that same lane.
Even a successful DELETE does not erase uncertainty from a lost POST response.
Explicit refresh is required before leaving that recovery state or searching again.

`useHome` owns one serialized mutation lane and replaceable reads, scoped by the
authenticated account/profile mount. Full refresh reads status **before** profile and
Home so concurrent invalidations remain detectable. A five-second visible-tab timer
reads only status; version changes, dirty state or a marker due according to server
time trigger the full projection. Hidden tabs pause polling, visible restoration
refreshes Home, and cleanup aborts reads without leaving the server queue.
`/home/pending` was inspected but is not needed: it omits matchmaking and counts,
and merging it into full Home would produce inconsistent snapshots.

Enqueue asks for fresh high-accuracy browser location with a seven-second timeout.
Finite coordinate bounds, accuracy 0–1000 m and Android's maximum age of 15 minutes
are checked; only latitude, longitude and integer accuracyMeters are submitted.
There is no automatic geolocation, fallback location or location persistence.
POST and DELETE results are validated, then queue GET and full Home reconcile.
Uncertain failures require an explicit refresh before another mutation, even if
the first reconciliation succeeds. Queue/Home disagreement also blocks operations.

All known pending/next-step types have Spanish labels. Unknown types retain their
identifiers and receive a generic summary; malformed projections fail closed.
Backend text renders as React text; blocked codes map to Spanish copy because
the backend currently provides English diagnostic messages.

## Limitations and integration checks

- Pending cards are read-only. First chat, visual review, scheduling, second chat,
  dismissals and profile editing from ACTIVE Home are outside this iteration.
- No countdown changes eligibility or lifecycle state. Dates are informational and
  formatted in the browser's local timezone.
- Full Home has no version. A status baseline before the projection deliberately
  permits an extra full refresh after concurrent invalidation rather than hiding it.
- Queue GET and Home are separate snapshots. A match created between reads can
  temporarily require another refresh; no local match/interaction is fabricated.
- No new backend endpoints or contract gaps blocking D1 were found. Live integration
  still needs a configured authenticated backend, location permission on the target
  HTTPS origin, and two eligible accounts to observe server-created matches.
- ACTIVE Home relies on backend matchmaking availability and transactional admission
  for legal/eligibility restrictions; it does not add a legal acceptance flow.

## Validation

See focused tests in `src/home/`, authentication routing regression in `App.test.tsx`
and onboarding regressions in `onboarding/Onboarding.test.tsx`. Chrome checks use
isolated contexts, synthetic auth/API fixtures and real browser geolocation; they
do not contact Firebase or mutate a live queue.

Validation on this branch: `npm run typecheck`, `npm test`, `npm run build` and
`git diff --check`. Chrome smoke checks at 360×900 and 1280×900 confirmed no
horizontal overflow, visible keyboard focus, keyboard search, browser geolocation,
enqueue/cancel reconciliation and zero page errors. Screenshots were inspected
from the temporary smoke directory; no browser tooling dependency was added.

Initial D1 results before UX refinement: typecheck/build/diff check passed; `npm test -- --maxWorkers=2`
passed all 395 tests in 17 files. Default `npm test` had intermittent one-second
preparation timeouts in unchanged `CropDialog.test.tsx` (394/395 passed on the
last default run). Its isolated run passed all 40 tests. No crop code or global
test-runner configuration was changed to mask the timeout.

UX refinement validation: `npm run typecheck`, default `npm test` (404/404 in
18 files), `npm run build` and `git diff --check` passed. Home-focused tests cover
53 cases, including deferred location/admission cancellation, uncertain cancel,
restoration, queue completion, account replacement, grouping and one shared poller.
Isolated Chrome checks at 360×900 and 1280×900 passed Activity/back heading focus,
keyboard navigation and focus ring, queue admission/cancel, queue restoration after
reload, no distracting waiting controls, no horizontal overflow, reduced-motion
behavior, and zero page errors. Screenshots of all three surfaces were inspected.
The browser checks use synthetic authentication and API responses, not live users.

Recommended integration smoke checks:

1. On HTTPS, cancel while permission is pending; grant permission afterward and
   verify that no enqueue occurs.
2. Throttle the admission response, cancel once, then verify POST settles before
   DELETE and final queue/Home reads agree. Disconnect during POST/DELETE and
   verify explicit recovery rather than an apparent successful cancellation.
3. Reload while queued and restore a background tab; verify the dedicated waiting
   surface and that closing the tab does not implicitly dequeue.
4. With two eligible accounts, create a match server-side; verify waiting returns
   to Inicio with priority/Actividad and that details remain read-only.
5. Change profile status or authenticated account during requests; verify no old
   profile/activity appears. Check keyboard and reduced motion on a mobile viewport.
