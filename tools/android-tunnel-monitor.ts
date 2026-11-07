import { execFile } from 'node:child_process';
import type { Plugin } from 'vite';
import { adbCandidates, parseDevices } from './android-tunnel.mjs';

type Result = { ok: boolean; stdout: string };
type Run = (file: string, args: string[], signal: AbortSignal) => Promise<Result>;

// execFile owns only its short-lived client; never kill/restart the shared ADB server.
export const runAdb: Run = (file, args, signal) => new Promise((resolve) => {
  execFile(file, args, {
    encoding: 'utf8', shell: false, windowsHide: true,
    timeout: 2_000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, signal,
  }, (error, stdout) => resolve({ ok: !error, stdout }));
});

export function startAndroidTunnelMonitor({
  run = runAdb,
  candidates = adbCandidates(),
  intervalMs = 5_000,
  log = console.log,
  warn = console.warn,
}: {
  run?: Run;
  candidates?: string[];
  intervalMs?: number;
  log?: (message: string) => void;
  warn?: (message: string) => void;
} = {}) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previousIssues = new Set<string>();
  const stopped = () => controller.signal.aborted;
  const invoke = async (file: string, args: string[]) => {
    if (stopped()) return { ok: false, stdout: '' };
    return run(file, args, controller.signal);
  };

  async function poll() {
    const issues = new Set<string>();
    const issue = (message: string) => issues.add(message);
    try {
      // Rediscover on every cycle, so an unavailable executable can recover too.
      let adb: string | undefined;
      for (const candidate of candidates) {
        if ((await invoke(candidate, ['version'])).ok) {
          adb = candidate;
          break;
        }
      }
      if (!adb) issue('ADB unavailable. Check platform-tools and PATH/ANDROID_SDK_ROOT/ANDROID_HOME. Monitoring will retry.');
      else {
        const result = await invoke(adb, ['devices']);
        if (!result.ok) issue('adb devices failed or timed out. Check adb devices; monitoring will retry.');
        else {
          const devices = parseDevices(result.stdout, issue);
          for (const serial of devices) {
            if (stopped()) break;
            const mapping = await invoke(adb, ['-s', serial, 'reverse', '--list']);
            if (!mapping.ok) {
              issue('Cannot inspect reverse mappings. Check adb devices and reverse --list; monitoring will retry.');
              continue;
            }
            // The transport column may differ from the serial. Match both ports exactly.
            const correct = mapping.stdout.split(/\r?\n/).some((line) =>
              /^.+\s+tcp:5173\s+tcp:5173\s*$/.test(line.trim()));
            if (correct || stopped()) continue;
            const reverse = await invoke(adb, ['-s', serial, 'reverse', 'tcp:5173', 'tcp:5173']);
            if (stopped()) break;
            if (reverse.ok) log('[android:tunnel] tcp:5173 -> tcp:5173 configured. Open http://127.0.0.1:5173/ in Android Chrome.');
            else issue('Reverse failed or timed out. Check adb devices; monitoring will retry.');
          }
        }
      }
    } catch {
      issue('ADB check could not finish. Check adb devices; monitoring will retry.');
    } finally {
      if (!stopped()) {
        for (const message of issues) {
          if (!previousIssues.has(message)) warn(`[android:tunnel] ${message}`);
        }
        previousIssues = issues;
        // Schedule after completion: no overlapping checks or stale response installation.
        timer = setTimeout(() => { void poll(); }, intervalMs);
        timer.unref();
      }
    }
  }
  void poll();
  return () => {
    clearTimeout(timer);
    controller.abort();
  };
}

export function androidTunnelPlugin(start = startAndroidTunnelMonitor): Plugin {
  let stop: (() => void) | undefined;
  return {
    name: 'android-tunnel',
    apply: 'serve',
    configureServer(server) {
      stop?.();
      const stopMonitor = start();
      const cleanup = () => {
        server.httpServer?.off('close', cleanup);
        stopMonitor();
      };
      stop = cleanup;
      server.httpServer?.once('close', cleanup);
    },
    closeBundle() {
      stop?.();
      stop = undefined;
    },
  };
}
