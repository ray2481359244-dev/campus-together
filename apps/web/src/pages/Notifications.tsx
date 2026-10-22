import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { NotificationsPageDTO } from '@campus/contracts';
import { api, messageOf } from '../lib/api';
import { useAuth } from '../lib/auth';
import { beijingTime } from '../lib/recruitments';
import { ErrorState, FormError, Loading, LoginGate, PageTitle } from '../components/UI';

export function Notifications() {
  const { user, loading } = useAuth(), client = useQueryClient();
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const queryKey = ['notifications', user?.id];
  const result = useInfiniteQuery({ queryKey, enabled: !!user, initialPageParam: '', retry: false, staleTime: 0,
    queryFn: ({ pageParam, signal }) => api<NotificationsPageDTO>('/me/notifications' + (pageParam ? '?cursor=' + pageParam : ''), { signal }),
    getNextPageParam: last => last.data.nextCursor || undefined });
  async function read(id: string) {
    if (busy) return;
    setBusy(id); setError('');
    try { await api('/me/notifications/' + id + '/read', { method: 'POST', body: {} }); await client.invalidateQueries({ queryKey }); }
    catch (e) { setError(messageOf(e)); }
    finally { setBusy(''); }
  }
  if (loading) return <Loading label="正在核对消息账号……" />;
  if (!user) return <LoginGate next="/messages" />;
  const items = result.data?.pages.flatMap(p => p.data.items) || [];
  return <section aria-label="站内通知"><PageTitle title="关于你的小队，有了新进展。" eyebrow="YOUR TEAM UPDATES." /><div className="review-toolbar"><h2>站内通知 · 未读 {result.data?.pages[0].data.unreadCount || 0}</h2><button className="text-button" disabled={result.isFetching || !!busy} onClick={() => void result.refetch()}>刷新通知</button></div><p className="form-note">这里保存岗位申请的审核结果。队内群聊后续开放；当前申请和成员身份可进入对应招募查看。</p><FormError>{error}</FormError>
    {result.isPending ? <Loading label="正在读取通知……" /> : <>{result.isError && <ErrorState message={messageOf(result.error)} retry={() => void result.refetch()} />}{!items.length && !result.isError ? <div className="paper notification-empty"><h2>暂时没有审核结果通知。</h2><p>队长处理你的申请后，结果会保存在这里。</p><Link className="text-button" to="/recruitments">看看竞赛招募 →</Link></div> : <div className="notification-list">{items.map(row => <article className={'paper notification-card' + (!row.readAt ? ' unread' : '')} key={row.id} aria-label={row.recruitmentTitle + '的审核通知'}><div className="review-card-heading"><h2>{row.kind === 'APPLICATION_APPROVED' ? '申请已通过，已加入队伍。' : '本次岗位申请未通过。'}</h2><span className="topic-badge cat-COMPETITION">{row.readAt ? '已读' : '未读'}</span></div><strong>{row.recruitmentTitle}</strong><p>申请岗位：{row.slotName}</p><p className="post-body">{row.reason || '队长未填写额外说明。'}</p><p className="field-note">{beijingTime(row.createdAt)}（北京时间）</p><div className="button-row"><Link className="text-button" to={'/recruitments/' + row.recruitmentId}>查看招募与申请 →</Link>{!row.readAt && <button className="button secondary" disabled={!!busy} onClick={() => void read(row.id)}>{busy === row.id ? '正在保存……' : '标为已读'}</button>}</div></article>)}</div>}{result.hasNextPage && <button className="button secondary" disabled={result.isFetchingNextPage} onClick={() => void result.fetchNextPage()}>查看更多通知</button>}</>}
  </section>;
}
