# Initial architecture

Vite serves a client-rendered React application. TypeScript checks application, tests and Vite configuration in strict mode. Plain CSS supplies shared design tokens with semantic light/dark roles from Android.

| File | Responsibility |
| --- | --- |
| `index.html` | Spanish document metadata and root element |
| `src/main.tsx` | Validate the root, import styles, mount React in StrictMode |
| `src/App.tsx` | Minimal presentational POC entry point |
| `src/styles/tokens.css` | Palette, semantic roles, typography and shape tokens |
| `src/styles/global.css` | Base document and placeholder layout styles |
| `src/App.test.tsx`, `src/test/setup.ts` | Render smoke test, DOM matchers and cleanup |
| `vite.config.ts` | React transform, development proxy and Vitest environment |

There are no feature layers, router, API client, global store or persistence yet. Add feature components, hooks and small typed API adapters only when a feature needs them. Future HTTP integration should use relative `/api/...` URLs and explicitly handle HTTP errors, response validation, cancellation and stale results. Static TypeScript types alone cannot validate backend JSON.

The backend owns domain state and transitions. Future UI state contains presentation and in-flight work, not independent copies of backend lifecycle rules. Future effects must tolerate StrictMode's development cleanup/restart and avoid obsolete responses overwriting current state.

No Firebase SDK, session implementation, manifest, service worker, offline cache, install prompt or push integration is included. PWA behavior needs a separate decision about assets, updates and sensitive-data caching. No deployment infrastructure is created. Vite's proxy exists only during development; hosting must later route `/api` to the intended backend or provide an explicit API/CORS design.

Reference: [Android architecture](../../reals-app/docs/architecture.md). Its separation of presentation and orchestration is useful; its platform layers are not reproduced in this small React scaffold.
