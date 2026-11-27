# Queue latency, environment ownership and sign-out review

The [startup and Home return review](navigation-flicker.md#startup-and-home-return)
documents the later startup presentation and status-based management return.
Search admission and cancellation still use the mutation lane described below.
The [retained Admin grant follow-up](navigation-flicker.md#retained-admin-grant-and-home-return)
records how access preparation overlaps Home verification while private entry
waits for both outcomes.

Current search presentation (review at `6e8ef9b`): normal location/admission/reconciliation/queued/canceling phases now share the unchanged Buscando chat screen and body, without phase-specific live-region labels or admission announcements. This supersedes the earlier preparation-copy descriptions below; internal phases, API coordination and the optimizations remain unchanged. Errors retain their existing retry/refresh content. Run only `node tools/runtime-refinements-browser.mjs --search-only` for the focused stability smoke (Vite loopback with ownership opt-in false): real DOM/focus/scroll and CSS animation identity, pending cancel and authoritative Home return, one POST/DELETE. Validation: focused Home tests 69/69, one final full suite 780/780, typecheck/build/diff check passed. Chromium passed 74 stability samples; physical devices/screen readers remain unverified.

Base: main `298f131`; task HEAD `a6864fe`, clean tree on `feature/single-active-tab`. Sibling repositories are read-only. This is a scoped Web change; no backend or Android mutation is authorized.

## Async/mutation review

| Path | Invariant and installation | Cancellation / failure |
| --- | --- | --- |
| Location | Only explicit Search obtains location; same coordinate/quality/time/security bounds, browser cache only | One sequential fallback; abort prevents fallback/POST; no application persistence or prefetch |
| Queue admission | Existing one-mutation lane and serialized POST then DELETE retained | Never replay uncertain writes; revoke/sign-out/unmount invalidates controller; queue remains authoritative |
| Reconciliation | Capture status/version baseline first, then independent profile/queue/Home projections in parallel; validate consistency and install fields together | Reject aborted/stale serial; mismatch blocks and requires refresh; no speculative queue success |
| Environment gate | Disabled only in Vite dev server on loopback unless opted in; deployed builds always enabled | Disabled branch passes no fake manager; explicit test manager forces real gate |
| Explicit sign-out | Confirmation is presentational; existing controller owns the actual operation/error recovery | Cancel/Escape/Back dismiss idle dialog; no automatic sign-out interception, deletion flow unchanged; lock duplicate clicks |
| Dialog lifecycle/history | Home owns history, modal blocks its navigation guard and listens for restored Back | Restore trigger focus; remove listeners/close modal on unmount; no invented domain transitions |

## Reference audit before implementation

Android `HomeCoordinator` distinguishes location resolution, queue admission and Searching, and owns explicit leaveQueue. `SignOutConfirmationDialog.kt` supplies title/body/Cancel/Confirm; Account/setup/root call sites govern confirmation state. Backend `MatchmakingController`, transactional `MatchmakingService.enqueue`, queue repository and availability service validate legal compliance, lock active user, validate location and check profile/ban/capacity before saving and invalidating Home. API contract: `docs/commons/api.md#matchmaking` in backend. Source inspection does not measure database latency.

Prior Web parity: queue lifecycle and cancellation COMPLETE within existing tested paths; preparation copy PARTIAL (same searching headline before admission); sign-out confirmation PARTIAL (native confirm in Account/Home failure, direct root action); native keyboard/focus/modal semantics PLATFORM-LIMITED until browser checks. This task preserves layout and business policy, adds requested preparation copy and Android sign-out copy, and changes ownership only by environment.

## Admission diagnosis and measured fixture evidence

No live SQL/Firebase experiment was performed. The browser harness imports actual pre-task `a6864fe` location/useHome code into temporary modules and runs it against current code with the same real HTTP fixture server. It injects a high-accuracy timeout, a valid coarse fix after 300 ms, 40 ms token work and 100 ms per HTTP response. Logs contain only static request paths/methods, phases and timings; no identity, coordinates, payloads or tokens. Browser waiting/paint and timer scheduling add some overhead to total time.

| Measured Chromium phase | Before | After |
| --- | --- | --- |
| Location acquisition | 5002 ms high timeout + 302 ms coarse | 307 ms coarse |
| First token preparation | 49 ms | 49 ms |
| POST fetch/response | 121 ms | 119 ms |
| Click to HTTP server receipt of POST | 5362 ms | 362 ms |
| Post-response authoritative reconciliation | 666 ms | 323 ms |
| Click to observed confirmed UI | 6260 ms | 910 ms |

These are controlled fixture measurements, not a claim about the reported production/PostgreSQL delay. In this scenario the bottleneck precedes POST, not the backend POST. Real admission time could also include permission prompts, token refresh, network latency, legal checks, active-user row-lock waits, capacity/profile/ban queries and transaction commit. The transactional service enqueues before the controller returns true; persistence is not deferred by a frontend timer. If a live trace instead shows a slow POST, correlate server transaction/SQL/lock timings separately; no backend change or frontend compensation was made here.

Optimization: try low-power/browser cache first (3 s), then a single high-accuracy attempt (8 s) on timeout/unavailable/inaccurate; inaccurate fallback and explicit quality retries request a fresh fix. Existing 15-minute timestamp and 5-km accuracy limits, finite/range/future-time checks and secure-context checks remain. No location request on Home load, no memory/localStorage coordinate cache, no concurrent sensor requests or permission retry. Browser geolocation cannot cancel an underlying getCurrentPosition acquisition; abort rejects local callbacks and prevents fallback/POST. A device requiring GPS can still take longer than a fast cached coarse fix; permission wait and device behavior are not bounded by these measured numbers.

Reconciliation captures the persisted status/version baseline first, then reads independent profile, optional queue status and Home projections in parallel. It installs only after all succeed and profile/queue/Home agree, retaining original owner/serial/session checks and ambiguity handling. It is not a transactional snapshot: concurrent matching may cause disagreement and require authoritative refresh, as before. Existing serialized writes, cancellation and no-replay policies remain intact.

The preparation surface keeps its DOM/animation while the title/body distinguish location, admission and confirmation. Only the confirmed queued state says Buscando chat. Android HomeLocation also tries validated cached/last-known positions first (15 min); Android's 1-km quality cutoff differs from Web's pre-existing 5-km policy. This task preserves that Web policy rather than silently changing eligibility.

## Environment policy and sign-out

Ownership is disabled only when Vite DEV is true and the hostname is exact localhost, 127.0.0.1 or IPv6 loopback, unless VITE_ENFORCE_TAB_OWNERSHIP=true. Builds/preview and every deployed/non-loopback host always enforce. An explicit test manager also forces enforcement. Bypass uses OperationalApp with no manager; auth/API/session behavior is unchanged. Existing local-persistence identity sharing still belongs to Firebase; use session persistence for separate local accounts. This is cooperative client-side enforcement, never a server antifraud boundary.

SignOutButton uses native showModal with shared Reals tokens and Android title/body/actions across Account, setup Account, root session recovery/loading and exceptional initial Home failure. Focus starts on Cancel and returns to the trigger. Escape/Cancel/owned-history Back dismiss idle confirmation. The Account navigation guard restores its existing history entry; the dialog adds no synthetic entries. Native navigation away from the document remains browser-controlled. Confirm closes once and delegates to the existing controller; pending relevant operations disable interaction and existing failure recovery permits a later attempt. Cleanup closes the dialog and removes Back listeners without sign-out. Automatic invalid-session/external sign-out and account-deletion confirmation remain unchanged.

## Validation scope and testing workflow

Two duplicate standalone geolocation tests were folded into the error table's exact-attempt-count assertions (permission denial = one request, unavailable/timeout = at most two). No boundary or critical mutation scenario was removed. Shared jsdom modal support replaces repeated Account mock setup, and one helper now confirms sign-out in integration tests. The default dot reporter/short DOM diagnostics and guarded test:focused command reduce noise; the complete CI suite is unchanged. AGENTS.md now requires focused iteration and one final full suite, not repeated full runs after every change.

Browser commands: start `npm run dev -- --host 127.0.0.1 --port 5174` with the local ownership opt-in unset/false, then `node tools/runtime-refinements-browser.mjs`. It checks actual before/after queue timing and UI, two local login tabs, two synthetic authenticated local identities, enabled takeover with no focus stealing, Escape/Back/restored focus, one sign-out and mobile/desktop modal layout (390/1280 px) with no horizontal overflow. Modal screenshots were inspected. To validate the real environment opt-in, restart Vite with VITE_ENFORCE_TAB_OWNERSHIP=true and run the same script with `--opt-in`. The original full ownership runner remains available but unrelated chat/onboarding scenarios need not be replayed for every change.

Remaining manual checks: real user-reported SQL latency and live token/GPS conditions; distinct live Firebase accounts; physical mobile/desktop keyboard and screen readers; actual deployed-host and production-preview smoke; browser engines beyond Chromium. Unit policy tests cover build/preview/non-loopback enforcement, but are not a deployment test. No browser/API guarantee is described as server-enforced security.

## Final results and files

- Focused command `npm run test:focused -- src/home/location.test.ts src/auth/SignOutButton.test.tsx src/home/AccountSection.test.tsx src/home/useHomeNavigation.test.tsx`: 40 passed.
- Focused command `npm run test:focused -- src/home/Home.test.tsx src/auth/SignOutButton.test.tsx src/tabs/policy.test.ts src/App.ownership.test.tsx`: 88 passed.
- The first final full run loaded 750 frontend tests successfully but two Node-only tool suites failed because the shared modal shim assumed a DOM. The shim now checks that HTMLDialogElement exists; no timeouts were increased. Focused command `npm run test:focused -- tools/android-tunnel.test.mjs tools/android-tunnel-monitor.test.mjs src/auth/SignOutButton.test.tsx`: 35 passed.
- Final `npm run typecheck`: passed. Final `npm test`: 780/780 in 35 files (35.62 s). This full repeat was justified by the Node setup correction; no further full runs were needed. `npm run build` and `git diff --check`: passed.
- Suite before: 762 tests. Two redundant cases consolidated, 20 cases added for changed policy/dialog/location/parallel-read/history paths; final 780. CI still invokes the whole suite. `node tools/test-focused.mjs` without filters deliberately exits 2 with usage guidance.
- Real Chromium normal-mode runner and `--opt-in` runner: passed. The latter used Vite restarted with the actual environment flag true and no explicit test manager. The normal runner used the flag false and verified disabled tabs plus explicitly enabled manager scenarios. The harness generates only two fixed baseline files and removes them; generated files are not needed by normal Vite startup or the production build.

Production changes: `src/home/location.ts`, `useHome.ts`, `SearchingScreen.tsx`; `src/tabs/policy.ts`, `src/App.tsx`; `src/auth/SignOutButton.tsx`/`sign-out.css`, `src/home/AccountSection.tsx` and `Home.tsx`. Tests: policy/dialog, App ownership/session, Home/location/Account, onboarding confirmation, shared DOM setup/sign-out helper. Tooling/config: package scripts, Vitest compact reporting, focused runner, synthetic queue/ownership browser fixtures and timing runner. Documentation: AGENTS.md, .env.example, testing/local-development/ownership/parity docs and this review.

HEAD remains `a6864fe3188e5ca2e3700507bff74cac3ece1cae`; no commit/push/PR/merge/deploy. Android checkout was on development; backend checkout was on feature/local-docker-network-hardening, with the reviewed matchmaking sources and API contract identical to its development ref. Both were read-only. No .env.local contents were printed or modified.


## Contact operation ownership

| Event | State accepted or retired |
|---|---|
| Open Contactos / resume | A cancellable owner GET installs one validated status. A newer read or write aborts an older read. Compatible foreground reads preserve the selection, scroll and picker operation. A failed transient read disables confirmation until revalidation. |
| Accept consent | The explicit action sends the displayed required version and revision. A successful response installs the next revision. A second gesture starts the provider. |
| Choose provider / confirm | The operation captures ADD or REPLACE, owner state, required consent version and revision. Temporary rows and the cancellation signal belong to that choice. Background reads can invalidate that intent. Region adjustments recalculate canonical groups locally. Explicit exclusions follow source rows and canonical numbers when groups split or merge. Confirmation sends unique E.164 numbers using the captured revision. One write can run at a time. |
| Conflict, rejected or uncertain write | Drop the intent, read current status and display a safe outcome message. A status read has no historical selection count or request identifier. The two mutation responses have separate count contracts. A duplicate-only addition can succeed with the same revision and timestamp. A full-replacement-required error returns the owner to a fresh decision after reconciliation. |
| Erase / withdraw | Confirm, issue unconditional DELETE and refresh after 204. Both remain available to participants during provider shutdown. |
| Leave, pagehide, session generation or tab lease loss | Abort owned work and release rows. An obsolete popup callback cannot install data. Visibility changes while choosing a Google account initiate ordinary revalidation and do not by themselves cancel the popup. JavaScript garbage collection controls eventual memory reclamation. |
| First Chat metadata | Validate the active participant/match and current read serial. Remove changed social context before history and exits settle. Ordinary tab switches retain an already confirmed range in the current session during revalidation. Pagehide and failed refreshes clear it. An interrupted write's pre-resume metadata cannot reinstate the range. Block, expiry, terminal state and session disposal suppress disclosure. |

All owner contact requests use Fetch's `redirect: error` at the configured API destination. The local Vite proxy passes upstream redirects back to Fetch. A redirect rejection during a write uses the same status reconciliation as a network failure.

Only the invitation dismissal and per-account/per-chat presentation preference use durable storage. Browser history carries ordinary navigation entries. No periodic contact sync, OAuth refresh token, selection cache or new chat polling loop is involved.

A device picker invocation owns the document's native picker slot until its promise settles. Retiring a Reals intent discards late results but cannot close Android's selector. Reuse the prepared capability on the next explicit tap. Reals never retries permission prompts automatically. Chrome can report a selector-open TypeError, which does not identify the underlying permission state. After earlier denials, check Android Settings → Apps → Chrome → Permissions → Contacts. Installed PWAs may use the host browser's permission settings. [Android repeated denial](https://developer.android.com/about/versions/11/privacy/permissions) · [Chrome Contact Picker](https://developer.chrome.com/docs/capabilities/web-apis/contact-picker) · [Selector exceptions](https://developer.mozilla.org/en-US/docs/Web/API/ContactsManager/select)

## Chat and startup response ownership

| Operation | Presentation owner and installation rule |
| --- | --- |
| Send, retry, POST result or history reconciliation | The existing session keeps the client ID and draft. Confirmed history and outgoing retirement install together. Delivery metadata and grouped rows share dimensions across confirmation. |
| Reaction PUT, response, follow-up read | The guarded writer sets a single pending message ID. The lane displays a filled heart immediately. Only a validated HEART on the requested participant message enters history. Failure clears the pending target and reconciles through reads. Successful confirmation survives a failed follow-up. |
| First Chat decision or terminal read | The existing Home callback still receives the closed flag. A reconciled decision returns silently. Safety, abandonment and expiry retain their existing feedback. |
| Manual authentication and identity replacement | A monotonically increasing attempt number scopes completion to its startup boundary. Firebase, bootstrap, legal and destination gates retain their request ownership. After 30 seconds the exit is available during authenticated bootstrap or destination loading. An unresolved Firebase credential request has no cancellation handle. |
| Queue discovery, initial chat read, visibility and retry | Home retains Searching after authoritative queue exit, removes cancellation and suspends its ordinary polling. First Chat owns match, metadata, history and exit reads. Reveal requires a current foreground snapshot. A 30-second initial-read deadline retires the read generation and allows retry without ending the conversation. |

## Confirmed queue cancellation

At base `ee28ee5`, cancellation awaited DELETE, then status, then profile, queue and Home together. A confirmed queued entry now starts DELETE and status together, then reads Home and profile together. Both first-stage operations settle before proceeding. Sampling profile with Home limits profile skew and uses the same two stages as starting it alongside DELETE. Profile identity, name and status still pass the shared installation checks.

| Condition | Mutation owner and installation |
|---|---|
| Expected account and explicit false | Install compatible fresh Home and profile. If Home reports re-entry, independently read queue and require agreement. |
| Uncertain DELETE, malformed acknowledgement, wrong user or true | Read a new status, profile, queue and Home. Keep uncertainty gated for explicit recovery. |
| Cancellation requested during location, POST or admission reconciliation | The existing admission lane owns intent and any necessary ordered DELETE and full read. |
| Failed mandatory read, hidden page or account replacement | Failure blocks actions. Visibility at installation gates automatic chat entry. Owner lifetime and serial reject obsolete reads. |

The client records the actual pre-projection status version. The backend captures its own version before aggregation and conditionally reconciles its marker if that version still matches. A mutation before the sample can already be reflected in both reads. A change after sampling, including DELETE itself, can cause another full projection on the next poll. Changes during or after aggregation remain detectable by version, dirty state or due boundary. Only boundaries due at the sampled server time are consumed. Previously advertised future boundaries survive even if another client clears the shared marker. The notification installer receives the projection with the same sample and receipt time, preserving category-enable cutoffs and server-clock offset.

The affinity owner retains previously loaded answers and catalog while the summary is hidden. Showing it again starts its normal parallel revalidation. These reads ran after the operational Home transition. The button and Home projection have no dependency on them.

Local Chrome issued OPTIONS for each critical request with both browser cache settings despite a 3600-second max age. Authorization and deployed App Check headers require cross-origin permission, and DELETE independently requires preflight. Chromium keys permissions by origin, URL and network partition and considers method and headers. Its cache-bypass flags can also bypass preflight reuse, consistent with the private no-store requests in this fixture. The trace cannot isolate every hosted browser or network factor. [Chromium preflight controller](https://chromium.googlesource.com/chromium/src/+/main/services/network/cors/preflight_controller.cc)

## Consecutive chat text sends

Measured against development 497dd26 in synthetic Chromium and WebKit, four sends per engine per chat. The first send starts after initialization. The following three start as soon as the next valid draft can be submitted. All values below are median milliseconds with observed range. Each request incurs a combined 520 ms of simulated application/preflight latency. See [timing methodology](testing.md#measuring-post-send-responsiveness).

| Chat and revision | Submit to POST | POST to confirmed bubble | POST to usable Send | Submit to usable Send | POST to last reconciliation response |
| --- | ---: | ---: | ---: | ---: | ---: |
| First base | 527 (521-532) | 17 (8-39) | 1602 (1594-1612) | 2130 (2118-2140) | 1589 (1574-1601) |
| First optimized | 530 (522-535) | 17 (12-47) | 542 (533-556) | 1071.5 (1065-1084) | 528 (521-538) |
| Second base | 540.5 (528-555) | 10 (4-39) | 1628.5 (1605-1960) | 2171 (2140-2504) | 1616.5 (1594-1764) |
| Second optimized | 539.5 (526-551) | 7.5 (6-22) | 1086 (1074-1114) | 1628 (1604-1655) | 1074.5 (1060-1107) |

First Chat isolated submit-to-Send fell from 2138 (2136-2140) to 1069.5 (1068-1071) ms. Rapid sends fell from 2128 (2118-2138) to 1073 (1065-1084) ms. Second Chat isolated sends fell from 2180.5 (2164-2197) to 1628 (1623-1633) ms. Rapid sends fell from 2164.5 (2140-2504) to 1631.5 (1604-1655) ms.

| Chat | Base dependency graph | Optimized dependency graph |
| --- | --- | --- |
| First | POST then match then chat then parallel history and exits | POST then parallel match, chat, history and exits. Five application requests in both versions. |
| Second | POST then status then chat then history | POST then status then same-chat history. Four requests reduced to three. Status determines which chat is readable. |

Each send initiated one targeted reconciliation. All normal samples required one history page. In the six-second idle window after each burst, each engine started four polling GETs for First Chat and six for Second Chat on both revisions. A separate 700 ms delayed-history-body run let every other rapid send interrupt a read. The following send completed the interrupted window before yielding again. Individual paginated responses and actual CORS preflights add variable overhead. Hosted measurements, real accounts and physical devices remain outstanding.

### First Chat exit recovery

Creation formerly used only general write reconciliation. The validated creation DTO now installs the paused state immediately. A due timeout can supersede that acknowledgement's complementary reads. The original write has already returned. The previous once-per-ID marker suppressed recovery after failure. The session now admits one reconciled retry with a two-second delay, then explicit connection recovery. Absolute expiry aborts the owner even during a pending POST or history body. The existing visible poll can verify inactivity while those operations are outstanding. For a POST still pending after five seconds it can also read exit requests, guarded by the original outgoing identity. Neither path replays the message. See [First Chat review](first-chat-review.md#mutual-exit-and-terminal-return).
