# Reals Web

React + TypeScript POC for a future Reals Progressive Web App. Stage A implements the Android-referenced login interface with sign-in/sign-up modes, recovery, Google action, pending states and errors. Authentication actions currently report that integration is unavailable; Firebase Authentication and PWA install/offline behavior are not implemented.

Requires Node.js 24.15+ in the 24.x line and npm (lockfile committed for reproducibility).

```powershell
npm ci
npm run dev
```

Open <http://localhost:5173>. The development server proxies `/api` to `http://localhost:8080` without rewriting the path. The entry point makes no API calls and works without a running backend.

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Strict TypeScript checking, including tests and configuration |
| `npm test -- src/auth/LoginScreen.test.tsx src/App.test.tsx` | Focused login and entry point tests |
| `npm run test:watch` | Interactive Vitest runner |
| `npm run build` | Type-check and create `dist/` |
| `npm run preview` | Preview the production bundle locally (no API proxy) |

Sibling repositories are references: [`../reals-app`](../reals-app) owns the Android implementation and [`../reals-backend`](../reals-backend) owns the Spring Boot API, PostgreSQL persistence and domain lifecycle. This task changes only `reals-web`.

See the [documentation index](docs/README.md), [local integration](docs/local-development.md) and [effort log template](docs/poc-log.md). Coding-agent instructions live in [AGENTS.md](AGENTS.md).
