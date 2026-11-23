# Android reference and parity plan

Inspected during scaffolding on 2026-11-03: Android revision `565e7d9`, backend revision `1bf015c`. Source links target the local sibling checkout and may evolve. Android is the canonical functional and visual product reference; backend contracts and domain state remain authoritative. Follow the mandatory migration requirements in [AGENTS.md](../AGENTS.md) and maintain the existing [parity matrix](android-parity-matrix.md).

## Source map

All UI paths below are relative to [`reals-app/app/src/main/java/com/reals/app/ui/`](../../reals-app/app/src/main/java/com/reals/app/ui/).

| Source | Use in this POC |
| --- | --- |
| `theme/RealsColors.kt` | Exact named palette values |
| `theme/Theme.kt` | Light/dark semantic color assignments and error palette |
| `theme/RealsTypography.kt` | Default Material 3 typography; normal-weight system serif identity and titles |
| `theme/RealsShapes.kt` | Extra-small 8, row/button 12, card 14, hero 16 dp radii |
| `common/RealsEditorialComponents.kt` | Flat paper cards, 1 dp outlines, gold dividers, minimum 48 dp buttons |
| `root/RealsApp.kt` | System-theme editorial background behind the application, including Login |
| `auth/LoginScreen.kt` | Future form, Spanish copy, busy/error states and responsive keyboard behavior |

Also inspected: [`AGENTS.md`](../../reals-app/AGENTS.md), all four files in [`.aiassistant/rules/`](../../reals-app/.aiassistant/rules/), [`README.md`](../../reals-app/README.md), and the Android docs index, architecture, local-development, testing and both frontend technical-debt documents. Relevant engineering guidance is adapted once in this repository's `AGENTS.md`.

## Visual mapping

`src/styles/tokens.css` retains all 12 named palette colors and every explicitly overridden color role in `Theme.kt`, including dark-mode gold/outline/error values. Principal light values:

| Android name | CSS value |
| --- | --- |
| Ivory | `#F7F2E8` |
| Paper | `#FCF8EF` |
| Sand | `#E9E1CF` |
| Ink | `#0F1F35` |
| InkSoft | `#31435A` |
| AntiqueGold | `#B28A3C` |
| SoftGold | `#D6C39A` |

Dark values are DarkInk `#08111F`, DarkSurface `#111C2C`, DarkSurfaceHigh `#18263A`, DarkText `#F4EDDF` and DarkTextMuted `#CFC3AF`. System dark preference selects the semantic dark roles, matching Android's default system-theme convention.

Android requests `FontFamily.Serif` at normal weight for Identity (`displayMedium`), ScreenTitle (`headlineLarge`) and SectionTitle (`titleLarge`). Web uses `ui-serif, serif` and a system sans-serif body without downloading a new branded font. The Material 3 role sizes/line heights map to 45/52, 32/40, 22/28 and bodyLarge 16/24, represented as rem at a 16 px browser default. These role metrics are the upstream Material defaults used by `Typography()`, not custom numeric constants declared by Reals. Exact glyph metrics differ across Android and browser system fonts and need visual review.

The inherited size/line-height values were verified against the [official Compose Material 3 typography table](https://developer.android.com/develop/ui/compose/designsystems/material3#typography).

Radii map dp numerically to CSS px (8/12/14/16). Each platform scales its own logical units. Login shares the 48-unit minimum button height, 54-unit seal, 20-unit Google icon, gold divider and 0.72/0.52 focused/unfocused field surface alpha. Android uses 24 dp screen padding and 14 dp form gaps. Web uses a centered form up to 400 px wide, 10 px form gaps and responsive padding and scrolling at narrow or short sizes. The in-app seal and Google mark PNGs come from `drawable-nodpi/ic_notification_large.png` and `ic_google_g.png`.

### Editorial background and asset provenance

At Android revision `97827fbb950c69bd58d4ab48f0c5aca280508b3b`, [`RealsApp.kt`](../../reals-app/app/src/main/java/com/reals/app/ui/root/RealsApp.kt) calls `realsEditorialBackground()` on the full-size root surface. It paints the system-theme drawable over `MaterialTheme.colorScheme.background` with centered `ContentScale.Crop`. This includes login, sign-up and password recovery. Opaque Android dialogs and editorial cards have their own surface colors.

| Android source under `app/src/main/res/drawable-nodpi/` | Original bytes | Web asset | Web bytes |
| --- | ---: | --- | ---: |
| `reals_background_editorial_light.png` | 1,550,332 | [Light WebP](../src/assets/reals-background-editorial-light.webp) | 102,930 |
| `reals_background_editorial_dark.png` | 1,713,622 | [Dark WebP](../src/assets/reals-background-editorial-dark.webp) | 123,746 |

Both WebPs were encoded from those PNGs with Pillow 13.0.0 (`quality=95, method=6`) at the original 841×1870 dimensions, with no edit to the composition or color palette. The encoding is lossy. Source and decoded versions were compared at mobile crop, and Vite emits both as separate, content-hashed files. CSS selects the active theme image.

[`global.css`](../src/styles/global.css) paints the image on a fixed, pointer-inert pseudo-element with centered `cover` and no repeat. The semantic HTML canvas provides the fallback and forced-colors mode suppresses the illustration. Safe-area padding and keyboard layout remain with the existing screens. Wide windows and landscape show a centered band of the portrait artwork due to the same cover rule. See the [visual parity audit](android-parity-matrix.md#editorial-visual-audit--2026-11-23) for source and browser evidence.

## Stage A behavior and differences

Implemented sign-in/sign-up modes, exact Android Spanish labels/descriptions (including `Email` and `Password`), password masking, default-off remember preference, callbacks, all three pending states, mode-owned/shared/null-owner errors, reset feedback and rounded-up deadline cooldown. Email/password/preference survive mode changes. Recovery and its feedback are sign-in-only; Google is shown in both modes. The UI makes no requests and does not store credentials.

Inspected the login helper unit tests (`LoginScreenPasswordResetTest.kt`), instrumentation tests (`LoginScreenAuthModeTest.kt`), and autofill/session tests (`LoginAutofillCompletionTest.kt`, `SessionCoordinatorLoginAutofillTest.kt`) under Android's `app/src/test` and `app/src/androidTest`. Web tests cover presentation and callback equivalents; Firebase/session coordinator behavior is outside Stage A.

Browser Back retains normal navigation. The mode button and Escape from sign-up provide local return behavior. Semantic form labels, Enter submission, alert/status regions and focus indicators replace Compose semantics. Browser autofill uses username/current-password/new-password hints; the checkbox does not control the password manager or persist raw credentials.

Dynamic viewport height, safe-area padding and natural page scrolling handle constrained layouts. Coarse-pointer text-field focus hides only the decorative brand area and top-aligns the form; it is a layout hint, not reliable keyboard detection. The mode heading/description remain available, unlike Android's fully hidden keyboard header. System fonts, native checkbox/autofill styling, focus treatment and desktop width adaptation can differ visually. Chrome Android/Safari iOS verification remains required.

The [MVP debt document](../../reals-app/docs/technical-debt-frontend-mvp.md) defers social providers; this task explicitly includes Google's UI and callback only. Firebase web configuration, session persistence and bootstrap remain future integration decisions.

For later product work, preserve server-owned interaction lifecycle and refresh behavior; do not port Android coordinators wholesale. [Production debt](../../reals-app/docs/technical-debt-frontend-prod.md) remains a reference for resilience, privacy and timing gaps, not an implicit work list for this POC.

Large Android documentation, `.aiassistant` rules, mirrored shared contracts, Gradle/flavor/signing instructions and Android release-smoke history are intentionally not copied. Link those owners so the web documentation does not become a second stale source of truth.
