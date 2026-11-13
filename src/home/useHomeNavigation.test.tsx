import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
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
  // State already equals this trail before the asynchronous Back starts.
  // Wait for both the attempted traversal and its restoring Forward event.
  const traversed = vi.fn(); window.addEventListener('popstate', traversed);
  try {
    act(() => history.back());
    await waitFor(() => expect(traversed).toHaveBeenCalledTimes(2));
  } finally { window.removeEventListener('popstate', traversed); }
  expect(history.state.trail).toEqual(['home', 'profile']);
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
it('uses same-document admin history and preserves Account Back/Forward without credentials', async () => {
  const { result } = renderHook(() => useHomeNavigation(() => true));
  act(() => result.current.open('account')); act(() => result.current.open('admin'));
  expect(location.pathname).toBe('/admin'); expect(history.state.trail).toEqual(['home', 'account', 'admin']);
  act(() => result.current.backTo('account')); await waitFor(() => expect(result.current.destination).toBe('account'));
  expect(location.pathname).toBe('/'); act(() => history.forward()); await waitFor(() => expect(result.current.destination).toBe('admin'));
  expect(location.pathname).toBe('/admin');
});
it('can block only administrative entry for unsaved forms while retaining ordinary Back behavior', async () => {
  let dirty = false;
  const { result } = renderHook(() => useHomeNavigation(target => target !== 'admin' || !dirty));
  act(() => result.current.open('account')); dirty = true; act(() => result.current.open('admin'));
  expect(result.current.destination).toBe('account'); expect(location.pathname).toBe('/');
  act(() => result.current.backTo('home')); await waitFor(() => expect(result.current.destination).toBe('home'));
});
it('a foreign admin entry cannot restore a stale account view and same-depth guards never reload via history.go(0)', () => {
  let allowed = true;
  const { result } = renderHook(() => useHomeNavigation(() => allowed));
  act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: { owner: 'obsolete', trail: ['home', 'admin'] } })));
  expect(result.current.destination).toBe('home'); expect(location.pathname).toBe('/');
  act(() => result.current.open('account')); allowed = false;
  const incoming = { owner: history.state.owner, trail: ['home', 'admin'] };
  const go = vi.spyOn(history, 'go');
  try {
    act(() => { history.replaceState(incoming, '', '/admin'); window.dispatchEvent(new PopStateEvent('popstate', { state: incoming })); });
    expect(result.current.destination).toBe('account'); expect(location.pathname).toBe('/'); expect(go).not.toHaveBeenCalledWith(0);
  } finally { go.mockRestore(); }
});

it('retains scheduling context through profile Back and Forward',async()=>{
 const {result}=renderHook(()=>useHomeNavigation(()=>true));act(()=>result.current.open('activity'));act(()=>result.current.openScheduling('c','m','María'));
 act(()=>result.current.openPartnerProfile());expect(result.current.destination).toBe('partner-profile');act(()=>result.current.backTo('scheduling'));await waitFor(()=>expect(result.current.destination).toBe('scheduling'));
 expect(result.current.connectionId).toBe('c');act(()=>history.forward());await waitFor(()=>expect(result.current.destination).toBe('partner-profile'));expect(result.current.matchId).toBe('m');
});
it('returns directly from an Activity profile card without a phantom scheduling entry',async()=>{
 const {result}=renderHook(()=>useHomeNavigation(()=>true));act(()=>result.current.open('activity'));act(()=>result.current.openScheduling('c','m',null,true));expect(history.state.trail).toEqual(['home','activity','partner-profile']);
 act(()=>result.current.backTo('activity'));await waitFor(()=>expect(result.current.destination).toBe('activity'));act(()=>history.forward());await waitFor(()=>expect(result.current.destination).toBe('partner-profile'));
});

it('gives Second Chat one history owner and retires stale Forward entries', async () => {
 let rootLocked=false,canReturn=false;const leave=vi.fn();
 const {result}=renderHook(()=>useHomeNavigation(()=>!rootLocked));
 act(()=>result.current.open('activity'));act(()=>{expect(result.current.openSecondChat('connection','match')).toBe(true);});rootLocked=true;
 let unregister: (()=>void)|undefined;act(()=>{unregister=result.current.registerSecondChat({canLeave:()=>canReturn,leave});});
 const length=history.length;act(()=>history.back());await waitFor(()=>expect(history.state.trail.at(-1)).toBe('second-chat'));expect(leave).not.toHaveBeenCalled();expect(history.length).toBe(length);
 canReturn=true;act(()=>history.back());await waitFor(()=>expect(result.current.destination).toBe('home'));expect(leave).toHaveBeenCalledOnce();act(()=>unregister?.());rootLocked=false;
 act(()=>history.forward());await waitFor(()=>expect(history.state.trail).toEqual(['home']));expect(result.current.destination).toBe('home');expect(leave).toHaveBeenCalledOnce();
});
it('explicit Second Chat exit replaces its entry without invoking a conflicting root guard',()=>{
 let rootLocked=false;const {result}=renderHook(()=>useHomeNavigation(()=>!rootLocked));act(()=>result.current.openSecondChat('connection','match'));rootLocked=true;act(()=>result.current.closeSecondChat());expect(result.current.destination).toBe('home');expect(history.state.trail).toEqual(['home']);
});

it('does not let a stale Second Chat entry bypass another screen navigation lock',()=>{
 let locked=false;const {result}=renderHook(()=>useHomeNavigation(()=>!locked));act(()=>result.current.open('account'));const previous=history.state;locked=true;
 act(()=>window.dispatchEvent(new PopStateEvent('popstate',{state:{owner:previous.owner,trail:['home','second-chat'],connectionId:'old',matchId:'old'}})));
 expect(result.current.destination).toBe('account');expect(history.state).toEqual(previous);
});
