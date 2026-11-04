# Android reference and parity plan

Inspected during scaffolding on 2026-11-03: Android revision `565e7d9`, backend revision `1bf015c`. Source links target the local sibling checkout and may evolve. Android behavior is a reference; backend contracts remain authoritative.

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

Radii map dp numerically to CSS px (8/12/14/16); dp and CSS px are analogous logical units, not physical-pixel equivalence. The 48 dp minimum control height and 24 dp login screen padding become corresponding CSS tokens. Editorial surfaces use zero elevation; focused/unfocused fields use surface alpha 0.72/0.52 and gold decorations use opacity, to be applied when components are built. No decorative components, seal assets or login layout are implemented now.

## Planned behavioral parity

The next login task should explicitly scope sign-in/sign-up modes, exact Spanish labels, password masking/autofill, default-off remember preference, mutual exclusion while auth/reset work is pending, mode-owned errors, and password-reset deadline/cooldown behavior. Adapt keyboard visibility, scrolling and Back behavior to browser accessibility and navigation rather than translating Compose lifecycle code.

Android's login source exposes Google UI, while the [MVP debt document](../../reals-app/docs/technical-debt-frontend-mvp.md) defers social providers. Resolve that scope explicitly before adding a provider. A remember preference does not authorize storing raw credentials. Firebase web configuration, session persistence and bootstrap are future integration decisions.

For later product work, preserve server-owned interaction lifecycle and refresh behavior; do not port Android coordinators wholesale. [Production debt](../../reals-app/docs/technical-debt-frontend-prod.md) remains a reference for resilience, privacy and timing gaps, not an implicit work list for this POC.

Large Android documentation, `.aiassistant` rules, mirrored shared contracts, Gradle/flavor/signing instructions and Android release-smoke history are intentionally not copied. Link those owners so the web documentation does not become a second stale source of truth.
