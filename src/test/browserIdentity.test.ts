import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readPublic = (path: string) => readFileSync('public' + new URL(path, 'https://reals.test').pathname);
const page = new DOMParser().parseFromString(readFileSync('index.html', 'utf8'), 'text/html');
const installIcons = [
  { src: '/icons/icon-192.png?v=2', sizes: '192x192', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-512.png?v=2', sizes: '512x512', type: 'image/png', purpose: 'any' },
  { src: '/icons/icon-maskable-512.png?v=2', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
];

describe('Reals installation metadata', () => {
  it('keeps one standalone app identity with distinct general and maskable icons', () => {
    const path = page.querySelector('link[rel="manifest"]')?.getAttribute('href');
    expect(path).toBe('/manifest.webmanifest');
    const manifest: unknown = JSON.parse(readPublic(path ?? '').toString('utf8'));
    expect(manifest).toMatchObject({
      id: '/', scope: '/', start_url: '/', display: 'standalone',
      name: 'Reals', short_name: 'Reals', lang: 'es-AR', icons: installIcons,
    });
  });

  it('references full-color PNGs with the declared sizes for each install and tab variant', () => {
    const links = [...page.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')];
    expect(links.map(link => link.getAttribute('href'))).toEqual([
      '/favicon.ico?v=2', '/favicon-16.png?v=2', '/favicon-32.png?v=2', '/apple-touch-icon.png?v=2',
    ]);
    const pngs = [
      ...installIcons,
      ...links.filter(link => link.getAttribute('type') !== 'image/x-icon').map(link => ({
        src: link.getAttribute('href') ?? '', sizes: link.getAttribute('sizes') ?? '',
      })),
    ];
    expect(pngs.map(icon => icon.sizes)).toEqual(['192x192', '512x512', '512x512', '16x16', '32x32', '180x180']);
    for (const { src, sizes } of pngs) {
      const png = readPublic(src);
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(sizes);
      expect([2, 6]).toContain(png[25]);
    }
  });
});
