# First Chat — implementation and validation

Branch: `feature/first-chat`, created with `--no-track` from freshly fetched `origin/main`, `0cc7fdb5da2563c8599f2d25938c0c0c70991241` (PR #9). Initial working tree was clean. Local `push.autoSetupRemote=true`; no commit, push, PR, deployment, backend or Android edits.

## Scope and ownership

`Home.tsx` opens authoritative `pendingActions/FIRST_CHAT` items using their match and chat IDs. Opening unmounts `HomeOverview/useHome`. Activity can explicitly reopen a conversation. Intentional return suppresses automatic reopening of that chat for the authenticated/profile mount; another chat can still open. Reloading discovers pending chat through authenticated Home bootstrap, without storing messages, drafts, routes or media URLs. Authentication/profile mount keys in `App.tsx` remain authoritative.

`ChatSession.ts` owns each chat's requests and immutable React snapshots. It loads participant-validated match, First Chat, messages and exit requests. `FirstChat.tsx` owns display, composer and polling lifetime. Text, reply, guidance, HEART, decisions, mutual exits, unilateral cancellation, reports and blocking use existing authenticated `SessionController.request`. No alternative Firebase identity or transport was introduced. `AudioComposer` owns microphone resources; HTML audio controls provide browser playback, pause, seeking and progress. There are no photos or visual-profile requests.

Reference contracts remain in [backend API](../../reals-backend/docs/commons/api.md), [ChatController](../../reals-backend/src/main/kotlin/com/reals/backend/controller/ChatController.kt), [MatchController](../../reals-backend/src/main/kotlin/com/reals/backend/controller/MatchController.kt) and their DTO/service sources. Android references include FirstChatCoordinator/Rules, ChatMessageActionHandler/Collection, HomeRouter/HomeCoordinator, ChatScreen/Chrome, FirstChatPanels/InteractionPolicy, ChatLifecycleUiState, ChatAudioComposer/RecorderController/PlaybackController/Session, ChatSafetyDialogs, ChatDto and domain Chat. Policy, collection, routing, reconciliation, guidance, safety and audio test cases informed the browser regressions. Browser controls replace gesture-only message actions.

## Invariants and mutation review

| Path | Required invariant / response installation | Failure, race and cleanup handling |
| --- | --- | --- |
| Home → chat / reload / Activity | IDs originate from Home; match membership, partner, match/chat ownership and FIRST_CHAT type are checked before conversation installation | Home poller unmounts; manual return suppresses redirect loops; auth/profile changes unmount owner |
| Initial load / poll / resume | Match, chat, messages, exits and measured server offset install together; order uses server `(sentAt,id)` | Single read lane, abort on mutation/disposal, generation checks reject obsolete results; StrictMode cleanup/restart supported |
| Text / direct reply | One logical UUID and immutable payload; 1000 UTF-16 units and backend plain-text restrictions; incoming message or immutable guidance snapshot target | Pending/failed/uncertain are explicit. Draft clears only after canonical confirmation. Lost response triggers authorized reconciliation. Explicit retry reloads before replaying identical ID/payload; no automatic resend |
| Audio upload | Same logical ID, reply and identical Blob survive ambiguous failures; enabled policy, size and quota checked | FormData supplies boundary. Recording must pass binary check before composer offers upload; retry uses stored bytes. Known rejection permits explicit draft editing |
| HEART | Incoming latest block only; TEXT/AUDIO presentation; no existing HEART; no remove/toggle | PUT canonical response installs immediately; merge preserves irreversible HEART when stale metadata omits it. No client activity/deadline updates |
| Guidance | Only authoritative `canRequestNext`, requested/completed flags, progression action and immutable instance ID | No locally computed participation score. Legacy null guidance is allowed. Obsolete direct question reply preserves draft and explains recovery |
| Decisions | Active match/chat, own decision pending, no mutual exit, advisory deadline not elapsed | Backend validates early approval/participation. Approval by either participant locks ordinary conversation; pending participant can still decide. Own submitted decision returns Home, as Android does |
| Mutual exits | PENDING pauses messages/guidance/decisions; only responder can accept/reject | Both acceptance and rejection close chat. Android's 20-second advisory delay triggers timeout once per request; backend may reject an early timeout. Explicit check remains available; no retry loop |
| Unilateral / report / block | Ordinary unilateral exit prohibited in decision-only; report/block retain availability in decision-only; confirmations explain effects | Report reason, plain-text details and optional block validated. Failed report keeps dialog details. Successful report/block has explicit Home feedback; no invented bans |
| Expiry / inactivity | Local countdown blocks stale ordinary controls but never creates a terminal status | Server timestamps plus measured offset. Decision-only ignores inactivity advisory. Match/chat terminal state or explicit CHAT_EXPIRED/CHAT_ABANDONED routes Home. Terminal owner stops reads/writes |
| Accepted write / failed subsequent read | A canonical success cannot become an uncertain send | Explicit “action confirmed, update failed” error. Refresh reads state; no repeat mutation |
| Navigation / background / identity | No signed URLs or sensitive payloads in custom storage/logging | Draft warning on explicit exit/browser unload; terminal notification retains an existing draft until explicit return. Recording stops on background/unmount/policy lock; late permission tracks stop; timers/listeners/object URLs released; playback resources unloaded |

Polling runs every five seconds while visible, plus resume/online reconciliation. It alternates newest-message cursor and Android's two-sender-run reaction cursor. Incremental wrappers drain `hasMore` to completion, reject nonadvancing cursors, and merge by canonical ID. A one/two-run history may require the bounded initial read to reconcile all eligible reactions, matching the Android strategy. There is no full-history reload on every poll for longer alternating histories. Explicit audio URL renewal reloads the authorized message page; URLs are neither rewritten nor persisted.

## Audio compatibility and deliberate fallback

Runtime capability detection checks `MediaRecorder`, native MP4/AAC candidates and microphone API availability. The completed recording is inspected as ISO BMFF: brand, one audio track, AAC sample entry/configuration, duration, populated sample/chunk tables and media payload. WebM/Opus, fragmented MP4, malformed, video or unsupported output never becomes an upload. MIME normalization to `audio/mp4` happens only after binary MP4/AAC inspection, without conversion or header-only spoofing. The backend remains the final validator. The conservative browser checker can reject otherwise valid formats (extended boxes, version-1 mdhd, co64 and multiple audio tracks); this is intentional fallback rather than an assertion of universal support.

A real Chrome 156 headless recording of a generated audio signal produced native `audio/mp4;codecs=mp4a.40.2`, approximately 15 KB, with top-level `ftyp, moov, moof, mdat`. The fragmented output was rejected by the browser admission check. The backend inspector requires nonempty classic sample tables, so `isTypeSupported=true` alone would be misleading. Unsupported output disables further recording in that composer with a clear text/Android fallback. This is actual encoder evidence, **not** an authenticated backend upload test or a real microphone permission test.

Primary references: [Chromium muxers](https://chromium.googlesource.com/chromium/src/+/HEAD/media/muxers/README.md), [WebKit MediaRecorder](https://webkit.org/blog/11353/), and the local backend's ChatAudioValidationService/ChatAudioPolicyService. WebKit's MP4/AAC support statement does not prove compatibility of a particular browser's completed output.

Alternatives evaluated:

- A client AAC encoder still needs a classic MP4 muxer, accurate sample durations/offsets and extensive cross-browser fixture coverage. Implementing this inside this change would introduce an unvalidated codec/muxer maintenance surface.
- A general WASM transcoder adds a separately downloaded binary, recording plus conversion memory, CPU/battery/latency costs on mobile, worker/resource deployment requirements and codec/security update maintenance. No such dependency was installed, bundled, fetched at runtime or represented as working. Its exact bundle/performance cost was not benchmarked because the dependency was not adopted.
- Chosen fallback: preserve text and playback, disable incompatible native recording after actual byte validation. **No supported browser/backend audio-upload combination has yet been certified. Safari and mobile Chrome recording acceptance remain integration blockers.**

Recording preview/upload/retry is implemented for admitted native output. Actual successful upload/playback against private storage still requires the tests below. File size is checked during available recorder chunks and after finalization; some implementations buffer until stop, so the finalized byte check is decisive. Upload feedback is state based rather than a fabricated percentage.

## Validation evidence

- `npm run typecheck`: passed.
- `npm exec vitest -- run src/chat src/home/Home.test.tsx`: 139 tests passed before the final seven session-race/timeout/validation cases were added.
- `npm exec vitest -- run src/chat/ChatSession.test.ts`: final 57 session tests passed.
- `npm test`: 540 tests / 23 files passed before those seven additional cases; final full-suite result recorded below.
- `npm run build`: passed; production JS 434.01 KB, gzip 133.11 KB at that run. No new npm dependencies.
- `git diff --check`: passed during review; final verification recorded below.
- `node tools/first-chat-smoke.mjs` with Vite running: real Chrome 156 native encoded-output check rejected fragmented MP4; synthetic chat rendered, submitted/confirmed text, and had no horizontal overflow at 390px and 1280px. This script uses generated audio and synthetic in-memory chat responses. It does **not** prove Firebase, backend or microphone integration. Its Chrome path is Windows-specific, debug port 9444; it creates and removes an isolated temporary profile. It does not sign in or expose `.env.local`.
- An earlier concurrent full-suite/build run hit an existing CropDialog preparation timeout (539 passed / 1 failed); a subsequent standalone `npm test` passed all 540. No onboarding code/tests were changed to suppress that timeout.

Automated coverage includes queue-to-chat, restoration, Activity reopening, manual Home suppression, auth replacement/sign-out, StrictMode, text success/rejection/uncertain replay, cursor pagination, malformed responses, latest incoming HEART block, immutable replies, guidance waiting/completion, audio permission failures/cleanup/format rejection/policy/multipart retry, signed URL replacement, decisions, exits/report/block, deadlines and superseded reads. These tests use fake dependencies; none certifies real service behavior.

## Required two-user integration protocol — not executed

Use two isolated browser profiles with **two authenticated Firebase users**, active backend profiles and the same intended backend environment. `.env.local` is configuration, not two authenticated browser sessions. Record pass/fail and browser/OS versions without tokens, personal messages, email addresses or private media URLs.

1. Start backend and Web. Both users enter matchmaking with location permission. In `local-firebase`, manually trigger the existing authorized matchmaking processing workflow because local schedulers may be disabled (see backend docs); do not infer queue success from the UI alone.
2. Confirm authoritative Home creates FIRST_CHAT and both browsers enter the same chat automatically, without photos. Reload both browsers; check session restoration. Return explicitly to Home; refresh repeatedly, confirm no loop, then reopen from Activity.
3. Exchange text in both directions, including accents/newlines and maximum length. Reply to incoming messages and the current guidance snapshot. Disconnect after submitting once, reconnect and reconcile; verify one canonical message per UUID.
4. React to several messages in the latest incoming block, send a later outgoing message, then create a newer incoming block. Check eligibility and irreversible HEART on both clients; deadlines must not extend from reactions.
5. Advance guidance with both users. Verify waiting, completion and server audio gate/quota. Deny microphone permission once and recover. Record actual bytes: incompatible Chrome output must be disabled, with no upload. For any admitted browser, send and play audio in both directions, seek/pause, test retry with identical recording bytes/UUID, and renew expired signed URLs through authorized reload. Save no private URLs. Successful browser/backend audio is currently unverified.
6. Attempt approval too early. Meet the authoritative participation requirements. Approve from A; verify A returns Home and B sees decision-only with safety/final decision available. Approve from B; both Home activities must reflect Visual Phase. No Visual Review screen is implemented.
7. Repeat with ordinary rejection, approval/rejection mismatch and unilateral exit. On separate chats, request mutual cancellation and test acceptance, rejection and timeout separately; each closes according to the backend. Simulate simultaneous sends/exits in both browsers.
8. Test all safety reasons, invalid/valid details, optional report+block and manual block, including decision-only. Verify explicit confirmation and authoritative Home feedback without claims about moderation outcomes.
9. Let inactivity and absolute deadlines resolve on separate chats; suspend/resume/background one browser. Local countdown must not synthesize closure. Sign out during a read, permission prompt and upload; no old identity response/media should appear after another user signs in.
10. On physical Android Chrome and Safari/iOS, test keyboard opening, composer visibility, scroll position, new-message indicator, long conversations, focus order, native playback and screen-reader labels. Desktop headless viewport checks do not certify physical keyboards or Safari.

## Remaining limits and acceptance status

This is a backend-integrated implementation with automatic and manual routing, not a mock screen. Stage D2 is **not certified complete end-to-end** until the two-user protocol passes. No real authenticated two-user mutation sequence, Firebase restoration, private audio URL expiry, successful native audio upload, physical mobile keyboard or Safari run was performed in this session.

The backend only exposes the most recent bounded initial page and forward cursors, so a fresh browser cannot retrieve messages older than its initial 500. A visible notice explains that limit; continued incremental sessions retain messages already loaded. No invented backwards-pagination endpoint was added. Drafts are memory-only: explicit exit requests confirmation, refresh warns, and no outgoing message is automatically restored/replayed after refresh. Suppression is also mount-local; reload intentionally rediscovers authoritative pending activity. Timeline rendering is not virtualized; very long continuously open sessions may need performance profiling. Guidance shows server readiness rather than inventing per-user participation totals absent from the snapshot.

Final verification: `npm test` passed **547 tests in 23 files**; `npm run build` (including `npm run typecheck`) passed with 434.51 KB JS / 133.30 KB gzip. `git diff --check` and a whitespace check of added files passed. The final small audio-draft deletion lock change was also rechecked with focused chat tests. No dependencies or lockfile changes.
