# Home management — Stage D1.5

Home keeps matchmaking first and Activity conditional on backend activity. Four compact cards open separate profile, preferences, affinities and account surfaces. Native buttons reuse the responsive Home grid (one column on narrow screens, two from 700px), touch targets and focus styling. No routing dependency was added.

Profile and preferences reuse `Onboarding` in management mode, including `ProfileForm`, `PhotoGrid` and `CropDialog`. ACTIVE users never receive activation controls. Preferences initialize from the complete saved profile and use the existing match-filter PUT contract. Account uses the existing session-level sign-out button, with no duplicate. Password availability uses Firebase provider metadata; unknown metadata receives informational copy, never an actionable password control.

## Lifecycle and mutation review

| Path | Invariant and reconciliation | Failure / ownership |
| --- | --- | --- |
| Home → management | Entry requires a settled, unblocked Home read and ACTIVE status; queued/searching users retain the waiting screen. | Home's hook unmounts, canceling reads, listeners and polling. No queue mutation occurs on navigation. |
| Editor admission / foreground / manual refresh | Read and install authoritative profile status, then check queue before exposing the editor. A queued result returns to Home, which reconciles and shows waiting. | The existing owner lock serializes reads with writes. Invalid queue/profile/photo/legal data blocks edits and offers refresh/back. |
| Profile PATCH / filters PUT | Existing payloads and server validation remain authoritative. Every attempt, including failed writes, is followed by reconciliation. | No automatic mutation retries. Network/invalid outcomes require explicit refresh before another write. |
| Photo add / replace / delete / reorder | Existing crop, complete placements, moderation and serialized mutation lane are reused. Refresh profile and photo state after every attempt. | Crop ownership and pending operations prevent navigation and overlapping writes. No local moderation or eligibility assumptions. |
| Status downgrade / profile removal | Install the profile read before dependent legal/photo reads, so their failure cannot conceal a known status change. App routes DRAFT/INACTIVE/missing profiles through existing onboarding. | ACTIVE navigation unmounts on status change; no activation action exists in management mode. |
| Back / refresh | Same-document history entries support browser/mobile Back and explicit return buttons. Pending editor work restores the navigation entry and keeps the editor. Headings receive focus. | Forward history cannot restore a form or identity. Page reload bootstraps the backend and returns to Home for ACTIVE profiles; saved data is fetched again. Unsaved input is local to its screen. |
| Sign-out / identity replacement | Existing SessionController cancellation and generation checks reject obsolete responses; authenticated screens are keyed by account/profile identity. | Cleanup aborts owned resources; it never cancels queue membership as a side effect. Sign-out remains available through the existing session action. |

References: [backend contracts](../../reals-backend/docs/commons/api.md#profiles), [backend lifecycle](../../reals-backend/docs/commons/state-machine.md), Android `MatchmakingHomeScreen.kt`, `HomeCards.kt`, `HomeAccountSection.kt`, `ProfileDetailsSection.kt`, `MatchPreferencesSection.kt`, `NotificationSettingsScreen.kt` in `../reals-app`. Android and backend are read-only references for this stage.

## Remaining features

- Affinity catalog, answers and authoritative progress: currently an informational “Próximamente” view, without generated percentages or pretend actions.
- Notification settings: informational entry only; future work needs backend preference loading, mutation/error handling and delivery integration.
- Password changes for password-enabled accounts: informational entry only; future work needs reauthentication, validation and complete Firebase handling.
- Account deletion: informational entry only; future work needs confirmation, reauthentication where required, backend deletion/recovery lifecycle and session reconciliation.
- Continuing Activity conversations, visual discovery and scheduling remains outside this stage.

## Validation

Focused integration tests cover ACTIVE details, saved filters, photo add/replace/delete/reorder, authoritative downgrades, failed/pending writes, queue admission, focus/back, foreground reconciliation, polling ownership, sign-out and unavailable features. Existing Home queue, location, Activity, onboarding, crop and Firebase persistence suites remain in the complete test run.

Chrome headless smoke used a temporary App harness with fake auth/API data: 390px and 1280px Home layouts without horizontal overflow, native Enter activation, profile heading focus/photo grid, filter save, browser Back, informational features and one working sign-out. This does not validate live Firebase, live backend moderation, physical touch gestures or a real mobile browser. No credentials or environment values were included in the harness or report.

Final commands: `npm run typecheck` passed; `npm test` passed (18 files, 446 tests); `npm run build` passed; `git diff --check` passed. Earlier validation runs intermittently failed existing crop context-loss and keyboard photo-reorder assertions; a subsequent complete run passed without changes to those components. Their timing sensitivity remains a test follow-up; this stage does not claim that flakiness is resolved.
