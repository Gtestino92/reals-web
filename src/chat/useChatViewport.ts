import { useCallback, useLayoutEffect, type RefObject } from 'react';

export function useChatDraftHeight(input: RefObject<HTMLTextAreaElement | null>, draft: string) {
  const resize = useCallback(() => {
    const field = input.current;
    if (!field || field.clientWidth === 0) return;
    const border = field.offsetHeight - field.clientHeight;
    field.style.height = 'auto';
    field.style.height = `${field.scrollHeight + border}px`;
  }, [input]);
  useLayoutEffect(resize, [draft, resize]);
  const attach = useCallback((field: HTMLTextAreaElement | null) => {
    input.current = field;
    resize();
  }, [input, resize]);
  return { attach, resize };
}

export function useChatViewport(
  root: RefObject<HTMLElement | null>,
  timeline: RefObject<HTMLOListElement | null>,
  following: RefObject<boolean>,
  observedHeight: RefObject<number>,
  readable: boolean,
  resizeInput: () => void,
) {
  useLayoutEffect(() => {
    const chat = root.current;
    if (!chat) return;
    const viewport = window.visualViewport;
    const list = timeline.current;
    let frame: number | undefined;
    let width: number | undefined;
    let lastHeight: number | undefined;
    let lastTop: number | undefined;
    const preserveReadingPosition = () => {
      if (!list) return;
      observedHeight.current = list.clientHeight;
      if (following.current) list.scrollTop = list.scrollHeight;
    };
    const sync = () => {
      frame = undefined;
      // Chrome can resize both viewports. Safari can resize and pan only
      // the visual viewport. Pinch zoom keeps native scrolling and zooming.
      const visual = viewport && viewport.scale === 1 && viewport.height > 0;
      const height = visual ? Math.floor(viewport.height) : window.innerHeight;
      const top = visual ? Math.max(0, viewport.offsetTop) : undefined;
      const sizeChanged = height !== lastHeight || (top === undefined) !== (lastTop === undefined);
      if (sizeChanged) {
        chat.style.setProperty('--chat-viewport', `${height}px`);
        chat.toggleAttribute('data-visual-viewport', visual === true);
        chat.toggleAttribute('data-compact-viewport', height <= 520);
        lastHeight = height;
      }
      if (top !== lastTop) {
        if (top === undefined) chat.style.removeProperty('--chat-viewport-top');
        else chat.style.setProperty('--chat-viewport-top', `${top}px`);
        lastTop = top;
      }
      if (width !== chat.clientWidth) {
        width = chat.clientWidth;
        resizeInput();
        preserveReadingPosition();
      } else if (sizeChanged) preserveReadingPosition();
    };
    const schedule = () => {
      if (frame === undefined) frame = window.requestAnimationFrame(sync);
    };
    sync();
    const observer = list && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(preserveReadingPosition) : null;
    if (list) observer?.observe(list);
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [root, timeline, following, observedHeight, readable, resizeInput]);
}
