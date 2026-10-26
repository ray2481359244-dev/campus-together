import { Link, useLocation } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import type { MyTeamsPageDTO } from '@campus/contracts';
import { api, messageOf } from '../lib/api';
import { useAuth } from '../lib/auth';
import { ErrorState, Loading, LoginGate, PageTitle } from '../components/UI';

export function MyTeams() {
  const { user, loading } = useAuth(), location = useLocation();
  const result = useInfiniteQuery({ queryKey: ['my-teams', user?.id], enabled: !!user, initialPageParam: '', retry: false, staleTime: 0,
    queryFn: ({ pageParam, signal }) => api<MyTeamsPageDTO>('/me/teams' + (pageParam ? '?cursor=' + pageParam : ''), { signal }), getNextPageParam: last => last.data.nextCursor || undefined });
  if (loading) return <Loading label="正在核对队伍账号……" />;
  if (!user) return <LoginGate next="/teams" />;
  const items = result.data?.pages.flatMap(page => page.data.items) || [];
  return <section aria-label="我的队伍"><PageTitle title="一起做的事，在这里继续。" eyebrow="YOUR TEAMS / KEEP BUILDING" /><div className="review-toolbar"><p className="form-note">这里只显示你当前仍是有效成员的队伍，不受浏览学校筛选影响。</p><button className="text-button" disabled={result.isFetching} onClick={() => void result.refetch()}>刷新我的队伍</button></div>
    {typeof location.state?.notice === 'string' && <p className="success-notice" role="status">{location.state.notice}</p>}
    {result.isPending ? <Loading label="正在读取我的队伍……" /> : result.isError ? <ErrorState message={messageOf(result.error)} retry={() => void result.refetch()} /> : !items.length ? <div className="paper notification-empty"><h2>还没有当前有效的队伍。</h2><p>申请获批或自己发布招募后，队伍会出现在这里。退出或被移除的结果可在消息中查看。</p><Link className="button" to="/recruitments">看看竞赛招募 →</Link></div> : <div className="team-grid">{items.map(team => <Link className="post-card" to={'/teams/' + team.id} key={team.id}><div className="post-card-top"><span className="topic-badge cat-COMPETITION">{team.myMembership.role === 'CAPTAIN' ? '我是队长' : '我是成员'}</span><span className="metadata">{team.closedAt ? '招募已关闭' : team.acceptingStatus === 'FULL' ? '当前已满' : team.acceptingStatus === 'OPEN' ? '招募中' : '招募已停止'}</span></div><h2>{team.title}</h2><p>我的岗位：{team.myMembership.slotName}</p><div className="post-card-footer"><span>{team.memberCount} / {team.capacity} 人（含队长）</span><span>查看队伍 →</span></div></Link>)}</div>}
    {result.hasNextPage && <button className="button secondary" disabled={result.isFetchingNextPage} onClick={() => void result.fetchNextPage()}>查看更多队伍</button>}
  </section>;
}
