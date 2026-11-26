# UX and runtime audit

Base: `feature/second-chat` / `1f0cbbd` (HEAD equals the available remote-tracking ref), 2026-11-16. Android reference: `87e2979`, read-only. No production credentials or personal data are used by the browser fixtures. The four untracked audit/fixture files present at task entry were retained and extended.

## Confirmed issues before implementation

| Severity | Location and reproduction | Recommendation / impact |
| --- | --- | --- |
| Medium | `src/onboarding/ProfileForm.tsx` (using `contracts.ts` defaults): open Create profile; without touching sensitive selectors, enter name, date and city and submit. MALE, FEMALE interest and DATE are sent. Android `CreateProfileScreen.kt:59–63` shares these defaults. | Require explicit new-profile choices. Preserve existing saved preferences, allowed enum values and backend validation. This deliberately changes Web defaults, not eligibility or matching rules. |
| Medium | `ProfileForm.tsx`: enter a one-character name or underage date, then submit from the end of the long form. Custom validation lists errors but neither focuses nor marks their fields. Native required-field validation also bypasses the custom summary. | One accessible validation path; focus/scroll to the first invalid field and associate error messages. Keep all sections editable. |
| Medium | `ProfileForm.tsx`, `Onboarding.tsx` activation section: creation and activation actions are below different long bodies. Advancing after creation can leave the next task offscreen. | Place actions at the start of each task with accurate Create/Activate/Save labels, retaining prerequisites and drafts. |
| Low | `Onboarding.tsx:205–207`: DRAFT profile with interactions displays “usá Android para continuarlas” above a working nested Web Home; failed Home lookup also directs users to Android despite retry. `Home.tsx` passive notices direct every notice to Android. | Describe the available Web Activity/retry path; retain genuine platform limitations for browser push and unsupported MP4 recording. Unknown activity types must not promise unsupported actions. |
| Low | `Home.tsx:62`: Activity FIRST_CHAT action omits the `disabled` prop used by all adjacent cards. During blocked Home reconciliation it looks available while the navigation handler rejects the action. | Apply the same busy/blocked state to that control. No navigation-policy change. |

## Audit boundaries and invariants

Authentication, legal, creation, activation, Home/Activity, Visual Review, Scheduling, both chats and account controls are reviewed through source, existing tests and synthetic Chromium scenarios. Deadlines originate from backend lifecycle/status; their presence is not evidence of deceptive urgency. No financial mutation exists in Web; the development-only voluntary support link declares no in-app benefit. Browser push and unsupported audio-format guidance remain legitimate platform limitations.

| Path | Invariant / response installation |
| --- | --- |
| Create/edit validation | Local draft only; no POST on invalid input; saved-profile values never reset by new-profile defaults. Busy submissions return immediately; the existing synchronous owner lock remains authoritative for duplicate writes. |
| Onboarding writes / legal / activation / photos | Existing abort ownership, reconciliation and uncertain-write lock stay intact; no automatic mutation, acceptance or activation. Prerequisites remain server-owned. |
| Navigation / account / chats | Existing account, tab ownership, attendance, deadlines and read-only guards stay intact. Styling and copy must not create a JOIN intent. |
| Browser diagnostics | Observe exceptions, rejections, console warnings/errors and network failures without suppressing output. Store safe categories/counts, never tokens, request bodies, private text or media URLs. Classify only explicitly expected negative-test failures. |

Validation results, measurements and unresolved limitations are appended after execution. This audit does not establish physical-device, live Firebase/backend or exhaustive assistive-technology parity.

## Implemented corrections and decisions

- New-profile sensitive selectors start empty locally in `ProfileForm.tsx`. Shared DTO defaults and saved profiles are unchanged. This is an intentional Web privacy improvement over Android defaults, not a matching/eligibility rule change. Country and age/distance defaults remain visible and editable.
- Create/Save actions appear before the editable fields. The entire activation section moves directly below the draft heading, with its button before supporting text. A successful create resets document scrolling once when the new profile ID replaces the empty profile. Polls, photo changes and existing-profile editing do not reset scroll. No sticky/fixed overlay, wizard, CSS redesign or hidden field is introduced.
- `noValidate` routes native-required and custom validation through one existing validator. A unique alert summary describes invalid controls; a layout effect focuses the first invalid control in document order, which uses native browser scrolling. Busy programmatic submits return without writing. Existing synchronous mutation ownership remains intact.
- First-chat Activity CTA now shares the surrounding cards' disabled state. Copy for supported Web interactions points to Activity or retry. Unknown backend activity types retain Android fallback rather than promising an unimplemented Web action.
- Tab favicon PNGs/ICO use a tighter circular crop with transparent corners; installation images and metadata are byte-identical to HEAD. See [browser identity](browser-identity.md).

## Audit coverage and remaining differences

This is a bounded source/test/runtime audit, not proof that every control or Android state has been exercised on hardware. The existing parity matrix remains the single feature matrix. Android paths below are under `app/src/main/java/com/reals/app/` at `87e2979`.

| Surface | Android / Web references and findings | Evidence and limit |
| --- | --- | --- |
| Authentication | `ui/auth/LoginScreen.kt`, `ui/root/SessionCoordinator.kt`; Web `auth/LoginScreen.tsx`, `auth/session.ts`. Remember starts off; mode/recovery/provider actions have pending and owner-scoped feedback. No new deceptive default confirmed. | Synthetic email login/logout in Chromium; complete auth regression tests. Live OAuth, mail and credential persistence not exercised. |
| Legal | `ui/legal/LegalRequirementsScreen.kt`, `ui/root/LegalCoordinator.kt`; Web `Onboarding.tsx`, `contracts.ts`. Separate document links and factual accept/acknowledge actions; no automatic consent added. | Chromium explicit acknowledgement plus legal/version-conflict regression tests. Actual legal content and document availability not audited. |
| Creation/editing | `ui/profile/CreateProfileScreen.kt`, `GenderPreferenceSelector.kt`, details/preferences sections, domain `CreateProfileInput.kt`; Web `ProfileForm.tsx`, slider and contracts. Android preselects MALE/FEMALE/DATE and places create at the bottom; Web now deliberately requires explicit sensitive choices and uses top actions. | Focus, sensitive blanks, saved values, country loading, invalid input and age controls in RTL. Real Chromium keyboard Enter, hit-tested pointer clicks, slow create and single POST. No physical IME or screen-reader claim. |
| Activation/photos | `ui/profile/ProfileStatusScreen.kt`, `ProfilePhotosSection.kt`, crop/reorder helpers, `ui/root/ProfileOperationHandler.kt`; Web `Onboarding.tsx`, `PhotoGrid.tsx`, `CropDialog.tsx`. Verification and moderation remain separate backend gates. | Chromium PNG decode/crop/JPEG upload fixture and single write; full photo/activation failure regression suite. Synthetic activation does not verify real moderation, minimum photo requirements or storage. |
| Home/Activity | `ui/matchmaking/MatchmakingHomeScreen.kt`, `HomeScreenModel.kt`, `ui/root/HomeCoordinator.kt`; Web `Home.tsx`, `useHome.ts`, presentation helpers. Confirmed inconsistent first-chat disabled state and outdated guidance corrected. Optional public questions and private affinities retain accurate privacy copy. | RTL failed reconciliation/retry regression; existing Home and browser priority scenarios. Unknown activity fallback remains limited. |
| Visual Review | `ui/chat/VisualApprovalScreen.kt`, `VisualProfileCard.kt`, `VisualApprovalLifecycle.kt`, `ui/root/VisualApprovalCoordinator.kt`; Web `visual/`, Home visual-return helpers. Decisions and safety confirmations remain explicit. | Existing Chromium mobile/desktop scenarios verify photo/source retention, scroll, approval/rejection, block, ownership and expiry; no new product-policy defect demonstrated. |
| Scheduling | `ui/scheduling/SchedulingScreen.kt`, round/lifecycle helpers, `ui/root/SchedulingCoordinator.kt`; Web `scheduling/`. Server deadlines remain legitimate lifecycle constraints; no artificial urgency finding. | Chromium mobile/desktop slow poll, obsolete response, uncertain write, one POST, DST, expired acceptance and block checks. No real scheduling service mutation. |
| Both chats | `ui/chat/ChatScreen.kt`, First/Second panels, safety/audio helpers; `ui/root/FirstChatCoordinator.kt`, `SecondChatCoordinator.kt`; Web `chat/` and session/restoration/navigation modules. Read-only, attendance and privacy guards preserved. | First chat send/layout in Chromium; second-chat synthetic HTTP/history/recorder scenarios and complete unit suite. Real microphone/audio capture remains unverified: native headless recorder produced zero bytes, correctly rejected. |
| Account | `ui/matchmaking/HomeAccountSection.kt`, `ui/profile/DeleteAccountSection.kt`, account recovery/suspension/notification screens; Web `AccountSection.tsx`, auth account components. Destruction has confirmation/cancellation; no financial mutation exists. Support link offers no in-app advantage. | Full account/sign-out/ownership regressions; Chromium logout cancel/confirm. Native dialogs, live Firebase reauthentication, actual deletion and notifications not executed. Android-only browser push guidance remains accurate. |

Source/test review found no demonstrated unintended consent, duplicate financial action or cancellation deterrent beyond the five confirmed issues above. This is not a legal assessment or an exhaustive dark-pattern certification. No domain deadline, attendance, penalty, retention or moderation policy changed.

## CTA measurements

Native headless Chromium; CSS pixels, height 844, document scroll initially zero. Baseline rendered HEAD versions of only the two onboarding components temporarily, restored byte-for-byte in `finally`. Same fixture/content and viewport used before/after; no secret/account data. Minimum scroll is `max(0, button.bottom - viewport.height)`.

| Viewport | CTA | Before top / minimum scroll | After top / minimum scroll |
| --- | --- | --- | --- |
| 390 x 844 | Create | 1759.81 / 963.81 | 313.81 / 0 |
| 390 x 844 | Activate | 1701.69 / 901.69 | 350.25 / 0 |
| 1280 x 844 | Create | 1411.81 / 615.81 | 289.81 / 0 |
| 1280 x 844 | Activate | 1867.72 / 1067.72 | 350.25 / 0 |

At 200% root text scaling activation top/bottom were 615.53/681.53 mobile and 567.53/633.53 desktop, without horizontal overflow. Native document scrolling keeps actions reachable without overlay interception. This is text enlargement, not a physical-device virtual keyboard or full browser-chrome zoom test. Safe-area/toolbar handling uses existing natural document layout; hardware verification remains open. Before/after JSON and mobile/desktop screenshots are in ignored `artifacts/ux-audit/`; the mobile after screenshot was visually inspected.

## Diagnostics and exact validation

`tools/browser-diagnostics.mjs` observes CDP Runtime exceptions (including unhandled promise rejections), console errors/warnings, browser Log entries, failed/canceled resources and HTTP >=400. It retains safe category/count reports under `artifacts/ux-audit/`, never console arguments, URLs, payloads or credentials. Uncaught exceptions set a failing exit code. Console/network findings remain visible and require classification; no global console suppression or validation exemption was introduced.

- `npm run test:focused -- src/onboarding/ProfileForm.test.tsx src/onboarding/Onboarding.test.tsx src/home/Home.test.tsx`: initial runs exposed obsolete copy assertions, corrected. A concurrent run had one onboarding mount timeout; isolated `npm run test:focused -- src/onboarding/Onboarding.test.tsx` passed 106/106. Final `ProfileForm` coverage: 18/18 PASS in focused/full runs, including the additional sensitive-choice test. Final `npm run test:focused -- src/home/Home.test.tsx`: 92/92 PASS, including first-chat disabled/retry regression.
- `npm run typecheck`: PASS. `npm run check:architecture`: PASS, 83 production modules, zero runtime cycles.
- `npm test -- --maxWorkers=2 --reporter=json --outputFile=artifacts/ux-audit/full-tests.json`: PASS, 1652/1652 tests, 68 files. Full suite run once.
- `npm run build`: PASS, 128 transformed modules. Existing bundle-size advisory (>500 kB) remains; no runtime warning was silenced.
- `node tools/ux-runtime-browser.mjs --before`: PASS at both widths. `node tools/ux-runtime-browser.mjs`: originally reported PASS at both widths, synthetic login/legal/create/slow write/validation/photo crop-upload/activation/Home/account/logout, zero captured diagnostics. **Correction:** the committed scaling loop tested `overflow` on the result of `scrollTo`, not the measured object; that PASS did not establish the scaling-loop overflow assertion. See the independent-review correction below for the exact rerun and verified result. Clicks use native CDP pointer events with hit testing; Enter uses native keyboard events. Form filling and file injection are synthetic.
- `node tools/visual-review-smoke.mjs`: PASS, 390/1440 widths and safety/ownership; zero diagnostics.
- `node tools/scheduling-smoke.mjs`: PASS, 390/1440 widths plus DST/failure/block checks; zero diagnostics.
- `node tools/first-chat-smoke.mjs`: PASS, send once/cleared draft at 390 and no overflow at 1280; zero diagnostics. Native headless MP4 recording not validated (zero-byte capture rejected).
- `node tools/generate-browser-icons.mjs --favicons-only`: PASS, only the three tab assets differ from HEAD.
- `node tools/check-browser-identity.mjs --url=http://127.0.0.1:5174`: PASS; `node tools/check-browser-identity.mjs --url=http://127.0.0.1:5186 --scale=2`: PASS against production preview, no manifest/installability errors. Both review sheets show the favicon at actual 16/32 px on light/dark backgrounds. Native tab chrome remains unverified.

Second-chat execution details and final diff review follow below. No live Firebase/backend account was used; `.env.local` values were not copied into reports.

### Second Chat and diagnostic classification

- `node tools/second-chat-browser.mjs`: final PASS, 72 scenarios / 704 assertions across 390 and 1280 layouts (144 participant pages). Coverage includes explicit entry vs JOIN, reload/history, attendance, cutoff/expiry/retention, uncertain sends/audio, retry, safety/blocking, ownership replacement and 200% text. Final output: `artifacts/ux-audit/second-chat-final.log`; preserved diagnostic report: `diagnostics-second-chat-full.json`.
- Earlier extensive runs stopped on a desktop cutoff timeout and a repeatable ownership-fixture startup race. The cutoff case passed alone (`--case=home-starting-soon-and-stale-scheduled`, 36 assertions). The ownership harness had treated Page.navigate acknowledgement as a mounted first owner; it now waits for the real first chat before opening the competitor, retaining all transfer assertions. `--case=reload-tab-ownership-transfer` passed both widths / 16 assertions, followed by the full 72-case PASS. No product ownership/expiry guard was changed. The initial cutoff timeout remains recorded as a prior intermittent harness result, not erased or claimed diagnosed.
- Final full second-chat diagnostic counts: zero uncaught exceptions/rejections, zero console errors/warnings, 402 canceled requests during teardown/ownership/navigation, 16 HTTP 503, 6 HTTP 409, 4 HTTP 403 and 26 corresponding browser network errors. The HTTP counts are explicit synthetic negative scenarios (unavailable/recoverable reads and uploads, rejected concurrent/cutoff joins, terminal audio policy); recovery/no-duplicate/private-DOM assertions pass. No failed resource outside those expected statuses was captured.
- Three browser intervention errors occurred in synthetic reload scenarios. The focused repeat `node tools/second-chat-browser.mjs '--case=reload-active-both|reload-status-failure-retry'` passed 4 cases / 30 assertions and reproduced `beforeunload-no-user-gesture`: Chromium refuses a confirmation panel without prior physical interaction. This is a browser/harness diagnostic, not an uncaught application exception. Diagnostics now categorize that known text without saving its contents. No Firebase development diagnostic or third-party console message was observed in these mocked scenarios; no conclusion is made about live Firebase/OAuth logs.

### Final diff review / remaining validation

23 files: three production components (`ProfileForm`, `Onboarding`, `Home`), three regression-test files, three favicon assets, three docs and eleven browser/generation/fixture helpers. No dependency, backend contract, CSS token/layout system, manifest, installation asset or CI-suite change. `git diff --check`: PASS; changed text inspected for Spanish accents and mojibake. Android/backend working trees remain clean. No commit, push, PR, merge or deployment performed.

Remaining validation is physical mobile toolbar/IME/safe-area behavior, full browser zoom (the executed 200% case scales text), assistive technology, real identity/mail/moderation/storage/scheduler/microphone, native-tab rendering and exhaustive Android screenshot/control parity. Backend deadlines are authoritative and unchanged; test success does not establish these unexecuted areas. Larger parity work stays in the existing matrix rather than this patch.


## Independent-review corrections to e92ceeb

Scope: only independent intention/interested-gender validation and the scaling-loop measurement assertion. Starting tree was clean on `feature/second-chat`; HEAD and available remote-tracking ref were `e92ceeb`. No backend, Android, assets, manifest or unrelated UX changes.

### Confirmed validation defect and fix

With all other fields valid and interested genders selected, leaving intention empty marked both controls invalid and focused the first checkbox. The inverse case also incorrectly marked a valid intention invalid. `contracts.ts` now emits independent errors for each condition; `ProfileForm.tsx` maps the interested-gender error only to that checkbox group. The allowed intention/gender enums, nonempty-interest requirement, normalization and payload structure are unchanged.

| Path / invariant | Review |
| --- | --- |
| Create and filter validation | Invalid intention or interested genders independently block submission. Valid counterpart has neither invalid state nor error description; first invalid control retains focus and alert association. |
| Corrected resubmission / saved profile | Existing saved choices remain intact; fixing the single missing field submits once with the same enum/list values. No auto-selection or payload change. |
| Async/mutation ownership | No new requests, response-installation paths, timers or effects. Existing busy guard, synchronous owner lock, reconciliation and sign-out handling are unchanged. |

Four focused regressions (each missing field independently, in create and filters modes) failed before the fix. They now assert focus, invalid/error-description isolation, no invalid write and exactly one corrected valid submission.

### Exact Chromium execution and correction to prior evidence

Before editing, the exact committed command `node tools/ux-runtime-browser.mjs` ran against Vite on `http://127.0.0.1:5174`: **exit code 0**, both viewports and both text sizes completed, zero captured diagnostics. Local native headless Chromium identifies itself as 157.0.0.0. A separate runtime probe observed that `scrollTo(0,0)` returns an object and, when awaited, resolves to `{interrupted:false}` here. Consequently `m.overflow` was undefined and silently skipped the intended check. On implementations returning undefined the same code would throw instead. The earlier PASS was therefore insufficient evidence for that assertion even though the script really exited successfully here.

The fix obtains `m` directly from `measure('Activar perfil')` after scrolling; no assertion was removed. Running the exact edited repository command `node tools/ux-runtime-browser.mjs` again returned **exit code 0**. It completed login/legal/create/slow-write/validation/photo crop-upload/activation/Home/account/logout for both widths; diagnostics totals were empty. The existing viewport-bound checks also passed after scrolling each action into view.

| Viewport / text size | Activation top / bottom at scroll zero | Measured overflow | Result |
| --- | --- | --- | --- |
| 390 x 844 / 100% | 350.25 / 394.25 | false | PASS |
| 390 x 844 / 200% | 615.53 / 681.53 | false | PASS |
| 1280 x 844 / 100% | 350.25 / 394.25 | false | PASS |
| 1280 x 844 / 200% | 567.53 / 633.53 | false | PASS |

Actual script JSON remains in ignored `artifacts/ux-audit/after-measurements.json`. Text scaling is still root-font enlargement, not physical keyboard/browser-toolbar testing or native browser zoom. This correction makes no new hardware or live-service parity claim.

### Validation for these two fixes

- `npm run test:focused -- src/onboarding/ProfileForm.test.tsx`: before fix, exit 1 (four new failures, 18 existing passes).
- `npm run test:focused -- src/onboarding/ProfileForm.test.tsx src/onboarding/contracts.test.ts`: after fix, exit 0, 67/67 tests in two files.
- `npm test -- --maxWorkers=2 --reporter=json --outputFile=artifacts/ux-audit/review-fixes-full-tests.json`: exit 0, 1656/1656 tests, 68 files; full suite run once for these corrections.
- `npm run typecheck`: exit 0.
- `npm run build`: exit 0, 128 transformed modules; existing >500 kB bundle advisory remains.
- `git diff --check`: exit 0.

### Subsequently requested favicon follow-up

After the two fixes above were validated, the user requested a further tab-icon
polish. Only the three favicon assets, their generator/checker and related docs
were additionally changed. The full circular seal is replaced at tab sizes by
its larger source monogram on transparency, with a fine ivory keyline for dark
backgrounds. PWA images remain byte-identical to HEAD; manifest/HTML are unchanged.
See [browser identity](browser-identity.md#verification-and-limits) for exact
generation, development and production-preview checks (all final exit codes 0),
light/dark review and native-tab limitations. The final build was rerun after
asset generation; application code and unit tests did not change after the full
suite above. No commit, push, merge or deployment was performed.

## Scheduling and Second Chat refinements

Branch `fix/second-chat-visual-refinements` starts at fetched `origin/development` `a954fa6ee85b5cfa93738bcb361584d80455a8bd`. See the [Android parity matrix](android-parity-matrix.md#scheduling-exits-and-second-chat-presentation) for the source comparison.

- Scheduling rendered a font glyph inside the outline control and used the same trail-relative callback for both return buttons. Confirmed scheduling now names and targets Activity and Home separately. The unconfirmed exit follows the caller. The 48px icon button retains the scoped block menu and native modal.
- Second Chat installed status before verifying the chat and fetching history. The view rendered that intermediate status and its actions. It now presents a structural skeleton until authoritative data, entry reconciliation and initial history are ready. Empty validated pages satisfy readiness. Passive restoration uses the same shell from skeleton through chat. The original light-theme timeline used a transparent border. Retained history now has a visible frame in both themes.
- Global busy feedback competed with action-specific feedback. Safety and resolution confirmations announce progress and show errors within the dialog. A transient error retains the form and permits connection recovery. The timeline owns outgoing delivery status and audio retry in both chats.
- Playback formatted elapsed seconds by flooring and duration by rounding up. Visibility changes and competing media released the element through the pause path, which relabeled completion as paused at the end. Clock rounding is now shared and completion owns the final position. Release preserves completed playback, and one gesture resets visual progress and starts a new media element at zero.

| Installation or mutation path | Invariant |
| --- | --- |
| Scheduling reads, confirmation and block | The existing lifecycle model owns actions, aborts overlapping reads, and reconciles writes. Both exit buttons respect the pending lock and the same History guard as profile browsing and browser Back. |
| Second Chat initial reads, JOIN and restoration | Match validation, status and chat/history reads use the current account, connection, abort signal and generation. JOIN requires a consumed explicit intent or an explicit entry button. Polling/restoration never JOIN. An initial error exits the skeleton with recovery. A history marker is installed with validated rows, including an empty result. |
| Same-chat refresh, focus return and overlapping responses | Status remains immediate for deadline enforcement. A compatible history remains mounted and usable, with the draft and reply retained. Transient failures block writes and show retry. Replaced or unreadable history clears readiness. A canceled or obsolete read cannot install. |
| Retention, terminal states and private audio | Retention expiry or authoritative history denial withdraws protected content. The participant media access header still owns counterpart audio. An access restriction removes the player from the timeline and preserves permitted rows. Account replacement and unmount retire scoped media. |
| Text/audio send, reactions and resolution | Existing synchronous write guards continue to own mutation and reconciliation. The timeline models a pending, failed or uncertain delivery, and retries reconcile the same client ID. No automatic mutation replay was added. Temporary write gates can hide the active composer while retaining its audio payload. |
| Recording and playback | Recorder generation and confirmation ownership still fence preparation, blob release and duplicate sends. Playback serial, element and intent fence old events and delayed URL renewals. Completion survives hide or competing playback. Paused media keeps its current position. Tab return never plays automatically. |

### Validation

```powershell
npm run test:focused -- src/chat/SecondChat.test.tsx src/chat/SecondChat.review.test.tsx src/chat/SecondChat.contract.test.tsx src/chat/SecondChatSession.test.ts src/chat/SecondChatSession.media.test.ts src/chat/SecondChatSession.terminalAudio.test.ts src/chat/FirstChat.test.tsx src/chat/AudioComposer.test.tsx src/chat/MessageAudio.test.tsx src/chat/postBlockMedia.security.test.ts src/chat/textSend.test.tsx src/home/Home.secondRestoration.test.tsx src/home/useHomeNavigation.test.tsx src/home/Home.test.tsx src/scheduling/Scheduling.test.tsx --maxWorkers=2
npm run test:focused -- src/home/Home.secondRestoration.test.tsx src/home/Home.test.tsx src/chat/SecondChat.test.tsx src/chat/SecondChat.review.test.tsx src/chat/SecondChatSession.terminalAudio.test.ts --maxWorkers=2
npm run typecheck
npm run check:architecture
npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
node tools/scheduling-smoke.mjs
node tools/first-chat-composer.mjs
npm run dev -- --host 127.0.0.1 --port 5175 --strictPort
node tools/second-chat-browser.mjs '--case=refinements|audio-policy-url-upload-and-identity|counterpart-audio-retirement'
git diff --check
```

Focused passes were 401 tests across 15 files and 172 tests across the five files affected by the final restoration/dialog checks. Typecheck and the architecture guard passed with 106 production modules and zero runtime cycles. Chromium Scheduling passed at 390×844 and 1440×900. First Chat composer passed at 390, 768 and 1440px, including a browser-generated AAC preview and same-ID delivery retry. Second Chat passed 106 checks over eight scenario/viewport combinations at 390×900 and 1280×900. Those checks used native AAC media events for natural completion, release on a real Chromium tab switch, replay and access retirement. The HTTP 403/503 diagnostics came from the scripted signed-link renewal and uncertain upload cases.

Screenshots are under ignored `artifacts/second-chat-refinements/` and `artifacts/scheduling/`, including light and dark layouts for delayed loading, composer, both dialogs, retained history and confirmed scheduling. HTTP responses and the Second Chat recorder were synthetic. Physical Safari, WebKit, device microphone behavior, live authentication/backend races and Android device rendering remain unverified. The full CI suite and production build were outside this focused pass.
