import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { withIdentityChrome } from './identity-chrome.mjs';

const base = process.argv.find(arg => arg.startsWith('--url='))?.slice(6) ?? 'http://127.0.0.1:5175';
const visible = process.argv.includes('--visible');
const scale = Number(process.argv.find(arg => arg.startsWith('--scale='))?.slice(8) ?? 1);
const versioned = path => path + '?v=2';
const tabs = [16, 32].map(size => ({ path: versioned(`/favicon-${size}.png`), size }));
const apple = { path: versioned('/apple-touch-icon.png'), size: 180 };
const pwa = [
  { path: versioned('/icons/icon-192.png'), size: 192, purpose: 'any' },
  { path: versioned('/icons/icon-512.png'), size: 512, purpose: 'any' },
  { path: versioned('/icons/icon-maskable-512.png'), size: 512, purpose: 'maskable' },
];
const pngs = [...tabs, apple, ...pwa];
for (const { path, size } of pngs) {
  const response = await fetch(base + path);
  assert.equal(response.status, 200, path);
  assert.match(response.headers.get('content-type'), /^image\/png/);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(bytes.readUInt32BE(16), size);
  assert.equal(bytes.readUInt32BE(20), size);
  assert.ok([2, 6].includes(bytes[25]), 'Icon must use full color PNG');
}
const icoPath = versioned('/favicon.ico');
const icoResponse = await fetch(base + icoPath);
assert.equal(icoResponse.status, 200);
assert.match(icoResponse.headers.get('content-type'), /^image\/(?:x-icon|vnd.microsoft.icon)/);
const ico = Buffer.from(await icoResponse.arrayBuffer());
assert.equal(ico.readUInt16LE(2), 1);
assert.equal(ico.readUInt16LE(4), 2);
for (const [index, { size }] of tabs.entries()) {
  const entry = 6 + index * 16;
  assert.equal(ico[entry], size);
  const offset = ico.readUInt32LE(entry + 12), length = ico.readUInt32LE(entry + 8);
  assert.deepEqual(ico.subarray(offset, offset + length), await readFile(`public/favicon-${size}.png`));
}
const manifestPath = '/manifest.webmanifest';
const response = await fetch(base + manifestPath);
assert.equal(response.status, 200);
assert.match(response.headers.get('content-type'), /^application\/manifest\+json/);
const manifest = await response.json();
assert.equal(manifest.name, 'Reals');
assert.equal(manifest.short_name, 'Reals');
assert.equal(manifest.display, 'standalone');
for (const field of ['id', 'scope', 'start_url']) assert.equal(manifest[field], '/');
assert.equal(manifest.theme_color, '#f7f2e8');
assert.equal(manifest.background_color, '#f7f2e8');
assert.deepEqual(manifest.icons, pwa.map(({ path, size, purpose }) => ({
  src: path, sizes: size + 'x' + size, type: 'image/png', purpose,
})));

const foreground = process.argv.includes('--android-reference') ?
  (await readFile('../reals-app/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.webp')).toString('base64') : null;
await mkdir('artifacts/identity', { recursive: true });
await withIdentityChrome(async ({ call, evaluate }) => {
  await call('Page.enable');
  await call('Page.navigate', { url: base });
  for (let i = 0; i < 100; i++) {
    try { if (await evaluate("document.title === 'Reals'")) break; }
    catch (error) {
      if (!/Inspected target navigated|Execution context was destroyed|Cannot find context/.test(error.message)) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(await evaluate('document.title'), 'Reals');
  const links = await evaluate(`[...document.querySelectorAll('link[rel=icon], link[rel=apple-touch-icon], link[rel=manifest]')].map(node => node.getAttribute('href'))`);
  assert.deepEqual(links, [icoPath, ...tabs.map(tab => tab.path), apple.path, manifestPath]);
  for (const [scheme, color] of [['light', '#f7f2e8'], ['dark', '#08111f']]) {
    await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    assert.equal(await evaluate("[...document.querySelectorAll('meta[name=theme-color]')].find(node => matchMedia(node.media).matches)?.content"), color);
  }
  const app = await call('Page.getAppManifest');
  assert.equal(app.url, base + manifestPath);
  assert.deepEqual(app.errors, []);
  assert.deepEqual(JSON.parse(app.data), manifest);

  const { board, report } = await evaluate(`(async () => {
    const specs = ${JSON.stringify(pngs)};
    async function load(src) {
      const image = new Image();
      image.src = src;
      await image.decode();
      return image;
    }
    const images = await Promise.all(specs.map(spec => load(spec.path)));
    const report = specs.map(({ path, size }, index) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const x = canvas.getContext('2d');
      x.drawImage(images[index], 0, 0);
      const pixels = x.getImageData(0, 0, size, size).data;
      const at = (col, row) => (row * size + col) * 4;
      const colors = new Set(), ringSectors = Array(8).fill(0);
      let minAlpha = 255, maxAlpha = 0, radius = 0, coverage = 0;
      for (let y = 0; y < size; y++) for (let col = 0; col < size; col++) {
        const pixel = at(col, y);
        const [r, g, b, a] = pixels.subarray(pixel, pixel + 4);
        if (a === 255) colors.add((r * 256 + g) * 256 + b);
        minAlpha = Math.min(minAlpha, a);
        maxAlpha = Math.max(maxAlpha, a);
        if (a > 128) coverage++;
        if (a <= 128 || r >= 210 || g >= 190 || b >= 170) continue;
        const dx = col + .5 - size / 2, dy = y + .5 - size / 2, distance = Math.hypot(dx, dy);
        radius = Math.max(radius, distance);
        if (distance > .78 * size / 2 && distance < size / 2) {
          ringSectors[Math.floor((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 4))]++;
        }
      }
      return {
        path, size, alpha: [minAlpha, maxAlpha], radius, colors: colors.size, ringSectors,
        coverage: coverage / size ** 2,
        corner: [...pixels.subarray(0, 4)],
        corners: [0, size - 1, size * (size - 1), size ** 2 - 1].map(index => pixels[4 * index + 3]),
      };
    });

    const canvas = document.createElement('canvas');
    canvas.width = 920;
    canvas.height = 540;
    const x = canvas.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.font = '15px sans-serif';
    for (const [row, color] of ['#f7f2e8', '#08111f'].entries()) {
      x.fillStyle = color;
      x.fillRect(0, row * 42, 920, 42);
      x.fillStyle = row ? '#fff' : '#08111f';
      x.fillText(row ? 'Dark tab' : 'Light tab', 16, row * 42 + 25);
      x.drawImage(images[0], 120, row * 42 + 13);
      x.drawImage(images[1], 170, row * 42 + 5);
    }
    x.fillStyle = '#ddd';
    x.fillRect(0, 84, 920, 456);
    const tile = (label, col, row, draw, mask) => {
      const left = col * 230 + 15, top = row * 220 + 116, size = 182;
      x.fillStyle = '#08111f';
      x.fillText(label, left, top - 8);
      x.save();
      if (mask) {
        x.beginPath();
        if (mask === 'circle') x.arc(left + size / 2, top + size / 2, size / 2, 0, Math.PI * 2);
        else x.roundRect(left, top, size, size, 37);
        x.clip();
      }
      draw(left, top, size);
      x.restore();
    };
    const reference = ${JSON.stringify(foreground)};
    if (reference) {
      const native = await load('data:image/webp;base64,' + reference);
      tile('Android adaptive reference', 0, 0, (left, top, size) => {
        x.fillStyle = '#F1EAE3';
        x.fillRect(left, top, size, size);
        x.drawImage(native, 72, 72, 288, 288, left, top, size, size);
      }, 'circle');
    }
    const draw = index => (left, top, size) => x.drawImage(images[index], left, top, size, size);
    tile('PWA 192, circle preview', 1, 0, draw(3), 'circle');
    tile('PWA 512, circle preview', 2, 0, draw(4), 'circle');
    tile('Maskable, circle preview', 3, 0, draw(5), 'circle');
    tile('Apple Touch preview', 1, 1, draw(2), 'rounded');
    tile('Maskable, rounded preview', 2, 1, draw(5), 'rounded');
    tile('Maskable, full canvas', 3, 1, draw(5));
    return { board: canvas.toDataURL('image/png').split(',')[1], report };
  })()`);
  for (const icon of report) {
    assert.ok(icon.ringSectors.every(count => count > 0), 'Retain the ring across all eight sectors');
    if (icon.path.includes('favicon')) {
      assert.deepEqual(icon.alpha, [0, 255]);
      assert.deepEqual(icon.corners, [0, 0, 0, 0]);
      assert.ok(icon.coverage > .65 && icon.coverage < .9);
    } else {
      assert.deepEqual(icon.alpha, [255, 255]);
      assert.ok(icon.colors > 1000, 'Preserve source color detail without quantization');
      const [red, green, blue] = icon.corner;
      assert.ok(red >= 242 && red <= 248 && green >= 228 && green <= 233 && blue >= 212 && blue <= 219,
        `Preserve the foreground cream tone from the launcher (${icon.path}: ${icon.corner})`);
    }
    if (icon.path.includes('maskable')) assert.ok(icon.radius < icon.size * .4, JSON.stringify(icon));
  }
  const { installabilityErrors } = await call('Page.getInstallabilityErrors');
  console.log(JSON.stringify({ base, scale, manifest: 'PASS', report, installabilityErrors }));
  await writeFile(`artifacts/identity/review-${scale}x.png`, Buffer.from(board, 'base64'));
  if (visible) {
    console.log('Native Chrome ready for tab inspection (60 seconds)');
    await new Promise(resolve => setTimeout(resolve, 60000));
  }
}, { visible, scale });
