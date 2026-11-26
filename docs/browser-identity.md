# Browser identity

## Instalar Reals Web

- **iPhone (Safari).** Abrí Reals en Safari y elegí **Compartir**. Según la
  disposición de las pestañas, Compartir puede estar dentro del menú de página.
  Elegí **Agregar a Inicio** (o **Añadir a pantalla de inicio**). Si aparece la
  opción **Abrir como app web**, activala y tocá **Agregar**. Abrí Reals desde el
  ícono de Inicio. Si falta la acción, buscala en **Editar acciones**. En iPhone
  la instalación se inicia desde ese menú. [Guía de Safari de Apple](https://support.apple.com/es-mx/guide/iphone/iphea86e5236/ios)
- **Android (Chrome).** Abrí Reals en Chrome y usá **Instalar aplicación** o
  **Agregar a la pantalla principal** en el menú del navegador, según la versión.

Eligible iPhone and iPad Safari tabs show **Instalá Reals** below the primary
actions on authenticated, active-profile Inicio. The card uses the native
Safari Share menu. It stays outside setup, account and legal interruptions,
Activity, matchmaking, conversations, review, scheduling and administrative
flows. Ordinary polling and foreground revalidation preserve the card and
its focus. [Safari 26 installation options](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/#every-site-can-be-a-web-app-on-ios-and-ipados)

Eligibility uses top-level Safari user-agent and platform signals, including
the touch-capable Mac-style iPad user agent. It skips other recognizable iOS
browsers and embedded views. `(display-mode: standalone)` and
`navigator.standalone` describe the **current window**. A regular Safari tab
cannot reliably tell whether Reals is installed elsewhere on the device.

**Ya la instalé** and **Ahora no** both store only
`reals:ios-install-guidance:v1=dismissed` in local storage. That preference
survives reloads and account changes in that storage context. A failed storage
write falls back to the current document. The value records dismissal and
carries no installation or account status. These instructions remain available
here after dismissal. Safari and installed web apps have separate web storage.
WebKit 17.2 can copy cookies at installation, while Reals uses Firebase
Web Storage for authentication. Reals does not copy either its preference
or its Firebase session between contexts. [WebKit storage behavior](https://webkit.org/blog/14787/webkit-features-in-safari-17-2/#web-apps)

Validation on the iOS experience branch:

- `npm run test:focused -- src/home/InstallGuidance.test.tsx src/home/Home.test.tsx --maxWorkers=2` passed 125 tests.
- `npm run typecheck` passed. `npm run check:architecture` passed with 107 modules and zero runtime cycles.
- On the Vite server at `127.0.0.1:5174`, `node tools/tab-ownership-browser.mjs --install-guidance` passed Chromium emulation for iPhone, desktop-UA iPad, desktop, iOS Chrome and standalone signals. It checked synthetic login and setup, search entry and cancellation, keyboard focus after dismissal and preference retention across document reload. Inspected 320 px light, 390 px dark and 820 px light screenshots. Safari’s Share sheet, Home Screen installation, VoiceOver and physical layouts remain device checks.

## Sources and reproduction

The source is Android's 432px `ic_launcher_foreground.webp` from
`app/src/main/res/mipmap-xxxhdpi/` (Android revision `97827fb`,
SHA-256 `00524b39e0f50fe5a7fc18f4bfc20d9efd18fb49738133f0059de46646366533`).
The Android manifest uses `ic_launcher` and `ic_launcher_round`. Their adaptive
definitions use this foreground and `ic_launcher_background.xml`
(`#F1EAE3`). The foreground itself carries the warmer cream surround
(approximately RGB 246/231/216). The normal viewport is the central 72dp
of the 108dp layer. [Android adaptive icon geometry](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive)

The previous 192px asset decoded to the legacy Android launcher with baked
transparent corners and shadow. The previous 512px, maskable and Apple Touch
icons instead used the lighter notification seal (RGB about 251/240/229 at the
outer edge). The old generator quantized these variants to a 256-color palette.
The source shift explains the change in cream, ink, gold and ornament proportions.
Palette reduction further removed tonal detail. The Play Store image and
legacy round launchers were also compared. The side-by-side device screenshot
was unavailable in the workspace.

For tab icons only, run `node tools/generate-browser-icons.mjs --favicons-only`.
This preserves all existing installation assets byte-for-byte. Run the full
`node tools/generate-browser-icons.mjs` from the Web repository root with
the Android sibling available. The tool uses native Chrome canvas for decoding,
resampling and lossless PNG encoding. Set `CHROME_PATH` if Chrome is at a
different path. Results are
byte-stable for the same Chrome version and source. Recheck the output when
upgrading Chrome or changing Android's artwork.

| Public URL | Source / transform | Encoding |
| --- | --- | --- |
| `/favicon-16.png`, `/favicon-32.png` | Central 240px of adaptive foreground with a circular tab mask. Retains the R, both rings and gold ornaments. | Lossless PNG with transparent corners |
| `/favicon.ico` | The same two PNGs embedded as explicit 16/32 ICO frames | ICO fallback; no extra unused sizes |
| `/apple-touch-icon.png` | Central 288px of adaptive foreground at 180px. iOS applies its launcher shape. | Opaque lossless PNG |
| `/icons/icon-192.png`, `/icons/icon-512.png` | Central 288px of adaptive foreground, matching the Android visible viewport. | Opaque lossless PNG |
| `/icons/icon-maskable-512.png` | Central 294px of adaptive foreground. The extra six cream pixels slightly inset the artwork for the Web safe zone. | Opaque lossless PNG |

The full-color lossless files total about 724 kB. The Web seal used elsewhere
in the UI still comes from the Android notification asset.

## Metadata and safe zone

`index.html` links absolute root URLs, uses the title `Reals` and the product
description shared with the manifest. Theme-color media queries match the
existing light Ivory `#f7f2e8` and dark Ink `#08111f` tokens. The manifest uses
the light theme as its static theme/background fallback, `name`/`short_name`
`Reals`, and `id`, `start_url`, `scope` all `/`, with standalone display.
The two general icons declare `purpose: any`; the separate maskable icon
declares only `purpose: maskable`.

The [manifest safe zone](https://www.w3.org/TR/appmanifest/#icon-masks) is the
centered circle with radius 40% of the image width (204.8 px for 512). The
generated maskable's ink/gold artwork reaches about 203.5 px from center.
`node tools/check-browser-identity.mjs --url=http://127.0.0.1:5187 --android-reference`
checks decoded pixels, opacity, color detail, safe area, dimensions, ICO frames,
MIME types, manifest parsing and theme references. Chromium reported an empty
installability error list. The visual sheet in `artifacts/identity/` compares the
Android adaptive crop and app variants at the same size with circle and rounded
previews, plus 16/32px favicons on both themes. The full-size outputs preserve
the cream, navy and gold. Fine strokes soften at 180/192px and at favicon sizes.
Launcher masking, shadows, themed icons and scaling depend on the OS and browser.

The icon URLs carry `?v=2` for fresh browser/CDN fetches. The manifest URL
and app ID stay stable so an existing Android WebAPK can find its update.
Installed icon refresh remains browser-managed. Android Chrome can refresh the
WebAPK on its normal schedule. On iPhone an existing icon may require removing
and re-adding the app. Verify on devices with new and existing installs.
[Chrome manifest updates](https://web.dev/articles/manifest-updates),
[PWA update behavior by platform](https://web.dev/learn/pwa/update).

## Historical verification


### Current circle restoration (2026-11-16)

The user reported that the tab showed only R. The monogram crop explicitly
removed the ring. Restore the full circular Android seal: R, double ink/gold
ring, diamonds and ivory interior, with transparent corners. The ivory interior
provides contrast on dark tabs; at 16 px the R is smaller than the monogram.
No state, interaction, API, environment or installation assets changed.

Work branch `fix/favicon-circle`, base HEAD `e92ceeb`. No local or remote-tracking
`development` ref was available; branch created with `--no-track` from current
HEAD, retaining prior working-tree edits. Android manifest/adaptive launcher
references and the byte-identical notification seal were inspected read-only.

- `node tools/generate-browser-icons.mjs --favicons-only`: exit 0; PNGs 804/2180
  bytes, matching two-frame ICO 3022 bytes.
- `node tools/check-browser-identity.mjs --url=http://127.0.0.1:5187`:
  all assertions passed in Chromium. Regression asserts ink/gold ring pixels in
  all eight outer sectors (both sizes), centered bounds, transparent corners,
  ivory disc coverage, ICO frame equality, status/MIME and manifest metadata.
- `node tools/check-browser-identity.mjs --url=http://127.0.0.1:5188 --scale=2`:
  same assertions passed against the production build at high DPI.
- Actual-size 16/32 px light/dark canvas samples visually inspected in
  `artifacts/identity/review-1x.png`. Native browser tab chrome and physical
  devices remain unverified; canvas checks do not establish native-tab parity.
- `npm run build`: exit 0 (includes typecheck); existing >500 kB bundle advisory.

- `npm test -- --reporter=json --outputFile=artifacts/identity/favicon-circle-tests.json`:
  exit 1; 1650/1656 passed. Five 5000 ms timeouts and one missing-element failure
  in LoginScreen, Home.secondRestoration, CropDialog and Onboarding. These files
  are outside the favicon change; no test or timeout configuration was modified.
- `npm run test:focused -- src/auth/LoginScreen.test.tsx src/home/Home.secondRestoration.test.tsx src/onboarding/CropDialog.test.tsx src/onboarding/Onboarding.test.tsx --maxWorkers=1`:
  exit 0, 179/179 passed across those four files in isolation. This does not
  replace the failed full-suite result or establish its root cause.
- Both Chromium identity commands above completed with exit 0 and no captured
  browser diagnostics. `git diff --check`: exit 0. UTF-8/mojibake check of changed
  text: clean. Diff scope: three favicon binaries, generator, regression checker,
  this document and the existing parity matrix; prior unrelated edits retained.

Earlier verification below describes superseded favicon variants.

Historical monogram refinement (superseded by the circle restoration below):
the full circular seal made the R too small at tab sizes and retained a solid
ivory disc. Only the tab assets now use the source monogram, including its gold
accent. The generator removes near-paper pixels (RGB >215/205/190), composes a
fine ivory keyline following the glyph at 4x target resolution, and downsamples.
Alpha below 16/255 is cleared to remove almost invisible resampling fringes.
No new logo font, artwork or dependency is introduced.

- `node tools/generate-browser-icons.mjs --favicons-only`: exit 0. PNGs are
  668/1532 bytes; the matching two-frame ICO is 2238 bytes.
- `node tools/check-browser-identity.mjs --url=http://127.0.0.1:5174`: exit 0.
  The checks now also assert fully transparent corners, visible glyph coverage
  without a solid badge, and a centered mark within one pixel. Measured coverage
  is 42.19% / 37.01%; centers are (7.5,8) / (16,16).
- `npm run build`: exit 0 after final generation; existing bundle-size advisory
  remains. `node tools/check-browser-identity.mjs --url=http://127.0.0.1:5186 --scale=2`:
  exit 0 against that build, with no manifest/installability errors or captured
  browser diagnostics.
- Actual-size 16/32 px light/dark canvas samples were visually inspected. The
  initial stricter corner check caught faint alpha fringes; final assets pass
  with all four corners at alpha zero. PWA image files are byte-identical to
  HEAD; HTML and manifest are unchanged (allowing existing checkout line endings).
- Native browser-chrome screenshots, physical-device rendering and installation
  remain unverified. The earlier results below describe previous seal variants.

2026-11-16 tab-only refinement: favicon PNGs are 811/2193 bytes and ICO 3042.
`check-browser-identity.mjs --url=http://127.0.0.1:5174` passed dimensions,
transparent corners, opaque centers, identical ICO frames, metadata and manifest
checks. The actual-size canvas sheet was visually inspected on light and dark
backgrounds. Installation assets and HTML/manifest remain identical to HEAD.
Production preview check at `http://127.0.0.1:5186` with `--scale=2` also passed.
Native browser-chrome screenshots and physical-device installation remain
unverified. The results below describe the original generation.

- `node tools/generate-browser-icons.mjs`: PASS. Favicon
  756/2081 bytes, ICO 2875, Apple Touch 10145, launcher 25974, large app icon
  53243, maskable 44980.
- `node tools/check-browser-identity.mjs`: PASS against existing Vite development
  server `http://127.0.0.1:5175`.
- `node tools/check-browser-identity.mjs --url=http://127.0.0.1:5186`: PASS against
  `npm run preview -- --host 127.0.0.1 --port 5186` after the production build.
- Chrome runs with `--visible --scale=1` (development) and
  `--visible --scale=2 --url=http://127.0.0.1:5186` (production) passed the same
  response/decoding/manifest checks at the respective process scale factors.
  **Native tab screenshot inspection was blocked:** Computer Use could not
  determine the current browser URL confidently enough to enforce its policy.
  Thus actual browser-chrome tab rendering at normal/high DPI remains unverified;
  page canvas previews are not claimed as native-tab screenshots.
- Chrome's `Page.getAppManifest` reported no errors; its
  `Page.getInstallabilityErrors` returned an empty list. This is metadata
  validation, not an OS installation or Safari/iOS Add to Home Screen test.
- Typecheck, architecture and production build PASS. Existing JavaScript
  bundle-size advisory remains unrelated. `npm run test:focused -- tools/check-cycles.test.mjs`: PASS, 4 tests. `npm test -- --reporter=json --outputFile=artifacts/identity/full-tests.json`: PASS, 1649 tests / 68 files. `git diff --check`: PASS.

No Service Worker, offline cache, messaging, push registration, notification
permissions, install prompts or runtime dependencies were added. Offline use is
not provided. Installation behavior and available UI vary by browser/platform;
production still requires appropriate HTTPS hosting. Actual OS installation,
physical-device appearance and Apple Touch behavior on iOS remain untested.


Repository state: inspected/fetched HEAD before edits was `339318b`. The previous
uncommitted Second Chat work was preserved. During validation, HEAD changed
externally to `aaea0fe` (`second chat fixes`); no commit or push command was run
for this identity task. Its pending changes are only HTML, public assets,
development verification/generation tools and documentation.
