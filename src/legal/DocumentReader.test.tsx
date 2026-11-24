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
afterEach(() => vi.unstubAllGlobals());

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

it.each(['http://reals-web.pages.dev/legal/doc', 'https://example.org/legal/doc', 'https://reals-web.pages.dev/app'])('rejects an untrusted publication before fetching %s', async target => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
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
