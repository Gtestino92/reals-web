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
