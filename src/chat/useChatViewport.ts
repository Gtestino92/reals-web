import { useLayoutEffect, type RefObject } from 'react';

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
    let restingHeight = window.innerHeight;
    const preserveReadingPosition = () => {
      if (!list) return;
      observedHeight.current = list.clientHeight;
      if (following.current) list.scrollTop = list.scrollHeight;
    };
    const sync = () => {
      const composerFocused = chat.querySelector('.chat-composer')?.contains(document.activeElement);
      if (!composerFocused) restingHeight = window.innerHeight;
      // With interactive-widget=resizes-content the layout and visual heights
      // may shrink together, so also compare against the unfocused layout.
      const layoutShrank = !!composerFocused && window.innerHeight < restingHeight;
      if (viewport && viewport.scale === 1 && viewport.height > 0) {
        chat.style.setProperty('--chat-viewport', `${viewport.height}px`);
        chat.style.setProperty('--chat-viewport-top', `${viewport.offsetTop}px`);
        chat.dataset.visualViewport = '';
        chat.toggleAttribute('data-compact-viewport', viewport.height < window.innerHeight || layoutShrank);
      } else {
        delete chat.dataset.visualViewport;
        chat.toggleAttribute('data-compact-viewport', !viewport && layoutShrank);
        chat.style.removeProperty('--chat-viewport-top');
        if (viewport) chat.style.removeProperty('--chat-viewport');
        else chat.style.setProperty('--chat-viewport', `${window.innerHeight}px`);
      }
      resizeInput();
      preserveReadingPosition();
    };
    sync();
    const observer = list && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(preserveReadingPosition) : null;
    if (list) observer?.observe(list);
    viewport?.addEventListener('resize', sync);
    viewport?.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);
    chat.addEventListener('focusin', sync);
    chat.addEventListener('focusout', sync);
    return () => {
      observer?.disconnect();
      viewport?.removeEventListener('resize', sync);
      viewport?.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
      chat.removeEventListener('focusin', sync);
      chat.removeEventListener('focusout', sync);
    };
  }, [root, timeline, following, observedHeight, readable, resizeInput]);
}
