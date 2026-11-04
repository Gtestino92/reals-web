# Testing

Vitest runs in jsdom with React Testing Library and jest-dom matchers. Tests live beside the component or helper they exercise. Shared setup performs explicit cleanup after each test. The initial render smoke test verifies the main landmark, Reals heading and UTF-8 Spanish placeholder; it also verifies the testing toolchain is usable.

```powershell
npm run typecheck
npm test -- src/App.test.tsx
npm run build
```

Use `npm run test:watch -- src/App.test.tsx` while editing. `npm test` runs all tests: the entry point smoke test and the Android tunnel helper tests. The build includes another type-check so standalone builds cannot skip it.

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

Manual smoke: run `npm run dev`, open the page at narrow and desktop widths, confirm Spanish accents, readable serif identity/body text, and system light/dark colors. When the existing backend is available, compare direct and proxied `/api/ping` using [local development](local-development.md). HTTP checks establish serving/proxy connectivity; jsdom does not establish browser layout, font metrics, color contrast or Android screenshot fidelity. Record actual results and remaining visual review in the [POC log](poc-log.md).

The [Android testing guide](../../reals-app/docs/testing.md) informs behavior priorities. Android build tasks, emulator tests and release APK checks are platform-specific and are not copied.
