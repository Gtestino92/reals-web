import type { SessionController } from '../auth/session';
import { legal, type LegalDocument } from '../onboarding/contracts';

export const fingerprint = (documents: LegalDocument[]) => JSON.stringify(documents.map(d => [d.type, d.version, d.requiredAction, d.satisfied]));

export async function readRequirements(controller: SessionController, signal: AbortSignal) {
  const read = () => Promise.all([controller.request('/me/legal-status', signal), controller.request('/legal/documents/current', signal)]);
  const pair = await read();
  try { return legal(...pair); }
  catch { signal.throwIfAborted(); return legal(...await read()); }
}

export function reportPendingRequirements(controller: SessionController, documents: LegalDocument[]) {
  controller.legalEvents.dispatchEvent(new CustomEvent('pending', { detail: fingerprint(documents) }));
}
