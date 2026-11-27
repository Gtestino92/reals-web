import { afterEach, expect, it, vi } from 'vitest';
import { contactsScope, peopleRows, prepareGoogle, preparePicker, providers } from './providers';

const signal = () => new AbortController().signal;
afterEach(() => { vi.unstubAllGlobals(); delete window.google; });
it('requires a secure supported picker and requests only available telephone/name properties', async () => {
  expect(providers).toEqual({});
  expect(await preparePicker()).toBeNull();
  vi.stubGlobal('isSecureContext', true);
  const select = vi.fn().mockResolvedValue([{ name: ['Ana'], tel: ['1', '2'] }]);
  const getProperties = vi.fn().mockResolvedValueOnce(['email']).mockResolvedValue(['name', 'tel', 'email']);
  vi.stubGlobal('navigator', { contacts: { select, getProperties } });
  expect(await preparePicker()).toBeNull();
  const pick = await preparePicker();
  expect(await pick!(signal())).toEqual([{ name: 'Ana', number: '1' }, { name: 'Ana', number: '2' }]);
  expect(select).toHaveBeenCalledWith(['tel', 'name'], { multiple: true });
  select.mockRejectedValueOnce(new DOMException('Cancel', 'AbortError'));
  await expect(pick!(signal())).rejects.toThrow(/Cancelaste/);
});
it('limits fields, follows all pages, and discards partial results on page failure', async () => {
  const page = () => Response.json({ connections: [{ names: [{ displayName: 'A' }], phoneNumbers: [{ value: 'local', canonicalForm: '+12025550100' }] }], nextPageToken: 'next' });
  const mock = vi.fn().mockResolvedValueOnce(page()).mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(page()).mockResolvedValueOnce(new Response(null, { status: 429 }));
  vi.stubGlobal('fetch', mock);
  expect(await peopleRows('synthetic', Infinity, signal())).toEqual([{ name: 'A', number: '+12025550100' }]);
  expect(String(mock.mock.calls[1]![0])).toContain('pageToken=next');
  await expect(peopleRows('synthetic', Infinity, signal())).rejects.toThrow();
  await expect(peopleRows('synthetic', 0, signal())).rejects.toThrow(/Venció/);
});
it.each(['scope', 'denied', 'closed', 'expired', 'valid'])('handles OAuth %s without using Firebase', async scenario => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({})); vi.stubGlobal('fetch', fetcher);
  window.google = { accounts: { oauth2: { initTokenClient: config => ({ requestAccessToken(options) {
    expect(options.prompt).toBe('select_account');
    if (scenario === 'closed') config.error_callback();
    else config.callback({ access_token: 'temporary', expires_in: scenario === 'expired' ? 0 : 3600, scope: scenario === 'scope' ? 'openid' : contactsScope, error: scenario === 'denied' });
  } }) } } };
  const pick = await prepareGoogle('synthetic');
  if (scenario === 'valid') expect(await pick(signal())).toEqual([]);
  else { await expect(pick(signal())).rejects.toThrow(); expect(fetcher).not.toHaveBeenCalled(); }
});



it('ignores an OAuth callback arriving after operation retirement', async () => {
  const task = new AbortController();
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  let respond!: (value: unknown) => void;
  window.google = { accounts: { oauth2: { initTokenClient: config => {
    respond = config.callback;
    return { requestAccessToken() {} };
  } } } };
  const pick = await prepareGoogle('synthetic');
  const pending = pick(task.signal);
  task.abort();
  respond({ access_token: 'obsolete', scope: contactsScope, expires_in: 3600 });
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetcher).not.toHaveBeenCalled();
});
it('rejects oversized People pages without offering an incomplete selection', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(' '.repeat(2 * 1024 * 1024 + 1))));
  await expect(peopleRows('synthetic', Infinity, signal())).rejects.toThrow(/2 MB/);
});

it('keeps the native slot until settlement even when the intent leaves and a new picker is prepared', async () => {
  let settle!: (rows: unknown[]) => void;
  const select = vi.fn().mockImplementationOnce(() => new Promise(resolve => { settle = resolve; }))
    .mockImplementationOnce(() => { throw new TypeError('Unable to open a contact selector'); })
    .mockRejectedValueOnce(new DOMException('Permission denied', 'NotAllowedError'))
    .mockResolvedValueOnce([{ tel: ['+12025550100'] }]);
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', { contacts: { getProperties: async () => ['tel'], select } });
  const owner = new AbortController();
  const first = (await preparePicker())!(owner.signal);
  owner.abort();
  const pick = (await preparePicker())!;
  await expect(pick(signal())).rejects.toThrow(/selector de contactos abierto/);
  expect(select).toHaveBeenCalledTimes(1);
  settle([]); await expect(first).rejects.toMatchObject({ name: 'AbortError' });
  await expect(pick(signal())).rejects.toThrow(/Chrome → Permisos → Contactos/);
  await expect(pick(signal())).rejects.toThrow(/no permitió/);
  await expect(pick(signal())).resolves.toEqual([{ name: '', number: '+12025550100' }]);
});
it('requests another gesture when transient activation is absent', async () => {
  const select = vi.fn();
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', { userActivation: { isActive: false }, contacts: { getProperties: async () => ['tel'], select } });
  await expect((await preparePicker())!(signal())).rejects.toThrow(/Volvé a tocar/);
  expect(select).not.toHaveBeenCalled();
});
