# General glitch: visible reload after changing browser tabs

Reported repeatedly, most recently in My Profile Preview (2026-11-17). Track this as a cross-screen regression class, not an isolated cosmetic defect. Source audit on `feature/my-profile-preview`, clean HEAD `daac728`. Browser visibility return, app navigation, account ownership transfer and actual document reload are different events.

## Root cause and corrections

`MyProfilePreview.tsx` used the same effect epoch for background refresh and image retry: visibility return aborted reads, cleared the snapshot, incremented the epoch, reset the photo and reconstructed the card. Corrected: a replacement read owns its own abort controller inside the screen lifetime; ordinary resume retains the complete same-owner snapshot and selected photo, never increments the image retry epoch, never moves focus/scroll and installs all four reads together. A failed read shows a stale-version notice and retry alongside the retained card. Reopen remains an initial authoritative read; identity replacement removes old data immediately.

A second instance in `useAffinityQuestionnaire.ts` entered `busy/uncertain` for every resume, visibly announcing a load and disabling answer controls. Corrected: healthy resume is silent, retains the catalog/answers and permits a user mutation to supersede the background read. Failed revalidation retains content but blocks writes until reconciliation. Explicit initial/recovery reads remain blocking.

## Screen inventory and review

Source review covers the authenticated root, every destination in `useHomeNavigation.ts`, authentication/recovery screens and modal/media subflows. Status below is source assessment, not a claim that every screen was exercised in a real browser during this task. Existing tests are evidence to inspect/run, not automatically verified by this inventory.

| Surface / owning sources | Resume behavior / assessment |
| --- | --- |
| App, ready session, ordinary/admin modes (`App.tsx`, `auth/session.ts`) | ReadySession key is account/profile, not visibility. Normal modes retain the ordinary tree under `hidden`; eligibility refresh does not itself reload the document. Actual identity/status changes may replace the tree intentionally. |
| Login/signup/recovery cooldown (`auth/LoginScreen.tsx`) | Focus/visibility only recompute absolute cooldown clocks; credentials remain component state. No data-load reset found. |
| Suspension (`AccountSuspension.tsx`), account deletion recovery (`AccountDeletionRecovery.tsx`) | Suspension has explicit recovery; deletion recovery rechecks on visible/pageshow, retains metadata but locks actions while consulting authority. Safety gate, not a normal content spinner to remove. |
| Tab ownership (`tabs/TabGate.tsx`, `TabOwnershipManager.ts`) | Another authenticated tab taking ownership intentionally gates/tears down session resources. Ordinary visibility is not takeover. Never bypass this gate to conceal a reload symptom. Production enforcement and browser-discard reload remain separate checks. |
| Home, Activity, Searching (`home/Home.tsx`, `useHome.ts`, `useHomeTime.ts`) | Resume uses version/status polling with existing model; no placeholder replacement on a healthy poll. Returning to an eligible retained ACTIVE snapshot revalidates silently, preserving immediate management re-entry. Search and automatic chat entry wait for the new result. Leaving again retires the read. Authoritative interaction/search transitions and uncertain admission/cancellation still gate actions. |
| Profile setup, Tu perfil, preferences, legal/email/activation, photos/crop (`onboarding/Onboarding.tsx`, `ProfileForm.tsx`, `CropDialog.tsx`, `PhotoGrid.tsx`) | Visibility calls background `run`, retaining mounted forms/crop and suppressing foreground busy. Internal return to active profile management retains both forms and photos. A usable same-owner snapshot revalidates quietly; cold or explicitly blocking reads keep the skeleton and can be retired on departure. ACTIVE details load photo metadata independently and keep image downloads local to each tile. Mutations and uncertain-write recovery keep their navigation lock. Confirmed fields and local dirty drafts remain separate. Drag ownership is canceled on blur/hidden intentionally; no new crop decode solely from visibility. |
| My Profile Preview (`profile/MyProfilePreview.tsx`) | Confirmed defect corrected as above. Entire snapshot, gallery selection and DOM retained during healthy/failed same-owner refresh. |
| Public questions: overview, unanswered list, legacy editor, selection (`profile/questions/`) | `refresh(true)` on resume; stable parent/form keys and local drafts. Foreground retry and uncertain writes stay gated. No clearing pattern found. |
| Private affinities: overview, categories, review, question (`profile/affinities/`) | Resume locking defect corrected as above. Draft tied to account/question/semantic version; genuine catalog removal/version change must reconcile safely. |
| Counterpart profile (`scheduling/PartnerProfile.tsx`) | No visibility handler and no periodic epoch change; shared card retained while mounted. Photo retry or match change is explicit. Scheduling parent continues authoritative lifecycle checks. No new silent freshness mechanism added here. |
| Visual discovery and personal-message/decision dialogs (`visual/VisualReview.tsx`, `VisualSession.ts`) | Healthy same-session resume retains profile and imageRetry. Decisions lock during revalidation. Expired content is concealed until authoritative recovery; denied/invalid snapshots fail closed. This intentional exception must not be removed. |
| Scheduling/proposals/review (`scheduling/Scheduling.tsx`, `SchedulingSession.ts`) | Resume uses `poll`, silent when verified/healthy; drafts retained. Each full refresh validates one private scheduling snapshot using its server clock. Pause cancels owned background reads. Uncertain mutations require blocking reconciliation. |
| First chat and exit/decision/safety (`chat/FirstChat.tsx`, `ChatSession.ts`) | Resume aborts obsolete read and refreshes silently with existing chat/messages; initial busy only without chat. Authoritative closed/decision state may leave the screen. |
| Second chat, reply/reactions/history/attendance (`chat/SecondChat.tsx`, `SecondChatSession.ts`) | Resume replaces read without clearing chat/messages. Explicit entry/attendance remains blocking. Expiry/closed state retires content by domain policy. |
| Audio recording/playback (`AudioComposer.tsx`, `MessageAudio.tsx`) | Hidden pauses playback and cancels active capture intentionally; retained recording/preview resource policies apply. Do not restart media automatically on resume. Both participant chats apply each history access header before remaining reads complete. Withdrawal removes counterpart players while preserving other keyed rows and drafts. Missing metadata permits recovery with fresh authorized media. See [participant playback](security-technical-debt.md#participant-chat-playback-after-a-block). |
| Account, notifications/password/deletion/sign-out dialogs (`home/AccountSection.tsx`, `auth/SignOutButton.tsx`, `DeletionConfirmation.tsx`) | Web switches use the owning session's browser-local state. Account has no visibility-driven reload. Dialog cleanup and focus restoration belong to navigation and dialog lifetimes. |
| Admin MFA (`admin/AdminGate.tsx`, `access.ts`) | Hidden clears OTP; visible rechecks authorization. MFA input focus and access gates are deliberate security behavior. Reauthorization may conceal/recreate protected content; audit separately from ordinary profile content. |
| Admin diagnostics/photos/reports/appeals/details (`admin/Admin.tsx`, `store.ts`) | Healthy visible calls background `load(true)` preserving rows; selected detail skips that read. Full pagehide/bfcache reauthorizes; private audio is stopped. Do not retain sensitive state across revoked access. |

## Prevent recurrence

1. Separate first load, user retry, navigation entry, background revalidation and writes. A request being in flight does not mean the screen has no usable data.
2. Keep the last complete compatible snapshot for the same account/resource. Do not bind React keys, image retry epochs, input initialization or heading-focus effects to refresh counters or busy flags.
3. Use a distinct read owner/serial. Abort obsolete reads; also reject late responses from transports ignoring abort. Identity/access changes must gate rendering synchronously and dispose owned resources. Never install partial batches or combine old answers with a new incompatible catalog.
4. Background reads must not own form drafts, gallery selection, focus, scroll or navigation. A successful response may update confirmed data, but local unsaved edits survive. Legitimate server removal/version transitions may invalidate only the affected local choice.
5. Give writes priority over healthy background reads; abort the read and reject its late result. Keep uncertain-write recovery blocking, never retry mutations blindly or reinterpret cleanup as a domain transition.
6. On transient background failure, retain readable content and show actionable failure/staleness information. Disable unsafe mutations where necessary. On invalid ownership/session/access or expired protected content, apply the existing fail-closed policy instead of displaying another account's or forbidden data.
7. Test a *loaded* screen with a delayed read, not only mount/initial load. Compare actual DOM node identity, selected media, focus, scroll, input value, enabled state and image requests before/during/after hide/show. Add rejected/malformed reads, rapid repeat resume, read/write overlap, sign-out, identity replacement and cleanup tests.
8. Browser tests must distinguish a synthetic visibility event from real Chrome target activation, internal app navigation, bfcache restoration and browser tab discard. Network revalidation is expected; visible blanking/remounting is the glitch. Physical-device, screen-reader, discarded-tab and real backend checks remain manual unless explicitly executed.

## Invariants / response installation review

| Path | Required invariant |
| --- | --- |
| Initial open / explicit retry | Fresh authoritative batch; initial placeholder only without a usable owner snapshot. Explicit image retry alone may advance image epoch. |
| Healthy resume / repeated events | Keep DOM and selection; replacement read aborts the previous preview batch; affinity serial prevents obsolete installation and deduplicates active reads. No focus/scroll reset. |
| Batch success / failure | Install coupled fields once after validation; retain last complete owner snapshot on transient failure, with error. No successful partial batch. |
| Affinity PATCH/DELETE versus background read | Abort the owned healthy read before write; serial rejects late read, install complete authoritative answer list; uncertain failure blocks later writes. |
| Identity/sign-out/unmount | Old identity is never eligible to render; abort only owned resources/listeners and reject late results. |

Web activity notifications follow the same split. A complementary response can
update the tab and Activity indicators while the operational DOM stays mounted.
After a hidden interval, an automatic first-chat open waits for operational
foreground verification. A delayed or failed verification retains the current
Home surface. See [notification ownership and polling](frontend-architecture.md#web-activity-notifications).

## Validation and open limits

Results are appended after validation. This is a source audit of all screen families, with regression testing concentrated on the changed behavior; it is not exhaustive real-device certification. Follow-up: exercise each inventory row under real tab switching, slow/offline network, internal mode switches and bfcache on supported devices; measure any remaining unnecessary foreground gates without weakening domain/access policies. Country/city work remains paused and no backend/Android files are changed.

Validation completed so far:

- `npm run test:focused -- src/profile/MyProfilePreview.test.tsx src/profile/affinities/useAffinityQuestionnaire.test.tsx src/profile/questions/useProfileQuestions.test.tsx --maxWorkers=2`: 42 PASS. Includes loaded-card/selection/focus retention, error/retry, old reads, account replacement, affinity PATCH/DELETE priority and local radio draft/focus retention. The first iteration exposed the missing uncertainty gate on failed background affinity reads; it was corrected. Two 5-second timeouts in that initial unbounded-worker run did not recur with bounded workers; no timeout thresholds were increased.
- `node tools/my-profile-preview-smoke.mjs`: 44 PASS assertions across ACTIVE/DRAFT, 390x844 and 1440x900. Real Chrome target activation captured hidden/visible events, started fresh reads and retained the same card, focus, scroll and performance.timeOrigin during 650ms-delayed responses and afterwards. Synthetic HTTP only; selected-photo retention is covered by unit tests, not live signed-media delivery.
- `npm run typecheck`, `npm run build`, `npm run check:architecture`, `git diff --check`: PASS; 85 production modules, zero runtime cycles; existing Vite bundle-size advisory remains.

The full regression command `npm test -- --maxWorkers=2 --reporter=json --outputFile=artifacts/resume-glitch-tests.json` was interrupted at the developer's request; it produced no completed suite result and must not be described as passing. No further tests or smoke runs were started. Going forward, default validation is affected tests plus typecheck; the developer owns smoke and full regression unless explicitly requested.
