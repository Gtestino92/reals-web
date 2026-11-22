import { useLayoutEffect, type RefObject } from 'react';
import { useActivityNotificationContext } from './useActivityNotifications';

export function usePresentedActivity(ref: RefObject<HTMLElement | null>, id: string | null, inViewport = false) {
  const notifications = useActivityNotificationContext();
  const present = notifications?.enabled ? notifications.present : undefined;
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !id || !present) return;
    const visible = () => document.visibilityState === 'visible' && node.isConnected &&
      !node.closest('[hidden], [inert], [aria-hidden="true"]') && getComputedStyle(node).visibility !== 'hidden';
    let observer: IntersectionObserver | undefined;
    let live = true;
    const report = () => { if (live && visible()) present(id); };
    const checkPosition = () => {
      const rect = node.getBoundingClientRect();
      if (rect.width && rect.height && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth) report();
    };
    const assess = () => {
      observer?.disconnect();
      observer = undefined;
      if (!visible()) return;
      if (!inViewport) { report(); return; }
      if (typeof IntersectionObserver === 'undefined') { checkPosition(); return; }
      const current = new IntersectionObserver(entries => {
        if (observer === current && entries.some(entry => entry.isIntersecting && entry.intersectionRatio >= 0.5)) report();
      }, { threshold: 0.5 });
      observer = current;
      current.observe(node);
    };
    assess();
    document.addEventListener('visibilitychange', assess);
    window.addEventListener('pageshow', assess);
    const fallback = inViewport && typeof IntersectionObserver === 'undefined';
    if (fallback) {
      window.addEventListener('scroll', checkPosition, true);
      window.addEventListener('resize', checkPosition);
    }
    return () => {
      live = false;
      observer?.disconnect();
      document.removeEventListener('visibilitychange', assess);
      window.removeEventListener('pageshow', assess);
      if (fallback) {
        window.removeEventListener('scroll', checkPosition, true);
        window.removeEventListener('resize', checkPosition);
      }
    };
  }, [id, inViewport, present, ref]);
}
