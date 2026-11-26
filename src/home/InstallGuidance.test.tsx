import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InstallGuidance } from './InstallGuidance';

const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const ipad = iphone.replace('iPhone; CPU iPhone OS', 'iPad; CPU OS');
const desktopSafari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const key = 'reals:ios-install-guidance:v1';

function browser(userAgent = iphone, maxTouchPoints = 0, standalone = false, displayMode = false, platform = 'MacIntel') {
  vi.stubGlobal('navigator', { userAgent, platform, maxTouchPoints, standalone, vendor: 'Apple Computer, Inc.' });
  vi.stubGlobal('matchMedia', vi.fn(query => ({ matches: query === '(display-mode: standalone)' && displayMode })));
}

beforeEach(() => { localStorage.removeItem(key); browser(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each([
  ['iPhone Safari', iphone, 5, true],
  ['iPad Safari', ipad, 5, true],
  ['iPad with desktop UA', desktopSafari, 5, true],
  ['desktop Safari', desktopSafari, 0, false],
  ['iOS Chrome', iphone.replace(' Mobile/', ' CriOS/140.0 Mobile/'), 5, false],
  ['iOS Firefox', iphone.replace(' Mobile/', ' FxiOS/140.0 Mobile/'), 5, false],
  ['iOS Edge', iphone.replace(' Mobile/', ' EdgiOS/140.0 Mobile/'), 5, false],
  ['embedded WebView', iphone.replace('Version/26.0 ', '').replace(' Safari/604.1', ''), 5, false],
  ['Android Chrome', desktopSafari.replace('Macintosh; Intel Mac OS X 10_15_7', 'Linux; Android 16').replace('Version/26.0', 'Chrome/140.0'), 5, false],
] as const)('offers instructions for %s (%s)', (_label, ua, touch, eligible) => {
  browser(ua, touch);
  render(<InstallGuidance onDismiss={vi.fn()} />);
  expect(!!screen.queryByRole('region', { name: 'Instalá Reals' })).toBe(eligible);
});

it.each([[true, false], [false, true]])('excludes standalone via navigator=%s or display mode=%s', (legacy, display) => {
  browser(iphone, 5, legacy, display);
  render(<InstallGuidance onDismiss={vi.fn()} />);
  expect(screen.queryByRole('region')).toBeNull();
});

it.each(['Ya la instalé', 'Ahora no'])('persists %s across remount via browser storage', label => {
  const dismiss = vi.fn();
  const view = render(<InstallGuidance onDismiss={dismiss} />);
  fireEvent.click(screen.getByRole('button', { name: label }));
  expect(screen.queryByRole('region')).toBeNull();
  expect(dismiss).toHaveBeenCalledOnce();
  expect(localStorage.getItem(key)).toBe('dismissed');
  view.unmount();
  render(<InstallGuidance onDismiss={dismiss} />);
  expect(screen.queryByRole('region')).toBeNull();
});

it('keeps a document dismissal when obtaining browser storage throws', () => {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => { throw new DOMException('Unavailable', 'SecurityError'); });
  const view = render(<InstallGuidance onDismiss={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Ahora no' }));
  view.unmount();
  render(<InstallGuidance onDismiss={vi.fn()} />);
  expect(screen.queryByRole('region')).toBeNull();
});
