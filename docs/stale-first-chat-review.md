# Stale First Chat after inactivity

Web changes are scoped to terminal navigation and Home projection. Backend transaction/eligibility changes and their separate validation are documented in [backend lifecycle notes](../../reals-backend/docs/first-chat-terminal-consistency.md). Android's FirstChatCoordinator/Rules and HomeCoordinator/HomeUiMapper/HomeRouter are the behavioral reference; Android is unchanged.

`ChatSession` distinguishes conclusively closed chat/match results from returning after submitting one's own decision. Only the former marks the match closed. Network, 5xx and session/authentication errors never mark a chat closed. Local advisory expiry alone never does either.

`Home` owns account/profile mount-local sets: manual auto-navigation suppression, currently stale hidden match IDs, and known-terminal match identities. A terminal return installs the closed identity, closes the screen and displays one notification. All FIRST_CHAT surfaces derive from the same `visibleHome` projection: pending actions, priority, Activity groups, counts and automatic navigation. Opening an already-known terminal match is also rejected at the navigation boundary, independent of rendering. Other interaction types and match IDs are preserved, including later Visual Phase actions for the same match.

An authoritative Home without the stale action retires its currently-stale hidden entry. A terminal match cannot legitimately become active again, so its identity remains a memory-only opening guard until session/identity reset; if a later snapshot erroneously reintroduces it, it is filtered before rendering and becomes a stale entry again. This prevents a clean-then-stale response from restoring an invalid action. Nothing is persisted in custom storage. Existing SessionApp account/profile mount ownership clears these sets on session/identity replacement.

| Path | Invariant | Verification |
| --- | --- | --- |
| CHAT_ABANDONED / CHAT_EXPIRED / terminal snapshot | Conclusive backend result, one notification, hide affected FIRST_CHAT by match ID | HTTP fake regression returns terminal conflict followed by stale Home; all surfaces remain filtered |
| Manual Home | Valid conversation remains reopenable from Activity; only automatic reopening is suppressed | Existing restoration/manual-Home tests remain |
| Poll / refresh | Raw authoritative Home remains intact; projection filters known terminal identities atomically before display | Repeated polling and clean-then-stale tests |
| Home acknowledgement | Remove stale entries once authoritative Home omits them | Pure reconciliation regression |
| Auth/network failures | No terminal identity is recorded | Network and HTTP failure tests preserve Activity opening |
| Account/session change | No old account's hidden IDs or response ownership survives | Auth replacement tests, existing session cancellation |
| Other activity | Filter only FIRST_CHAT of affected match | Independent chat/Visual Review preserved and summary adjusted |
| Draft present on terminal discovery | Existing draft-preservation screen retains terminal cause; explicit Home return carries closed identity | Existing draft guard remains; no messaging/audio rewrite |

No Home/Chat polling loop was added. HomeOverview still unmounts on chat opening; ChatSession still aborts requests and stops polling on terminal/unmount. This patch does not change audio, message mutation contracts, browser microphone behavior, Visual Review or Second Chat.

Validation so far: focused Home/navigation/chat tests passed; `npm run typecheck` and `npm run build` passed. A default full-suite run under concurrent JVM load had two unrelated onboarding/crop timing failures; `npm test -- --maxWorkers=2` subsequently passed 566 tests in 25 files. Final post-review results are appended below. Tools/ADB sources are unchanged from HEAD.

Real two-user Firebase/browser smoke has not been executed: no two authenticated browser sessions were provided, and the running local backend has not been rebuilt with this patch. PostgreSQL HTTP integration tests with Spring test authentication are recorded separately in backend notes. Follow the backend manual protocol for inactivity, absolute expiry and decision-only with both users; no direct database repair or scheduler invocation is required by the fix.

Branch/base: `fix/first-chat-lifecycle` from preserved work HEAD `10da14e` (First Chat plus Android tunnel recovery). Web has no development ref; branching from origin/main would discard the explicitly requested in-progress functionality. No commit, push, merge, deployment or Android edits.

## Final validation

- `npm run typecheck`: passed on the reviewed tree.
- `npm run build`: final reviewed tree passed; production JS 435.70 KB / 133.62 KB gzip.
- `npm test -- --maxWorkers=1`: an earlier reviewed run passed **568 tests in 25 files**, including ADB recovery tests. After adding two conservative terminal-state classification guards and their tests, the final complete run passed **569/570**, with one failure in the unmodified Onboarding photo reorder test. That exact test passed in isolation with `npm exec vitest -- run src/onboarding/Onboarding.test.tsx -t "reorders all placements and deletes by ID with confirmation"` (1 passed, 93 skipped). The full suite is therefore not claimed universally green. No onboarding code or timeout configuration was changed.
- `npm exec vitest -- run src/chat/ChatSession.test.ts src/home/Home.test.tsx src/chat/FirstChat.test.tsx src/home/hiddenFirstChats.test.ts`: final focused check **127 passed**. Unknown/malformed match/chat states remain recoverable errors, rather than causing terminal suppression.
- `git diff --check`: passed; added files receive a separate whitespace check.
- Backend independently passed **107 focused tests**, including nine PostgreSQL HTTP commit/concurrency tests. These are not Firebase browser smoke tests. See the linked backend report for exact command and class counts.

Tracked diff is limited to terminal callback metadata, Home's projection/opening guards, focused Home regressions and the documentation index; new helper/tests and this review contain the suppression policy and invariants. `tools/` has no diff. No commit, push, merge, PR or deploy was performed.

Both work branches lack a same-named origin ref; no upstream was created because publication was explicitly prohibited. Web preserves 10da14e; backend preserves the existing development-based branch and its user-owned Docker/documentation changes.

Observed final worktree (git status --short; git diff --stat, tracked files only; untracked additions appear in status):
```text
 M docs/README.md
 M src/chat/ChatSession.test.ts
 M src/chat/ChatSession.ts
 M src/chat/FirstChat.tsx
 M src/home/Home.test.tsx
 M src/home/Home.tsx
?? docs/stale-first-chat-review.md
?? src/home/hiddenFirstChats.test.ts
?? src/home/hiddenFirstChats.ts
 docs/README.md               |  1 +
 src/chat/ChatSession.test.ts |  2 ++
 src/chat/ChatSession.ts      |  8 +++++---
 src/chat/FirstChat.tsx       |  8 ++++----
 src/home/Home.test.tsx       | 41 +++++++++++++++++++++++++++++++++++++++++
 src/home/Home.tsx            | 20 +++++++++++++++-----
 6 files changed, 68 insertions(+), 12 deletions(-)
```
