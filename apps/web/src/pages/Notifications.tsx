import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { NotificationDTO } from '@campus/contracts';
import { BellOff, ThumbsUp } from 'lucide-react';
import { api, messageOf } from '../lib/api';
import { useAuth } from '../lib/auth';
import { beijingTime } from '../lib/recruitments';
import { ErrorState, FormError, Loading, LoginGate, PageTitle } from '../components/UI';
import { useNotifications } from '../lib/notifications';

const titles: Record<NotificationDTO['kind'], string> = { POST_COMMENT:'你的帖子有了新评论。', POST_REPLY:'有人回复了你的评论。', POST_LIKED:'你的帖子收到了点赞。', APPLICATION_SUBMITTED:'收到新的入队申请。', MEMBER_JOINED:'有成员直接加入队伍。', TOPIC_APPROVED:'主题申请已通过。', TOPIC_REJECTED:'主题申请未通过。', REPORT_RESOLVED:'举报已处理。', APPLICATION_APPROVED: '申请已通过，已加入队伍。', APPLICATION_REJECTED: '本次岗位申请未通过。', MEMBER_LEFT: '你已退出这支队伍。', MEMBER_REMOVED: '你已被移出这支队伍。', RECRUITMENT_CLOSED: '招募已关闭，本次待审申请已失效。', CAPTAIN_TRANSFERRED: '队长已转交，请到队伍查看当前负责人。', TEAM_STARTED: '活动已开始，队伍停止招人。', TEAM_COMPLETED: '活动已结束，队伍信息转为只读。', TEAM_CANCELLED: '活动已取消，队伍信息转为只读。', APPLICATION_EXPIRED: '活动状态已变化，本次待审申请已失效。', TEAM_EXPIRED: '招募截止已到，队伍已自动到期。' };

export function Notifications() {
  const { user, loading } = useAuth(), client = useQueryClient();
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const result = useNotifications(user?.id);
  async function refresh() { await Promise.all([client.invalidateQueries({queryKey:['notifications']}),client.invalidateQueries({queryKey:['notification-summary']}),client.invalidateQueries({queryKey:['community']})]); }
  async function read(id: string) {
    if (busy) return;
    setBusy(id); setError('');
    try { await api('/me/notifications/' + id + '/read', { method: 'POST', body: {} }); await refresh(); }
    catch (e) { setError(messageOf(e)); }
    finally { setBusy(''); }
  }
  async function mute(postId:string,muted:boolean) {
    if(busy)return;setBusy(postId);setError('');
    try{await api('/community/'+postId+'/notifications',{method:'PUT',body:{muted}});await refresh();}
    catch(e){setError(messageOf(e));}finally{setBusy('');}
  }
  if (loading) return <Loading label="正在核对消息账号……" />;
  if (!user) return <LoginGate next="/messages" />;
  const items = result.data?.pages.flatMap(p => p.data.items) || [];
  return <section aria-label="站内通知"><PageTitle title="有人回应，也有新的进展。" eyebrow="YOUR MESSAGES & UPDATES." /><div className="review-toolbar"><h2>站内通知 · 未读 {result.data?.pages[0].data.unreadCount || 0}</h2><button className="text-button" disabled={result.isFetching || !!busy} onClick={() => void result.refetch()}>刷新通知</button></div><p className="form-note">评论、回复、点赞和队伍进展都会在这里提醒。可单独关闭某篇帖子的提醒；队内群聊从“我的队伍”进入。</p><FormError>{error}</FormError>
    {result.isPending ? <Loading label="正在读取通知……" /> : <>{result.isError && <ErrorState message={messageOf(result.error)} retry={() => void result.refetch()} />}{!items.length && !result.isError ? <div className="paper notification-empty"><h2>暂时没有新消息。</h2><p>有人评论、回复或点赞，以及队伍有新进展时，都会通知你。</p><Link className="text-button" to="/discover">去讨论板逛逛 →</Link></div> : <div className="notification-list">{items.map(row => <article className={'paper notification-card'+(row.postId?' post-notification':'')+(!row.readAt?' unread':'')} key={row.id} aria-label={(row.postTitle||row.recruitmentTitle)+(row.postId?'的帖子通知':'的队伍通知')}><div className="review-card-heading"><h2>{titles[row.kind]}</h2><span className={'topic-badge '+(row.postId?'cat-OUTDOOR':'cat-COMPETITION')}>{row.readAt?'已读':'未读'}</span></div><strong>{row.postTitle||row.recruitmentTitle}</strong>{row.kind==='POST_LIKED'&&row.postAvailable&&<p className="notification-likes"><ThumbsUp size={19} aria-hidden="true" />当前共 {row.likes} 个赞</p>}{row.slotName&&<p>相关岗位：{row.slotName}</p>}<p className="post-body">{row.reason||'队长未填写额外说明。'}</p><p className="field-note">{beijingTime(row.createdAt)}（北京时间）</p><div className="button-row">
      {row.postId? <>{row.postAvailable&&<><Link className="text-button" to={'/posts/'+row.postId+(row.commentId?'?comment='+row.commentId:'')} onClick={()=>{if(!row.readAt)void read(row.id);}}>{row.commentId?'查看评论并回复 →':'查看帖子 →'}</Link><button className="text-button" disabled={!!busy} onClick={()=>void mute(row.postId!,!row.notificationsMuted)}><BellOff size={15} aria-hidden="true" />{row.notificationsMuted?'开启本帖提醒':'关闭本帖提醒'}</button></>}</> : <>{['CAPTAIN_TRANSFERRED','TEAM_STARTED','TEAM_COMPLETED','TEAM_CANCELLED'].includes(row.kind)&&<Link className="text-button" to={'/teams/'+row.teamId}>查看队伍 →</Link>}{row.recruitmentId?<Link className="text-button" to={'/recruitments/'+row.recruitmentId}>{row.applicationId?'查看招募与申请 →':'查看招募与当前状态 →'}</Link>:<Link className="text-button" to="/topic-requests">查看我的申请与举报 →</Link>}</>}
      {!row.readAt&&<button className="button secondary" disabled={!!busy} onClick={()=>void read(row.id)}>{busy===row.id?'正在保存……':'标为已读'}</button>}</div></article>)}</div>}{result.hasNextPage&&<button className="button secondary" disabled={result.isFetchingNextPage} onClick={()=>void result.fetchNextPage()}>查看更多通知</button>}</>}
  </section>;
}
