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
