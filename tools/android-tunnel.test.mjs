// @vitest-environment node
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { setupAndroidTunnel } from './android-tunnel.mjs';

const ok = (stdout = '') => ({ status: 0, stdout });
const missing = () => ({ status: null, error: { code: 'ENOENT' } });

function harness({ output = 'List of devices attached\n', run, ...options } = {}) {
  const log = vi.fn();
  const warn = vi.fn();
  const subprocess = vi.fn(run ?? ((_file, args) => ok(args[0] === 'devices' ? output : '')));
  setupAndroidTunnel({ run: subprocess, env: {}, platform: 'win32', log, warn, ...options });
  return { subprocess, log, warn };
}

describe('Android tunnel', () => {
  const env = { ANDROID_SDK_ROOT: 'sdk root', ANDROID_HOME: 'sdk home', LOCALAPPDATA: 'local app data' };
  const candidates = [
    'adb.exe',
    join(env.ANDROID_SDK_ROOT, 'platform-tools', 'adb.exe'),
    join(env.ANDROID_HOME, 'platform-tools', 'adb.exe'),
    join(env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
  ];

  it.each(candidates)('discovers %s in the required precedence', (available) => {
    const { subprocess } = harness({ env, run: (file, args) => file === available
      ? ok(args[0] === 'devices' ? 'List of devices attached\n' : '') : missing() });
    expect(subprocess.mock.calls.filter(([, args]) => args[0] === 'version').map(([file]) => file))
      .toEqual(candidates.slice(0, candidates.indexOf(available) + 1));
    expect(subprocess).toHaveBeenLastCalledWith(available, ['devices'], expect.any(Object));
  });

  it.each(['linux', 'darwin'])('uses native adb and SDK paths on %s without PowerShell', (platform) => {
    const { subprocess } = harness({ platform, env, run: (file) => file === 'adb' ? missing() : ok() });
    expect(subprocess.mock.calls[0][0]).toBe('adb');
    expect(subprocess.mock.calls[1][0]).toBe(join(env.ANDROID_SDK_ROOT, 'platform-tools', 'adb'));
  });

  it('warns and returns normally when ADB is missing', () => {
    const { log, warn, subprocess } = harness({ env, run: missing });
    expect(subprocess).toHaveBeenCalledTimes(4);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ADB unavailable'));
    expect(log).not.toHaveBeenCalled();
  });

  it('warns without reversing when no devices are attached', () => {
    const { subprocess, log, warn } = harness();
    expect(subprocess).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('No authorized Android device'));
    expect(log).not.toHaveBeenCalled();
  });

  it('skips unauthorized, offline and malformed rows without claiming success', () => {
    const { subprocess, log, warn } = harness({ output: 'List of devices attached\r\nusb\tunauthorized\r\nphone\toffline\r\nunknown row\r\n' });
    expect(subprocess).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unauthorized'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('offline'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unrecognized'));
    expect(log).not.toHaveBeenCalled();
  });

  it('reverses only 5173 for every authorized USB, IP and mDNS serial with literal arguments', () => {
    const serials = ['usb-123', '192.168.1.2:41235', 'adb-phone (2)._adb-tls-connect._tcp', 'phone & "quoted" %PATH% $(echo hi)'];
    const output = `List of devices attached\n${serials.map((s) => `${s}\tdevice`).join('\n')}\n`;
    const { subprocess, log, warn } = harness({ output });
    expect(subprocess.mock.calls.slice(2).map(([, args]) => args))
      .toEqual(serials.map((s) => ['-s', s, 'reverse', 'tcp:5173', 'tcp:5173']));
    for (const [, , options] of subprocess.mock.calls) {
      expect(options).toEqual(expect.objectContaining({ shell: false, windowsHide: true, timeout: 2000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 }));
    }
    expect(log).toHaveBeenCalledTimes(4);
    expect(warn).not.toHaveBeenCalled();
  });

  it('accepts space-separated device rows without truncating wireless serials', () => {
    const { subprocess } = harness({ output: 'adb-phone (2)._adb-tls-connect._tcp device\n' });
    expect(subprocess.mock.calls[2][1][1]).toBe('adb-phone (2)._adb-tls-connect._tcp');
  });

  it('deduplicates repeated serials', () => {
    const { subprocess } = harness({ output: 'usb\tdevice\nusb\tdevice\n' });
    expect(subprocess).toHaveBeenCalledTimes(3);
  });

  it.each([
    { status: 1, stderr: 'private diagnostic data' },
    { status: null, error: { code: 'ETIMEDOUT' } },
  ])('handles failed device enumeration without logging raw output: %j', (failure) => {
    const { subprocess, log, warn } = harness({ run: (_file, args) => args[0] === 'devices' ? failure : ok() });
    expect(subprocess).toHaveBeenCalledTimes(2);
    expect(log).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('adb devices failed or timed out'));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('private diagnostic data');
  });

  it.each([{ status: 1 }, { status: null, error: { code: 'ETIMEDOUT' } }])('continues to other devices after reverse failure: %j', (failure) => {
    const { subprocess, log, warn } = harness({ run: (_file, args) => {
      if (args[0] === 'devices') return ok('first\tdevice\nsecond\tdevice\n');
      return args[1] === 'first' ? failure : ok();
    } });
    expect(subprocess).toHaveBeenCalledTimes(4);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Device 2:'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Device 1: reverse failed or timed out'));
  });

  it('contains unexpected subprocess exceptions', () => {
    const { warn, log } = harness({ run: () => { throw new Error('sensitive subprocess details'); } });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Setup could not finish'));
    expect(log).not.toHaveBeenCalled();
  });

  it('bounds total setup time as well as each subprocess', () => {
    const times = [0, 0, 9_500, 10_001];
    const { subprocess, warn, log } = harness({ output: 'usb\tdevice\n', now: () => times.shift() ?? 10_001 });
    expect(subprocess.mock.calls.map(([, , options]) => options.timeout)).toEqual([2000, 500]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('time limit'));
    expect(log).not.toHaveBeenCalled();
  });
});
