# Screen transition audit

Starting branch `feature/admin-mfa-integration`, clean HEAD `497ab9187bdbc8ac75bff4e69c08a4fbd2fc9ad3`. Compared with requested review `471d3967805cc00977594f8f8e50e8401b48d853`; preserved intervening login changes. No worktree, persistent snapshot cache, dependency, backend, Android, Firebase configuration or environment-file changes.

## Proven causes and decisions

| Transition | Cause / existing behavior | Result |
| --- | --- | --- |
| Login → Home | Current HEAD already retains login through bootstrap and gives authorized Home its first skeleton. | Retained. Chromium verifies the input node and document survive bootstrap. |
| Home → Account → Home | Both readers already remain mounted; Home retains its model on reconciliation. | No new skeleton. Restore Home origin scroll for management/Activity entries; preserve heading focus. |
| Account → Notifications → Account | First read left the three-row region empty; confirmed switches already survived revisits. | Three static placeholder rows on first read. Retain switches during later reads/failures and restore Notifications entry focus. |
| Home → Profile / Preferences → Home | Conditional Onboarding unmounted on exit, discarding its read model, countries, form and nested question reader. Repeated initial loading and country requests. | Lazily retain the management owner within the authenticated account/profile lifetime. Revalidate on activation with writes blocked; keep confirmed content on failure. Skip hidden foreground refresh. |
| Home → Profile Questions → Home | Nested hook retained data only while Onboarding remained mounted; status inserted a row above healthy content. | Retain parent owner/catalog/answers. Static first-load action-card placeholder; visually hidden accessible refresh status thereafter. |
| Home → Affinities → Home | Hook already retained catalog/answers; refresh status shifted healthy content. First load lacked destination structure. | Keep model; static first-load card and visually hidden refresh status. Block writes until successful reconciliation. |
| Home → Activity → Home | Overview intentionally switches to groups using the same confirmed Home model. | Retained. No additional skeleton. |
| Home → Search → Home | Search deliberately uses another centered layout; queue/location/cancel transitions require authoritative reconciliation. | Retained admission/cancel behavior. No queue-state snapshot cache. |
| Home ↔ Chat | Separate live chat session owns drafts and exit guards; terminal return retains Home. | Retained. Actual App smoke verifies terminal reconciliation returns to the same Home node. |
| Home ↔ Admin | ReadySession replaced the normal tree, unmounting Home and repeating its initial load on return. | Keep ordinary tree hidden; suspend its readers and lock reports during Admin. Private Admin components/stores/evidence still dispose on exit. MFA gate unmounts while Admin displays, preserving its reauthorization lifecycle. |

Placeholders have `aria-hidden`, no interactive elements, shimmer, pulse or timer. Status remains accessible. Existing Search animation respects reduced motion. Ordinary destination headers and the shell stay present. No minimum loading duration.

## Ownership and mutation review

| Path | Invariant / response installation |
| --- | --- |
| Identity / sign-out / terminal invalidity | ReadySession keyed by account/profile ID; removed outside ready. Models are component memory, never browser storage. Identity transitions dispose models and owned resources. |
| Management first read / reentry / failure | Existing owner serializes reconciliation/mutations. Activation blocks writes before paint, revalidating profile, queue, legal state and photos. Failed reads keep confirmed presentation and actionable recovery with writes blocked. Countries stay in memory. |
| Management / question visibility | Hidden management skips foreground refresh. Questions retain identity/abort/serial response checks. Local drafts remain owned by their component. Cleanup invents no business transitions. |
| Affinity / question reads | Mark uncertainty synchronously. Retain catalog/answers atomically; only a valid complete successful projection clears uncertainty. Failed reads block writes. |
| Affinity / question mutations | Reject during reads, mutations or uncertainty. Preserve no-op checks, full response installation, identity/serial rejection, definite-versus-uncertain failures and no automatic mutation replay. Regression tests cover reads before writes and duplicate writes. |
| Notifications / Home / Search / Chat | Existing serialized owners, abort checks, queue reconciliation, closed-match suppression, cancel and draft guards remain. Presentation retention never replaces authoritative domain state. |
| Admin / resume / expiry | Hidden normal callbacks cannot overwrite Admin's mutation lock or consume its resume revalidation. Private stores/media dispose on exit. Grant expiration, revocation, pagehide, identity restrictions and checks before privileged requests remain authoritative. |

## Measurements

Native headless Chromium; synthetic HTTP with actual App/SessionController/ApiClient; 390×844 and 1440×900. Samples span about 1.1 seconds using requestAnimationFrame, with 100 ms delay per GET. Baseline reran starting HEAD sources under a temporary backup/restore protected by `finally`, without a worktree. Raw frames/screenshots remain local under `artifacts/navigation-flicker/`; [portable aggregate evidence](navigation-flicker-measurements.json).

| Revisit | Before generic loading frames | After | GETs before → after |
| --- | --- | --- | --- |
| Profile mobile | 38 / 67 | 0; same form, no skeleton | 6 → 5 |
| Preferences mobile | 33 / 67 | 0; same form, no skeleton | 6 → 5 |
| Profile desktop | 35 / 67 | 0; same form, no skeleton | 6 → 5 |
| Preferences desktop | 33 / 68 | 0; same form, no skeleton | 6 → 5 |

First Profile/Preferences loads previously had 33–36 generic loading frames; now a static destination structure. Countries account for the eliminated request; profile/queue/legal/photos intentionally revalidate. Healthy profile revisit layout-shift sums were about 0.0002–0.0003; preferences 0. These sums include recent input, not a field Core Web Vitals claim. Panel x/y/width stayed stable (mobile 24/24/342; desktop 240/24/960). Different pages retain different heights. Error recovery can shift layout (~0.038 desktop / ~0.118 mobile) while preserving the form.

Admin return now preserves the same confirmed Home node without a skeleton and removes private DOM. Mode Back/Forward preserves document time origin. DOM identity probes establish remount behavior; they are not React profiler commit counts. Activity/Search deliberately replace overview descendants.

## Validation

- Initial focused six-file run: 268 passed. `npm run test:focused -- src/onboarding/Onboarding.test.tsx src/profile/affinities/useAffinityQuestionnaire.test.tsx src/profile/questions/useProfileQuestions.test.tsx`: 132 passed, including delayed/failed same-form revisits and writes blocked by reads.
- `npm run test:focused -- src/admin/mfa.test.tsx src/admin/modes.test.tsx src/admin/Admin.test.tsx`: 65 passed after fixing retained-reader/lock and MFA-gate regressions found by the full suite.
- Final `npm test -- --maxWorkers=2`: 1156 passed in 48 files. Earlier full run exposed six Admin regressions; fixed before the successful full rerun. A later minor placeholder row-count adjustment only changes static presentation.
- `npm run build`: passed, including `tsc --noEmit`; existing >500 kB bundle warning. `git diff --check`: passed.
- Start `npm run dev -- --host 127.0.0.1 --port 5174 --strictPort`; run `node tools/navigation-flicker-smoke.mjs`. Tests initial/repeat/failed management, affinities/questions, notifications; Account/Activity/Search roundtrips; terminal actual Chat return in both viewports. Request traces distinguish actual failed reads from screens without an entry read (Account/Activity/Search).
- `node tools/home-navigation-polish.mjs`: passed desktop/mobile geometry, header Back, repeated Back/Forward, nested Notifications and recovery scenarios. Updated stale browser-test waits and native confirmation/recovery selectors.
- `$env:REALS_SMOKE_URL='http://127.0.0.1:5174'; node tools/admin-smoke.mjs`: desktop/mobile Login bootstrap, entry/cancel, private reads, retained grant, same Home on return, Back/Forward, identity denial, visibility, no persistence: passed.

Pending profile/preferences and retained mobile profile screenshots were visually inspected. This is synthetic Chromium emulation, not physical Android, TalkBack, Safari, production backend, real OAuth or real MFA validation. Full existing CI coverage remains enabled.

Legacy `first-chat-navigation.mjs` has an incomplete standalone controller mock and fails Home-ready; `home-account-transitions.mjs` uses a stale affinity text selector and fails before its scenarios. Their results are not counted as passing. The new actual-App harness covers terminal Chat return; exhaustive Chat gesture/media scenarios were not rerun.

Remaining limits: placeholders approximate variable final height; actionable errors add recovery space; writes lock during revalidation; switching directly between details and filters still changes their mode-specific form subtree. No broad Android visual-parity completion or elimination of every device rendering flash is claimed.
## Startup and Home return

The previous cold path painted separate ownership, Firebase restoration, legal
and Home loaders. An active chat could add another presentation. The shared
startup uses the Reals seal, existing editorial tokens and reduced-motion-aware
indicator. Signed-out, blocked-tab, transfer, recovery, legal decision and
actionable errors still reach their respective screens. After legal entry, Home
reports readiness only after its projection and passive Second Chat decision.
A pending automatic First Chat hands off to the chat loader without revealing
ordinary Home. An existing queue goes straight to Searching. Manual sign-in,
direct Admin challenges, in-app skeletons and explicit retry feedback retain
their own presentation. The [architecture notes](frontend-architecture.md#initial-presentation)
describe the boundary.

### Read policy

- `/me` resolves the authenticated account, including provisioning and restriction
  paths, before bootstrap validates its profile identity and status. The
  bootstrap parser retains those fields. Home still needs a fresh display name
  and a profile status that agrees with its later, legally gated projection.
  Profile writes and photo-triggered demotion can occur between the two reads.
  Setup needs the full profile fields. There is no version on the bootstrap
  profile that proves it is current at the Home read.
- The two legal reads already run concurrently after the authenticated gate.
  A full Home read reconciles the shared dirty flag and time marker against its
  own starting version in `MeController.getHome`. Keep the client's preceding
  status sample so an invalidation racing the projection remains observable.
  The Home profile and full projection already overlap in startup. The
  pre-Home request count and critical-path ordering remain the same.
- After returning from profile management, preferences or affinities, start
  status and profile in parallel. Reuse the same-owner operational projection
  only if its version is unchanged, clean and before every known refresh marker,
  and the fresh profile status agrees. Install a newly validated name with the
  retained projection. Full replies still validate owner, profile ID, status
  and queue consistency where required. A changed version, dirty status, due
  server marker, profile-status change, projected interactions or mandatory
  reconciliation triggers full Home after status. The full read shares the
  in-flight profile read.
- `MatchmakingService` bumps the version for queue changes. `ProfileService`
  bumps on activation and `ProfilePhotoService` bumps on status demotion.
  `ProfileService.updateProfile` and `updateDynamicMatchFilters` save without
  bumping Home. Filters do not enter `MatchmakingAvailabilityService`'s admission
  availability computation, and a returned profile read covers the owner's
  unversioned name. Full Home includes unversioned partner names, so returns
  with pending actions or next steps still retrieve the projection. Question
  answers and affinities use their own readers and do not supply Home's
  eligibility fields. See the [Home API](../../reals-backend/docs/commons/api.md)
  and [Backend services](../../reals-backend/src/main/kotlin/com/reals/backend/service).
- Account, scheduling, visual and chat returns keep reconciliation when the
  surface could have changed operational state. Activity remains a projection
  of the mounted Home. An uncertain editor write or an observed queue admission
  explicitly invalidates the retained model. Ordinary departure aborts the
  in-flight return read and retires its serial. The next read owns verification.
- Search stays disabled through return verification. Once eligible, its click
  runs through the queue/location lane even during an unrelated healthy poll,
  retiring that read. Backend admission and the legal gate still decide the
  write. Admin can start its own access check during an ordinary healthy return.
  Known mandatory reconciliation, errors, navigation guards, queue and chat
  priority retain their locks. A queue or chat that becomes actionable while
  access is being checked retires the competing Admin entry intent.

### Invariants and response ownership

| Path | Invariant |
| --- | --- |
| Startup, ownership transfer, BFCache | Startup visibility has no authority over requests or tab ownership. Informational contention remains separate. BFCache reacquisition still requests a vacant lock and never takes it from an active tab. |
| Bootstrap, legal, retry, replacement | No protected Home before session and legal gates. User decisions and actionable failures release the presentation. Account/profile keys and abort generations retire obsolete results. |
| Clean return, rename, preferences, affinities | Fresh profile and usable status must agree before Search reopens. Display name and projection install under the same read serial. Management drafts and the Home controls keep their DOM identity. |
| Invalidated, failed or interrupted return | A known invalidation takes the full path. Failure retains the last usable model with actionable retry and blocked operations. Departure/visibility aborts owned work, and late responses cannot overwrite Home or open a conversation. |
| Profile/photo/queue mutation | Editor uncertainty remains write-locked. Queue admission and cancellation retain their serialized reconciliation and no automatic replay. Status reads cannot release a mutation lock. |
| Automatic chat, Admin, notifications | A passive restore transfers one session and does not JOIN. First Chat priority and Admin's independent MFA/grant validation remain in their owners. Reusing Home leaves existing Activity acknowledgements intact. |

### Chromium measurements

The same actual-App fixture used 120 ms of synthetic lock delay and 160 ms per
synthetic HTTP response on base `ac6d0ec` and the task branch. Frame time begins
at the first visible loading status or the profile exit. Admin time is time to
clickable entry. Its authorization still takes a separate request on click.

| Measurement | 390 × 844 light, before → after | 1440 × 900 dark, before → after |
| --- | --- | --- |
| Distinct loading presentations / panel positions | 4 / 4 → 1 / 1 | 4 / 4 → 1 / 1 |
| Startup frames showing Home placeholders | 21 → 0 | 22 → 0 |
| Startup to usable Home and Admin | 1233 → 1150 ms | 1150 → 1150 ms |
| Read-only profile exit to Search / Admin | 375 / 375 → 190 / 6 ms | 390 / 390 → 221 / 5 ms |
| Confirmed name save exit to Search / Admin | 383 / 383 → 211 / 11 ms | 385 / 385 → 199 / 16 ms |
| Changed Home version exit to Search / Admin | 385 / 385 → 390 / 7 ms | 392 / 392 → 412 / 12 ms |
| Clean return reconciliation GETs | 3 → 2 | 3 → 2 |

Startup requests in both runs included `GET /me`, two `GET /me/profile`,
`GET /me/legal-status`, `GET /legal/documents/current`, `GET /me/home/status`
and `GET /me/home`. The eligible fixture also read `GET /admin-auth/status`.
Affinity catalog and answers began around the first usable Home frame and did
not gate Search or Admin. Profile entry and save retained their existing
requests. The read-only visit retrieved countries, profile, queue, legal status,
legal catalog and photos. The saved visit included one `PATCH /me/profile` and
the editor's existing verification reads. After either exit, Home reconciliation
went from status, profile and full projection to status and profile. The two
independent affinity summary reads still made the total exit counts five to
four in these fixture runs. Changed-version returns retained full Home.

Search and Admin nodes survived every measured return. A changed-version return
that discovered queue admission moved to Searching, retired the concurrent
Admin intent and issued no privileged Admin reads. Neither startup run exposed
Login on the authenticated path. The desktop startup timing and unchanged HTTP
ordering do not establish a startup speedup. These timings are local Chromium
frame samples, with no live Firebase, production ingress or physical Safari.

Reproduce with `npm run dev -- --host 127.0.0.1 --port 5174 --strictPort` and
`node tools/runtime-refinements-browser.mjs --startup-home`. Run the same
fixture with `--baseline` against the base sources. The script saves JSON
and light/mobile and dark/desktop screenshots under `artifacts/startup-home/`.
Passive Second Chat reload was also checked at 390 and 1280 px with
`node tools/second-chat-browser.mjs --case=reload-active` on Vite port 5175.

### Validation

- `npm run test:focused -- src/App.test.tsx src/App.ownership.test.tsx src/home/Home.test.tsx src/home/Home.secondRestoration.test.tsx src/home/useHome.polling.test.tsx src/tabs/TabOwnershipManager.test.tsx src/onboarding/Onboarding.test.tsx src/admin/modes.test.tsx src/admin/mfa.test.tsx src/auth/AccountSuspension.test.tsx src/auth/AccountDeletionRecovery.test.tsx` passed 530 tests across 11 files. The subsequent targeted `npm run test:focused -- src/home/Home.test.tsx -t "accepts a single Search click"` passed the added overlapping-poll regression.
- `node tools/tab-ownership-browser.mjs` passed Chromium ownership transfer, rapid re-entry, read/write retirement and BFCache vacancy/occupied cases, including actual browser Back.
- `npm run typecheck`, `npm run check:architecture` (107 production modules, zero runtime cycles) and `git diff --check` passed. Full regression and deployment builds were left to CI.
