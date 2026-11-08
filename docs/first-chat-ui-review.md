# First Chat UI review

The requested branch is `fix/first-chat-lifecycle`, based on inspected HEAD `492a9fa`. The initial working tree was clean. No local or remote development branch is available. Backend and Android references were read only; no contracts, audio implementation, tunnel recovery or ChatSession business logic changed.

Home reports its active conversation to SessionApp, which selects a dedicated shell. Terminal closure restores the normal authenticated shell. The chat uses the viewport height, an independently scrolling timeline and a 1280px maximum application width. Mobile uses stacked guidance; desktop arranges the existing guidance horizontally. Bubbles have a 560px reading limit. Existing VisualViewport resizing remains active.

## Invariants and response paths

| Path | Invariant / review |
| --- | --- |
| Open / terminal close / identity replacement | Home owns chat identity and terminal suppression; shell signal cleans up on unmount. No independent API state added. |
| Approve / reject | Existing policy, confirmation and ChatSession action retained; one approval button below header. |
| Mutual request / accept / reject / timeout | Existing request and pending panel retained; no local lifecycle inference. |
| Unilateral / report / block | Existing confirmation, payload and error handling retained. Ordinary exits omitted in decision-only mode; safety remains policy controlled. |
| Poll / retries / resume / obsolete responses | ChatSession response installation, cancellation and reconciliation unchanged. Retry appears within connection errors. |
| Back / draft / uncertain send | Back keeps the mounted chat, never calls cancellation or adds history entries. Subsequent browser traversal can leave the document. Existing beforeunload protection remains; terminal draft notice offers explicit discard confirmation. |
| Menu / dialogs | Local open state only; pointer listener cleanup, arrow/Home/End navigation, Escape restoration, Tab/outside dismissal. Native buttons provide Enter/Space. Confirmation still uses a modal dialog. |

## Validation

- `npm run typecheck`: passed.
- `npm test -- src/chat/FirstChat.test.tsx src/home/Home.test.tsx`: initially 65 passed; expanded focused run `npm test -- src/chat/FirstChat.test.tsx src/chat/ChatSession.test.ts src/home/Home.test.tsx`: 129 passed.
- `npm test`: initial run 574 passed, one unrelated CropDialog prepared-state timeout. `npm test -- src/onboarding/CropDialog.test.tsx`: all 40 passed separately. Full suite rerun: 575 passed across 25 files.
- `npm run build`: passed.
- `git diff --check`: passed.
- `node tools/chat-layout-check.mjs` with local Vite running: headless Chrome synthetic conversation, send confirmation, all six requested viewport sizes with populated and empty timeline. No horizontal overflow; composer within viewport. Captures in `artifacts/first-chat/`. These use fake chat data and do not authenticate or call backend services. Empty screenshots hide rendered fixture messages and check the resulting layout.

Remaining manual checks: Android/iOS virtual keyboard, real safe areas, touch and screen-reader interaction, long real conversations, and real authenticated browser history traversal across document boundaries. Chrome emulation does not validate a device keyboard. No commit, push or deployment performed.
