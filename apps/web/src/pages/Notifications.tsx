import {BellFeedback} from '../components/visual/BellFeedback';
import {useCloudArrival} from '../lib/cloud-arrival';
import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { NotificationDTO } from '@campus/contracts';
import { ThumbsUp } from 'lucide-react';
import { api, messageOf } from '../lib/api';
import { useAuth } from '../lib/auth';
import { beijingTime } from '../lib/recruitments';
import { ErrorState, FormError, Loading, LoginGate, PageTitle } from '../components/UI';
import { useNotifications } from '../lib/notifications';
import { messageLink } from '../lib/messaging';
import { rememberScroll } from '../lib/scroll';

const titles: Record<NotificationDTO['kind'], string> = { POST_COMMENT:'你的帖子有了新评论。', POST_REPLY:'有人回复了你的评论。', POST_LIKED:'你的帖子收到了点赞。', APPLICATION_SUBMITTED:'收到新的入队申请。', MEMBER_JOINED:'有成员直接加入队伍。', TOPIC_APPROVED:'主题申请已通过。', TOPIC_REJECTED:'主题申请未通过。', REPORT_RESOLVED:'举报已处理。', APPLICATION_APPROVED: '申请已通过，已加入队伍。', APPLICATION_REJECTED: '本次加入申请未通过。', MEMBER_LEFT: '你已退出这支队伍。', MEMBER_REMOVED: '你已被移出这支队伍。', RECRUITMENT_CLOSED: '招募已关闭，本次待审申请已失效。', CAPTAIN_TRANSFERRED: '队长已转交，请到队伍查看当前负责人。', TEAM_STARTED: '活动已开始，队伍停止招人。', TEAM_COMPLETED: '活动已结束，队伍信息转为只读。', TEAM_CANCELLED: '活动已取消，队伍信息转为只读。', APPLICATION_EXPIRED: '活动状态已变化，本次待审申请已失效。', TEAM_EXPIRED: '招募截止已到，队伍已自动到期。' };

export function Notifications({ embedded = false }: { embedded?: boolean } = {}) {
  const { user, loading } = useAuth(), client = useQueryClient(), location = useLocation();
  const [busy, setBusy] = useState(''), [error, setError] = useState('');
  const result = useNotifications(user?.id, embedded);
  const [bellPulses,setBellPulses]=useState<Record<string,number>>({});
  const items=(result.data?.pages.flatMap(page=>page.data.items)||[]).filter(row => !embedded || row.kind !== 'APPLICATION_SUBMITTED');
  const arrivals=useCloudArrival('notifications:'+user?.id,items,!!result.data);
  const follow = (row: NotificationDTO) => {
    rememberScroll(location.key);
    if (!row.readAt) void read(row.id);
  };
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
    try{await api('/community/'+postId+'/notifications',{method:'PUT',body:{muted}});client.setQueriesData({queryKey:['notifications']},(cache:typeof result.data)=>cache?{...cache,pages:cache.pages.map(page=>({...page,data:{...page.data,items:page.data.items.map(row=>row.postId===postId?{...row,notificationsMuted:muted}:row)}}))}:cache);setBellPulses(previous=>({...previous,[postId]:(previous[postId]||0)+1}));await refresh();}
    catch(e){setError(messageOf(e));}finally{setBusy('');}
  }
  if (loading) return <Loading label="正在核对消息账号……" />;
  if (!user) return <LoginGate next="/messages" />;
  // Rows are shared with the arrival controller.
  return <section aria-label="站内通知" className={embedded ? 'message-activity' : undefined}>{!embedded && <PageTitle title="站内通知" />}<FormError>{error}</FormError>
    {result.isPending ? <Loading label="正在读取通知……" /> : <>{result.isError && <ErrorState message={messageOf(result.error)} retry={() => void result.refetch()} />}{!items.length && !result.isError ? <div className="paper notification-empty"><h2>暂时没有新消息。</h2><p>有人评论、回复或点赞，以及队伍有新进展时，都会通知你。</p><Link className="text-button" to="/discover">去讨论板逛逛 →</Link></div> : <div ref={arrivals} className="notification-list">{items.map(row => <article data-cloud-id={row.id} className={'paper notification-card'+(row.postId?' post-notification':'')+(!row.readAt?' unread':'')} key={row.id} aria-label={(row.postTitle||row.recruitmentTitle)+(row.postId?'的帖子通知':'的队伍通知')}><div className="review-card-heading"><h2>{titles[row.kind]}</h2><span className={'topic-badge '+(row.postId?'cat-OUTDOOR':'cat-COMPETITION')}>{row.readAt?'已读':'未读'}</span></div><strong>{row.postTitle||row.recruitmentTitle}</strong>{row.kind==='POST_LIKED'&&row.postAvailable&&<p className="notification-likes"><ThumbsUp size={19} aria-hidden="true" />当前共 {row.likes} 个赞</p>}{row.slotName && row.slotName !== '成员' && <p>所选名额：{row.slotName}</p>}<p className="post-body">{row.reason||'队长未填写额外说明。'}</p><p className="field-note">{beijingTime(row.createdAt)}（北京时间）</p><div className="button-row">
      {row.postId? <>{row.postAvailable&&<><Link className="text-button" to={'/posts/'+row.postId+(row.commentId?'?comment='+row.commentId:'')} state={{ fromNotice: true }} onClick={()=>follow(row)}>{row.commentId?'查看评论并回复 →':'查看帖子 →'}</Link><button className="text-button" disabled={!!busy} onClick={()=>void mute(row.postId!,!row.notificationsMuted)}><BellFeedback muted={!!row.notificationsMuted} pulse={bellPulses[row.postId!]||0} size={15}/>{row.notificationsMuted?'开启本帖提醒':'关闭本帖提醒'}</button></>}</> : <>
        {row.chatAvailable && row.teamId && <Link className="text-button" to={messageLink({kind:'TEAM',id:row.teamId})} state={{ returnNotice: true }} onClick={()=>follow(row)}>进入队伍群</Link>}
        {row.recruitmentId ? <Link className="text-button" to={'/recruitments/'+row.recruitmentId} state={{ fromNotice: true }} onClick={()=>follow(row)}>{row.applicationId?'查看招募与申请 →':'查看招募与当前状态 →'}</Link> : <Link className="text-button" to="/topic-requests" onClick={()=>follow(row)}>查看我的申请与举报 →</Link>}</>}
      {!row.readAt&&<button className="button secondary" disabled={!!busy} onClick={()=>void read(row.id)}>{busy===row.id?'正在保存……':'标为已读'}</button>}</div></article>)}</div>}{result.hasNextPage&&<button className="button secondary" disabled={result.isFetchingNextPage} onClick={()=>void result.fetchNextPage()}>查看更多通知</button>}</>}
  </section>;
}
