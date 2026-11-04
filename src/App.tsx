import { useState } from 'react';
import { LoginScreen } from './auth/LoginScreen';
import type { LoginErrorOwner } from './auth/LoginScreen';

export function App() {
  const [failure, setFailure] = useState<{ message: string; owner: LoginErrorOwner } | null>(null);

  return <LoginScreen
    error={failure?.message ?? null}
    errorOwner={failure?.owner ?? null}
    onSignIn={() => setFailure({ message: 'La autenticación todavía no está disponible.', owner: 'signIn' })}
    onSignUp={() => setFailure({ message: 'La autenticación todavía no está disponible.', owner: 'signUp' })}
    onPasswordReset={() => setFailure({ message: 'La recuperación de contraseña todavía no está disponible.', owner: 'signIn' })}
    onGoogleSignIn={() => setFailure({ message: 'El inicio de sesión con Google todavía no está disponible.', owner: 'shared' })}
  />;
}
