# Initial architecture

Vite serves a client-rendered React application. TypeScript checks application, tests and Vite configuration in strict mode. Plain CSS supplies shared design tokens with semantic light/dark roles from Android.

| File | Responsibility |
| --- | --- |
| `index.html` | Spanish document metadata and root element |
| `src/main.tsx` | Validate the root, import styles, mount React in StrictMode |
| `src/App.tsx` | Mount login with explicit unavailable-integration errors |
| `src/auth/LoginScreen.tsx`, `src/auth/login.css` | Login presentation, in-memory form/mode and deadline-based cooldown |
| `src/assets/` | Unmodified Android brand seal and Google icon |
| `src/styles/tokens.css` | Palette, semantic roles, typography and shape tokens |
| `src/styles/global.css` | Base document and placeholder layout styles |
| `src/auth/LoginScreen.test.tsx`, `src/App.test.tsx`, `src/test/setup.ts` | Login behavior, entry point, DOM matchers and cleanup |
| `vite.config.ts` | React transform, development proxy and Vitest environment |

`LoginScreenProps` exposes synchronous action callbacks and externally controlled loading, Google/reset loading, error owner, reset feedback and absolute reset deadline. A future adapter owns asynchronous execution and failure mapping and must set pending state when starting work. No Promise is launched or ignored by the UI. The current app only produces explicit unavailable messages; it does not create sessions or pretend to send email. Form values live in component memory and the remember checkbox only passes a preference to the callback. Browser password managers control their own save/autofill prompts; there is no Android autofill commit/cancel API equivalent here.

There is no router, API client, global store or persistence. Future HTTP integration should use relative `/api/...` URLs and explicitly handle HTTP errors, response validation, cancellation and stale results. Static TypeScript types alone cannot validate backend JSON.

## Login state and mutation review

| State / invariant | Mutation paths | Verification |
| --- | --- | --- |
| Form values remain in memory and survive mode switches | Email/password change, checkbox change; unmount discards component state | Exact callback arguments; both remember values; mode round trip |
| Busy is the union of all three pending props | Parent prop replacement | Both modes block all controls and form submit; Escape blocked; release restores actions |
| Mode starts sign-in; changes never submit | Switch button or Escape from sign-up, guarded by busy | Round trip, Escape, busy tests; browser history untouched |
| Error and owner are one conceptual value | App replaces one failure object; parent props supply presentation | Sign-in/sign-up/shared/null ownership; error removal; text-only rendering |
| Reset feedback only appears in sign-in | Parent props + mode change | Visibility round trip; app never fabricates delivery |
| Reset availability derives from absolute deadline, not accumulated ticks | Parent deadline change, timer render, window focus, document visibility | Rounding, expiry, deadline replacement, null/invalid values, resume; StrictMode/unmount cleanup |

Cooldown timers schedule at most once per second and stop at expiry; listener/timer cleanup runs when the deadline changes or the component unmounts. No request results, backend state or resource ownership are introduced in Stage A.

The backend owns domain state and transitions. Future UI state contains presentation and in-flight work, not independent copies of backend lifecycle rules. Future effects must tolerate StrictMode's development cleanup/restart and avoid obsolete responses overwriting current state.

No Firebase SDK, session implementation, manifest, service worker, offline cache, install prompt or push integration is included. PWA behavior needs a separate decision about assets, updates and sensitive-data caching. No deployment infrastructure is created. Vite's proxy exists only during development; hosting must later route `/api` to the intended backend or provide an explicit API/CORS design.

Reference: [Android architecture](../../reals-app/docs/architecture.md). Its separation of presentation and orchestration is useful; its platform layers are not reproduced in this small React scaffold.
