import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { withIdentityChrome } from './identity-chrome.mjs';

const resources = '../reals-app/app/src/main/res';
const foreground = await readFile(`${resources}/mipmap-xxxhdpi/ic_launcher_foreground.webp`);
const backgroundXml = await readFile(`${resources}/values/ic_launcher_background.xml`, 'utf8');
const background = backgroundXml.match(/name="ic_launcher_background">(#\p{ASCII_Hex_Digit}{6})</u)?.[1];
if (!background) throw Error('Android adaptive icon background color is missing');

const favicons = [
  { path: 'favicon-16.png', size: 16, crop: 240, circular: true },
  { path: 'favicon-32.png', size: 32, crop: 240, circular: true },
];
const visible = 288; // Android masks the central 72 dp of the 108 dp, 4x foreground.
const icons = [
  ...favicons,
  { path: 'apple-touch-icon.png', size: 180, crop: visible },
  { path: 'icons/icon-192.png', size: 192, crop: visible },
  { path: 'icons/icon-512.png', size: 512, crop: visible },
  // Six extra source pixels keep the entire ring and ornaments inside the
  // web maskable safe circle (40% of the canvas). The extra pixels are cream.
  { path: 'icons/icon-maskable-512.png', size: 512, crop: 294 },
];
const specs = process.argv.includes('--favicons-only') ? favicons : icons;
const source = `data:image/webp;base64,${foreground.toString('base64')}`;
await mkdir('public/icons', { recursive: true });

await withIdentityChrome(async ({ evaluate }) => {
  const rendered = await evaluate(`(async () => {
    const image = new Image();
    image.src = ${JSON.stringify(source)};
    await image.decode();
    if (image.naturalWidth !== 432 || image.naturalHeight !== 432) {
      throw Error('Review the crop for the new Android foreground dimensions');
    }
    return ${JSON.stringify(specs)}.map(({ path, size, crop, circular = false }) => {
      // Crop at native resolution before resampling so the filter cannot pick
      // up the transparent adaptive-layer margin outside the visible artwork.
      const sourceCrop = document.createElement('canvas');
      sourceCrop.width = sourceCrop.height = crop;
      const sourceContext = sourceCrop.getContext('2d', { alpha: false });
      sourceContext.fillStyle = ${JSON.stringify(background)};
      sourceContext.fillRect(0, 0, crop, crop);
      const inset = (image.width - crop) / 2;
      sourceContext.drawImage(image, inset, inset, crop, crop, 0, 0, crop, crop);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d', { alpha: circular });
      context.imageSmoothingQuality = 'high';
      if (circular) {
        context.beginPath();
        context.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
        context.clip();
      }
      context.drawImage(sourceCrop, 0, 0, size, size);
      return { path, png: canvas.toDataURL('image/png').split(',')[1] };
    });
  })()`);
  const pngs = new Map();
  for (const { path, png } of rendered) {
    const bytes = Buffer.from(png, 'base64');
    pngs.set(path, bytes);
    await writeFile(`public/${path}`, bytes);
    console.log(path, bytes.length, 'bytes');
  }

  // ICO embeds the same two PNGs so fallback branding stays consistent.
  const header = Buffer.alloc(6 + favicons.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(favicons.length, 4);
  let offset = header.length;
  const frames = favicons.map(({ path, size }, index) => {
    const png = pngs.get(path);
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
    return png;
  });
  await writeFile('public/favicon.ico', Buffer.concat([header, ...frames]));
});
console.log('Android foreground SHA-256', createHash('sha256').update(foreground).digest('hex'));
