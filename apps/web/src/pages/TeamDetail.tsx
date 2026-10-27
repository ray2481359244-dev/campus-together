import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TeamDetailDTO } from '@campus/contracts';
import { api, ApiError, messageOf } from '../lib/api';
import { useAuth } from '../lib/auth';
import { beijingTime, teamStatusLabel } from '../lib/recruitments';
import { ErrorState, FormError, Loading, LoginGate, PageTitle } from '../components/UI';

type Selection = { kind: 'LEAVE' | 'REMOVE' | 'CLOSE' | 'TRANSFER' | 'START' | 'COMPLETE' | 'CANCEL'; revision: number; memberId?: string; memberRevision?: number; nickname?: string };
const labels = { LEAVE: '退出队伍', REMOVE: '移除成员', CLOSE: '关闭招募', TRANSFER: '转交队长', START: '开始活动', COMPLETE: '结束活动', CANCEL: '取消活动' };
const explanations = { LEAVE: '退出会释放岗位名额并收回队内查看权限，本版本不能重新加入同一队伍。', REMOVE: '成员将失去队内权限，岗位名额释放，本版本不能重新加入同一队伍。', CLOSE: '停止接收申请和批准入队，未处理申请失效并收到通知；保留现有队伍，本版本不能重新开放。', TRANSFER: '接任者将获得审核和队伍管理权限，你转为普通成员。双方岗位不变，现有成员会收到通知。', START: '确认由现有成员开始活动，未满员也可开始；停止招人，未处理申请失效并通知。', COMPLETE: '确认本次活动已结束。队伍信息转为只读，成员不能再退出、被移除或转交队长，终态不能重开。', CANCEL: '确认取消本次活动。未处理申请失效并通知，现有成员仍能只读查看队伍，终态不能重开。' };
export function TeamDetail() {
  const { id } = useParams(), { user, loading } = useAuth(), client = useQueryClient(), navigate = useNavigate();
  const [selected, setSelected] = useState<Selection | null>(null), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(false), [blocked, setBlocked] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const heading = useRef<HTMLHeadingElement>(null), pending = useRef<{ path: string; body: { revision: number; reason?: string; kind?: string; targetMemberId?: string; targetRevision?: number } } | null>(null);
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
    const management = ['TRANSFER', 'START', 'COMPLETE', 'CANCEL'].includes(selected.kind);
    pending.current ??= { path: '/teams/' + id + (management ? '/actions' : selected.kind === 'LEAVE' ? '/leave' : selected.kind === 'REMOVE' ? '/members/' + selected.memberId + '/remove' : '/close-recruitment'), body: { revision: selected.revision, ...(selected.kind === 'LEAVE' ? {} : { reason: reason.trim() }), ...(management ? { kind: selected.kind } : {}), ...(selected.kind === 'TRANSFER' ? { targetMemberId: selected.memberId, targetRevision: selected.memberRevision } : {}) } };
    setBusy(true); setError(''); setNotice('');
    try {
      await api(pending.current.path, { method: 'POST', body: pending.current.body });
      const kind = selected.kind;
      pending.current = null; setUncertain(false); setSelected(null);
      await invalidate();
      if (kind === 'LEAVE') { client.removeQueries({ queryKey: ['team', id] }); navigate('/teams', { replace: true, state: { notice: '已退出队伍，名额已释放，队内查看权限已收回。本版本不能重新加入同一队伍。' } }); }
      else { setNotice(kind === 'REMOVE' ? '成员已移除，名额已释放，结果通知已保存。' : kind === 'CLOSE' ? '招募已关闭，未处理申请已失效并保存结果通知；现有队伍和成员继续保留。' : labels[kind] + '已保存，权限与结果通知已同步，请以当前队伍状态为准。'); await result.refetch(); }
    } catch (e) {
      setError(messageOf(e));
      if (e instanceof ApiError && ['MEMBERSHIP_CHANGED', 'RECRUITMENT_CHANGED', 'TEAM_CHANGED', 'CAPTAIN_CANNOT_LEAVE', 'TEAM_NOT_EDITABLE', 'INVALID_INPUT', 'NOT_FOUND'].includes(e.code)) { pending.current = null; setUncertain(false); setBlocked(true); }
      else setUncertain(true);
    } finally { setBusy(false); }
  }
  if (loading) return <Loading label="正在核对队伍账号……" />;
  if (!user) return <LoginGate next={'/teams/' + id} />;
  if (result.isPending) return <Loading label="正在读取队伍……" />;
  if (result.isError) return <section><Link className="text-button" to="/teams">返回我的队伍</Link><ErrorState message={messageOf(result.error)} retry={() => void refresh()} /></section>;
  const team = result.data.data, locked = busy || !!pending.current;
  const reasonLabel = selected?.kind === 'REMOVE' ? '移除原因' : selected?.kind === 'CLOSE' ? '关闭说明' : '操作说明';
  const reasonRequired = selected && ['REMOVE', 'START', 'COMPLETE', 'CANCEL'].includes(selected.kind);
  return <section className="form-page" aria-label="队伍详情"><Link className="text-button" to="/teams">返回我的队伍</Link><PageTitle title={team.title} eyebrow="YOUR TEAM / MAKE IT HAPPEN" /><article className="paper"><div className="review-toolbar"><h2>当前 {team.memberCount} / {team.capacity} 人</h2><button className="text-button" disabled={busy || result.isFetching} onClick={() => void refresh()}>刷新并核对队伍</button></div><p>我的身份：{team.myMembership.role === 'CAPTAIN' ? '队长' : '成员'} · 岗位：{team.myMembership.slotName}</p><p className="form-note">队内成员信息仅当前有效成员可见。学校和技能均为自述。</p>
    <p className="stage-explanation">{teamStatusLabel(team.status)}{['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(team.status) ? ' · 队伍信息只读' : ''}</p>
    {team.startedAt && <p className="field-note">开始于 {beijingTime(team.startedAt)}（北京时间）</p>}{team.completedAt && <p className="field-note">结束于 {beijingTime(team.completedAt)}（北京时间）</p>}{team.cancelledAt && <p className="field-note">取消于 {beijingTime(team.cancelledAt)}（北京时间）</p>}
    {team.archiveUntil && <p className="field-note">群聊只读归档至 {beijingTime(team.archiveUntil)}（北京时间），之后聊天正文和公告隐藏并清理。</p>}
    {team.closedAt && <p className="stage-explanation">招募已关闭（{beijingTime(team.closedAt)}，北京时间），现有队伍和成员继续保留。</p>}
    {notice && <p className="success-notice" role="status">{notice}</p>}
    {selected && <form className="confirm-box form-stack" aria-label="确认队伍操作" onSubmit={event => { event.preventDefault(); void submit(); }}><h3 ref={heading} tabIndex={-1}>确认{labels[selected.kind]}？</h3>{selected.nickname && <p>所选成员：{selected.nickname}</p>}<p>{explanations[selected.kind]}</p>
      {selected.kind !== 'LEAVE' && <label>{reasonLabel}<textarea aria-label={reasonLabel} required={!!reasonRequired} maxLength={500} rows={3} value={reason} disabled={locked || blocked} onChange={event => setReason(event.target.value)} placeholder={(reasonRequired ? '必填' : '可选') + '，最多 500 字；结果接收者可见。'} /></label>}
      <FormError>{error}</FormError>{uncertain && <p className="form-note" role="status">操作结果尚未确认，原决定已保留。请重试核对原操作，或刷新查看当前状态。</p>}{blocked && <p className="form-note">状态或版本已有变化，请先刷新核对，再选择操作。</p>}
      <div className="button-row"><button className="button" disabled={busy || blocked || (!pending.current && !!reasonRequired && !reason.trim())} type="submit">{busy ? '正在核对……' : uncertain ? '核对并重试操作' : '确认' + labels[selected.kind]}</button><button className="text-button" type="button" disabled={locked} onClick={() => { setSelected(null); setError(''); }}>先保留</button></div>
    </form>}
    <div className="team-members" aria-label="当前有效成员">{team.members.map(member => <article className="team-member" aria-label={'队伍成员：' + member.nickname} key={member.id}><div className="review-card-heading"><h3>{member.nickname}{member.userId === user.id ? '（我）' : ''}</h3><span className="topic-badge cat-COMPETITION">{member.role === 'CAPTAIN' ? '队长' : '成员'}</span></div><p>{member.slotName} · {member.schoolName}（自述）</p><p className="form-note">自述技能：{member.skills.join('、') || '未填写'}</p><p className="field-note">加入于 {beijingTime(member.joinedAt)}（北京时间）</p>{member.canRemove && <button className="text-button danger" disabled={locked} onClick={() => select({ kind: 'REMOVE', memberId: member.id, nickname: member.nickname, revision: member.revision })}>移除成员</button>}{member.canTransfer && <button className="text-button" disabled={locked} onClick={() => select({ kind: 'TRANSFER', memberId: member.id, memberRevision: member.revision, nickname: member.nickname, revision: team.revision })}>转交队长</button>}</article>)}</div>
    <div className="button-row"><Link className="button" to={'/teams/' + team.id + '/chat'}>进入队伍群聊 →</Link><Link className="button secondary" to={'/recruitments/' + team.recruitmentId}>查看招募与申请 →</Link>{team.canLeave && <button className="text-button danger" disabled={locked} onClick={() => select({ kind: 'LEAVE', revision: team.myMembership.revision })}>退出队伍</button>}{team.canClose && <button className="text-button danger" disabled={locked} onClick={() => select({ kind: 'CLOSE', revision: team.recruitmentRevision })}>关闭招募</button>}</div>
    <div className="button-row">{(['START', 'COMPLETE', 'CANCEL'] as const).filter(kind => kind === 'START' ? team.canStart : kind === 'COMPLETE' ? team.canComplete : team.canCancel).map(kind => <button key={kind} className="text-button" disabled={locked} onClick={() => select({ kind, revision: team.revision })}>{labels[kind]}</button>)}</div>
    {team.myMembership.role === 'CAPTAIN' && team.canCancel && <p className="field-note">队长须先转交身份才能退出。开始至少需要两名有效成员，结束或取消后不能重开。</p>}
    </article></section>;
}
