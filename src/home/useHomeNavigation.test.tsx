import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useHomeNavigation } from './useHomeNavigation';

it('consumes owned returns and restores destinations with Back and Forward without growing history', async () => {
  const { result } = renderHook(() => useHomeNavigation(() => true));
  const baseline = history.length;
  for (let i = 0; i < 3; i++) {
    act(() => result.current.open('account'));
    expect(result.current.destination).toBe('account');
    act(() => result.current.backTo('home'));
    await waitFor(() => expect(result.current.destination).toBe('home'));
    act(() => history.forward());
    await waitFor(() => expect(result.current.destination).toBe('account'));
    act(() => history.back());
    await waitFor(() => expect(result.current.destination).toBe('home'));
  }
  expect(history.length).toBeLessThanOrEqual(baseline + 1);
});
it('returns through nested notifications and Forward restores each screen', async () => {
  const { result } = renderHook(() => useHomeNavigation(() => true));
  act(() => result.current.open('account')); act(() => result.current.open('notifications'));
  act(() => result.current.backTo('account')); await waitFor(() => expect(result.current.destination).toBe('account'));
  act(() => result.current.backTo('home')); await waitFor(() => expect(result.current.destination).toBe('home'));
  act(() => history.forward()); await waitFor(() => expect(result.current.destination).toBe('account'));
  act(() => history.forward()); await waitFor(() => expect(result.current.destination).toBe('notifications'));
});
it('restores a blocked Back instead of adding history entries', async () => {
  let blocked = false;
  const { result } = renderHook(() => useHomeNavigation(() => !blocked));
  act(() => result.current.open('profile')); const length = history.length;
  blocked = true; act(() => result.current.backTo('home')); expect(result.current.destination).toBe('profile');
  act(() => history.back());
  await waitFor(() => expect(history.state.trail).toEqual(['home', 'profile']));
  expect(result.current.destination).toBe('profile'); expect(history.length).toBe(length);
  blocked = false; act(() => result.current.backTo('home')); await waitFor(() => expect(result.current.destination).toBe('home'));
});
it('never follows external history for explicit Home and rejects a foreign account entry', () => {
  const { result } = renderHook(() => useHomeNavigation(() => true));
  act(() => result.current.open('preferences'));
  history.replaceState({ external: true }, '');
  act(() => result.current.backTo('home')); expect(result.current.destination).toBe('home');
  act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: { owner: 'another-account', trail: ['home', 'profile'] } })));
  expect(result.current.destination).toBe('home');
});
