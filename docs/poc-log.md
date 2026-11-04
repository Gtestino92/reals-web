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
