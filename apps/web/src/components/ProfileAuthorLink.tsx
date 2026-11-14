import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useProfileLink } from '../lib/profile-link';

export function ProfileAuthorLink({ userId, nickname, postId, commentId, children }: {
  userId: string; nickname: string; postId: string; commentId?: string; children: ReactNode;
}) {
  const link = useProfileLink(userId, postId, commentId);
  return <Link {...link} className="comment-person profile-author-link" aria-label={'查看 ' + nickname + ' 的主页'}>{children}</Link>;
}
