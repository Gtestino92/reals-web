# Testing

Vitest runs in jsdom with React Testing Library and jest-dom matchers. Tests live beside the component or helper they exercise. Shared setup performs explicit cleanup after each test. The initial render smoke test verifies the main landmark, Reals heading and UTF-8 Spanish placeholder; it also verifies the testing toolchain is usable.

```powershell
npm run typecheck
npm test -- src/App.test.tsx
npm run build
```

Use `npm run test:watch -- src/App.test.tsx` while editing. `npm test` runs all tests; there is currently one. The build includes another type-check so standalone builds cannot skip it.

Future tests should focus on user-observable behavior, error mapping, response validation and async cancellation/stale-response races. Cover alternate mutation paths and regressions when introduced. No backend connection, credentials, Firebase SDK or new end-to-end framework is required by current tests.

Manual smoke: run `npm run dev`, open the page at narrow and desktop widths, confirm Spanish accents, readable serif identity/body text, and system light/dark colors. When the existing backend is available, compare direct and proxied `/api/ping` using [local development](local-development.md). HTTP checks establish serving/proxy connectivity; jsdom does not establish browser layout, font metrics, color contrast or Android screenshot fidelity. Record actual results and remaining visual review in the [POC log](poc-log.md).

The [Android testing guide](../../reals-app/docs/testing.md) informs behavior priorities. Android build tasks, emulator tests and release APK checks are platform-specific and are not copied.
