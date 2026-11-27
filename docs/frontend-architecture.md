# Frontend dependency guard

Run `npm run check:architecture` locally. CI runs it after `npm ci`, before
typecheck, the full Vitest suite (`--maxWorkers=2`) and build. There are no added
packages: the script uses Vite 8's public `parseSync` API on Node 24.

`tools/check-cycles.mjs` follows production modules from `src/main.tsx`, including
literal dynamic imports, relative imports, directory indexes and re-exports.
Tests and fixtures outside that graph are excluded. All runtime cycles, including
self-imports and cycles through lazy chunks, are prohibited; there is no allowlist.
Diagnostics print the source paths in each detected cycle and exit nonzero.

Explicit `import type`, `export type` and type queries create no runtime edge.
Mixed imports remain edges. With this project's `verbatimModuleSyntax`, even
`import { type T } from './module'` retains module side effects as `import {}`;
use `import type { T }` to erase the dependency entirely. Comments and strings
are parsed as syntax, never searched with an import regex.

The resolver reflects today's relative-import architecture, not a general-purpose
TypeScript resolver. Packages and non-code assets are outside the graph. Unresolved
relative code imports, parse failures, known source-alias prefixes and nonliteral
dynamic imports fail closed. If adding aliases, glob imports, workers, additional
entry points or new source extensions, extend the checker and its fixture tests
alongside that change. No feature-boundary framework is imposed.

## Home / Onboarding composition

Previously `Home -> Onboarding -> Home` was the only detected production runtime
cycle. `App` and `Home` now pass the existing stable `Home` function to Onboarding
as a required component prop. Onboarding's reverse import is type-only. This
preserves the same JSX positions, keys, hidden retained subtrees and callbacks,
without wrapping components, asynchronous loading or new state owners. Do not
pass an inline component function: changing its identity would remount nested Home.

The remaining feature edges connect actual UI composition (Home to chat/account,
chat to audio, Onboarding to profile fields/questions). No other runtime cycles or
concrete misplaced responsibilities warranted changes. Admin lazy imports and
authentication initialization remain intact. Additional screen splitting was not
needed for this refactor.

| Lifecycle / mutation path reviewed | Preserved invariant |
| --- | --- |
| App selects Home or setup; Admin covers regular UI | Same ownership, visibility and session controller; no new mount boundary or auth timing change. |
| Home opens/closes profile or preferences | The same retained Onboarding instance owns forms, crops, dirty reporting and navigation locks. |
| Setup embeds Home for existing interactions or activated profile | The supplied component is the original Home function; same history delegation, active-chat state and suppression/reconciliation. |
| Profile/photo/legal writes, retries and response installation | Existing serialized `run`, abort ownership, authoritative reconciliation and uncertain-write blocking are unchanged. No mutation path added. |
| Background/resume, stale responses, sign-out | Existing effect cleanup and controller/resource ownership are unchanged; no new asynchronous callback or response installer. |
| Browser Back/Forward, focus, account navigation | Existing navigation object, callbacks, guards and DOM structure remain unchanged. |

Validation and the limited Android comparison are recorded in the existing
[parity matrix](android-parity-matrix.md). Existing broader parity gaps remain
outside this maintenance task.

## Web activity notifications

`ReadySession` owns one coordinator under the authenticated account/profile key
and the existing tab gate. `useHome` forwards successful validated Home
installations and Scheduling forwards its existing validated reconciliation
after rendering. The coordinator owns the unread projection, the tab title and
favicon, and two read-only endpoints through `SessionController`. Its responses
have no path to operational Home, matchmaking, restoration, navigation, or
screen errors. The existing five-second foreground Home status poll remains in
place. It remembers previously advertised boundaries even if another device
clears or advances the shared marker. A successful full Home read retires
boundaries through the triggering status's server time. The full read reuses
that status sample, so a marker-triggered reconciliation adds no status GET.

| Context | Additional polling |
| --- | --- |
| Visible Home, Activity, or searching | Zero. Use the operational Home projection. |
| Hidden queue | One status GET per 10 seconds. |
| Hidden ordinary activity or management/interaction surfaces outside Home | One status GET per 30 seconds. |
| Otherwise eligible within five minutes of a known second chat or during its entry window | One status GET per 10 seconds. |
| Active chat, Administration, all Web categories disabled, restricted/signed-out session, non-owning tab, or setup with no Home | Zero. |

## Initial presentation

`OperationalApp` scopes `StartupBoundary` to a single operational mount. The
boundary owns visibility only. Firebase and the session controller select the
session state, the legal gate authorizes entry, and Home, Onboarding and the chat
sessions report when their destination or actionable error can be shown. The
boundary releases before paint for the current authentication attempt. Explicit authentication and replacement identities advance its generation. A completion from an older generation cannot reveal a newer destination. After 30 seconds, authenticated bootstrap and destination loading can offer sign-out. Pending Firebase operations cannot be cancelled by this control. Ordinary startup presents the brand and progress indicator.
Account and actionable recovery screens own sign-out. Tab ownership uses the same presentation for acquisition before the
operational tree exists, with explicit contention and failure feedback.

See [startup and Home return](navigation-flicker.md#startup-and-home-return)
for the backend read ordering, mutation review and measurements. Automatic First Chat entry mounts one session while the search presentation is visible. The chat renders its timeline only after metadata, messages and exit requests are installed together. A failed read returns retry controls to the search surface. The queue cancellation handler is retired when the authoritative queue ends.

On eligible ticks, pending costs at most one additional GET when a version
changes, an advertised or known activity boundary is crossed, recovery is due,
or the last projection is about two minutes old. Pending has an independent
parser and does not clear the shared dirty flag. The coordinator remembers a
future refresh marker across status reads so another device consuming it does
not erase the local wake-up. Mode transitions reuse the recent check time,
operational reads and scheduling writes preempt complementary reads, and
eligible resume checks status promptly. Transient failures preserve the usable
projection and respect Retry-After when supplied.

| Installation or mutation path | Invariant |
| --- | --- |
| Initial/reloaded projection | A new account/browser establishes a seen baseline. Each re-enabled category independently treats its first fresh projection as seen, including an empty baseline. A reload retains an outstanding baseline and any still-relevant unread IDs from other categories. |
| Operational and complementary success | Validated records and projection are reconciled together. Complementary reads install only into the notification model. A scheduling projection without a Home version preserves the last observed version and yields to a newer projection. |
| Activity replacement, expiry or invalidation | At most one supported stage per match. Authoritative absence or replacement removes old records. A projected second-chat availability stage with eligible attendance can show immediately even if the preceding status predates the start. Known deadlines may hide indicators and prompt reads. They cannot authorize entry or change the business lifecycle. |
| Presentation | Each loaded destination acknowledges its own enabled ID while the document and surface are visible. Appointment cards acknowledge when their appointment text intersects the viewport. A successful local confirmation acknowledges before its Home reconciliation feeds notifications. |
| Hidden/foreground transitions, failed or obsolete reads | Resume preserves mounted DOM, selection, focus, scroll and drafts. One complementary read is owned at a time. Aborted, late, malformed and failed replies cannot clear good state. Automatic first-chat opening still uses operational Home and requires a visible document. |
| Disable, sign-out, restricted session, identity or ownership replacement | Disabling removes only that category's unread records and presentation receipts. Disabling the last category retires supplemental polling. Session teardown aborts owned work and restores the original title and icon attributes. SessionController retains App Check, authentication and tab ownership checks. |

Storage uses `reals:web-notifications:v2:<accountId>` per browser origin. It
holds the five Web switches, categories awaiting baseline, up to 100 current
IDs with seen bits, and up to 100 short-lived presentation receipts. The v1
master switch migrates to the same value for all five categories, preserving
valid enabled history. v2 is written on the next change or reconciliation and
takes precedence thereafter. A storage failure keeps the owning session's
in-memory data and the settings page explains that changes are session-only.
The settings page has only Web switches. The native Android client continues
to own the existing server-backed push preferences.

The timer targets are best effort. Hidden documents can be throttled, frozen or
discarded, and a closed PWA cannot run this coordinator. Favicon updates use the
existing 32px PNG and Canvas. Image decoding or deployment CSP can prevent
the dynamic icon while the title still updates. The installed PWA icon uses
the existing manifest. See the [Android comparison and test limits](android-parity-matrix.md#web-activity-notifications).


## Shared contacts

Ordinary Account navigation owns Contactos. Only an active profile gets the entry. The optional Home invitation mounts after the ordinary summary is ready, with no active interaction, and only reads owner status when a provider is configured and usable. An account-scoped dismissal suppresses the invitation. Contact participation has no effect on onboarding or queue admission.

The management screen loads telephone metadata on demand. Reals initially selects every eligible unique E.164 number returned by either provider. The active owner's profile country supplies the initial national dialing region. International numbers retain their country. Users can adjust the region, select or deselect all, and review excluded entries. Duplicate aliases share one checkbox with the first nonempty name in provider order. Separate numbers remain individually selectable even when names match. Confirmation requires at least one telephone. Erasure has its own confirmed action. Backend normalization and the confirmed distinct count remain authoritative.

Owner requests use SessionController, App Check and the existing private transport. Consent, full selection and selection additions are the exact PUT routes that accept the revision header. A synchronized owner can add or replace. Initial import and required resynchronization use full selection. The review contains only the current provider batch. The additions endpoint atomically merges that batch and reports how many phones were added and the resulting total. The UI shows those counts in the confirmed result. Owner status supplies the synchronization timestamp and the current distinct phone count. Contacts displays the count for synchronized selections, including an explicitly empty set. During rollout, a response omitting the count leaves it undisplayed. Both import responses must agree with their nested status count when supplied. The import body contains unique selected E.164 strings. Contact identities, tokens and numbers live only in the active operation. Review [ownership](runtime-refinements.md#contact-operation-ownership), [release configuration](deployment.md#shared-contact-providers) and the [owner contract](../../reals-backend/docs/commons/api.md).

### Confirmed chat text sends

The message transaction can replay a committed clientMessageId before checking mutable eligibility. The POST alone cannot authorize another send. Both sessions capture the history cursor before the write, install the validated acknowledgement, then read authoritative participant state. The composer uses the session's current text eligibility for click, touch and Enter. Each draft edit advances a revision, and each selected reply is an object owned by its submission.

| Session path | Requests and installation |
| --- | --- |
| First Chat, initialized text | POST, then match, First Chat snapshot, exit requests and participant history concurrently. Validate the original account, match, chat and counterpart. Install the current lifecycle, exits and server clock together. Shared contacts require current foreground and media checks. |
| Second Chat, initialized text | POST, then attendance/lifecycle status, then history. Reuse the validated chat-to-connection/match binding only for the same readable chat. Replacement and terminal chats take the general metadata path. |
| Text-only early release | Require a validated text acknowledgement, writable lifecycle, eligible reply and current foreground plus an ALLOWED history header. The unread response body and remaining pages can overlap the next POST. Audio and action mutations retain the general busy guard. |
| Superseding a history body | Abort the complementary read, advance the generation and reuse its pre-send cursor. The next reconciliation must complete before yielding again. This bounds interruptions even during sustained input. Alternating history windows include earlier reaction changes. |
| Rejection, unreadable history or failed confirmation | Preserve confirmed bubbles. Retain unresolved payloads and IDs. Explicit recovery checks authoritative history before a user-requested retry. Current owner and generation guard installations and cleanup. |
| Polling and resume | Skip an interval tick in the first 500 ms after successful text reconciliation. Explicit refresh and foreground revalidation bypass that debounce. |

Deferred technical debt: a bounded in-memory FIFO for text could accept a limited number of drafts, each with its own immutable reply and clientMessageId, while issuing one HTTP write at a time. It needs explicit handling for ambiguous delivery, user-visible recovery and retirement on terminal lifecycle or owner change. The current implementation retains only the submitted mutation.

### First Chat exit ownership

ChatSession validates exit acknowledgements, tracks the response window and serializes exit mutations. FirstChat owns the panel, tick and composer resources. Home owns account-scoped stale projection suppression and retires the interaction navigation entry. Absolute local expiry carries a provisional suppression reason. Confirmed server closure carries a permanent guard for the current mount. Details and mutation paths are in [the First Chat review](first-chat-review.md#mutual-exit-and-terminal-return).
