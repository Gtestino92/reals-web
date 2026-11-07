# Home D1

## Approximate location and stable waiting copy (current policy)

User-requested Web exception to Android's 1 km preference: accept actual browser
accuracy up to 5000 m, within the backend's existing 0–100000 m contract. This
improves availability at the cost of less precise proximity matching. No backend
or Android changes; no fabricated accuracy or fallback coordinates.

| Path | Invariant | Fallback / ownership |
| --- | --- | --- |
| Precise acquisition | Validate coordinates, timestamp and accuracy ≤5 km | High accuracy gets a 5-second browser acquisition budget |
| Slow/unavailable/inaccurate precise result | At most one alternative acquisition | Low accuracy, 8-second budget; same signal and validation; fresh fix after inaccurate result |
| Denial/invalid/stale/abort | Do not silently bypass permission or data validation | No automatic fallback; existing explicit retry/cancellation |
| Competing/late callbacks | Only the active attempt can resolve one payload | First attempt settles before fallback; abort prevents second request; POST/DELETE serialization unchanged |
| Preparation → confirmed queue | Stable visible title/body, authoritative membership | Accessible status label distinguishes preparation/confirmation; no visual copy swap |

The investigation and validation sections below record earlier iterations and
their former 1 km / 20-second policy. This section supersedes those options.

Visible waiting copy is now identical throughout location, admission, reconciliation
and confirmed queue membership. The live status's accessible name still distinguishes
unconfirmed preparation from backend-confirmed membership. Errors and cancellation
remain distinct. Existing text slots preserve layout without artificial delays.

Validation for this policy: typecheck, 81 Home-focused tests, default full `npm test`
(432/432), build and diff check passed. Tests cover the 5 km boundary, precise timeout
followed by fast coarse success, at most one fallback, denied permission without
fallback, cancellation between/during requests, actual accuracy in a single POST,
and stable visible copy before/after confirmed membership.
Isolated Chrome with synthetic auth/API and location/error emulation passed precise
success, 5-second timeout → coarse success at 4200 m accuracy, exhausted attempts →
explicit retry, denied permission without POST, queue restoration and cancellation.
Frame sampling at widths 320/360/1280 found one unchanged title and no seal/button
movement. No native provider success is claimed; live Windows provider availability
still determines whether either attempt can return a usable location.

## Search transition stability review

Chrome frame sampling with controlled location/API delays reproduced four consecutive
titles (location, admission, reconciliation, queued) and a 32 px vertical shift of
the centered seal/button as copy changed height. This was presentation churn, not
a return to Inicio or a new geolocation request.

| Path | Invariant | Presentation / cleanup |
| --- | --- | --- |
| Location → admission → reconciliation | Keep distinct internal phases; do not claim confirmed membership | One stable preparation title/body and reserved text slots; no display-delay timer |
| Admission reconciliation → queued | Full backend state remains authoritative | Show confirmed waiting copy only after reconciliation |
| Cancel during reconciliation | Record intent in the existing serialized lane | Cancellation copy persists through its read reconciliation; no disabled-button flash during normal admission |
| Failure/retry/unmount | Preserve existing errors, location retry and owner cleanup | No new effect, request, poller or callback owner |

Validation: Chrome frame sampling at 320, 360 and 1280 px now records only
preparation → confirmed waiting, with zero seal/button displacement in the
controlled location/API sequence. The same DOM nodes persist, and cancellation
during admission reconciliation is covered. `npm run typecheck`, 72 Home tests,
`npm run build` and `git diff --check` passed. Full `npm test -- --maxWorkers=2`
passed 423/423; default parallelism produced two failures in unchanged CropDialog
tests. No crop code or global test settings were modified.

## Location reliability review (before changes)

| Path | Invariant / response installation | Retry / ownership |
| --- | --- | --- |
| Browser permission + acquisition | Only a valid finite position, ≤1000 m accuracy and ≤15 minutes old can reach POST | Permission wait belongs to browser; a longer bounded acquisition timeout does not relax validation |
| Browser cache | Cached success is validated exactly like a fresh position, including timestamp | No app storage, fallback coordinates, background acquisition or permission prewarming |
| Pre-POST location failure | Typed safe category/message; no mutation has been attempted | Explicit location retry in search; same operation lock, fresh location owner, no full Home refresh |
| Queue admission failure | Distinct from location failure even if coordinates were valid | Existing queue/Home reconciliation and uncertainty block; no direct location retry |
| Retry after obsolete callback | Settled/aborted location owners cannot affect a later attempt | Cancel/sign-out abort owner; serialized POST/DELETE and one Home poller remain |

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
- Search: location → admission → confirmed queue; preparation has stable copy,
  while cancellation and recoverable failure remain distinct. Backend queue membership always
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

Enqueue asks for high-accuracy browser location with a twenty-second acquisition timeout.
The browser may reuse a position up to fifteen minutes old; the same client-side
freshness/accuracy validation applies to cached and newly acquired positions.
Finite coordinate bounds, accuracy 0–1000 m and Android's maximum age of 15 minutes
are checked; only latitude, longitude and integer accuracyMeters are submitted.
There is no automatic geolocation, fallback location or app-owned location persistence.
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

## First-attempt location investigation

Confirmed by code inspection: the previous browser request used `maximumAge: 0`
and a 7000 ms acquisition timeout. Android first accepts valid cached/last-known
positions before making a fresh request. Both implementations require accuracy
≤1000 m and age ≤15 minutes. Previously, every pre-POST failure led to generic
search recovery without a direct location retry; POST failures used a separate
admission message and queue/Home reconciliation.

An isolated Windows Chrome native probe (permission granted, no location override,
no authenticated backend calls) produced error code 3 after approximately 7010 ms
and 7013 ms on consecutive attempts. A probe with revised options also timed out
after approximately 20012 ms. Thus acquisition timeout was reproduced in this
environment, but **first failure followed by second success was not reproduced**.
These probes never sent queue requests. They cannot identify which stage failed
in the reported live matchmaking session. Slow cold acquisition, an unavailable
OS/network provider or a later reusable fix remain hypotheses, not confirmed causes.
Increasing the timeout cannot guarantee a position when no usable provider exists.

The [W3C Geolocation timeout definition](https://www.w3.org/TR/geolocation/#timeout-member)
excludes permission-prompt and hidden-document waiting from acquisition time.
Do not attribute a native timeout merely to the user taking time to grant access.
`maximumAge` only permits cache reuse; it does not guarantee a cached fix exists
or that its accuracy passes Reals validation.

The bounded acquisition budget is now 20000 ms. Browser cache allowance is 900000 ms,
matching the existing accepted age. Finite coordinate bounds, nonnegative accuracy
≤1000 m, age ≤15 minutes and existing future-timestamp checks are unchanged.
Typed safe failures distinguish denied permission, unavailable position, timeout,
invalid coordinates, insufficient accuracy and stale timestamps. No browser error
detail, exact coordinate, token or request payload is logged.

Before POST, failure offers **Reintentar ubicación** directly in the search screen.
Only an explicit click starts another owned location request; permission denial
never triggers automatic retries. A quality/staleness/invalid-position retry asks
for a fresh fix (`maximumAge: 0`) to avoid repeating the same unusable cached fix.
Other explicit retries may use validated browser cache. Retry performs no full Home
refresh before acquisition and remains subject to current profile/eligibility,
the existing mutation lock and authoritative queue membership. Polling preserves
location failure guidance; an authoritative queued projection supersedes it.
Once POST has been attempted, direct location retry is unavailable and existing
uncertain-mutation reconciliation remains mandatory. Cancel/abort and settled
callbacks cannot install a late position into another attempt.

Location-fix validation: `npm run typecheck`, `npm test` (421/421 in 18 files),
`npm run build` and `git diff --check` passed. The 70 Home-focused tests include
permission pending/granted, slow first acquisition, explicit timeout retry, cache
freshness boundaries, invalid/stale/inaccurate rejection, permission denial without
automatic retries, no pre-validation POST, retry cancellation/late callbacks,
single polling ownership and backend queue restoration.

Isolated mobile Chrome smoke checks passed first admission, a controlled 9-second
acquisition, explicit retry after a controlled timeout, denied permission without
POST, queue restoration after reload and cancellation. Success used browser
geolocation emulation; latency/errors and auth/API were synthetic. Each successful
scenario submitted exactly one POST with only supported payload fields and had no
page errors or horizontal overflow. Native-provider timeout probes above are
separate evidence; controlled smoke success is not proof of real OS-provider recovery.
For live confirmation, record only browser error category and pre/post-admission
stage, compare first and second attempts, and test a cold permission grant plus
cache reuse on the affected Windows Chrome setup. Never capture precise location,
tokens or sensitive request bodies in diagnostics.

## Required Chat 1 integration

When Chat 1 is implemented, automatically open First Chat as soon as the backend
projects an actionable `FIRST_CHAT`, using its authoritative `matchId` and `chatId`.
This is required Android `HomeRouter.resolve` parity, not an optional future UX.
D1 retains only the temporary Inicio priority/Actividad fallback when a match is
found. No chat navigation, fake chat destination or notification system is added.
The waiting copy is: “Estamos buscando a alguien compatible. Te avisaremos cuando
encontremos una persona para conversar.”
