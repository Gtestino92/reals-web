import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LoginScreen } from './LoginScreen';
import type { LoginScreenProps } from './LoginScreen';

const switchToSignUp = () => fireEvent.click(screen.getByRole('radio', { name: 'Crear cuenta' }));
const switchToSignIn = () => fireEvent.click(screen.getByRole('radio', { name: 'Iniciar sesión' }));
function callbacks() {
  return { onSignIn: vi.fn(), onSignUp: vi.fn(), onPasswordReset: vi.fn(), onGoogleSignIn: vi.fn() };
}
afterEach(() => { vi.useRealTimers(); });

it('starts in sign-in with Android copy, masking, autofill hints and unchecked remember', () => {
  render(<LoginScreen {...callbacks()} />);
  expect(screen.getByRole('radio', { name: 'Iniciar sesión' })).toBeChecked();
  expect(screen.queryByText('Ingresá con tu email y contraseña para continuar.')).toBeNull();
  expect(screen.getByLabelText('Email')).toHaveAttribute('autocomplete', 'username');
  expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');
  expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password');
  expect(screen.getByRole('checkbox', { name: 'Mantener sesión iniciada' })).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Ingresar' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Olvidé mi contraseña' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Continuar con Google' })).toBeVisible();
});

it('switches both ways without submitting and retains fields and remember preference', () => {
  const actions = callbacks();
  render(<LoginScreen {...actions} />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'persona@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret' } });
  fireEvent.click(screen.getByRole('checkbox'));
  switchToSignUp();
  expect(screen.getByRole('radio', { name: 'Crear cuenta' })).toBeChecked();
  expect(screen.getByLabelText('Password')).toHaveAttribute('autocomplete', 'new-password');
  expect(screen.queryByRole('button', { name: 'Olvidé mi contraseña' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Continuar con Google' })).toBeVisible();
  switchToSignIn();
  expect(screen.getByLabelText('Email')).toHaveValue('persona@example.com');
  expect(screen.getByLabelText('Password')).toHaveValue('secret');
  expect(screen.getByRole('checkbox')).toBeChecked();
  for (const callback of Object.values(actions)) expect(callback).not.toHaveBeenCalled();
});

it.each([false, true])('submits only the current mode with remember=%s and exact arguments', (remember) => {
  const actions = callbacks();
  render(<LoginScreen {...actions} />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'persona@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: ' secret ' } });
  if (remember) fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.submit(screen.getByRole('form'));
  expect(actions.onSignIn).toHaveBeenCalledExactlyOnceWith('persona@example.com', ' secret ', remember);
  expect(actions.onSignUp).not.toHaveBeenCalled();
  switchToSignUp();
  fireEvent.submit(screen.getByRole('form'));
  expect(actions.onSignUp).toHaveBeenCalledExactlyOnceWith('persona@example.com', ' secret ', remember);
  expect(actions.onSignIn).toHaveBeenCalledTimes(1);
});

it('calls reset with email only and Google in either mode without submitting', () => {
  const actions = callbacks();
  render(<LoginScreen {...actions} />);
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'persona@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Olvidé mi contraseña' }));
  expect(actions.onPasswordReset).toHaveBeenCalledExactlyOnceWith('persona@example.com');
  fireEvent.click(screen.getByRole('button', { name: 'Continuar con Google' }));
  switchToSignUp();
  fireEvent.click(screen.getByRole('button', { name: 'Continuar con Google' }));
  expect(actions.onGoogleSignIn).toHaveBeenCalledTimes(2);
  expect(actions.onGoogleSignIn).toHaveBeenLastCalledWith();
  expect(actions.onSignIn).not.toHaveBeenCalled();
  expect(actions.onSignUp).not.toHaveBeenCalled();
});

it.each(['loading', 'googleLoading', 'sessionLoading'] as const)('keeps the brand and restores the signup draft after %s', pending => {
  const actions = callbacks();
  const { rerender } = render(<LoginScreen {...actions} />);
  switchToSignUp();
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'persona@example.com' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
  const brand = screen.getByRole('heading', { name: 'Reals' });
  rerender(<LoginScreen {...actions} {...{ [pending]: true }} />);
  expect(screen.getByRole('status')).toHaveTextContent('Preparando tu sesión de forma segura…');
  expect(screen.queryByRole('form')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.getByRole('heading', { name: 'Reals' })).toBe(brand);
  rerender(<LoginScreen {...actions} error="No se pudo crear la cuenta." errorOwner="signUp" />);
  expect(screen.getByRole('radio', { name: 'Crear cuenta' })).toBeChecked();
  expect(screen.getByLabelText('Email')).toHaveValue('persona@example.com');
  expect(screen.getByLabelText('Password')).toHaveValue('password');
  expect(screen.getByRole('alert')).toHaveTextContent('No se pudo crear la cuenta.');
});

it('keeps password reset pending inline and excludes other form interactions', () => {
  const actions = callbacks();
  render(<LoginScreen {...actions} passwordResetLoading />);
  expect(screen.getByRole('form')).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByRole('button', { name: 'Enviando...' })).toBeDisabled();
  expect(screen.getByRole('radio', { name: 'Crear cuenta' })).toBeDisabled();
  expect(screen.getByLabelText('Email')).toBeDisabled();
  fireEvent.submit(screen.getByRole('form'));
  expect(actions.onSignIn).not.toHaveBeenCalled();
});
it.each([
  ['signIn', true, false], ['signUp', false, true], ['shared', true, true], [null, true, false],
] as const)('scopes error owner %s to its permitted modes', (owner, inSignIn, inSignUp) => {
  render(<LoginScreen {...callbacks()} error="Credenciales inválidas." errorOwner={owner} />);
  expect(Boolean(screen.queryByRole('alert'))).toBe(inSignIn);
  switchToSignUp();
  expect(Boolean(screen.queryByRole('alert'))).toBe(inSignUp);
  switchToSignIn();
  expect(Boolean(screen.queryByRole('alert'))).toBe(inSignIn);
});

it('renders error/feedback as text and shows reset feedback only in sign-in', () => {
  const props: LoginScreenProps = { ...callbacks(), passwordResetMessage: 'Revisá tu email.' };
  const { rerender } = render(<LoginScreen {...props} error="<b>Error</b>" errorOwner="shared" />);
  expect(screen.getByRole('alert')).toHaveTextContent('<b>Error</b>');
  expect(screen.getByRole('alert').querySelector('b')).toBeNull();
  expect(screen.getByRole('status')).toHaveTextContent('Revisá tu email.');
  switchToSignUp();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  rerender(<LoginScreen {...props} error={null} />);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  switchToSignIn();
  expect(screen.getByRole('status')).toBeVisible();
});

it('rounds cooldown up, blocks only reset, and enables reset at the deadline', () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const actions = callbacks();
  render(<LoginScreen {...actions} passwordResetAvailableAtMillis={2501} />);
  expect(screen.getByRole('button', { name: 'Reenviar en 2s' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Reenviar en 2s' }));
  expect(actions.onPasswordReset).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Ingresar' })).toBeEnabled();
  act(() => { vi.advanceTimersByTime(1000); });
  expect(screen.getByRole('button', { name: 'Reenviar en 1s' })).toBeDisabled();
  act(() => { vi.advanceTimersByTime(501); });
  fireEvent.click(screen.getByRole('button', { name: 'Olvidé mi contraseña' }));
  expect(actions.onPasswordReset).toHaveBeenCalledExactlyOnceWith('');
});

it('replaces deadlines immediately, survives mode switches, and catches up on resume', () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const actions = callbacks();
  const { rerender } = render(<LoginScreen {...actions} passwordResetAvailableAtMillis={61000} />);
  switchToSignUp();
  switchToSignIn();
  expect(screen.getByRole('button', { name: 'Reenviar en 60s' })).toBeDisabled();
  rerender(<LoginScreen {...actions} passwordResetAvailableAtMillis={3000} />);
  expect(screen.getByRole('button', { name: 'Reenviar en 2s' })).toBeDisabled();
  vi.setSystemTime(4000);
  fireEvent(window, new Event('focus'));
  expect(screen.getByRole('button', { name: 'Olvidé mi contraseña' })).toBeEnabled();
  rerender(<LoginScreen {...actions} passwordResetAvailableAtMillis={null} />);
  expect(vi.getTimerCount()).toBe(0);
});

it('cleans timers on unmount and StrictMode restart', () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  const { unmount } = render(<StrictMode><LoginScreen {...callbacks()} passwordResetAvailableAtMillis={61000} /></StrictMode>);
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});

it.each([null, 0, Number.NaN, Number.POSITIVE_INFINITY])('accepts absent/expired/invalid deadline %s without cooldown', (deadline) => {
  render(<LoginScreen {...callbacks()} passwordResetAvailableAtMillis={deadline} />);
  expect(screen.getByRole('button', { name: 'Olvidé mi contraseña' })).toBeEnabled();
});

it('returns from sign-up with Escape without submitting or losing email', () => {
  const actions = callbacks();
  render(<LoginScreen {...actions} />);
  switchToSignUp();
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'persona@example.com' } });
  fireEvent.keyDown(screen.getByLabelText('Email'), { key: 'Escape' });
  expect(screen.getByRole('radio', { name: 'Iniciar sesión' })).toBeChecked();
  expect(screen.getByLabelText('Email')).toHaveValue('persona@example.com');
  expect(actions.onSignIn).not.toHaveBeenCalled();
});
