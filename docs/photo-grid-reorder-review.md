# Android-aligned photo grid and reordering

Canonical references (read only): [ProfilePhotosSection.kt](../../reals-app/app/src/main/java/com/reals/app/ui/profile/ProfilePhotosSection.kt), particularly PhotoGrid/FilledPhotoSlot/EmptyPhotoSlot/DraggedPhotoGhost, and [ProfilePhotoReorder.kt](../../reals-app/app/src/main/java/com/reals/app/ui/profile/ProfilePhotoReorder.kt). The [backend API](../../reals-backend/docs/commons/api.md) owns validation and persistence.

## Presentation and interactions

The Web grid always has nine square image/empty frames in three columns, including narrow mobile screens. Occupied slots have a 24px visual X inside a 44px delete target at the upper-right corner and a compact Cambiar action below. Empty slots show + / Agregar. Positions remain in accessible names instead of visible numbered headings. Only Android's NEEDS_REVIEW and REJECTED moderation states produce En revisión / Rechazada badges, with accessible guidance. Raw validation/moderation/person/full-body flags are not rendered.

Mouse/pen movement starts an internal reorder after 4px. A touch must remain within an 8px slop for 500ms before dragging. Before activation, touch scrolling remains native; after activation a non-passive listener on this grid prevents the active drag from scrolling. Listeners do not block unrelated page touches. Source opacity, a pointer-transparent ghost, destination outline and live feedback mirror Android's feedback without rearranging the authoritative list.

Keyboard users focus an occupied photo, press Space/Enter to pick it up, use arrows (or Home/End) to choose among all nine positions, then Enter/Space to request the move. Escape/Tab cancels. Screen-reader activation clicks also support pickup. Delete, change and add remain separate labelled buttons; upload permissions remain distinct from delete/reorder permissions.

## Mutation and resource invariants

`photoPlacements` implements Android's swap semantics: occupied destinations swap positions, empty destinations move only the selected ID, and all other positions/holes remain unchanged. The complete placements list is sorted by position and sent to the existing PUT `/api/me/profile/photos/reorder`. No-op, invalid target and missing-ID operations produce no mutation.

The existing parent mutation lock, session/profile identity checks and authoritative reconciliation remain responsible for writes. No optimistic order is installed; only the backend refresh changes rendered placements. Failed or uncertain writes retain the existing recovery rules, including an explicit refresh before another write after an uncertain transport result.

Each gesture owns its pointer or touch identifier and pending hold timer. Cancel, lost capture, blur, backgrounding, disable, photo refresh and unmount discard that ownership and clean listeners/timers. A repeated end event cannot commit twice. External `Files` drops use the existing guarded file selection/crop/upload path; internal pointer/keyboard gestures do not construct files or invoke uploads. An active internal interaction rejects competing file selection.

## Validation and pending manual checks

Focused tests cover slot presentation and overlay deletion, swaps and empty moves with sparse complete payloads, mouse/touch/keyboard interaction, hold timing, cancellation/cleanup, file isolation, failed reconciliation, uncertain persisted outcomes and duplicate-request protection. Existing picker, crop, verification, activation and session tests remain in the full suite.

Latest validation: `npm run typecheck` PASS; `npm test` 316/316 PASS in 13 files; `npm run build` PASS; `git diff --check` PASS.

An isolated native headless Chrome harness passed 320px, 360px and 1000px layout checks (three columns, nine square frames, 44px delete targets and no horizontal overflow), mouse ghost/target feedback, keyboard movement to an empty position, and native touch emulation. Scrolling before the hold was observed (`scrollY=125`); after the hold a drag reordered without scrolling. Touch cancellation and synthetic external Files drop isolation passed. The dark-theme preview was inspected. No account data, backend mutations or storage URLs were used; temporary repository harness files were removed and browser/Vite processes stopped.

Pending: actual Chrome Windows OS file dragging (the harness used DataTransfer), authenticated reorder/delete/upload smoke, physical Chrome Android long-press/context-menu and page-scroll behavior, TalkBack and keyboard focus across real server round trips, and light/dark visual checks on physical devices. Keep `.env.local`, MinIO endpoints and backend/Android repositories unchanged.
