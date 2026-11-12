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

[CI](../.github/workflows/ci.yml) runs on pull requests targeting `main` (opened, reopened, or updated) and pushes to `main`. Its single job, `Web validation` (job ID `validation`), runs on Ubuntu with Node.js 24, compatible with the `^24.15.0` engine requirement in `package.json`. The official `actions/setup-node` action caches npm's download cache using `package-lock.json`; dependencies are installed afresh with `npm ci`.

The job runs these commands in order and stops if a step fails:

```sh
npm ci
npm run check:architecture
npm run typecheck
npm test -- --maxWorkers=2
npm run build
```

To inspect results, open the repository's **Actions** tab, select **CI**, then open a run and its **Web validation** job to view step logs. On a pull request, open **Checks** or follow **Details** beside the check. After the first successful run, require the exact status-check name **`Web validation`** (GitHub Actions) in the branch-protection rule for `main`. Keep this job name stable so the required check continues to match.

The workflow has only `contents: read` permission and needs no custom secrets or backend connection. It performs code-quality validation only; CodeQL default analysis and Dependabot remain configured separately. GitHub-hosted execution must be confirmed by the first run; local commands do not verify hosted execution.

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
