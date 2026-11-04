# Testing

React tests run in jsdom with Vitest, React Testing Library and jest-dom matchers; the Android tunnel helper tests use the Node environment. Tests live beside the component or helper they exercise. Shared setup performs explicit cleanup after each test. Stage A has 22 tests across login behavior and the app's explicit unavailable-integration responses, plus 18 Android tunnel helper tests.

```powershell
npm run typecheck
npm test -- src/auth/LoginScreen.test.tsx src/App.test.tsx
npm run build
```

Use `npm run test:watch -- src/auth/LoginScreen.test.tsx` while editing. `npm test` runs all 40 tests across login behavior, app integration responses and the Android tunnel helper. The build includes another type-check so standalone builds cannot skip it. Login tests cover mode switching, argument forwarding, remember default/toggle, masking/autofill hints, recovery/Google callbacks, all busy states in both modes, owner-scoped errors, reset feedback, cooldown rounding/expiry/replacement, background resume, and StrictMode timer cleanup. No credentials or backend connection are required.

Run `npm test -- tools/android-tunnel.test.mjs` for the helper's 18 focused tests. These use the Node test environment and mocked subprocess calls to cover discovery precedence, non-Windows paths, authorized/unauthorized/offline and malformed device rows, multiple USB/wireless devices, literal serial arguments, command failures and per-command/total time limits. They do not run ADB or verify a physical tunnel. See [local development](local-development.md#android-chrome-over-usb-or-wireless-adb) for manual connection checks. The `predev` hook is not invoked by CI's install, typecheck, test or build commands.

## Continuous integration

[CI](../.github/workflows/ci.yml) runs on pull requests targeting `main` (opened, reopened, or updated) and pushes to `main`. Its single job, `Web validation` (job ID `validation`), runs on Ubuntu with Node.js 24, compatible with the `^24.15.0` engine requirement in `package.json`. The official `actions/setup-node` action caches npm's download cache using `package-lock.json`; dependencies are installed afresh with `npm ci`.

The job runs these commands in order and stops if a step fails:

```sh
npm ci
npm run typecheck
npm test
npm run build
```

To inspect results, open the repository's **Actions** tab, select **CI**, then open a run and its **Web validation** job to view step logs. On a pull request, open **Checks** or follow **Details** beside the check. After the first successful run, require the exact status-check name **`Web validation`** (GitHub Actions) in the branch-protection rule for `main`. Keep this job name stable so the required check continues to match.

The workflow has only `contents: read` permission and needs no custom secrets or backend connection. It performs code-quality validation only; CodeQL default analysis and Dependabot remain configured separately. GitHub-hosted execution must be confirmed by the first run; local commands do not verify hosted execution.

Future tests should focus on user-observable behavior, error mapping, response validation and async cancellation/stale-response races. Cover alternate mutation paths and regressions when introduced. No backend connection, credentials, Firebase SDK or new end-to-end framework is required by current tests.

## Stage A manual device checklist (not yet executed)

Run `npm run dev` through the team's device-accessible development setup. On Chrome Android and Safari iOS:

- Compare both modes against Android at narrow portrait and landscape widths in light/dark themes; confirm original seal/icon, Spanish copy, spacing, field outlines and focus/disabled contrast.
- Open/dismiss the virtual keyboard for each field, switch between fields, rotate, expand/collapse browser chrome and verify scrolling reaches every action without clipping, horizontal overflow or a trapped focus. Check safe areas on a notched iPhone.
- Verify email keyboard, password masking, password-manager fill/save behavior, new-password suggestions in sign-up, and that the remember preference does not promise browser storage control.
- Check external-keyboard Tab/Shift+Tab/Enter/Escape, visible focus, 200% zoom/text scaling and TalkBack/VoiceOver labels, headings, busy state and error/feedback announcements. Ensure countdown changes do not create repetitive live announcements.
- With externally supplied pending/feedback/deadline props, verify all actions lock, feedback ownership and cooldown recovery after background/resume. The standalone app intentionally only reports unavailable integrations; it never simulates success or reset delivery.

No browser/device visual result is claimed from jsdom. A headless Chrome preview attempt was rejected by the environment execution policy. HTTP/backend checks are outside Stage A; no actual API requests are made. Future backend connectivity instructions remain in [local development](local-development.md).

The [Android testing guide](../../reals-app/docs/testing.md) informs behavior priorities. Android build tasks, emulator tests and release APK checks are platform-specific and are not copied.
