import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TeamDetailDTO } from '@campus/contracts';
import { api, ApiError, messageOf } from '../lib/api';
import { useAuth } from '../lib/auth';
import { beijingTime } from '../lib/recruitments';
import { ErrorState, FormError, Loading, LoginGate, PageTitle } from '../components/UI';

type Selection = { kind: 'LEAVE' | 'REMOVE' | 'CLOSE'; revision: number; memberId?: string; nickname?: string };
export function TeamDetail() {
  const { id } = useParams(), { user, loading } = useAuth(), client = useQueryClient(), navigate = useNavigate();
  const [selected, setSelected] = useState<Selection | null>(null), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [blocked, setBlocked] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const heading = useRef<HTMLHeadingElement>(null), pending = useRef<{ path: string; body: { revision: number; reason?: string } } | null>(null);
  const result = useQuery({ queryKey: ['team', id, user?.id], queryFn: ({ signal }) => api<TeamDetailDTO>('/teams/' + id, { signal }), enabled: !!user && !busy && !uncertain, retry: false, staleTime: 0 });
  useEffect(() => { if (selected) heading.current?.focus(); }, [selected]);
  function select(value: Selection) { if (busy || pending.current) return; setSelected(value); setReason(''); setError(''); setNotice(''); setBlocked(false); }
  async function invalidate() {
    await Promise.all([client.invalidateQueries({ queryKey: ['my-teams'] }), client.invalidateQueries({ queryKey: ['recruitments'] }), client.invalidateQueries({ queryKey: ['recruitment'] }), client.invalidateQueries({ queryKey: ['my-recruitments'] }), client.invalidateQueries({ queryKey: ['my-applications'] }), client.invalidateQueries({ queryKey: ['notifications'] }), client.invalidateQueries({ queryKey: ['team-applications'] })]);
  }
  async function refresh() {
    if (busy) return;
    const fresh = await result.refetch();
    if (fresh.error instanceof ApiError && fresh.error.status === 404) { client.removeQueries({ queryKey: ['team', id] }); await invalidate(); navigate('/teams', { replace: true, state: { notice: '你当前已不是这支队伍的有效成员，队内内容已收起。具体结果可在消息中查看。' } }); }
    else if (!fresh.isError) { pending.current = null; setSelected(null); setUncertain(false); setBlocked(false); setError(''); await invalidate(); }
  }
  async function submit() {
    if (!selected || busy || blocked || result.isError) return;
    pending.current ??= { path: '/teams/' + id + (selected.kind === 'LEAVE' ? '/leave' : selected.kind === 'REMOVE' ? '/members/' + selected.memberId + '/remove' : '/close-recruitment'), body: { revision: selected.revision, ...(selected.kind === 'LEAVE' ? {} : { reason: reason.trim() }) } };
    setBusy(true); setError(''); setNotice('');
    try {
      await api(pending.current.path, { method: 'POST', body: pending.current.body });
      const kind = selected.kind;
      pending.current = null; setUncertain(false); setSelected(null);
      await invalidate();
      if (kind === 'LEAVE') { client.removeQueries({ queryKey: ['team', id] }); navigate('/teams', { replace: true, state: { notice: '已退出队伍，名额已释放，队内查看权限已收回。本版本不能重新加入同一队伍。' } }); }
      else { setNotice(kind === 'REMOVE' ? '成员已移除，名额已释放，结果通知已保存。' : '招募已关闭，未处理申请已失效并保存结果通知；现有队伍和成员继续保留。'); await result.refetch(); }
    } catch (e) {
      setError(messageOf(e));
      if (e instanceof ApiError && ['MEMBERSHIP_CHANGED', 'RECRUITMENT_CHANGED', 'CAPTAIN_CANNOT_LEAVE', 'TEAM_NOT_EDITABLE', 'INVALID_INPUT', 'NOT_FOUND'].includes(e.code)) { pending.current = null; setUncertain(false); setBlocked(true); }
      else setUncertain(true);
    } finally { setBusy(false); }
  }
  if (loading) return <Loading label="正在核对队伍账号……" />;
  if (!user) return <LoginGate next={'/teams/' + id} />;
  if (result.isPending) return <Loading label="正在读取队伍……" />;
  if (result.isError) return <section><Link className="text-button" to="/teams">返回我的队伍</Link><ErrorState message={messageOf(result.error)} retry={() => void refresh()} /></section>;
  const team = result.data.data, locked = busy || !!pending.current;
  return <section className="form-page" aria-label="队伍详情"><Link className="text-button" to="/teams">返回我的队伍</Link><PageTitle title={team.title} eyebrow="YOUR TEAM / MAKE IT HAPPEN" /><article className="paper"><div className="review-toolbar"><h2>当前 {team.memberCount} / {team.capacity} 人</h2><button className="text-button" disabled={busy || result.isFetching} onClick={() => void refresh()}>刷新并核对队伍</button></div><p>我的身份：{team.myMembership.role === 'CAPTAIN' ? '队长' : '成员'} · 岗位：{team.myMembership.slotName}</p><p className="form-note">队内成员信息仅当前有效成员可见。学校和技能均为自述。</p>
    {team.closedAt && <p className="stage-explanation">招募已关闭（{beijingTime(team.closedAt)}，北京时间），现有队伍和成员继续保留。</p>}
    {notice && <p className="success-notice" role="status">{notice}</p>}
    {selected && <form className="confirm-box form-stack" aria-label="确认队伍操作" onSubmit={event => { event.preventDefault(); void submit(); }}><h3 ref={heading} tabIndex={-1}>{selected.kind === 'LEAVE' ? '确认退出这支队伍？' : selected.kind === 'REMOVE' ? '确认移除这位成员？' : '确认关闭招募？'}</h3><p>{selected.kind === 'LEAVE' ? '退出会释放你的岗位名额并收回队内查看权限。本版本不能重新加入同一队伍。' : selected.kind === 'REMOVE' ? `${selected.nickname} 将不再是有效成员，岗位名额会释放；本版本不能再次加入同一队伍。` : '关闭后不再接收申请或批准入队，未处理申请将失效并收到通知。现有队伍和成员保留，本版本没有重新开放入口。'}</p>
      {selected.kind !== 'LEAVE' && <label>{selected.kind === 'REMOVE' ? '移除原因' : '关闭说明'}<textarea aria-label={selected.kind === 'REMOVE' ? '移除原因' : '关闭说明'} required={selected.kind === 'REMOVE'} maxLength={500} rows={3} value={reason} disabled={locked || blocked} onChange={event => setReason(event.target.value)} placeholder={selected.kind === 'REMOVE' ? '请填写原因，最多 500 字；被移除者可见。' : '可选，最多 500 字；待审申请者可见。'} /></label>}
      <FormError>{error}</FormError>{uncertain && <p className="form-note" role="status">操作结果尚未确认，原决定已保留。请重试核对原操作，或刷新查看当前状态。</p>}{blocked && <p className="form-note">状态或版本已有变化，请先刷新核对，再选择操作。</p>}
      <div className="button-row"><button className="button" disabled={busy || blocked || (!pending.current && selected.kind === 'REMOVE' && !reason.trim())} type="submit">{busy ? '正在核对……' : uncertain ? '核对并重试操作' : selected.kind === 'LEAVE' ? '确认退出队伍' : selected.kind === 'REMOVE' ? '确认移除成员' : '确认关闭招募'}</button><button className="text-button" type="button" disabled={locked} onClick={() => { setSelected(null); setError(''); }}>先保留</button></div>
    </form>}
    <div className="team-members" aria-label="当前有效成员">{team.members.map(member => <article className="team-member" aria-label={'队伍成员：' + member.nickname} key={member.id}><div className="review-card-heading"><h3>{member.nickname}{member.userId === user.id ? '（我）' : ''}</h3><span className="topic-badge cat-COMPETITION">{member.role === 'CAPTAIN' ? '队长' : '成员'}</span></div><p>{member.slotName} · {member.schoolName}（自述）</p><p className="form-note">自述技能：{member.skills.join('、') || '未填写'}</p><p className="field-note">加入于 {beijingTime(member.joinedAt)}（北京时间）</p>{member.canRemove && <button className="text-button danger" disabled={locked} onClick={() => select({ kind: 'REMOVE', memberId: member.id, nickname: member.nickname, revision: member.revision })}>移除成员</button>}</article>)}</div>
    <div className="button-row"><Link className="button secondary" to={'/recruitments/' + team.recruitmentId}>查看招募与申请 →</Link>{team.canLeave && <button className="text-button danger" disabled={locked} onClick={() => select({ kind: 'LEAVE', revision: team.myMembership.revision })}>退出队伍</button>}{team.canClose && <button className="text-button danger" disabled={locked} onClick={() => select({ kind: 'CLOSE', revision: team.recruitmentRevision })}>关闭招募</button>}</div>
    {team.myMembership.role === 'CAPTAIN' && <p className="field-note">队长不能直接退出。队长转交、取消 / 开始 / 结束队伍和群聊后续开放。</p>}
    </article></section>;
}
