import { useLayoutEffect, useRef } from 'react';

export function useTabIndicators(count: number | null) {
  const update = useRef<((count: number | null) => void) | null>(null);
  useLayoutEffect(() => {
    const originalTitle = document.title;
    const icons = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')].map(node => ({
      node, href: node.getAttribute('href'), type: node.getAttribute('type'),
    }));
    const source = icons.find(({ node, type }) => node.getAttribute('sizes') === '32x32' && type === 'image/png');
    const restore = () => {
      for (const { node, href, type } of icons) {
        if (href === null) node.removeAttribute('href'); else if (node.getAttribute('href') !== href) node.setAttribute('href', href);
        if (type === null) node.removeAttribute('type'); else if (node.getAttribute('type') !== type) node.setAttribute('type', type);
      }
    };
    let drawing: Promise<HTMLImageElement> | undefined;
    let displayed = '', generation = 0;
    update.current = count => {
      const title = count === null ? originalTitle : count ? `(${count}) Reals` : 'Reals';
      if (document.title !== title) document.title = title;
      const badge = count ? count > 9 ? '9+' : String(count) : '';
      if (badge === displayed) return;
      displayed = badge;
      const ticket = ++generation;
      if (!badge) { restore(); return; }
      if (!source) return;
      drawing ??= Promise.resolve().then(async () => {
        const image = new Image();
        image.src = source.href ?? '';
        await image.decode();
        return image;
      });
      void drawing.then(async image => {
        if (ticket !== generation) return;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 32;
        const context = canvas.getContext('2d');
        if (!context) return;
        context.drawImage(image, 0, 0, 32, 32);
        context.fillStyle = '#0f1f35';
        context.fillRect(badge === '9+' ? 12 : 16, 16, badge === '9+' ? 20 : 16, 16);
        context.fillStyle = '#fcf8ef';
        context.font = 'bold 13px sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(badge, badge === '9+' ? 22 : 24, 24);
        const url = canvas.toDataURL('image/png');
        if (!url.startsWith('data:image/png;')) return;
        const badgeImage = new Image();
        badgeImage.src = url;
        await badgeImage.decode();
        if (ticket === generation) for (const { node } of icons) { node.type = 'image/png'; node.href = url; }
      }).catch(() => {
        // Canvas, image decoding and favicon data URLs can be unavailable.
        if (ticket === generation) restore();
      });
    };
    return () => {
      generation++;
      update.current = null;
      document.title = originalTitle;
      restore();
    };
  }, []);
  useLayoutEffect(() => { update.current?.(count); }, [count]);
}
