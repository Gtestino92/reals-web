import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function adbCandidates(env = process.env, platform = process.platform) {
  const executable = platform === 'win32' ? 'adb.exe' : 'adb';
  const candidates = [executable];
  for (const root of [env.ANDROID_SDK_ROOT, env.ANDROID_HOME]) {
    if (root?.trim()) candidates.push(join(root, 'platform-tools', executable));
  }
  if (platform === 'win32' && env.LOCALAPPDATA?.trim()) {
    candidates.push(join(env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', executable));
  }
  return [...new Set(candidates)];
}

export function parseDevices(stdout, warning) {
  const devices = new Set();
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim() || line.trim() === 'List of devices attached') continue;
    // Prefer ADB's tab separator to preserve spaces in mDNS/other serials.
    const match = line.match(/^(.+)\t(device|offline|unauthorized)\s*$/)
      ?? line.match(/^(.+?)\s+(device|offline|unauthorized)\s*$/);
    if (!match) warning('Skipped an unrecognized adb devices row. Inspect adb devices manually.');
    else if (match[2] === 'device') devices.add(match[1]);
    else warning(`Skipped an ${match[2]} device. Unlock/authorize it or reconnect wireless ADB.`);
  }
  return [...devices];
}

// Only this helper's children are bounded/killed; never stop the shared ADB server.
export function setupAndroidTunnel({
  run = spawnSync,
  env = process.env,
  platform = process.platform,
  now = Date.now,
  log = console.log,
  warn = console.warn,
} = {}) {
  const warning = (message) => warn(`[android:tunnel] ${message} Continuing without requiring a phone.`);
  const deadline = now() + 10_000;
  const invoke = (executable, args) => {
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error('Setup time limit reached');
    return run(executable, args, {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: Math.min(2_000, remaining),
      killSignal: 'SIGKILL',
      maxBuffer: 1024 * 1024,
    });
  };
  const succeeded = (result) => !result.error && result.status === 0;

  try {
    const adb = adbCandidates(env, platform).find((candidate) => succeeded(invoke(candidate, ['version'])));
    if (!adb) {
      warning('ADB unavailable. Install Android SDK platform-tools and check PATH, ANDROID_SDK_ROOT or ANDROID_HOME, then run npm run android:tunnel.');
      return;
    }

    const result = invoke(adb, ['devices']);
    if (!succeeded(result)) {
      warning('adb devices failed or timed out. Check adb devices in your terminal, then run npm run android:tunnel.');
      return;
    }

    const devices = parseDevices(result.stdout, warning);
    if (devices.length === 0) {
      warning('No authorized Android device connected. Check adb devices, connect/authorize USB or reconnect wireless ADB, then run npm run android:tunnel.');
      return;
    }

    for (const [index, serial] of [...new Set(devices)].entries()) {
      const reverse = invoke(adb, ['-s', serial, 'reverse', 'tcp:5173', 'tcp:5173']);
      if (succeeded(reverse)) {
        log(`[android:tunnel] Device ${index + 1}: tcp:5173 -> tcp:5173 configured. Open http://127.0.0.1:5173/ in Android Chrome once Vite is running.`);
      } else {
        warning(`Device ${index + 1}: reverse failed or timed out. Check adb devices and adb -s <serial> reverse --list, then run npm run android:tunnel.`);
      }
    }
  } catch {
    warning('Setup could not finish (process error or time limit). Check adb devices and rerun npm run android:tunnel.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  setupAndroidTunnel();
}
