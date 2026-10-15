import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';
const positions = new Map<string, number>();
export const rememberScroll = (key: string) => positions.set(key, window.scrollY);
export function ScrollRestoration() {
  const location = useLocation(), kind = useNavigationType(), previous = useRef(location.pathname);
  useLayoutEffect(() => {
    const pathnameChanged = previous.current !== location.pathname;
    previous.current = location.pathname;
    const top = positions.get(location.key);
    if (kind === 'POP' && top !== undefined) {
      const frame = requestAnimationFrame(() => window.scrollTo({ top, behavior: 'instant' }));
      return () => cancelAnimationFrame(frame);
    }
    if (pathnameChanged) window.scrollTo({ top: 0, behavior: 'instant' });
  }, [location.key, location.pathname, kind]);
  return null;
}
