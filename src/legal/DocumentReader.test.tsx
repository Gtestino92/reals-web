import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DocumentReader } from './DocumentReader';
import { loadDocument } from './documentContent';

const url = 'https://reals-web.pages.dev/legal/privacy/v1/document.html';
function publication(html: string, headers: HeadersInit = { 'content-type': 'text/html' }, destination = url.replace('/document.html', '/document')) {
  const response = new Response(html, { headers });
  Object.defineProperty(response, 'url', { value: destination });
  return response;
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function production(origin: string) {
  vi.stubEnv('VITE_REALS_ENVIRONMENT', 'prod');
  vi.stubEnv('VITE_API_BASE_URL', 'https://api.reals.ar');
  vi.stubEnv('VITE_LOCAL_FIREBASE_EMAIL_AUTO_VERIFICATION', 'false');
  vi.stubEnv('VITE_FIREBASE_APP_CHECK_DEBUG', 'false');
  vi.stubEnv('VITE_LEGAL_DOCUMENT_ORIGIN', origin);
}

it('refuses document requests when production has no trusted publication', async () => {
  production('');
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  await expect(loadDocument(url, new AbortController().signal)).rejects.toThrow('Unexpected publication');
  expect(fetcher).not.toHaveBeenCalled();
});

it('fetches the configured production document at its exact URL and rejects other destinations', async () => {
  const origin = 'https://legal.reals.ar';
  production(origin);
  const documentUrl = origin + '/legal/privacy/v2/document.html';
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(publication('<p>Vigente</p>', undefined, documentUrl));
  vi.stubGlobal('fetch', fetcher);
  const signal = new AbortController().signal;
  for (const target of [url, origin + '/privacy', origin + ':8443/legal/privacy']) {
    await expect(loadDocument(target, signal)).rejects.toThrow('Unexpected publication');
  }
  await expect(loadDocument(documentUrl, signal)).resolves.toBeDefined();
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(documentUrl, expect.objectContaining({ credentials: 'omit', redirect: 'error' }));
});

it('requires successful presentation, allows retry and submits only on explicit action', async () => {
  const fetcher = vi.fn<typeof fetch>();
  let finish!: (response: Response) => void;
  fetcher.mockResolvedValueOnce(publication('<main>Unsupported <form>body</form></main>'))
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  vi.stubGlobal('fetch', fetcher);
  const submit = vi.fn();
  render(<DocumentReader doc={{ type: 'TERMS_OF_USE', requiredAction: 'ACCEPTED', version: 'v1', satisfied: false, url }}
    title="Términos de uso" action="Aceptar" disabled={false} onClose={vi.fn()} onSubmit={submit}/>);
  const action = screen.getByRole('button', { name: 'Aceptar' });
  expect(action).toBeDisabled();
  fireEvent.click(await screen.findByRole('button', { name: 'Reintentar lectura' }));
  expect(action).toBeDisabled();
  await act(async () => finish(publication('<main><h1>Título</h1><ol start="3"><li><em>Texto íntegro</em></li></ol><a href="about:blank" onclick="ignored()">Referencia</a></main>')));
  expect(await screen.findByRole('heading', { name: 'Título' })).toBeVisible();
  expect(screen.getByText('Texto íntegro').tagName).toBe('EM');
  expect(screen.getByText('Referencia').closest('a')).toBeNull();
  expect(screen.getByRole('list')).toHaveAttribute('start', '3');
  expect(fetcher.mock.calls[1]?.[0]).toBe(url.replace('/document.html', '/document'));
  expect(screen.getByRole('link', { name: 'Abrir en navegador' })).toHaveAttribute('href', url);
  const init = fetcher.mock.calls[1]?.[1];
  expect(init).toMatchObject({ credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
  expect(init?.headers).toBeUndefined();
  expect(submit).not.toHaveBeenCalled();
  fireEvent.click(action);
  expect(submit).toHaveBeenCalledOnce();
});

it.each([true, false])('keeps closing and opening the publication available during verification (completed: %s)', async satisfied => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(publication('<p>Texto íntegro</p>')));
  const close = vi.fn(), submit = vi.fn();
  render(<DocumentReader doc={{ type: 'PRIVACY_NOTICE', requiredAction: 'ACKNOWLEDGED', version: 'v1', satisfied, url }}
    title="Aviso de privacidad" action="Confirmar lectura" disabled status="Verificando la versión vigente…" onClose={close} onSubmit={submit}/>);

  const body = screen.getByRole('region', { name: 'Contenido del documento' });
  expect(await screen.findByText('Texto íntegro')).toBeVisible();
  const closeButton = screen.getByRole('button', { name: 'Cerrar' });
  const link = screen.getByRole('link', { name: 'Abrir en navegador' });
  expect(closeButton.closest('header')).toContainElement(link);
  expect(closeButton.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const action = screen.queryByRole('button', { name: 'Confirmar lectura' });
  if (satisfied) expect(action).toBeNull();
  else {
    expect(action).toBeDisabled();
    expect(action?.closest('footer')).toContainElement(action);
  }
  fireEvent.click(closeButton);
  expect(close).toHaveBeenCalledOnce();
  expect(submit).not.toHaveBeenCalled();
});

it.each([
  'http://reals-web.pages.dev/legal/doc',
  'https://example.org/legal/doc',
  'https://reals-web.pages.dev/app',
  'https://reals-web.pages.dev/legal/%2e%2e/app',
  'https://@reals-web.pages.dev/legal/doc',
  'https://reals-web.pages.dev/legal/doc#fragment',
  'javascript:void(0)',
])('rejects an untrusted publication before fetching or offering navigation to %s', async target => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  render(<DocumentReader doc={{ type: 'TERMS_OF_USE', requiredAction: 'ACCEPTED', version: 'v1', satisfied: false, url: target }}
    title="Términos de uso" action="Aceptar" disabled={false} onClose={vi.fn()} onSubmit={vi.fn()}/>);
  expect(screen.queryByRole('link', { name: 'Abrir en navegador' })).toBeNull();
  expect(await screen.findByRole('alert')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Aceptar' })).toBeDisabled();
  await expect(loadDocument(target, new AbortController().signal)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([
  () => publication('<iframe></iframe>'), () => publication('<p>Legal</p><script></script>'),
  () => publication('<img src="/tracking">'), () => publication('<p>Legal</p>', { 'content-type': 'text/plain' }),
  () => publication('x'.repeat(524289)), () => publication('text', undefined, url + '?redirect'),
  () => publication('<html><title>Loading</title><body></body></html>'),
])('rejects unsupported or incomplete content', async response => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response()));
  await expect(loadDocument(url, new AbortController().signal)).rejects.toThrow();
});

it('retires a public document request when its reader is removed', async () => {
  let signal: AbortSignal | null | undefined;
  vi.stubGlobal('fetch', vi.fn<typeof fetch>((_, init) => {
    signal = init?.signal;
    return new Promise(() => {});
  }));
  const view = render(<DocumentReader doc={{ type: 'PRIVACY_NOTICE', requiredAction: 'ACKNOWLEDGED', version: 'v1', satisfied: false, url }}
    title="Aviso" action="Confirmar lectura" disabled={false} onSubmit={vi.fn()} onClose={vi.fn()}/>);
  await waitFor(() => expect(signal?.aborted).toBe(false));
  view.unmount();
  expect(signal?.aborted).toBe(true);
});
