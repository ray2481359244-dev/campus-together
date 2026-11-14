import type { Location } from 'react-router-dom';
import { useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { rememberScroll } from './scroll';

export function useProfileLink(userId: string, postId: string, commentId?: string) {
  const { user } = useAuth(), location = useLocation();
  return {
    to: user?.id === userId ? '/me' : '/profiles/' + userId,
    state: { fromProfileLink: true, postId, commentId, origin: location },
    onClick: () => rememberScroll(location.key, undefined, document.getElementById('main-content')),
  };
}

export function postProfileSource(state: { postId?: string; commentId?: string } | null) {
  return state?.postId ? { kind: 'POST' as const, postId: state.postId, commentId: state.commentId } : undefined;
}

export function activePostLocation(location: Location): Location | undefined {
  const origin: Location | undefined = location.state?.origin;
  if (location.state?.fromProfileLink && origin && /^\/profiles\/[^/]+$|^\/me$/.test(location.pathname) && /^\/posts\/[^/]+$/.test(origin.pathname)) return origin;
}
