# Current validation policy

Use focused tests while editing: `npm run test:focused -- <test-file paths>`. The wrapper refuses an empty filter so an iterative command cannot accidentally run the entire suite. `npm run test:watch -- <paths>` remains available. Dot reporting and a 1500-character RTL DOM diagnostic limit retain failures without printing passing test details or whole screens.

| Change | Start with |
| --- | --- |
| Queue/geolocation | `src/home/location.test.ts`, `src/home/Home.test.tsx` |
| Session/Firebase | `src/App.test.tsx`, `src/auth/firebase.test.ts`, `src/auth/persistence-sdk.test.ts` |
| Ownership/policy | `src/tabs/`, `src/App.ownership.test.tsx` |
| Sign-out/account | `src/auth/SignOutButton.test.tsx`, `src/home/AccountSection.test.tsx`, `src/home/Home.test.tsx`, `src/App.test.tsx`, `src/onboarding/Onboarding.test.tsx` |
| Profile mutations | `src/onboarding/Onboarding.test.tsx` plus the changed field/photo/crop tests |

Run `npm run typecheck` after meaningful TypeScript changes. At final validation run **one** `npm test`, `npm run build`, and `git diff --check`; repeat the full suite only to investigate failures or validate subsequent material changes. Use only browser scenarios relevant to the change. The complete CI regression suite and its auth/persistence/ownership/history/account/profile coverage remain enabled. Do not repeatedly run the whole suite to obtain a green result from a flaky test; fix its synchronization/ownership instead.

Test audit for the runtime refinements: the two standalone permission-denial/fallback-count tests in `location.test.ts` duplicated the browser-error table; those same assertions now live in each table case. Two duplicate HTMLDialogElement mock setups in Account tests were replaced by the shared jsdom dialog shim; a shared sign-out confirmation helper keeps session/onboarding integration tests focused. Boundary tables, layer-specific API/UI tests and critical mutations remain because they cover distinct contracts, not duplicate scenarios. Total count can increase as new policy/dialog scenarios are added; count alone is not a coverage target. See [runtime review](runtime-refinements.md) for evidence and final counts.

The earlier stage logs below are historical results, not a requirement to replay every command or browser scenario during each change.

# Testing

React tests run in jsdom with Vitest, React Testing Library and jest-dom matchers; the Android tunnel helper tests use the Node environment. Tests live beside the component or helper they exercise. Shared setup performs explicit cleanup after each test. Stage B has 101 tests across 5 files, including the unchanged 21 login presentation tests and 18 Android tunnel helper tests.

```powershell
npm run typecheck
npm test -- src/auth/LoginScreen.test.tsx src/App.test.tsx
npm run build
```

Use `npm run test:watch -- src/auth/LoginScreen.test.tsx` while editing. `npm test` runs all 101 tests across login presentation, mocked auth/session integration, HTTP contracts, modular Firebase adapter and the Android tunnel helper. The build includes another type-check so standalone builds cannot skip it. Login tests cover mode switching, argument forwarding, remember default/toggle, masking/autofill hints, recovery/Google callbacks, all busy states in both modes, owner-scoped errors, reset feedback, cooldown rounding/expiry/replacement, background resume, and StrictMode timer cleanup. No credentials or backend connection are required.

Run `npm test -- tools/android-tunnel.test.mjs tools/android-tunnel-monitor.test.mjs` for the one-shot helper and lifecycle monitor tests. These use the Node environment, mocked subprocesses and fake timers to cover discovery, literal serial arguments, authorized/unauthorized/offline/malformed rows, multiple devices, late connection, disconnect/reconnect with the same serial, lost/incorrect mappings, failures, bounded async execution, no overlapping polls, shutdown and late responses. They do not verify a physical tunnel. See [local development](local-development.md#android-chrome-over-usb-or-wireless-adb) for manual checks. Typecheck and production build do not start ADB monitoring.

Monitor invariants and mutation review:

| Path | Invariant / response handling |
| --- | --- |
| Discovery / device enumeration | Rediscover each cycle; inspect only authorized devices. Failed enumeration never installs a tunnel. |
| Mapping inspection / creation | Read actual device mappings each cycle; only successful inspection permits creation. Correct mappings are skipped; failed mutations wait for the next inspection before retrying. No other ports change. |
| Poll completion / failure | One cycle owns the next timer; schedule only after completion. Warn on issue transitions; no raw subprocess output or device serials are logged. |
| Server close / restart / shutdown | Abort only the owned client, clear the timer and detach the close listener. Aborted continuations cannot launch commands, log success or schedule another poll. Each server instance owns its cleanup. |

Manual regression: start `npm run dev -- --host 127.0.0.1` without a phone; connect/authorize it, open Android Chrome at `http://127.0.0.1:5173/`, disconnect/reconnect and remove just the 5173 mapping to check restoration. Stop Vite and confirm monitoring stops. Hardware checks remain manual; no backend/session state is involved.


## Continuous integration

[CI](../.github/workflows/ci.yml) runs on pull requests targeting `development` or `main` and on pushes to either branch. Manual dispatch can select a branch once this workflow is present on the repository's default branch. The `Web validation` job runs on Ubuntu with Node.js 24 and installs dependencies with `npm ci`.

The job runs these commands in order and stops if a step fails:

```sh
npm ci
npm run check:architecture
npm run typecheck
npm test -- --maxWorkers=2
VITE_REALS_ENVIRONMENT=dev npm run build
VITE_REALS_ENVIRONMENT=prod npm run build
```

To inspect results, open the CI run and its **Web validation** job, or open **Checks** on the pull request. After the first successful hosted run, require **`Web validation`** on both integration branches where branch protection or repository rules are available.

The workflow has only `contents: read` permission and needs no custom secrets or backend connection. The build step supplies [synthetic configuration](../.github/workflows/ci.yml) for both environments. For local build checks, use those fixture settings or a valid remote configuration and set both local-only flags to `false` if enabled in `.env.local`. See [deployment settings](deployment.md). GitHub-hosted execution must be confirmed by the first run.

### CodeQL analysis scope

[CodeQL](../.github/workflows/codeql.yml) loads
[the analysis configuration](../.github/codeql/codeql-config.yml), which excludes
the root `tools/**` directory from analysis. This is an analysis exclusion, not a
workflow trigger filter: changes under tools still run CI, and the existing full
regression suite continues testing those helpers. JavaScript/TypeScript and
GitHub Actions remain analyzed with the default query suite. CodeQL runs for PRs
targeting `development` or `main`, pushes to either branch, weekly, and manually.

Activation: the repository currently uses CodeQL **default setup** (verified
read-only while preparing this change). A standalone configuration file does
not customize default setup for this personal-account repository. When adopting
the checked-in workflow, switch the repository's CodeQL configuration to
**advanced setup** under Settings -> Advanced Security -> Code scanning ->
CodeQL analysis, using this workflow rather than creating a second one. The
workflow/configuration must be present on the analyzed branch. Until that switch,
default setup remains authoritative and the exclusion is not active. See
[GitHub's setup instructions](https://docs.github.com/en/code-security/how-tos/find-and-fix-code-vulnerabilities/configure-code-scanning/configuring-advanced-setup-for-code-scanning)
and [configuration reference](https://docs.github.com/en/code-security/reference/code-scanning/workflow-configuration-options#specifying-directories-to-scan).

No repository settings are changed by these files. Hosted CodeQL execution and
actual file coverage must be verified on the first advanced-setup run; local
tests/build do not run CodeQL.

Local validation (2026-11-16): YAML parsing and configuration-path/language/permission checks passed; referenced action major tags verified upstream. `npm test -- --maxWorkers=2 --reporter=json --outputFile=artifacts/codeql-config/full-tests.json`: 1670 passed, zero failures. `npm run build` (including typecheck), `npm run check:architecture` and `git diff --check`: PASS; existing bundle-size advisory remains. Source code, dependencies and `.github/workflows/ci.yml` are unchanged. No hosted CodeQL run or repository setting change was performed.

Session tests mock Firebase through a typed service and HTTP through injected fetch. Separate adapter tests mock the modular SDK. They cover missing config, sign-in/signup/Google outcomes, verification send/retry, restoration and StrictMode, identity replacement, external sign-out, stale responses, reset validation/202/failure/cooldown, provisioning restrictions, profile detection/validation, token refresh limits, malformed/network responses and restricted/terminal accounts. No backend, real credentials or phone is needed. Existing login tests retain fake-clock coverage of cooldown expiry and background resume.

## Stage A manual device checklist (not yet executed)

Run `npm run dev` through the team's device-accessible development setup. On Chrome Android and Safari iOS:

- Compare both modes against Android at narrow portrait and landscape widths in light/dark themes; confirm original seal/icon, Spanish copy, spacing, field outlines and focus/disabled contrast.
- Open/dismiss the virtual keyboard for each field, switch between fields, rotate, expand/collapse browser chrome and verify scrolling reaches every action without clipping, horizontal overflow or a trapped focus. Check safe areas on a notched iPhone.
- Verify email keyboard, password masking, password-manager fill/save behavior, new-password suggestions in sign-up, and that the remember preference does not promise browser storage control.
- Check external-keyboard Tab/Shift+Tab/Enter/Escape, visible focus, 200% zoom/text scaling and TalkBack/VoiceOver labels, headings, busy state and error/feedback announcements. Ensure countdown changes do not create repetitive live announcements.
- With externally supplied pending/feedback/deadline props, verify all actions lock, feedback ownership and cooldown recovery after background/resume. The standalone app intentionally only reports unavailable integrations; it never simulates success or reset delivery.

No browser/device visual result is claimed from jsdom. A headless Chrome preview attempt was rejected by the environment execution policy. HTTP/backend checks are outside Stage A; no actual API requests are made. Future backend connectivity instructions remain in [local development](local-development.md).

The [Android testing guide](../../reals-app/docs/testing.md) informs behavior priorities. Android build tasks, emulator tests and release APK checks are platform-specific and are not copied.

## Stage B validation

```powershell
npm run typecheck
npm test
npm run build
git diff --check
```

Latest local result: typecheck PASS; 101/101 tests PASS in 5 files; build PASS. Real Firebase/backend and Windows/Android browser auth smoke tests were not run because `.env.local` was absent. Follow the [Firebase setup and manual checklist](local-development.md#firebase-web-setup-stage-b). Passing mocks do not prove OAuth authorization, real mail delivery or device persistence.

`npm audit --omit=dev` reports four high entries propagated from the Firebase umbrella package's Firestore → gRPC dependency (gRPC 1.9.16). App/Auth are the only Firebase browser imports; Firestore/gRPC are not used by this application. Do not accept the audit's suggested downgrade to Firebase 9.14.0 without review. Re-evaluate upstream versions before extending Firebase usage or shipping this POC.

## Stage C validation and smoke checklist

Automated coverage adds real onboarding surface tests with mocked Firebase/fetch, DTO/form/legal/crop geometry validation, JPEG canvas export, multipart boundaries, add/replace/delete/reorder reconciliation, legal version conflicts, email reload/cooldown, backend activation rejection codes, StrictMode duplicate submission, sign-out stale results and crop resource cleanup. Stage B's 105 authentication/login/ADB tests remain, with its App tests explicitly isolating the onboarding surface; Stage C tests exercise that real integration separately. CI needs no backend or credentials.

Latest Stage C validation: `npm run typecheck` PASS; `npm test` PASS (178 tests in 9 files, including the existing 105); `npm run build` PASS; `git diff --check` PASS.

Manual disposable-account smoke (pending on Windows Chrome and physical Chrome Android):

1. Start the existing Firebase/PostgreSQL/MinIO/Spring Boot setup and Vite. Confirm `/api` requests and optional MinIO ADB mapping described in [local development](local-development.md).
2. Register a disposable account. Inspect the legal gate only when requirements are unsatisfied; open each current document, perform its explicit required action, reload and confirm persisted completion. Test an updated version from authorized backend configuration separately.
3. Search `espana` and select España; verify required fields, invalid dates, underage input, age range and plain-text errors. Create once with rapid repeated clicks; confirm DRAFT and restoration after reload.
4. For email/password, verify resend cooldown, delivery and **Ya verifiqué** with refreshed token. Separately test verified Google and the existing local-only auto-verification flag.
5. Select JPEG/PNG on desktop and phone. Drag crop, use keyboard sliders, reset, cancel and confirm. Check orientation, vertical output and square thumbnails. Reject HEIC, corrupt and oversized inputs safely.
6. Add at least four suitable disposable photos; confirm backend validation/moderation classifications. Replace one by ID, delete with cancel/confirm, reorder all photos, and reload. Test offline upload and refresh authoritative state before retrying; check no duplicate photo. Check pending/rejected guidance and refreshed storage URLs.
7. Edit profile details and match preferences separately; reload. Attempt activation before meeting prerequisites and review actual backend errors. With server-approved requirements met, activate and confirm **Tu perfil está activo**, **Ir a Inicio**, reload into temporary Home and sign out.
8. Check DRAFT with existing interactions against Android: Web retains a read-only notice and never destroys interactions. Verify account restrictions, legal gate after version changes, sign-out during slow load/upload, background/resume, keyboard navigation, touch drag, narrow layouts, light/dark themes and Spanish accents.

Executed: backend/MinIO health HTTP 200, Vite HTTP 200, and unauthenticated `/api/me` through the Vite proxy HTTP 401. The temporary Vite process was stopped after probing. Real Firebase registration, OAuth, mail delivery, PostgreSQL persistence, photo upload/cropping/moderation, visual rendering and physical-device validation remain pending. jsdom/canvas mocks do not establish those results. No Safari/iOS or HEIC compatibility is claimed.

## Dual-thumb age slider validation

Focused tests cover keyboard bounds/crossing, adjacent/equal values, mouse/touch/pen gestures, pointer ownership and cancellation, disabled/unmounted cleanup, and persisted match-filter intervals. Full validation: `npm run typecheck` PASS; `npm test` 254/254 PASS in 12 files; `npm run build` PASS; `git diff --check` PASS.

An isolated native headless Chrome harness also passed keyboard equality, separate hit-testing at equal values and both boundaries, real mouse dragging at the upper boundary, Chrome touch emulation at the lower boundary, and no horizontal overflow at 360px. The dark-theme preview was inspected. Checks used the actual component/CSS without account data or API calls. Temporary repository harness files were removed and the browser/Vite processes stopped. Automatic approval review blocked deleting the disposable browser profile in the system temp folder; it was left there. Physical Chrome Android, TalkBack and full-form visual validation remain pending. Photo controls were inspected without changing permissions or integration; no actual browser photo failure was identified.

The bracket refinement uses one SVG mirrored for the maximum marker, with separate left/right 44×44 hit targets even at equal values. Numeric Desde/Hasta inputs keep invalid intermediate drafts local, then restore or clamp them on blur/Enter; valid integers update the existing age fields atomically. Regression tests cover symmetry, deterministic overlap selection, adjacent/equal/boundary ages, pointer ownership, keyboard controls, draft synchronization and create/edit payloads. The mutation invariant review is in [onboarding-mutation-review.md](onboarding-mutation-review.md).

Bracket refinement validation: `npm run typecheck` PASS; `npm test` 330/330 PASS in 13 files; `npm run build` PASS; `git diff --check` PASS. Focused slider/ProfileForm run: 42/42 PASS in 2 files.

An isolated headless Chrome check of the bracket implementation passed 26 assertions: 320/360/1000px layout without overflow, mirrored dimensions, vertically centered track, independent 44×44 targets including both equal boundaries, real mouse dragging, touch emulation, keyboard focus and numeric clamping. The dark-theme screenshot was inspected. The temporary harness was removed and its Chrome/Vite processes stopped; no credentials, API calls or account data were used. Still pending: full Create Profile and persisted match-filter screens in interactive Windows Chrome, physical Chrome Android gestures/virtual numeric keyboard, TalkBack, light/dark contrast and 200% text scaling. Emulation does not establish physical-device compatibility.

## Architecture regression check

Run `npm run check:architecture` to reject production runtime import cycles, including lazy imports, while excluding erased TypeScript imports. See [frontend architecture](frontend-architecture.md) for scope, composition invariants and resolver limitations. Focused guard tests: `npm run test:focused -- tools/check-cycles.test.mjs`. CI runs the check before typecheck and keeps the complete regression suite with `--maxWorkers=2`.


## Synthetic shared-contact validation

Run the focused suites in src/contacts plus src/chat/sharedContacts.test.tsx, the existing FirstChat/ChatSession and Account/Home navigation tests. The provider suite mocks GIS, People pagination and navigator.contacts. All names, phone numbers and OAuth responses are synthetic. The local fixture never contacts a real provider or Backend.

Run `npm run dev -- --port 5177 --strictPort` and then `node tools/shared-contacts-smoke.mjs`. The smoke uses an external Playwright installation, local Chrome and Playwright WebKit. For a temporary installation, run `npm install --prefix <temp-directory> --no-save playwright`, install WebKit with that installation's Playwright CLI, and set CONTACT_PLAYWRIGHT_ANCHOR to the absolute path of <temp-directory>/package.json. The script exercises Account navigation, native-style selection with region, select-all, deselection, replacement, stale revision, withdrawal, unavailable providers, and First Chat collapse/dismiss/reload. Screenshots are written to artifacts/shared-contacts.

Run `node tools/shared-contacts-smoke.mjs --additions` for the focused import journey in Chromium and WebKit at 390×844 and 1280×800 in each light and dark theme. The synthetic owner holds its synchronized set in memory and calculates the union. The journey covers overlap, duplicate-only counts and timestamp, replacement, cancellation, stale revision, required resynchronization, deletion and withdrawal. Run `--picker-transitions` and `--region-history` separately for delayed picker settlement and country-dialog navigation. [Mobile additive review](shared-contacts/chromium-mobile-light-add-review.png) · [Desktop confirmed result](shared-contacts/webkit-desktop-dark-add-result.png).

| Synthetic Chromium screenshots | Mobile / light | Desktop / dark |
|---|---|---|
| Home invitation | [Mobile invitation](shared-contacts/chromium-mobile-light-invitation.png) | [Desktop invitation](shared-contacts/chromium-desktop-dark-invitation.png) |
| Selection | [Mobile selection](shared-contacts/chromium-mobile-light-selection.png) | [Desktop selection](shared-contacts/chromium-desktop-dark-selection.png) |
| Country selector | [Mobile selector](shared-contacts/chromium-mobile-light-country.png) | [Desktop selector](shared-contacts/chromium-desktop-dark-country.png) |
| Shared-contact explanation | [Narrow dark header](shared-contacts/narrow-dark-chat.png) | [Open explanation](shared-contacts/narrow-dark-explanation.png) |
| First Chat | [Mobile chat](shared-contacts/chromium-mobile-light-chat.png) | [Desktop chat](shared-contacts/chromium-desktop-dark-chat.png) |

For independent Backend coverage, run `./mvnw -Dtest=SharedContactsPostgresIT test` in a disposable checkout of Backend a1538817afe61be6805c719bb6917f3a8334ef8a with JDK 21 and Docker. It creates disposable PostgreSQL, exercises two owners with five fictional numbers in common, reads the new chat bucket via MockMvc, then verifies invalidation, quota and concurrency. On Docker Desktop 29 the local test needed JAVA_TOOL_OPTIONS=-Dapi.version=1.44 for Testcontainers. For a browser connected to local Backend with fictional entries see [local configuration](deployment.md#local-synthetic-backend).

Physical verification remains open. After provider/legal approval, test Chrome Android native selection, multi-number contacts, cancel/deny and refocus, Safari iPhone with the unsupported-picker state and Google popup, and installed-PWA popup return, pagehide/BFCache, tab lease loss and sign-out during pagination. Exercise the soft keyboard, screen reader focus and chat controls on a small screen. WebKit on Windows and viewport emulation exercise engine/layout behavior only.

## Chat transition browser evidence

Validated on Windows against base `3ac0c250` using synthetic Firebase identities, HTTP responses and an MP4 recorder fixture. Browser frames and rectangle measurements come from the real React components. The following are observations from the delayed fixtures.

| Scenario | Before | After |
| --- | --- | --- |
| First and Second Chat, 360 px Chromium, “Prueba de envío 1” | 145.39 × 84 px pending, 149.39 × 58 px confirmed | 149.39 × 58 px in both states, with the same focused composer |
| First Chat, 360 px Chromium, short / wrapped / multiline / quoted text | Short text 94.41 × 84 → 82.48 × 58 px | Respectively 91 × 58, 257.55 × 322, 91 × 82 and 137.19 × 110 px in both states |
| Manual Google login to the existing queue | Three visible loading messages and 11–13 visible sign-out frames | One visible status, “Preparando Reals…”, zero sign-out frames |
| Automatic queue exit to ready conversation | 32–33 frames showing incomplete chat | Zero intermediate Home or incomplete chat frames. The same search seal remains mounted until reveal. |
| Initialization reads | One match, one chat, one history, one exit-request read | Same four reads. Discovery to ready frame took 564–711 ms in one eight-case run. The match-found presentation lasted 490–584 ms. |

Chromium and WebKit covered 320 px dark, 360 px light, and 1280 px in both themes. The fixture measures short, wrapped, multiline and quoted First Chat text, Second Chat text and audio, the 48 px heart target, an icon inset under 12 px, pending and confirmed heart semantics, and reduced motion. It checks the 18 px dismiss SVG, popup bounds, header stability and keyboard focus restoration. All timings include fixture delays and scheduling. Physical Android/iOS keyboards, assistive technology, real Firebase and hosted-backend latency require separate testing.

Representative Chromium captures at 360 px:

| State | Base | Task branch |
| --- | --- | --- |
| Pending send | [Before](evidence/chat-visual-responsiveness/before-pending.png) | [After](evidence/chat-visual-responsiveness/after-pending.png) |
| Confirmed send | [Before](evidence/chat-visual-responsiveness/before-confirmed.png) | [After](evidence/chat-visual-responsiveness/after-confirmed.png) |
| Shared-contact popup | [Before](evidence/chat-visual-responsiveness/before-contacts.png) | [After](evidence/chat-visual-responsiveness/after-contacts.png) |

Start Vite with `npm run dev -- --host 127.0.0.1 --port 5187 --strictPort`. Run `node tools/chat-transition-browser.mjs` with installed Chrome, Playwright WebKit and Playwright available to Node. An external Playwright installation can be supplied via its module file URL in `PLAYWRIGHT_MODULE`. The fixture writes screenshots to `artifacts/chat-transition/`. For a baseline run, use the task's fixtures with the base application code and pass `--baseline`. For the repeated composer-focus and geometry check, run `node tools/mobile-chat-browser.mjs --geometry`. The initial 360 px reproduction used `--geometry --baseline --focus-baseline`.

Focused regression command (681 passed in 16 files):

```sh
npm run test:focused -- src/App.test.tsx src/App.ownership.test.tsx src/onboarding/Onboarding.test.tsx src/home/Home.test.tsx src/home/Home.secondRestoration.test.tsx src/chat/ChatSession.test.ts src/chat/FirstChat.test.tsx src/chat/SecondChat.test.tsx src/chat/SecondChat.review.test.tsx src/chat/SecondChat.contract.test.tsx src/chat/SecondChatSession.test.ts src/chat/SecondChatSession.media.test.ts src/chat/SecondChatSession.terminalAudio.test.ts src/chat/postBlockMedia.security.test.ts src/chat/textSend.test.tsx src/chat/sharedContacts.test.tsx --maxWorkers=2
```

`npm run typecheck`, `npm run check:architecture` (115 production modules, zero runtime cycles), the production `npm run build` and `git diff --check` passed. Build used the synthetic public settings in the CI “Build dev and prod” step with `VITE_REALS_ENVIRONMENT=prod`, `VITE_LOCAL_FIREBASE_EMAIL_AUTO_VERIFICATION=false` and `VITE_FIREBASE_APP_CHECK_DEBUG=false`. Vite reported the existing 500 kB chunk advisory.

## Synthetic confirmed cancellation

Start `npm run dev -- --host 127.0.0.1 --port 5174 --strictPort` with local ownership opt-in disabled, then run `node tools/runtime-refinements-browser.mjs --cancellation`. The runner exercises the full Home surface against a loopback cross-origin HTTP server. Each OPTIONS and application response has 260 ms simulated latency. Times below are milliseconds, median (min-max), three fresh pages per condition. Normal cache permits reuse after bootstrap. CDP cache-disabled approximates cold request conditions. Neither simulates cold TLS, Firebase credentials or radio startup.

| Build and cache | Click to DELETE response | DELETE response to operational Home | Click to operational Home |
|---|---:|---:|---:|
| Base, normal | 549 (536-552) | 1121 (1111-1152) | 1669 (1663-1689) |
| Optimized, normal | 545 (540-578) | 583 (576-596) | 1136 (1121-1161) |
| Base, disabled | 543 (539-553) | 1136 (1130-1136) | 1674 (1672-1689) |
| Optimized, disabled | 560 (547-563) | 587 (567-594) | 1141 (1130-1147) |

Resource Timing measures DELETE and Home response completion. The first DOM commit exposing an enabled search button measures installed, operational Home. The internal assignment and display paint are not separately timestamped. Home response completed 1630-1650 ms after click before and 1088-1125 ms after. Critical application calls fell from five in three stages to four in two, plus five and four genuine Chrome preflights respectively. Two background affinity GETs followed every presentation. The next poll issued one status GET in all six baseline trials and five optimized trials. One optimized trial also fetched profile and Home after sampling the older version. All these follow-up GETs also preflighted. Hosted and physical-device timings remain unmeasured.

### Measuring post-send responsiveness

Start Vite on port 5187 and run `node tools/chat-send-timing.mjs` with an external Playwright installation and installed Chrome/WebKit. Set `CONTACT_PLAYWRIGHT_ANCHOR` to the package.json beside that installation's node_modules. `CHAT_TIMING_URL` selects the Vite origin. `CHAT_HISTORY_BODY_MS=700` delays the response body after the participant-access header to exercise the text-only lane.

The runner mounts each real chat component with a synthetic controller. Every application request incurs 520 ms of delay to model 260 ms each for the application and preflight stages. Actual OPTIONS timing, token acquisition and hosted service latency are outside this model. Each engine sends once after initialization and three more times as soon as Send becomes usable. Each sample requires the next nonempty draft, an enabled Send button, and a confirmed bubble in the DOM. Timings use the first matching animation frame. Reconciliation measures the last application response completion relative to POST completion. A null measurement means a response was still outstanding when Send became usable. Following each burst, the runner counts poll reads started in six seconds. The normal fixture fits on one history page. Focused media/session tests exercise pagination separately.

The send-change validation passed 448 focused tests in 18 files. The production build used the synthetic public settings from CI. The geometry run exercised both chats at 360, 430 and 1280 CSS pixels. Its diagnostic collector counted six failed resource loads across the six fixture navigations, which explicitly block the production entry module.

```sh
npm run test:focused -- src/chat/ChatSession.test.ts src/chat/SecondChatSession.test.ts src/chat/SecondChatSession.media.test.ts src/chat/SecondChatSession.terminalAudio.test.ts src/chat/FirstChat.test.tsx src/chat/SecondChat.test.tsx src/chat/SecondChat.contract.test.tsx src/chat/SecondChat.review.test.tsx src/chat/contracts.test.ts src/chat/secondContracts.test.ts src/chat/postBlockMedia.security.test.ts src/chat/textSend.test.tsx src/chat/AudioComposer.test.tsx src/chat/sharedContacts.test.tsx src/chat/MessageAudio.test.tsx src/chat/useChatViewport.test.tsx src/chat/ReplySwipe.test.tsx src/home/Home.secondRestoration.test.tsx
npm run typecheck
npm run check:architecture
VITE_REALS_ENVIRONMENT=prod npm run build
node tools/chat-send-timing.mjs
CHAT_HISTORY_BODY_MS=700 node tools/chat-send-timing.mjs
node tools/mobile-chat-browser.mjs --geometry
git diff --check
```
