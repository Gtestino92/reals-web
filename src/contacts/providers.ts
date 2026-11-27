import { isLocalVite } from '../config/environment';
import { object } from '../auth/api';

export interface ContactRow { name: string; number: string }
export type PickContacts = (signal: AbortSignal) => Promise<ContactRow[]>;
export class ProviderError extends Error {}
const oversized = () => new ProviderError('La agenda supera el límite de lectura de 4000 entradas. Elegí menos contactos desde el selector del dispositivo.');
function append(rows: ContactRow[], name: unknown, number: unknown) {
  if (typeof number !== 'string' || !number.trim()) return;
  if (rows.length >= 4000) throw oversized();
  rows.push({ name: typeof name === 'string' ? name.slice(0, 200) : '', number: number.trim().length > 64 ? 'Teléfono demasiado largo (más de 64 caracteres)' : number.trim() });
}

// The native operation has no AbortSignal. Keep only its occupancy across views.
let nativePickerOpen = false;
const pickerBusy = 'Ya hay un selector de contactos abierto. Cerralo antes de volver a intentar.';
const activation = 'Volvé a tocar el botón de importación para abrir los contactos del dispositivo.';
const settings = 'Si rechazaste el permiso, revisá Ajustes de Android → Apps → Chrome → Permisos → Contactos. Si usás Reals instalada, revisá también los permisos del navegador que la abre. Después volvé a intentar.';

function pickerFailure(error: unknown): Error {
  const name = object(error) && typeof error.name === 'string' ? error.name : '';
  const message = object(error) && typeof error.message === 'string' ? error.message : '';
  if (name === 'AbortError') return new DOMException('Cancelaste la selección.', 'AbortError');
  if (/user (activation|gesture)/i.test(message)) return new ProviderError(activation);
  if (/already (in use|open|active)|picker is already/i.test(message)) return new ProviderError(pickerBusy);
  if (name === 'InvalidStateError') return new ProviderError('No pudimos abrir tus contactos. Si hay otro selector abierto, cerralo. ' + settings);
  if (name === 'SecurityError' || name === 'NotAllowedError') return new ProviderError('El navegador no permitió el acceso. ' + settings);
  if (name === 'TypeError' && /unable to open a contact selector/i.test(message)) return new ProviderError('No pudimos abrir tus contactos. ' + settings);
  return new ProviderError('El selector no pudo completar la solicitud. Cerralo si sigue abierto y volvé a intentar.');
}
export async function preparePicker(): Promise<PickContacts | null> {
  if (!window.isSecureContext || window.top !== window || !('contacts' in navigator)) return null;
  const manager = navigator.contacts;
  if (!object(manager) || typeof manager.getProperties !== 'function' || typeof manager.select !== 'function') return null;
  const props: unknown = await manager.getProperties();
  if (!Array.isArray(props) || !props.includes('tel')) return null;
  const select = manager.select.bind(manager);
  return async signal => {
    signal.throwIfAborted();
    if (nativePickerOpen) throw new ProviderError(pickerBusy);
    if (navigator.userActivation?.isActive === false) throw new ProviderError(activation);
    nativePickerOpen = true;
    let contacts: unknown;
    try { contacts = await select(props.includes('name') ? ['tel', 'name'] : ['tel'], { multiple: true }); }
    catch (error) { throw pickerFailure(error); }
    finally { nativePickerOpen = false; }
    signal.throwIfAborted();
    if (!Array.isArray(contacts)) throw new ProviderError('El selector devolvió una respuesta inesperada.');
    if (contacts.length > 4000) throw oversized();
    const rows: ContactRow[] = [];
    for (const person of contacts) {
      if (object(person) && Array.isArray(person.tel)) {
        for (const number of person.tel) append(rows, Array.isArray(person.name) ? person.name[0] : '', number);
      }
    }
    return rows;
  };
}

export const contactsScope = 'https://www.googleapis.com/auth/contacts.readonly';
// Bound decoded bytes as well as row/page counts. Content-Length may be absent or compressed.
async function readPeoplePage(response: Response): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new ProviderError('Respuesta de Google incompleta.');
  const decoder = new TextDecoder();
  let bytes = 0, json = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 2 * 1024 * 1024) {
        await reader.cancel();
        throw new ProviderError('Una página de Google supera el límite de 2 MB. Probá con una agenda más pequeña.');
      }
      json += decoder.decode(value, { stream: true });
    }
    return JSON.parse(json + decoder.decode());
  } finally { reader.releaseLock(); }
}
export async function peopleRows(token: string, expires: number, signal: AbortSignal): Promise<ContactRow[]> {
  let pageToken = '';
  const rows: ContactRow[] = [];
  for (let page = 0; page < 20; page++) {
    signal.throwIfAborted();
    if (Date.now() >= expires) throw new ProviderError('Venció el permiso temporal. Volvé a elegir tu cuenta de Google.');
    const query = new URLSearchParams({ personFields: 'names,phoneNumbers', sources: 'READ_SOURCE_TYPE_CONTACT', pageSize: '200',
      fields: 'nextPageToken,connections(names(displayName),phoneNumbers(value,canonicalForm))' });
    if (pageToken) query.set('pageToken', pageToken);
    const response = await fetch('https://people.googleapis.com/v1/people/me/connections?' + query, {
      signal, cache: 'no-store', redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Authorization: 'Bearer ' + token },
    });
    if (!response.ok) throw new ProviderError(response.status === 401 ? 'Venció el acceso a Google. Volvé a autorizarlo.' :
      'Google no pudo completar la lectura. Volvé a intentarlo más tarde.');
    const data = await readPeoplePage(response);
    signal.throwIfAborted();
    if (!object(data) || (data.connections !== undefined && !Array.isArray(data.connections))) throw new ProviderError('Respuesta de Google incompleta.');
    for (const person of data.connections ?? []) {
      if (!object(person) || (person.phoneNumbers !== undefined && !Array.isArray(person.phoneNumbers))) throw new ProviderError('Respuesta de Google incompleta.');
      const first = Array.isArray(person.names) && person.names[0];
      for (const phone of person.phoneNumbers ?? []) {
        if (!object(phone)) throw new ProviderError('Respuesta de Google incompleta.');
        append(rows, object(first) && first.displayName, phone.canonicalForm || phone.value);
      }
    }
    if (data.nextPageToken === undefined || data.nextPageToken === '') return rows;
    if (typeof data.nextPageToken !== 'string') throw new ProviderError('Respuesta de Google incompleta.');
    pageToken = data.nextPageToken;
  }
  throw oversized();
}

interface OAuth {
  initTokenClient(config: { client_id: string; scope: string; include_granted_scopes: false; callback: (response: unknown) => void; error_callback: () => void }): {
    requestAccessToken(options: { prompt: 'select_account' }): void;
  };
}
declare global { interface Window { google?: { accounts?: { oauth2?: OAuth } } } }
let loading: Promise<void> | undefined;
export async function prepareGoogle(clientId: string): Promise<PickContacts> {
  if (!window.google?.accounts?.oauth2) {
    loading ??= new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      const fail = () => {
        window.clearTimeout(timer); script.onload = null; script.onerror = null; script.remove(); loading = undefined;
        reject(new ProviderError('No se pudo cargar Google. Revisá tu conexión.'));
      };
      const timer = window.setTimeout(fail, 15000);
      script.onload = () => {
        if (!window.google?.accounts?.oauth2) { fail(); return; }
        window.clearTimeout(timer); resolve();
      };
      script.onerror = fail;
      document.head.append(script);
    });
    await loading;
  }
  const oauth = window.google?.accounts?.oauth2;
  if (!oauth) throw new ProviderError('Google no está disponible.');
  return async signal => {
    signal.throwIfAborted();
    const grant = await new Promise<{ token: string; expires: number }>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      const fail = () => { signal.removeEventListener('abort', abort); reject(new ProviderError('Autorización incompleta. Permití ventanas emergentes y elegí una cuenta para continuar.')); };
      try {
        oauth.initTokenClient({ client_id: clientId, scope: contactsScope, include_granted_scopes: false, error_callback: fail,
          callback: raw => {
            if (signal.aborted) return;
            if (!object(raw) || raw.error || typeof raw.access_token !== 'string' || !raw.access_token ||
                typeof raw.scope !== 'string' || !raw.scope.split(' ').includes(contactsScope) || (!Number.isFinite(Number(raw.expires_in)) || Number(raw.expires_in) <= 0)) return fail();
            signal.removeEventListener('abort', abort);
            resolve({ token: raw.access_token, expires: Date.now() + Number(raw.expires_in) * 1000 });
          },
        }).requestAccessToken({ prompt: 'select_account' });
      } catch { fail(); }
    });
    return peopleRows(grant.token, grant.expires, signal);
  };
}

export interface Providers {
  picker?: () => Promise<PickContacts | null>;
  google?: () => Promise<PickContacts>;
}
const env = import.meta.env;
export const syntheticContacts = isLocalVite(env) && env.VITE_CONTACTS_SYNTHETIC === 'true' &&
  ['127.0.0.1', 'localhost'].includes(location.hostname);
export const providers: Providers = syntheticContacts ? {
  picker: async () => async () => [
    { name: 'Ejemplo A', number: '+12025550100' }, { name: 'Ejemplo B', number: '+12025550101' },
  ],
} : {
  ...(env.VITE_CONTACT_PICKER_ENABLED === 'true' ? { picker: preparePicker } : {}),
  ...(env.VITE_GOOGLE_CONTACTS_ENABLED === 'true' && env.VITE_GOOGLE_CONTACTS_CLIENT_ID ?
    { google: () => prepareGoogle(env.VITE_GOOGLE_CONTACTS_CLIENT_ID) } : {}),
};
