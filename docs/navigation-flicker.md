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
