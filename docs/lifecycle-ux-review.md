# Browser return, login layout and OTP feedback

Reviewed base: `25950ae91cd7176e3d40529da45d8600799c8432`. Backend and Android are read-only; Firebase configuration is unchanged. Browser evidence uses synthetic identities and HTTP, never real tokens or account data.

## Audit and mutation review

| Path | Required invariant / response ownership |
| --- | --- |
| Ordinary visibility / focus | Same document and operational session; retain screen and unexpired in-memory grant. Foreground reads must not clear healthy content. |
| Administrative foreground GET | One owned read; navigation, selection or mutation supersedes it. Denial removes sensitive data; transient failure retains context with explicit recovery and blocks stale decisions. |
| Home foreground read | Status/version remains authoritative. Late or aborted responses cannot replace a newer owner or release its read lane. |
| Page exit / BFCache / ownership loss | Existing retirement/revocation and mandatory revalidation remain intact. Visibility is not page exit. |
| Login checking / authentication / bootstrap | Keep one shell with stable form bounds; protected UI remains ready-only. No new Auth instance, persistence changes or timed login delays. |
| Sixth OTP digit / paste | Claim synchronously once. Keep pending presentation until feedback; no retry of failed verification. Only backend grant + status confirmation starts success feedback. |
| Success / cancel / expiry / identity | Presentation timer cannot confer authority or extend expiry. Cancel/unmount/context invalidation cancels stale navigation; retained grants bypass feedback after revalidation. |

Android reference: `LoginScreen.kt` (centered form, busy/keyboard states), `SessionCoordinator.kt` (auth/bootstrap ownership), and `MatchmakingHomeScreen.kt` (rendered model plus refresh/poll state). Android has no administrative OTP screen; that interaction is an explicitly authorized browser addition. Browser document/ownership/BFCache behavior is platform-specific.

Before implementation: ordinary foreground Home model retention is COMPLETE in the controlled baseline; administrative list retention is PARTIAL (read clears rows and resets pagination); stable login layout is PARTIAL (same component but inserted status/logout changes centered bounds); OTP editing is PARTIAL (single input and request exclusion exist, active caret and confirmed success feedback are missing). Browser/native keyboard and screen-reader equivalence remain PLATFORM-LIMITED until device testing.

## Reproduction

Start fresh Vite on localhost port 5175, then `node tools/lifecycle-smoke.mjs --baseline` before implementation, and `node tools/lifecycle-smoke.mjs` afterward. `--quick` is only for iteration and does not establish a 60-second background result.

The isolated page installs a React DevTools test hook before React DOM loads. It records component instance mounts/unmounts, document UUID, `performance.timeOrigin`, navigation type, visibility/page lifecycle, session phases, ownership transitions and layout shifts. No component props, request bodies, identity values or credentials enter the diagnostic output. The fixture runs the real application under StrictMode, real Chromium Web Locks and BroadcastChannel when enabled, and synthetic Firebase/HTTP. Responses are held during foreground reconciliation to capture intermediate DOM rather than only the final state.

Validation results and remaining hypotheses are recorded after implementation below.

## Proven causes and fix

The reviewed baseline completed eight actual 60-second unrelated-tab switches: Home/Admin × 390×844/1440×900 × ownership disabled/enabled. Every return kept the document UUID/time origin, committed React instances and session phase. No extra bootstrap, verification or revoke occurred. In Admin, the existing foreground `store.load()` cleared rows, rendered `Cargando…`, reset pagination to 1 of 1 during the request, then 1 of 2 after completion. This is data replacement (case E), not document/root/session remount (A–C) or ownership transfer (D). Home retained its content in the same controlled reproduction.

`AdminStore.load(true)` now owns a non-destructive foreground GET. It retains rows/diagnostics and pagination while awaiting the server, excludes overlapping foreground reads, and lets a deliberate selection/navigation supersede the read. A transient failure blocks stale decisions and retains explicit recovery; authorization failures still remove data. Explicit reconciliation after mutations keeps its existing blocking behavior. Pagination clamps to the available pages instead of resetting on every returned array.

Login retained its component already, but inserted status and logout changed the height of a centered panel. Baseline email-field movement was +20 CSS px at 390px and −14 CSS px at 1440px. The status now replaces text inside a reserved description area; cancellation has an always-reserved region. Coarse-pointer input focus no longer conditionally removes/reinserts branding when authentication disables the input. Natural scrolling handles the mobile viewport; this is an intentional browser difference from Android's actual IME-inset detection.

OTP previously cleared all digits immediately and entered Admin immediately upon `allowed`. It now has a single claimed request and presentation states: idle, pending, invalid, confirmed success, complete. Digits stay visible only in component memory until the response; failures reset safely. Backend grant and status must both confirm before a cancellable 400ms success presentation. Six slot backgrounds progress over 345ms; a separate verified label is accessible. Reduced motion shows static feedback and caret. Returning with an already-confirmed retained grant bypasses this presentation. The Admin presentation module loads during access checks, with no privileged reads until entry, avoiding a Suspense loading replacement after success.

The new session snapshot subscription also exposed an existing shared-listener ownership problem: unsubscribing one listener removed the identical abort callback used by another listener. The abort listener now belongs to the first/last subscription lifetime, matching the existing auth observer ownership. The real lease-transfer regression test guards this boundary.

## Interpretation limits

The controlled baseline did not reproduce the reported effect in a healthy normal Home. Actual document discard, a backend restriction response, Firebase/network failures, extensions or a developer file edit remain hypotheses for any additional live-only occurrence. Fresh Vite validation records HMR events; ordinary visibility alone does not generate a Vite update. No security behavior is disabled to hide such events. An actual reload/document exit still loses memory credentials; BFCache and ownership changes retain their existing retirement/revalidation paths.

The probe counts committed component instances separately from StrictMode's effect replay. Initial navigation in the isolated fixture can be classified by Chromium as `reload` when deliberately revisiting the same fixture URL; the relevant measurement is zero document/time-origin changes during each unrelated-tab return, rather than that initial navigation label.

## Changed surfaces

`src/admin/{store.ts,Admin.tsx,AdminGate.tsx,admin.css}`; entry/loading ownership in `src/App.tsx`; shared lease-listener ownership in `src/auth/session.ts`; login shell in `src/auth/{LoginScreen.tsx,login.css}`. Regression tests are in `src/admin/{store,modes}.test.ts(x)` and `src/auth/LoginScreen.test.tsx`; existing lifecycle/MFA/ownership/Home/App regressions remain enabled. The isolated browser probe is `tools/lifecycle-smoke.mjs`; artifacts are ignored by `.gitignore`. This review and the existing security/parity documents record the scope and evidence.

## Final validation

- `npm run test:focused -- src/admin/store.test.ts src/admin/Admin.test.tsx --reporter=json --outputFile=artifacts/lifecycle/focused-final.json`: **45/45 PASS** after the final atomic installation of foreground error/selection state.
- `npm run test:focused -- src/admin/modes.test.tsx src/admin/lifecycle.test.tsx src/admin/mfa.test.tsx src/App.test.tsx --reporter=json --outputFile=artifacts/lifecycle/focused-fifth.json`: **116/116 PASS**. Login/store/lifecycle focused run: **66/66 PASS**; mode/App/login/ownership/tab focused run: **146/146 PASS**. The full final suite includes all these areas.
- `npm test -- --maxWorkers=2 --reporter=json --outputFile=artifacts/lifecycle/full-final.json`: **1149/1149 PASS, 48 files**. The full suite was repeated after the final atomic error/selection installation; no CI tests were removed.
- `npm run typecheck`, `npm run build`, `git diff --check`: **PASS**. Existing main-chunk size warning remains (560.85 kB minified); Admin stays separately loaded.
- Fresh `npm run dev -- --port 5175 --host 127.0.0.1`, then `node tools/lifecycle-smoke.mjs`: **PASS**. Eight measured unrelated-tab periods lasted **60,031–61,024ms**. Document/time-origin changes: **0**; React root replacements and component remounts per return: **0**; pagehide and HMR events: **0**; ownership transitions per return: **0**. Same current Admin grant, bootstrap count and verification count on return; no revoke. Administrative rows and page 2 remain rendered during the held foreground response and after completion. `before.json` is the reviewed-base evidence; `after.json` retains the actual 60-second result, separately from quick runs.
- Final `node tools/lifecycle-smoke.mjs --quick`: **PASS** after the last state-installation adjustment. Additional native Tab/Escape/focus-restoration, Backspace, synthetic DOM paste, invalid-code/Retry-After, no success before status, no private content during confirmation, retained-grant return without TOTP/success replay, and reduced-motion checks pass at both widths and ownership settings. Exactly **one POST per completed attempt**; the fixture deliberately performs one invalid attempt followed by one fresh valid attempt, never an automatic retry. Successful feedback measured **412–437ms** including render/DOM observation. The final quick run is not used as evidence for background duration.
- Google, password and restored-session synthetic Chromium login cases: **0px email-field movement and 0px panel-size change** through backend bootstrap. Bounds for checking/login/authenticating/loading and layout-shift entries are retained in ignored JSON reports. Protected Home appears only after ready. Password context has no Admin entry.
- Visual inspection: mobile/desktop login/bootstrap, active OTP caret, pending digits, invalid/cooldown, progressive success and backoffice during the held refresh. No horizontal clipping was seen. Login and modal retain natural vertical scrolling on constrained viewports. UTF-8/mojibake review: **PASS**.

These checks use native Chromium, real Web Locks/visibility and actual React components with **synthetic Firebase and HTTP**. They do not verify real token claims, App Check attestation, backend grant bindings, a physical mobile keyboard/OTP autofill, screen readers, other engines or actual BFCache eligibility. Existing jsdom tests cover simulated pagehide/pageshow, identity/lease changes, expiry and StrictMode; those are distinguished from native tab switching. Repeat the changed UX against the already-working real operator setup. No new Firebase configuration is required; `.env.local`, backend and Android were not modified. No commit, push, merge, PR or deployment was performed.
