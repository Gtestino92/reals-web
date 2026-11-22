import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useRef } from 'react';
import { controllerFixture } from '../chat/fixtures';
import { homeSecondFixture } from '../home/secondHome.fixtures';
import { SecondChatCard } from '../home/SecondChatCard';
import { savePreferences, loadPreferences } from './activityStorage';
import { activityId } from './activityPolicy';
import { ActivityNotifications, useActivityNotifications } from './useActivityNotifications';
import { usePresentedActivity } from './usePresentedActivity';
import { useTabIndicators } from './tabIndicators';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); localStorage.clear(); });

it('acknowledges a loaded visible surface only after it is presented, including after a hidden load', () => {
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  const controller = controllerFixture(), id = activityId('VISUAL_REVIEW', 'm')!;
  savePreferences('me', { enabled: true, records: [[id, false]], presented: [] });
  function Surface({ loaded }: { loaded: boolean }) {
    const ref = useRef<HTMLDivElement>(null);
    usePresentedActivity(ref, loaded ? id : null);
    return <div ref={ref}>{loaded ? 'Perfil' : 'Reintentar'}</div>;
  }
  function View({ hidden, loaded }: { hidden: boolean; loaded: boolean }) {
    const model = useActivityNotifications(controller, 'me', false);
    return <ActivityNotifications.Provider value={model}><div hidden={hidden}><Surface loaded={loaded}/></div></ActivityNotifications.Provider>;
  }
  const view = render(<View hidden loaded={false}/>);
  visibility.mockReturnValue('visible'); act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(loadPreferences('me').records).toEqual([[id, false]]);
  view.rerender(<View hidden loaded/>);
  expect(loadPreferences('me').records).toEqual([[id, false]]);
  visibility.mockReturnValue('hidden'); view.rerender(<View hidden={false} loaded/>);
  expect(loadPreferences('me').records).toEqual([[id, false]]);
  visibility.mockReturnValue('visible'); act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(loadPreferences('me').records).toEqual([[id, true]]);
});

it('acknowledges a confirmed Activity card only when the appointment reaches the visible viewport', () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.parse('2026-11-13T11:00:00Z'));
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  const controller = controllerFixture(), item = homeSecondFixture();
  const id = activityId(item.type, item.connectionId!, item.secondChat!.availableAt)!;
  savePreferences('me', { enabled: true, records: [[id, false]], presented: [] });
  let intersection: (ratio: number) => void = () => {};
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: (entries: { isIntersecting: boolean; intersectionRatio: number }[]) => void) {
      intersection = ratio => callback([{ isIntersecting: ratio > 0, intersectionRatio: ratio }]);
    }
    observe() {}
    disconnect() {}
  });
  function View() {
    const model = useActivityNotifications(controller, 'me', false);
    return <ActivityNotifications.Provider value={model}>
      <SecondChatCard item={item} accountId="me" onOpen={vi.fn()} onDismiss={vi.fn()} disabled={false} presented/>
    </ActivityNotifications.Provider>;
  }
  render(<View/>);
  act(() => intersection(0.1));
  expect(loadPreferences('me').records).toEqual([[id, false]]);
  visibility.mockReturnValue('hidden'); act(() => intersection(1));
  expect(loadPreferences('me').records).toEqual([[id, false]]);
  visibility.mockReturnValue('visible');
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  act(() => intersection(0.75));
  expect(loadPreferences('me').records).toEqual([[id, true]]);
});

it('overlays the current favicon, caps its label and restores original attributes and title', async () => {
  const icon = document.createElement('link');
  icon.rel = 'icon'; icon.href = '/favicon-32.png'; icon.type = 'image/png';
  icon.setAttribute('sizes', '32x32');
  document.head.append(icon);
  document.title = 'Original';
  const label = vi.fn(), draw = vi.fn();
  vi.stubGlobal('Image', class { src = ''; decode = async () => {}; });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    Object.assign({ drawImage: draw, fillRect: vi.fn(), fillText: label }) as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,example');
  try {
    const initialProps: { count: number | null } = { count: 0 };
    const view = renderHook(({ count }) => useTabIndicators(count), { initialProps });
    expect(document.title).toBe('Reals');
    await act(async () => view.rerender({ count: 1 }));
    expect(document.title).toBe('(1) Reals');
    expect(icon.getAttribute('href')).toBe('data:image/png;base64,example');
    expect(draw).toHaveBeenCalledOnce();
    await act(async () => view.rerender({ count: 10 }));
    expect(label).toHaveBeenLastCalledWith('9+', 22, 24);
    await act(async () => view.rerender({ count: 11 }));
    expect(document.title).toBe('(11) Reals'); expect(draw).toHaveBeenCalledTimes(2);
    view.rerender({ count: 0 });
    expect(icon.getAttribute('href')).toBe('/favicon-32.png');
    expect(icon.type).toBe('image/png');
    await act(async () => view.rerender({ count: 1 }));
    view.rerender({ count: null });
    expect(document.title).toBe('Original');
    expect(icon.getAttribute('href')).toBe('/favicon-32.png');
    await act(async () => view.rerender({ count: 2 }));
    view.unmount();
    expect(document.title).toBe('Original');
    expect(icon.getAttribute('href')).toBe('/favicon-32.png');
    expect(icon.getAttribute('sizes')).toBe('32x32');
  } finally { icon.remove(); }
});
