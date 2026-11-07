// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({ execFile: vi.fn() }));
import { execFile } from 'node:child_process';
import { androidTunnelPlugin, runAdb, startAndroidTunnelMonitor } from './android-tunnel-monitor.ts';

const ok = (stdout = '') => ({ ok: true, stdout });
const fail = { ok: false, stdout: '' };
let stop;

function harness() {
  const state = { devices: '', mappings: new Map(), unavailable: false, listFailure: false, reverseFailure: false };
  const run = vi.fn(async (_file, args) => {
    if (state.unavailable) return fail;
    if (args[0] === 'devices') return ok(state.devices);
    if (args[0] === 'version') return ok();
    if (args.at(-1) === '--list') return state.listFailure ? fail : ok(state.mappings.get(args[1]) ?? '');
    if (state.reverseFailure) return fail;
    state.mappings.set(args[1], '(reverse) tcp:5173 tcp:5173\n');
    return ok();
  });
  const log = vi.fn();
  const warn = vi.fn();
  stop = startAndroidTunnelMonitor({ run, candidates: ['adb'], log, warn });
  return { state, run, log, warn, reverses: () => run.mock.calls.filter(([, args]) => args.at(-1) === 'tcp:5173') };
}
const tick = () => vi.advanceTimersByTimeAsync(5_000);

beforeEach(() => vi.useFakeTimers());
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); vi.clearAllMocks(); });

describe('Android tunnel monitor', () => {
  it('connects after startup, skips correct tunnels and restores after same-serial reconnect', async () => {
    const h = harness();
    await tick();
    expect(h.reverses()).toHaveLength(0);
    h.state.devices = 'phone\tdevice\n';
    await tick();
    expect(h.reverses()).toHaveLength(1);
    await tick();
    expect(h.reverses()).toHaveLength(1);
    h.state.devices = '';
    h.state.mappings.clear();
    await tick();
    expect(h.reverses()).toHaveLength(1);
    h.state.devices = 'phone\tdevice\n';
    await tick();
    expect(h.reverses()).toHaveLength(2);
    expect(h.log).toHaveBeenCalledTimes(2);
  });

  it('restores a lost or incorrect mapping even without observing a disconnect', async () => {
    const h = harness();
    h.state.devices = 'phone\tdevice\n';
    await tick();
    h.state.mappings.set('phone', 'transport tcp:5173 tcp:9999\ntransport tcp:9000 tcp:9000\n');
    await tick();
    expect(h.reverses()).toHaveLength(2);
    expect(h.reverses().every(([, args]) => args.join(' ') === '-s phone reverse tcp:5173 tcp:5173')).toBe(true);
  });

  it('handles multiple devices, duplicate serials, unauthorized, offline and malformed rows quietly', async () => {
    const h = harness();
    h.state.devices = 'first\tdevice\nfirst\tdevice\nphone with spaces\tdevice\nlocked\tunauthorized\ngone\toffline\ninvalid\n';
    h.state.mappings.set('phone with spaces', 'phone with spaces tcp:5173 tcp:5173\n');
    await tick();
    expect(h.reverses()).toHaveLength(1);
    expect(h.reverses()[0][1][1]).toBe('first');
    expect(h.warn).toHaveBeenCalledTimes(3);
    await tick();
    expect(h.warn).toHaveBeenCalledTimes(3);
    expect(h.log).toHaveBeenCalledTimes(1);
  });

  it('recovers from unavailable ADB and logs persistent failures only once', async () => {
    const h = harness();
    await tick();
    h.state.unavailable = true;
    await tick();
    await tick();
    expect(h.warn).toHaveBeenCalledTimes(1);
    h.state.unavailable = false;
    h.state.devices = 'phone\tdevice\n';
    await tick();
    expect(h.reverses()).toHaveLength(1);
  });

  it('requires a successful mapping inspection and retries failed reverse on the next cycle', async () => {
    const h = harness();
    h.state.devices = 'phone\tdevice\n';
    h.state.listFailure = true;
    await tick();
    expect(h.reverses()).toHaveLength(0);
    h.state.listFailure = false;
    h.state.reverseFailure = true;
    await tick();
    expect(h.log).not.toHaveBeenCalled();
    h.state.reverseFailure = false;
    await tick();
    expect(h.log).toHaveBeenCalledTimes(1);
    expect(h.warn).toHaveBeenCalledTimes(2);
  });

  it('does not overlap polls and discards a late response after shutdown', async () => {
    let finish;
    let signal;
    const run = vi.fn((_file, _args, abortSignal) => {
      signal = abortSignal;
      return new Promise((resolve) => { finish = resolve; });
    });
    const log = vi.fn();
    const warn = vi.fn();
    stop = startAndroidTunnelMonitor({ run, candidates: ['adb'], log, warn });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(run).toHaveBeenCalledTimes(1);
    stop();
    expect(signal.aborted).toBe(true);
    finish(ok());
    await vi.advanceTimersByTimeAsync(20_000);
    expect(run).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the scheduled timer on repeated shutdown', async () => {
    const h = harness();
    await tick();
    stop();
    stop();
    const calls = h.run.mock.calls.length;
    await tick();
    expect(h.run).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('discards a reverse success arriving after shutdown', async () => {
    let finish;
    const log = vi.fn();
    const warn = vi.fn();
    const run = vi.fn(async (_file, args) => {
      if (args[0] === 'version') return ok();
      if (args[0] === 'devices') return ok('phone\tdevice\n');
      if (args.at(-1) === '--list') return ok();
      return new Promise((resolve) => { finish = resolve; });
    });
    stop = startAndroidTunnelMonitor({ run, candidates: ['adb'], log, warn });
    await vi.advanceTimersByTimeAsync(0);
    expect(finish).toBeTypeOf('function');
    stop();
    finish(ok());
    await tick();
    expect(run).toHaveBeenCalledTimes(4);
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rediscovers SDK ADB, recovers failed enumeration and continues after a device fails', async () => {
    let enumerationFails = true;
    const log = vi.fn();
    const warn = vi.fn();
    const run = vi.fn(async (file, args) => {
      if (file === 'adb') return fail;
      if (args[0] === 'version') return ok();
      if (args[0] === 'devices') return enumerationFails ? fail : ok('first\tdevice\nsecond\tdevice\n');
      if (args.at(-1) === '--list') return ok();
      return args[1] === 'first' ? fail : ok();
    });
    stop = startAndroidTunnelMonitor({ run, candidates: ['adb', 'sdk/adb'], log, warn });
    await vi.advanceTimersByTimeAsync(0);
    expect(run.mock.calls.map(([, args]) => args[0])).toEqual(['version', 'version', 'devices']);
    enumerationFails = false;
    await tick();
    expect(log).toHaveBeenCalledTimes(1);
    expect(run.mock.calls.filter(([, args]) => args.at(-1) === 'tcp:5173').map(([, args]) => args[1]))
      .toEqual(['first', 'second']);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('contains unexpected subprocess errors and retries later', async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error('private details')).mockResolvedValue(ok());
    const warn = vi.fn();
    stop = startAndroidTunnelMonitor({ run, candidates: ['adb'], warn });
    await tick();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.flat().join()).not.toContain('private details');
    expect(run.mock.calls.length).toBeGreaterThan(1);
  });
});

it('uses bounded asynchronous execFile with literal arguments and the owned abort signal', async () => {
  execFile.mockImplementation((_file, _args, _options, callback) => callback(null, 'output'));
  const controller = new AbortController();
  const args = ['-s', 'phone & $(private)', 'reverse', '--list'];
  await expect(runAdb('adb', args, controller.signal)).resolves.toEqual(ok('output'));
  expect(execFile).toHaveBeenCalledWith('adb', args, expect.objectContaining({
    shell: false, windowsHide: true, timeout: 2000, killSignal: 'SIGKILL', signal: controller.signal,
  }), expect.any(Function));
  execFile.mockImplementation((_file, _args, _options, callback) => callback(new Error('failed'), ''));
  await expect(runAdb('adb', args, controller.signal)).resolves.toEqual(fail);
});

it('owns monitoring through Vite development server close, restart and closeBundle', () => {
  const stops = [vi.fn(), vi.fn()];
  const start = vi.fn().mockReturnValueOnce(stops[0]).mockReturnValueOnce(stops[1]);
  const plugin = androidTunnelPlugin(start);
  expect(plugin.apply).toBe('serve');
  const httpServer = new EventEmitter();
  plugin.configureServer({ httpServer });
  expect(start).toHaveBeenCalledTimes(1);
  httpServer.emit('close');
  expect(stops[0]).toHaveBeenCalled();
  expect(httpServer.listenerCount('close')).toBe(0);
  plugin.configureServer({ httpServer });
  plugin.closeBundle();
  expect(stops[1]).toHaveBeenCalled();
  expect(httpServer.listenerCount('close')).toBe(0);
});
