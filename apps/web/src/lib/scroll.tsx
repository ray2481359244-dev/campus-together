import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
const positions = new Map<string, number>();
const cards = new Map<string, string>();
function scrollHost() {
  return document.querySelector<HTMLElement>('[data-page-scroll]') || document.getElementById('main-content');
}
export function rememberScroll(key: string, postId?: string) {
  positions.set(key, scrollHost()?.scrollTop ?? window.scrollY);
  if (postId) cards.set(key, postId);
  if (positions.size > 100) { const oldest = positions.keys().next().value!; positions.delete(oldest); cards.delete(oldest); }
}
export function ScrollRestoration() {
  const location = useLocation(), kind = useNavigationType(), previous = useRef(location.pathname);
  useLayoutEffect(() => {
    const pathnameChanged = previous.current !== location.pathname;
    previous.current = location.pathname;
    const top = positions.get(location.key);
    if (kind === 'POP' && top !== undefined) {
      const frame = requestAnimationFrame(() => {
        const host = scrollHost();
        if (host) host.scrollTo({ top, behavior: 'instant' });
        else window.scrollTo({ top, behavior: 'instant' });
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
