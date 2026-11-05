# Crop zoom / blank-interface investigation

## Evidence and diagnosis

A regression against the previous cropper reproduced a React render failure: pointer movement queued functional `setX`/`setY` updaters that read `drag.current`, then pointer-up cleared that ref before the updaters ran. The result was `TypeError: Cannot read properties of null (reading 'x')`. An isolated native headless Chrome harness using the previous component reproduced the same exception and observed that its dialog had disappeared. This is a confirmed blank-interface path, not a speculative allocation issue.

The reported original-photo zoom threshold is not independently reproduced. The failure above is gesture/timing dependent; it does not establish that changing zoom alone always triggers it. The previous 1–4 geometry is finite for valid image dimensions, but its memory/display path had separate confirmed weaknesses:

- A supported 2000×16000 source requested only `resizeWidth: 2000`, leaving a 32 MP processed bitmap. The 2400 width limit did not constrain height.
- The preview loaded an object URL for the original File, independently of that processed bitmap. At 32 MP, a single uncompressed RGBA surface is about 128 MB; actual browser sharing, peak allocation and GPU storage were not measured.
- Enlarging the original `<img>` through CSS percentages made its rendered dimensions grow with zoom and aspect ratio. The original-file preview and oversized surfaces were avoidable even though this was not proven to be the reported crash's exact cause.

## Change and resource ownership

`cropImage.ts` checks JPEG/PNG dimensions and orientation metadata before decoding. Existing 15 MB, 32 MP and 16000px source limits remain; processed dimensions now fit both 2400px axes and 4 MP, preserving aspect ratio within integer pixel rounding. EXIF rotation/mirroring is delegated to `createImageBitmap` with `imageOrientation: 'from-image'`; resize targets account for swapped dimensions. See the [HTML ImageBitmap preparation algorithm](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#imagebitmap).

The UI previews that processed bitmap directly on a fixed 560×700 canvas, with no original-file image or object URL. Preview and export share `cropRect`/`drawCrop`. Export remains JPEG 1080×1350, quality 0.9, with the same upload contract. Preview motion changes only source crop coordinates; it does not resize canvases, allocate larger DOM surfaces, or decode again. Animation frames are coalesced/cancelled, and source geometry is finite across all 301 supported zoom steps.

Pointer deltas are captured as numbers before queued state updates, rather than dereferencing mutable drag ownership later. Dragging uses actual viewport/source geometry. Pointer capture is released on completion, cancellation, lost capture and unmount. File generations reject obsolete decode/export completions, close late/owned bitmaps, cancel preview frames and release canvas backing storage. StrictMode's first scheduled decode is cancelled before allocation. Explicit retry may decode again; ordinary slider changes do not.

Decode failures, missing/drawing/lost canvas contexts and export failures produce visible errors. Retry/Cancel remain available and failed previews cannot be confirmed. Firebase, email eligibility, photo classification/moderation, backend endpoints and MinIO configuration are unchanged. `.env.local` is untouched.

## Validation and remaining Chrome checks

Automated regressions cover all zoom steps 1.00–4.00, repeated UI slider updates, portrait/landscape/extreme ratios, source/processed limits, all eight EXIF orientations, shared preview/export source rectangles, the confirmed drag-release race, cleanup and recovery from decode/render failures. Run `npm run typecheck`, `npm test`, `npm run build`, and `git diff --check`.

Latest result: typecheck PASS; 297/297 tests PASS in 12 files; build PASS; diff whitespace check PASS.

The isolated Chrome smoke used generated images, real JPEG decoding and real canvas output, without accounts or API calls. Five cases passed repeated zoom/position changes and preview/export sample-pixel alignment:

| Source | EXIF | Processed bitmap |
| --- | --- | --- |
| 2000×16000 | 1 | 300×2400 |
| 16000×2000 | 1 | 2400×300 |
| 1×16000 | 1 | 1×2400 |
| 4000×3000 | 6 | 1732×2309 |
| 5600×5600 | 1 | 2000×2000 |

Each case used one decode and one fixed 560×700 preview, exported a compatible 1080×1350 JPEG, and allocated no preview object URLs. EXIF 6 was also checked against expected quadrant colors. All five retained bitmaps closed after replacement/cancellation. Temporary repository harnesses were removed and browser/Vite processes stopped.

Still pending: interactive Chrome Windows with the actual failing photo/gesture, hardware acceleration enabled, DevTools native/GPU memory and responsiveness profiling, repeated large-photo open/zoom/cancel cycles, and physical Chrome Android touch/background/resume validation. Headless Chrome here used software rendering; passing tests does not guarantee a bound on transient native decoder allocations or prevent every browser-process out-of-memory failure. Extreme aspect ratios remain accepted within source limits but may yield visibly upscaled output after bounded downsampling. No HEIC or Safari compatibility claim is added.
