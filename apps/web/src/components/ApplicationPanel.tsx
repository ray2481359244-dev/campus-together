import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApplicationDTO, ApplicationInput, EligibilityDTO, RecruitmentDTO } from '@campus/contracts';
import { api, ApiError, messageOf } from '../lib/api';
import { useAuth } from '../lib/auth';
import { beijingTime } from '../lib/recruitments';
import { ErrorState, FormError, Loading, LoginGate } from './UI';
import { CaptainApplications } from './CaptainApplications';

const labels: Record<ApplicationDTO['status'], string> = { PENDING: '待审核', APPROVED: '已批准', REJECTED: '已拒绝', WITHDRAWN: '已撤回', EXPIRED: '已失效' };
const conditionLabels = { PASS: '通过', FAIL: '不符合', UNKNOWN: '待补充' };
export function MyApplications() {
  const { user } = useAuth();
  const result = useQuery({ queryKey: ['my-applications', user?.id], queryFn: ({ signal }) => api<ApplicationDTO[]>('/me/applications', { signal }), enabled: !!user, retry: false });
  if (!user) return null;
  return <section className="my-drafts" aria-label="我的岗位申请列表"><details><summary>我的岗位申请{result.data?.data.length ? ` (${result.data.data.length})` : ''}</summary>
    {result.isPending ? <Loading label="正在读取我的申请……" /> : result.isError ? <ErrorState message={messageOf(result.error)} retry={() => void result.refetch()} /> : !result.data.data.length ? <p className="form-note">还没有岗位申请。打开招募详情，先核对条件再申请。</p> : <div className="draft-list">{result.data.data.map(row => <Link className="draft-row" key={row.id} to={'/recruitments/' + row.recruitmentId}><span><strong>{row.recruitmentTitle}</strong><span>{row.slotName} · {labels[row.status]}</span></span><span>查看申请 →</span></Link>)}</div>}
    <p className="field-note">显示最近 50 份本人申请。待审核不占名额；队长批准后正式入队，结果也会保存在消息页。</p>
  </details></section>;
}
export function ApplicationPanel({ recruitment: r }: { recruitment: RecruitmentDTO }) {
  const { user, loading } = useAuth(), client = useQueryClient();
  const team = r.team!;
  const [slotId, setSlotId] = useState(''), [time, setTime] = useState(''), [message, setMessage] = useState('');
  const [assessment, setAssessment] = useState<EligibilityDTO | null>(null), [busy, setBusy] = useState<'check' | 'submit' | 'withdraw' | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState<{ text: string; revision: number; status: ApplicationDTO['status'] } | null>(null), [uncertain, setUncertain] = useState(false), [blocked, setBlocked] = useState(false);
  const pending = useRef<ApplicationInput | null>(null), withdrawal = useRef<{ id: string; revision: number } | null>(null);
  const ownKey = ['my-applications', user?.id, team.id];
  const own = useQuery({ queryKey: ownKey, queryFn: ({ signal }) => api<ApplicationDTO[]>('/me/applications?teamId=' + team.id, { signal }), enabled: !!user && user.id !== team.captainUserId, retry: false });
  const current = own.data?.data[0];
  async function remember(row: ApplicationDTO) {
    await client.cancelQueries({ queryKey: ['my-applications', user?.id] });
    client.setQueryData(ownKey, { data: [row] });
    await client.invalidateQueries({ queryKey: ['my-applications', user?.id] });
  }
  async function refresh() {
    const result = await own.refetch();
    if (!result.isError) { pending.current = null; withdrawal.current = null; setBlocked(false); setUncertain(false); setAssessment(null); setError(''); setNotice(null); await client.invalidateQueries({ queryKey: ['recruitment', r.id] }); }
  }
  async function assess() {
    if (busy || pending.current || withdrawal.current) return;
    setBusy('check'); setError(''); setNotice(null);
    try { setAssessment((await api<EligibilityDTO>('/recruitments/' + r.id + '/eligibility', { method: 'POST', body: { slotId: slotId || null, timeConfirmed: time === '' ? null : time === 'yes' } })).data); }
    catch (e) { setError(messageOf(e)); setAssessment(null); }
    finally { setBusy(null); }
  }
  async function submit() {
    if (busy || blocked || (!pending.current && assessment?.status !== 'PASS')) return;
    pending.current ??= { requestKey: crypto.randomUUID(), slotId, timeConfirmed: time === 'yes', message: message.trim() };
    setBusy('submit'); setError(''); setNotice(null);
    try {
      const row = (await api<ApplicationDTO>('/teams/' + team.id + '/applications', { method: 'POST', body: pending.current })).data;
      pending.current = null; setUncertain(false); setAssessment(null);
      await remember(row);
      setNotice({ revision: row.revision, status: row.status, text: row.status === 'PENDING' ? '申请已保存，等待队长审核，当前不占名额。' : '已核对原申请，当前状态为' + labels[row.status] + '，没有重新提交。' });
    } catch (e) {
      setError(messageOf(e));
      const definitive = e instanceof ApiError && ((e.status === 400 && e.code === 'INVALID_INPUT') || (e.status === 422 && e.code === 'ELIGIBILITY_NOT_PASSED') || (e.status === 404 && e.code === 'NOT_FOUND') || ['APPLICATION_COOLDOWN', 'APPLICATION_LIMIT', 'APPLICATION_EXISTS', 'REQUEST_KEY_CONFLICT', 'APPLICATION_SUPERSEDED', 'APPLICATION_NOT_OPEN'].includes(e.code));
      if (definitive) {
        pending.current = null; setUncertain(false); setAssessment(null);
        setBlocked(e instanceof ApiError && ['APPLICATION_EXISTS', 'REQUEST_KEY_CONFLICT', 'APPLICATION_SUPERSEDED', 'NOT_FOUND'].includes(e.code));
        void own.refetch();
      } else setUncertain(true);
    } finally { setBusy(null); }
  }
  async function withdraw() {
    if (busy || blocked || (!withdrawal.current && !current?.canWithdraw)) return;
    withdrawal.current ??= { id: current!.id, revision: current!.revision };
    const attempt = withdrawal.current;
    setBusy('withdraw'); setError(''); setNotice(null);
    try {
      const row = (await api<ApplicationDTO>('/applications/' + attempt.id + '/withdraw', { method: 'POST', body: { revision: attempt.revision } })).data;
      withdrawal.current = null; await remember(row); setNotice({ revision: row.revision, status: row.status, text: '申请已撤回，10 分钟后可重新申请。' });
    } catch (e) {
      setError(messageOf(e));
      if (e instanceof ApiError && ['APPLICATION_CHANGED', 'NOT_FOUND'].includes(e.code)) { withdrawal.current = null; setBlocked(true); void own.refetch(); }
    } finally { setBusy(null); }
  }
  if (loading) return <Loading label="正在核对申请账号……" />;
  if (!user) return <section className="application-panel"><LoginGate next={'/recruitments/' + r.id} /></section>;
  if (user.id === team.captainUserId) return <CaptainApplications recruitment={r} />;
  if (own.isPending) return <Loading label="正在读取我的申请……" />;
  if (own.isError && !own.data) return <ErrorState message={messageOf(own.error)} retry={() => void own.refetch()} />;
  const cooldown = !!current?.reapplyAt && Date.parse(current.reapplyAt) > Date.now();
  const existing = !!current && ['PENDING', 'APPROVED'].includes(current.status);
  const locked = !!busy || !!pending.current || !!withdrawal.current || blocked || existing || cooldown || team.acceptingStatus !== 'OPEN' || own.isError;
  return <section className="application-panel" aria-label="我的岗位申请"><h2>申请这个岗位。</h2>
    <p className="form-note">申请和时间确认是本次意向，待审核不占名额。队长批准后正式入队，审核结果会保存在消息页。</p>
    {own.isError && <ErrorState message={messageOf(own.error)} retry={() => void own.refetch()} />}
    {current && <div className="application-current" aria-label="已保存申请"><strong>申请状态：{labels[current.status]}</strong><p>{current.slotName} · 提交于 {beijingTime(current.submittedAt)}（北京时间）</p><p className="post-body">{current.message || '未填写申请说明'}</p>
      {current.status === 'PENDING' && <p>等待队长审核，当前不占名额。</p>}
      {current.membership?.status === 'ACTIVE' && <p className="success-notice" role="status">已入队 · 当前有效成员 · {current.membership.slotName} · 加入于 {beijingTime(current.membership.joinedAt)}（北京时间）</p>}
      {current.membership?.status === 'ACTIVE' && <Link className="button secondary" to={'/teams/' + team.id}>进入我的队伍 →</Link>}
      {current.membership?.status === 'LEFT' && <p className="stage-explanation">当前已退出队伍，队内查看权限已收回。本版本不能重新加入同一队伍。</p>}
      {current.membership?.status === 'REMOVED' && <p className="stage-explanation">当前已被移除，队内查看权限已收回。本版本不能再次加入同一队伍。</p>}
      {current.review && <div className="review-result"><p>队长于 {beijingTime(current.review.reviewedAt)}（北京时间）{current.review.decision === 'APPROVE' ? '批准了本次申请。' : '拒绝了本次申请。'}</p><p>{current.review.reason || '队长未填写额外说明。'}</p>{current.review.eligibilitySnapshot && <p>批准时条件复查：{conditionLabels[current.review.eligibilitySnapshot.status]}</p>}<Link className="text-button" to="/messages">查看结果通知 →</Link></div>}
      {cooldown && <p>撤回 / 拒绝后需等待 10 分钟，可在 {beijingTime(current.reapplyAt)}（北京时间）后刷新核对。</p>}
      {(current.canWithdraw || withdrawal.current) && <button className="button secondary" disabled={!!busy || blocked || own.isError} onClick={() => void withdraw()}>{withdrawal.current ? '重试撤回申请' : '撤回申请'}</button>}
    </div>}
    <button className="text-button" disabled={!!busy || own.isFetching} onClick={() => void refresh()}>刷新并核对申请</button>
    {notice && current?.revision === notice.revision && current.status === notice.status && <p className="success-notice" role="status">{notice.text}</p>}
    <FormError>{error}</FormError>
    {uncertain && <p className="form-note" role="status">提交结果尚未确认，本次输入已保留并锁定。再次提交会核对同一请求；刷新或关闭前也可先查看我的申请。</p>}
    {withdrawal.current && error && <p className="form-note">撤回结果尚未确认，重试仍操作原版本，不会撤回后续的新申请。</p>}
    {(!existing || uncertain) && <form className="form-stack" onSubmit={e => { e.preventDefault(); void submit(); }}>
      <fieldset className="application-fields" disabled={locked}>
        <label>申请岗位<select aria-label="申请岗位" value={slotId} onChange={e => { setSlotId(e.target.value); setAssessment(null); }}><option value="">请选择岗位</option>{team.slots.map(s => <option value={s.id} key={s.id}>{s.name}（余 {Math.max(0, s.capacity - s.occupied)} 人）</option>)}</select></label>
        <label>本次时间确认<select aria-label="本次时间确认" value={time} onChange={e => { setTime(e.target.value); setAssessment(null); }}><option value="">阅读上方起止、每周投入和时段后选择</option><option value="yes">我本次可以安排所列时间与投入</option><option value="no">我本次无法安排所列时间</option></select></label>
        <label>申请说明<textarea aria-label="申请说明" value={message} maxLength={1000} rows={4} onChange={e => setMessage(e.target.value)} placeholder="说明你希望承担的工作，可选，最多 1000 字。" /></label>
        <button className="button secondary" type="button" onClick={() => void assess()}>核对申请条件</button>
      </fieldset>
      {assessment && <div className="condition-report" aria-label="申请条件对照"><h3>核对结果：{conditionLabels[assessment.status]}</h3><ul>{assessment.checks.map(c => <li key={c.code} data-status={c.status}><strong>{conditionLabels[c.status]} · {c.label}</strong><p>{c.reason}</p></li>)}</ul><p className="field-note">这是当前规则与自述资料的对照，提交时服务端会再次检查，不显示总匹配分数。</p><Link className="text-button" to="/me">补充我的真实资料 →</Link></div>}
      {team.acceptingStatus !== 'OPEN' && <p className="form-note">当前招募已满或已停止，不能提交新申请。</p>}
      <button className="button" type="submit" disabled={!!busy || blocked || own.isError || (!uncertain && (locked || assessment?.status !== 'PASS'))}>{uncertain ? '核对并重试申请' : busy === 'submit' ? '正在提交……' : '提交岗位申请'}</button>
    </form>}
  </section>;
}
