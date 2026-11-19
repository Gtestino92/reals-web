# Reals Web

React + TypeScript Web client for Reals with Firebase Authentication and a Spring Boot API.

Requires Node.js 24.15+ in the 24.x line and npm (lockfile committed for reproducibility).

```powershell
npm ci
npm run dev
```

Open <http://localhost:5173>. The local Vite server proxies `/api` to `http://localhost:8080` without rewriting the path. Copy `.env.example` to `.env.local` and configure the local Firebase Web app for authentication.

`npm run dev` first attempts an ADB reverse tunnel for port 5173 on every authorized Android device, then starts Vite even if ADB setup fails. This uses Node.js and works in IntelliJ IDEA's PowerShell or CMD terminal on Windows. On Android Chrome, open <http://127.0.0.1:5173/>: ADB reverse connects Android localhost to Windows localhost, with Vite still forwarding `/api` to the local backend on port 8080. No LAN exposure is required.

Wireless ADB needs an existing authorized connection. After disconnecting, reconnect manually with `adb connect <phone-ip>:<connection-port>` using the phone's current Wireless debugging connection address, check `adb devices`, then run `npm run android:tunnel` without restarting Vite. Inspect mappings with `adb reverse --list` (or `adb -s <serial> reverse --list` for multiple devices). See [Android local development](docs/local-development.md#android-chrome-over-usb-or-wireless-adb) for SDK discovery, authorization and reconnection details.

| Command | Purpose |
| --- | --- |
| `npm run android:tunnel` | Restore Android's port 5173 ADB reverse mapping without restarting Vite |
| `npm run typecheck` | Strict TypeScript checking, including tests and configuration |
| `npm test -- src/auth/LoginScreen.test.tsx src/App.test.tsx` | Focused login and entry point tests |
| `npm run test:watch` | Interactive Vitest runner |
| `npm run build` | Type-check, validate explicit Reals `dev` or `prod` settings and create `dist/` |
| `npm run preview` | Preview `dist/` locally using the settings compiled into the bundle |

Sibling repositories are references: [`../reals-app`](../reals-app) owns the Android implementation and [`../reals-backend`](../reals-backend) owns the Spring Boot API, PostgreSQL persistence and domain lifecycle. This task changes only `reals-web`.

See the [documentation index](docs/README.md), [local integration](docs/local-development.md), [deployment configuration](docs/deployment.md) and [effort log template](docs/poc-log.md). Coding-agent instructions live in [AGENTS.md](AGENTS.md).
