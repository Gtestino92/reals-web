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

Radii map dp numerically to CSS px (8/12/14/16); dp and CSS px are analogous logical units, not physical-pixel equivalence. The login uses the 48 dp minimum control height, 24 dp screen padding, 54 dp seal, 20 dp Google icon, 14 dp form gaps, gold divider and 0.72/0.52 focused/unfocused field surface alpha. Browser layout is centered up to a 400 px form width and scrolls naturally on smaller/shorter screens. Original PNGs are copied byte-for-byte from `drawable-nodpi/ic_notification_large.png` and `ic_google_g.png`; no background illustration is added because Android login does not render one. Source image payload is about 777 kB combined; image optimization is deferred to preserve the supplied originals.

## Stage A behavior and differences

Implemented sign-in/sign-up modes, exact Android Spanish labels/descriptions (including `Email` and `Password`), password masking, default-off remember preference, callbacks, all three pending states, mode-owned/shared/null-owner errors, reset feedback and rounded-up deadline cooldown. Email/password/preference survive mode changes. Recovery and its feedback are sign-in-only; Google is shown in both modes. The UI makes no requests and does not store credentials.

Inspected the login helper unit tests (`LoginScreenPasswordResetTest.kt`), instrumentation tests (`LoginScreenAuthModeTest.kt`), and autofill/session tests (`LoginAutofillCompletionTest.kt`, `SessionCoordinatorLoginAutofillTest.kt`) under Android's `app/src/test` and `app/src/androidTest`. Web tests cover presentation and callback equivalents; Firebase/session coordinator behavior is outside Stage A.

Browser Back retains normal navigation. The mode button and Escape from sign-up provide local return behavior. Semantic form labels, Enter submission, alert/status regions and focus indicators replace Compose semantics. Browser autofill uses username/current-password/new-password hints; the checkbox does not control the password manager or persist raw credentials.

Dynamic viewport height, safe-area padding and natural page scrolling handle constrained layouts. Coarse-pointer text-field focus hides only the decorative brand area and top-aligns the form; it is a layout hint, not reliable keyboard detection. The mode heading/description remain available, unlike Android's fully hidden keyboard header. System fonts, native checkbox/autofill styling, focus treatment and desktop width adaptation can differ visually. Chrome Android/Safari iOS verification remains required.

The [MVP debt document](../../reals-app/docs/technical-debt-frontend-mvp.md) defers social providers; this task explicitly includes Google's UI and callback only. Firebase web configuration, session persistence and bootstrap remain future integration decisions.

For later product work, preserve server-owned interaction lifecycle and refresh behavior; do not port Android coordinators wholesale. [Production debt](../../reals-app/docs/technical-debt-frontend-prod.md) remains a reference for resilience, privacy and timing gaps, not an implicit work list for this POC.

Large Android documentation, `.aiassistant` rules, mirrored shared contracts, Gradle/flavor/signing instructions and Android release-smoke history are intentionally not copied. Link those owners so the web documentation does not become a second stale source of truth.
