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
