import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
const positions = new Map<string, { top: number; main: boolean }>();
const cards = new Map<string, string>();
function scrollHost() {
  return document.querySelector<HTMLElement>('[data-page-scroll]') || document.getElementById('main-content');
}
export function rememberScroll(key: string, postId?: string, main?: HTMLElement | null) {
  positions.set(key, { top: main?.scrollTop ?? scrollHost()?.scrollTop ?? window.scrollY, main: !!main });
  if (postId) cards.set(key, postId);
  if (positions.size > 100) { const oldest = positions.keys().next().value!; positions.delete(oldest); cards.delete(oldest); }
}
export function ScrollRestoration() {
  const location = useLocation(), kind = useNavigationType(), previous = useRef(location.pathname);
  useLayoutEffect(() => {
    const pathnameChanged = previous.current !== location.pathname;
    previous.current = location.pathname;
    const position = positions.get(location.key);
    if (kind === 'POP' && position) {
      const frame = requestAnimationFrame(() => {
        const host = position.main ? document.getElementById('main-content') : scrollHost();
        if (host) host.scrollTo({ top: position.top, behavior: 'instant' });
        else window.scrollTo({ top: position.top, behavior: 'instant' });
        const id = cards.get(location.key);
        if (id) document.querySelector<HTMLElement>(`.post-card[data-post-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
      });
      return () => cancelAnimationFrame(frame);
    }
    if (pathnameChanged && !location.state?.backgroundLocation) {
      scrollHost()?.scrollTo({ top: 0, behavior: 'instant' });
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [location.key, location.pathname, kind]);
  return null;
}
