import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiClient } from '../auth/api';
import { SessionController } from '../auth/session';
import { defaults, fullProfile } from '../onboarding/contracts';
import { questionCatalog, savedAnswer } from './questions/fixtures';
import { MyProfilePreview, previewProfile } from './MyProfilePreview';

beforeEach(() => { vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); });
const profile = { ...defaults, id: 'p', userId: 'u', status: 'ACTIVE', displayName: 'Confirmed', birthDate: '1995-11-17', authenticityVerificationStatus: 'STALE' };
it('filters public answers by current version and selection, preserves saved order and approved photos only', () => {
  const result = previewProfile(fullProfile(profile, 'u'), ['APPROVED','PENDING','NEEDS_REVIEW','REJECTED'].map((moderationStatus,i) => ({ id: String(i), position: i+1, url: 'https://example.test/photo', validationStatus: 'VALIDATED', moderationStatus, isPersonPhoto: true, isFullBody: false })), questionCatalog(), [savedAnswer('A', { selectedPosition: 2 }), savedAnswer('B', { selectedPosition: 1 }), savedAnswer('C'), savedAnswer('D', { selectedPosition: 3, current: false })], new Date(2026,10,16));
  expect(result.age).toBe(30); expect(result.profileQuestions.map(q => q.questionId)).toEqual(['B','A']); expect(result.photos.map(p => p.id)).toEqual(['0']); expect(result.affinityIndicators).toEqual([]);
  expect(previewProfile(fullProfile(profile,'u'), [], questionCatalog(), [savedAnswer('A', { selectedPosition: 1, questionSemanticVersion: 2 }), savedAnswer('REMOVED', { selectedPosition: 2 })], new Date(2026,10,17)).profileQuestions).toEqual([]);
  expect(previewProfile(fullProfile(profile,'u'), [], questionCatalog(), [], new Date(2026,10,17)).age).toBe(31);
});
function setup() {
  const user = { uid: 'f', emailVerified: true, getIdToken: async () => 'test', reload: async () => {} };
  const controller = new SessionController({ observe: () => () => {}, signIn: async () => user, signUp: async () => user, google: async () => user, verify: async () => {}, signOut: async () => {} }, new ApiClient(), false);
  controller.snapshot = { ...controller.snapshot, phase: 'ready', account: { id: 'u', status: 'ACTIVE' }, profile: { id: 'p', userId: 'u', status: 'ACTIVE' } };
  const listeners = new Set<() => void>(); vi.spyOn(controller, 'subscribe').mockImplementation(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; });
  const request = vi.spyOn(controller, 'request').mockImplementation(async path => path === '/me/profile' ? profile : path === '/me/profile/photos' ? [] : path === '/reference/profile-questions' ? questionCatalog() : { answers: [] });
  return { controller, request, notify: () => listeners.forEach(fn => fn()) };
}
function deferred() { let resolve!: (value: unknown) => void; const promise = new Promise<unknown>(r => { resolve = r; }); return { promise, resolve }; }
it('renders empty public content, retries a complete failed batch and remains read-only', async () => {
  const { controller, request } = setup(); request.mockRejectedValueOnce(new Error('offline'));
  const back = vi.fn(); render(<MyProfilePreview controller={controller} onBack={back}/>);
  await screen.findByRole('alert'); expect(screen.queryByText('Confirmed, 31')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  await screen.findByText('No hay fotos aprobadas disponibles.');
  expect(screen.queryByText('Preguntas del perfil')).toBeNull(); expect(screen.queryByText('Mensaje personal')).toBeNull();
  expect(request.mock.calls.every(c => c.length === 2)).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Volver' })); expect(back).toHaveBeenCalledOnce();
});
it('cancels obsolete resume reads, installs only complete batches and ignores late responses', async () => {
  const { controller, request } = setup(), old = deferred(); request.mockReturnValueOnce(old.promise);
  render(<MyProfilePreview controller={controller} onBack={() => {}}/>);
  expect(screen.queryByText('No hay fotos aprobadas disponibles.')).toBeNull();
  const signal = request.mock.calls[0]![1];
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await screen.findByText('No hay fotos aprobadas disponibles.'); expect(signal.aborted).toBe(true);
  await act(async () => old.resolve({ ...profile, displayName: 'Obsolete' }));
  expect(screen.queryByText(/Obsolete/)).toBeNull();
});
it('clears displayed data on account replacement and rejects a profile owned by another account', async () => {
  const { controller, notify } = setup(); render(<MyProfilePreview controller={controller} onBack={() => {}}/>);
  await screen.findByText('No hay fotos aprobadas disponibles.');
  act(() => { controller.snapshot = { ...controller.snapshot, account: { id:'other', status:'ACTIVE' }, profile: { id:'p2', userId:'other', status:'ACTIVE' } }; notify(); });
  await screen.findByRole('alert'); expect(screen.queryByText(/Confirmed,/)).toBeNull();
  act(() => { controller.snapshot = { ...controller.snapshot, phase:'login', account:null, profile:null }; notify(); });
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});
it('aborts on unmount even when the transport ignores cancellation', async () => {
  const { controller, request } = setup(), old = deferred(); request.mockReturnValueOnce(old.promise);
  const { unmount } = render(<MyProfilePreview controller={controller} onBack={() => {}}/>); const signal = request.mock.calls[0]![1]; unmount();
  expect(signal.aborted).toBe(true); await act(async () => old.resolve(profile));
});

it('rejects pending results from the previous identity after replacement', async () => {
  const { controller, request, notify } = setup(), old = deferred(); request.mockReturnValueOnce(old.promise);
  render(<MyProfilePreview controller={controller} onBack={() => {}}/>);
  const signal = request.mock.calls[0]![1];
  act(() => { controller.snapshot = { ...controller.snapshot, phase:'login', account:null, profile:null }; notify(); });
  expect(signal.aborted).toBe(true); await act(async () => old.resolve(profile));
  expect(screen.queryByText(/Confirmed,/)).toBeNull();
});

it('revalidates on tab return without replacing content, selected photo, focus or resetting scroll', async () => {
  const { controller, request } = setup();
  const images = [1,2].map(position => ({ id:String(position), position, url:`https://example.test/${position}.jpg`, validationStatus:'VALIDATED', moderationStatus:'APPROVED', isPersonPhoto:true, isFullBody:false }));
  const base = request.getMockImplementation()!;
  request.mockImplementation((path, signal) => path === '/me/profile/photos' ? Promise.resolve(images) : base(path, signal));
  render(<MyProfilePreview controller={controller} onBack={() => {}}/>);
  const selected = await screen.findByRole('button', { name:'Ver foto 2 de 2' }); fireEvent.click(selected); selected.focus();
  const card = selected.closest('article'), before = request.mock.calls.length;
  vi.mocked(window.scrollTo).mockClear();
  const read = deferred(); request.mockReturnValueOnce(read.promise);
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  act(() => document.dispatchEvent(new Event('visibilitychange'))); expect(request).toHaveBeenCalledTimes(before);
  visibility.mockReturnValue('visible'); act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(selected).toBeVisible(); expect(selected).toHaveFocus(); expect(selected).toHaveAttribute('aria-pressed','true');
  expect(screen.queryByLabelText('Cargando perfil…')).toBeNull(); expect(selected.closest('article')).toBe(card);
  expect(window.scrollTo).not.toHaveBeenCalled();
  await act(async () => read.resolve(profile));
  expect(selected.closest('article')).toBe(card); expect(selected).toHaveFocus(); expect(selected).toHaveAttribute('aria-pressed','true');
  expect(request).toHaveBeenCalledTimes(before+4);
});
it('retains the complete snapshot on failed background reads and recovers without remounting it', async () => {
  const { controller, request } = setup(); render(<MyProfilePreview controller={controller} onBack={() => {}}/>);
  const content = await screen.findByText('No hay fotos aprobadas disponibles.');
  request.mockRejectedValueOnce(new Error('offline'));
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await screen.findByRole('alert'); expect(content).toBeVisible();
  expect(screen.getByText('No hay fotos aprobadas disponibles.')).toBe(content);
  fireEvent.click(screen.getByRole('button', { name:'Reintentar' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull()); expect(content).toBeVisible();
});

it.each([['Buenos Aires', 'AR', 'Buenos Aires, Argentina'], ['', '', null]])('shows only confirmed owner location %s without extra reads', async (city, countryCode, label) => {
  const { controller, request } = setup(), read = request.getMockImplementation()!;
  request.mockImplementation((path, signal) => path === '/me/profile' ? Promise.resolve({ ...profile, city, countryCode }) : read(path, signal));
  render(<MyProfilePreview controller={controller} onBack={() => {}}/>);
  await screen.findByText('No hay fotos aprobadas disponibles.');
  const heading = screen.getByRole('heading', { name: /Confirmed,/ });
  if (label) expect(heading.nextElementSibling).toHaveTextContent(label);
  else expect(document.querySelector('.public-profile-location')).toBeNull();
  expect(request.mock.calls.map(c => c[0])).toEqual(['/me/profile','/me/profile/photos','/reference/profile-questions','/me/profile/question-answers']);
});
