# Testing

Vitest runs in jsdom with React Testing Library and jest-dom matchers. Tests live beside the component or helper they exercise. Shared setup performs explicit cleanup after each test. Stage A has 22 tests across login behavior and the app's explicit unavailable-integration responses.

```powershell
npm run typecheck
npm test -- src/auth/LoginScreen.test.tsx src/App.test.tsx
npm run build
```

Use `npm run test:watch -- src/auth/LoginScreen.test.tsx` while editing. The build includes another type-check so standalone builds cannot skip it. Login tests cover mode switching, argument forwarding, remember default/toggle, masking/autofill hints, recovery/Google callbacks, all busy states in both modes, owner-scoped errors, reset feedback, cooldown rounding/expiry/replacement, background resume, and StrictMode timer cleanup. No credentials or backend connection are required.

Future tests should focus on user-observable behavior, error mapping, response validation and async cancellation/stale-response races. Cover alternate mutation paths and regressions when introduced. No backend connection, credentials, Firebase SDK or new end-to-end framework is required by current tests.

## Stage A manual device checklist (not yet executed)

Run `npm run dev` through the team's device-accessible development setup. On Chrome Android and Safari iOS:

- Compare both modes against Android at narrow portrait and landscape widths in light/dark themes; confirm original seal/icon, Spanish copy, spacing, field outlines and focus/disabled contrast.
- Open/dismiss the virtual keyboard for each field, switch between fields, rotate, expand/collapse browser chrome and verify scrolling reaches every action without clipping, horizontal overflow or a trapped focus. Check safe areas on a notched iPhone.
- Verify email keyboard, password masking, password-manager fill/save behavior, new-password suggestions in sign-up, and that the remember preference does not promise browser storage control.
- Check external-keyboard Tab/Shift+Tab/Enter/Escape, visible focus, 200% zoom/text scaling and TalkBack/VoiceOver labels, headings, busy state and error/feedback announcements. Ensure countdown changes do not create repetitive live announcements.
- With externally supplied pending/feedback/deadline props, verify all actions lock, feedback ownership and cooldown recovery after background/resume. The standalone app intentionally only reports unavailable integrations; it never simulates success or reset delivery.

No browser/device visual result is claimed from jsdom. A headless Chrome preview attempt was rejected by the environment execution policy. HTTP/backend checks are outside Stage A; no actual API requests are made. Future backend connectivity instructions remain in [local development](local-development.md).

The [Android testing guide](../../reals-app/docs/testing.md) informs behavior priorities. Android build tasks, emulator tests and release APK checks are platform-specific and are not copied.
