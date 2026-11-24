import { createContext } from 'react';

// Standalone Home has no known legal snapshot.
export const PendingLegalSearch = createContext<() => boolean>(() => false);
