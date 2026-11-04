# POC effort log

Copy this record for each task. Use actual observations; leave unknown values pending. Record wall time separately from active human/agent effort. Overlapping time must not be double-counted. A passing automated test is not visual approval.

## Task status: Web CI and Android Vite ADB automation

- Branch: `chore/web-ci`, based on `main` (`4092f6d`). Both deliverables belong to this task.
- Implementation: complete in `76e24da` (GitHub Actions CI) and `5cccceb` (automatic Android ADB tunnel before Vite startup).
- CI scope: pull requests targeting `main` and pushes to `main`; Node 24; npm cache; `npm ci`, typecheck, tests and build; stable check `Web validation`; `contents: read` permission.
- Local development scope: `npm run dev` invokes the shared Node.js tunnel helper through `predev`; `npm run android:tunnel` restores port 5173 mappings independently. ADB failures warn without preventing Vite startup. CI does not invoke the hook.
- Validation repeated on 2026-11-04: `npm run typecheck` PASS; `npm test` PASS (19 tests in 2 files, including 18 mocked tunnel tests); `npm run build` PASS.
- GitHub verification: no pull request or Actions run found for this branch at review time. Hosted CI execution and making `Web validation` a required branch-protection check remain pending.
- Human review, browser/device acceptance and effort measurements: pending; no timings inferred.

The [testing guide](testing.md#continuous-integration) documents CI inspection and the required check; [local development](local-development.md#android-chrome-over-usb-or-wireless-adb) documents Android setup and wireless reconnection.

## Task: <name>

- Date, branch and starting/ending commit (or unborn branch):
- Scope and acceptance criteria:
- Android/backend reference revisions (when available):
- Agent/model and relevant environment/tool versions:
- Start/end timestamps with timezone:

| Measurement | Minutes | Evidence / notes |
| --- | --- | --- |
| Codex initial execution (inspection, implementation, validation) | pending | |
| Codex correction execution (all review iterations) | pending | |
| Human preparation / prompting | pending | |
| Human code review | pending | |
| Human visual / behavior testing | pending | |
| Human corrections / retesting | pending | |
| External waiting, excluded from active effort | pending | installs, blocked services, etc. |
| Total active development effort | pending | Sum active Codex + human time, including testing once |
| Elapsed task wall time | pending | End minus start, including waits |

- Corrections: iteration, finding, owner, minutes, affected files, outcome.
- Automated validation: exact commands, results, duration, test count.
- Manual checks: browser/device, viewport, theme, reference screenshots, observed differences.
- Quality review: clarity, typing, errors/async behavior, dependencies, maintainability.
- Visual fidelity: accepted differences, defects and reviewer verdict.
- Deliverables, remaining gaps and next task:
- Human approval / review status:

For this bootstrap, human review and visual acceptance remain pending until performed. No retrospective execution timings should be guessed.

## Reals Login UI — Stage A (2026-11-04)

- Branch: `feature/login-ui`, created without tracking from fetched `origin/main`; starting HEAD and base both `4092f6d`. No commit created.
- Reference: Android `565e7d9`; login screen, theme, editorial components, original drawable-nodpi assets, login unit/instrumentation and autofill/session tests.
- Environment: Node 24.19.0, npm 11.17.0, Vitest 5.1.0, Vite 8.3.5; existing dependencies unchanged. Agent model identifier unavailable in measurable session metadata.
- Measured execution window: 2026-11-04 04:47:44–04:55:18 UTC (01:47:44–01:55:18 America/Buenos_Aires), from first clock reading through implementation, validation and review checkpoint. Final log writing/delivery follows this checkpoint and is excluded.

| Measurement | Result | Evidence / limits |
| --- | --- | --- |
| Observed execution wall time through checkpoint | 7 min 34 sec (454 sec) | Two tool clock readings; includes tool waits and correction work |
| Codex active time vs tool waiting | unavailable | No separate active-effort instrumentation; do not equate wall time with active time |
| Human preparation, code review, corrections and device testing | unavailable | No measurements supplied; visual approval pending |
| Total development effort / full task wall time | unavailable | Human times and final-delivery interval not measured |
| Focused automated tests | 22 passed, 2 files | Vitest reported 3.53 sec; final successful validation command group took 7.24 sec |
| Final production rebuild after responsive CSS review | passed | Command wall time 1.89 sec; Vite bundling 192 ms |

Delivered: typed login presentation, original brand assets, unavailable-integration app callbacks, focused tests, responsive/safe-area styles and updated reference/architecture/testing documentation. No Firebase, backend requests, storage, dependency additions or proxy changes.

Corrections observed: the first type-check found an unsupported `exact` option on a role query; removed it before the successful run. Responsive review restricted compact styling to text-field focus instead of every focused control. Diff review removed one extra EOF blank line. A patch-tool request with duplicate file operations was rejected and resubmitted as an update. Separate correction durations were not captured.

Validation:

- `npm run typecheck`: PASS after the query correction.
- `npm test -- src/auth/LoginScreen.test.tsx src/App.test.tsx`: PASS, 22 tests across 2 files.
- `npm run build`: PASS; repeated after the responsive CSS adjustment.
- `git diff --check`: PASS after EOF cleanup; strict UTF-8/mojibake and trailing-whitespace scan passed.
- Copied asset SHA-256 hashes match Android originals; combined PNG payload 776,720 bytes.
- Browser visual checks: NOT RUN successfully. Headless Chrome launch was rejected by execution policy (`blocked by policy`); no permission escalation attempted and no browser visual result claimed. Development server was stopped after the attempt.

State review: all mode/form mutations, externally supplied busy/error/feedback/deadline paths, timer replacement/resume/cleanup and unavailable-adapter errors are enumerated in `architecture.md`. Tests cover both modes, all pending sources, error owners, cooldown replacement/expiry and StrictMode cleanup. No asynchronous auth response-installation path exists yet.

Remaining review: execute the Chrome Android/Safari iOS checklist in `testing.md`, compare screenshots with Android, check font metrics/contrast/autofill and review the original PNG transfer cost. Human visual fidelity verdict remains pending. Next recommended action: device visual and keyboard review before Stage B authentication integration.

## Stage B — real auth and backend session

Implemented on `feature/auth-backend`, based on latest fetched `origin/main` at `e4019ed` (IPv4 loopback fix present); clean initial tree, no tracking of main. Inspected the requested Android repositories/coordinators/login and backend controllers/security/contracts/local-development references without editing siblings.

Work includes modular Firebase App/Auth, SDK persistence, safe config errors, email signup/signin, Google popup, sign-out/restoration, typed fetch bearer calls, one INVALID_TOKEN refresh, conditional provisioning, runtime user/profile validation, separate ready/missing-profile/restricted/recoverable states, backend-only password reset and optional development-only verification. [Mutation review](auth-session-review.md) records invariants and async installation/cleanup paths. Login presentation/assets, ADB helper, proxy and CI remain unchanged.

Validation: `npm run typecheck` PASS; `npm test` PASS (101 tests, 5 files); `npm run build` PASS. Initial typecheck caught readonly emailVerified assignment in fake users; corrected test fixtures using property descriptors. Dependency installation reported four high audit entries through unused Firestore/gRPC; see testing notes. Real smoke tests remain pending: no `.env.local` configuration was available. No credentials were invented, logged or committed; no backend was started or mutated. No commit/push/deploy performed.

Effort: reference inspection, invariant design, integration, race regressions, automated validation and setup documentation completed in one session. Active engineering time was not measured; no estimate is presented as observed effort. Remaining effort is project-owner Firebase setup and Windows/Android Chrome smoke validation. Home/profile editor/legal/matchmaking/chat/PWA/production work stays outside this stage.

## Stage C — profile onboarding integration

Implemented on `feature/profile-onboarding`, based on fetched `origin/main` at `af49b1af3952ddad509107e51f67dc867032abda`; initial main and task base matched and working tree was clean. No commit, push, deployment or sibling modification.

Added backend-driven legal, create/completion, photo crop/management, email verification, activation confirmation and temporary Home. Reused Stage B authentication/client rather than introducing another session controller. Native accessible HTML controls adapt Android UI/copy with existing theme tokens. Optional questions, account deletion, matchmaking and chats remain outside scope.

Backend and MinIO health returned 200 with local configuration present. Full browser/device and authenticated disposable-account smoke remains pending; follow [testing checklist](testing.md). The [mutation review](onboarding-mutation-review.md) records concurrency and reconciliation decisions. Authenticity requirements are presented from backend errors; this stage does not implement a liveness/identity verification flow if a deployment enables that prerequisite.

Validation: typecheck PASS; 178/178 tests PASS across 9 files (105 existing tests preserved); production build PASS; diff whitespace check PASS. Vite served HTTP 200 and its anonymous `/api/me` proxy returned the expected 401. No authenticated browser/device end-to-end result is claimed.
