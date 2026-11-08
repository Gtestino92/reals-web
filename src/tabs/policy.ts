// Vite DEV describes its dev server, never the backend environment.
// A build/preview and every non-loopback deployment always enforce ownership.
export function tabOwnershipEnabled(dev: boolean, hostname: string, localOptIn: unknown): boolean {
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
  return !dev || !loopback || localOptIn === 'true';
}
