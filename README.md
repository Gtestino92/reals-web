# Reals Web

React + TypeScript POC for a future Reals Progressive Web App. Stage A implements the Android-referenced login interface with sign-in/sign-up modes, recovery, Google action, pending states and errors. Authentication actions currently report that integration is unavailable; Firebase Authentication and PWA install/offline behavior are not implemented.

Requires Node.js 24.15+ in the 24.x line and npm (lockfile committed for reproducibility).

```powershell
npm ci
npm run dev
```

Open <http://localhost:5173>. The development server proxies `/api` to `http://localhost:8080` without rewriting the path. The entry point makes no API calls and works without a running backend.

`npm run dev` first attempts an ADB reverse tunnel for port 5173 on every authorized Android device, then starts Vite even if ADB setup fails. This uses Node.js and works in IntelliJ IDEA's PowerShell or CMD terminal on Windows. On Android Chrome, open <http://127.0.0.1:5173/>: ADB reverse connects Android localhost to Windows localhost, with Vite still forwarding `/api` to the local backend on port 8080. No LAN exposure is required.

Wireless ADB needs an existing authorized connection. After disconnecting, reconnect manually with `adb connect <phone-ip>:<connection-port>` using the phone's current Wireless debugging connection address, check `adb devices`, then run `npm run android:tunnel` without restarting Vite. Inspect mappings with `adb reverse --list` (or `adb -s <serial> reverse --list` for multiple devices). See [Android local development](docs/local-development.md#android-chrome-over-usb-or-wireless-adb) for SDK discovery, authorization and reconnection details.

| Command | Purpose |
| --- | --- |
| `npm run android:tunnel` | Restore Android's port 5173 ADB reverse mapping without restarting Vite |
| `npm run typecheck` | Strict TypeScript checking, including tests and configuration |
| `npm test -- src/auth/LoginScreen.test.tsx src/App.test.tsx` | Focused login and entry point tests |
| `npm run test:watch` | Interactive Vitest runner |
| `npm run build` | Type-check and create `dist/` |
| `npm run preview` | Preview the production bundle locally (no API proxy) |

Sibling repositories are references: [`../reals-app`](../reals-app) owns the Android implementation and [`../reals-backend`](../reals-backend) owns the Spring Boot API, PostgreSQL persistence and domain lifecycle. This task changes only `reals-web`.

See the [documentation index](docs/README.md), [local integration](docs/local-development.md) and [effort log template](docs/poc-log.md). Coding-agent instructions live in [AGENTS.md](AGENTS.md).
