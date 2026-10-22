import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { CaptainApplicationDTO, CaptainApplicationsPageDTO, RecruitmentDTO, ReviewApplicationInput } from '@campus/contracts';
import { api, ApiError, messageOf } from '../lib/api';
import { useAuth } from '../lib/auth';
import { beijingTime } from '../lib/recruitments';
import { ErrorState, FormError, Loading } from './UI';

const statusLabels = { PENDING: '待审核', APPROVED: '已批准', REJECTED: '已拒绝', WITHDRAWN: '已撤回', EXPIRED: '已失效' };
const conditionLabels = { PASS: '通过', FAIL: '不符合', UNKNOWN: '待补充' };
export function CaptainApplications({ recruitment: r }: { recruitment: RecruitmentDTO }) {
  const { user } = useAuth(), client = useQueryClient(), teamId = r.team!.id;
  const [filter, setFilter] = useState<'PENDING' | 'ALL'>('PENDING');
  const [selected, setSelected] = useState<{ row: CaptainApplicationDTO; decision: ReviewApplicationInput['decision'] } | null>(null);
  const [reason, setReason] = useState(''), [busy, setBusy] = useState(false), [blocked, setBlocked] = useState(false);
  const [uncertain, setUncertain] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [evidence, setEvidence] = useState<string[]>([]);
  const pending = useRef<ReviewApplicationInput | null>(null), heading = useRef<HTMLHeadingElement>(null);
  const queryKey = ['team-applications', user?.id, teamId];
  const result = useInfiniteQuery({ queryKey: [...queryKey, filter], enabled: user?.id === r.team!.captainUserId, initialPageParam: '', retry: false,
    queryFn: ({ pageParam, signal }) => api<CaptainApplicationsPageDTO>('/teams/' + teamId + '/applications?' + new URLSearchParams({ status: filter, ...(pageParam ? { cursor: pageParam } : {}) }), { signal }),
    getNextPageParam: last => last.data.nextCursor || undefined });
  useEffect(() => { if (selected) heading.current?.focus(); }, [selected]);
  function select(row: CaptainApplicationDTO, decision: ReviewApplicationInput['decision']) {
    if (busy || pending.current) return;
    setSelected({ row, decision }); setReason(''); setBlocked(false); setError(''); setNotice(''); setEvidence([]);
  }
  async function refresh() {
    if (busy) return;
    const response = await result.refetch();
    if (!response.isError) { pending.current = null; setSelected(null); setUncertain(false); setBlocked(false); setError(''); setEvidence([]); await client.invalidateQueries({ queryKey: ['recruitment', r.id] }); }
  }
  async function review() {
    if (!selected || busy || blocked || result.isError) return;
    pending.current ??= { revision: selected.row.revision, decision: selected.decision, reason: reason.trim() };
    setBusy(true); setError(''); setEvidence([]); setNotice('');
    try {
      const saved = (await api<CaptainApplicationDTO>('/applications/' + selected.row.id + '/review', { method: 'POST', body: pending.current })).data;
      pending.current = null; setUncertain(false); setSelected(null);
      setNotice(saved.status === 'APPROVED' ? '已批准入队，成员与岗位人数已更新，结果通知已保存。' : '已拒绝申请，结果通知已保存。');
      await Promise.all([client.invalidateQueries({ queryKey }), client.invalidateQueries({ queryKey: ['recruitment', r.id] }), client.invalidateQueries({ queryKey: ['recruitments'] }), client.invalidateQueries({ queryKey: ['my-recruitments'] })]);
    } catch (e) {
      setError(messageOf(e)); setEvidence(e instanceof ApiError ? [...new Set(Object.values(e.fields || {}).flat())] : []);
      if (e instanceof ApiError && ['APPLICATION_CHANGED', 'ELIGIBILITY_NOT_PASSED', 'NOT_FOUND', 'INVALID_INPUT'].includes(e.code)) { pending.current = null; setUncertain(false); setBlocked(true); }
      else setUncertain(true);
    } finally { setBusy(false); }
  }
  if (result.isPending) return <Loading label="正在读取本队申请……" />;
  if (result.isError && !result.data) return <ErrorState message={messageOf(result.error)} retry={() => void result.refetch()} />;
  const items = result.data?.pages.flatMap(p => p.data.items) || [], locked = busy || !!pending.current;
  return <section className="application-panel" aria-label="队长申请管理"><h2>处理岗位申请。</h2><p className="form-note">仅本队队长可查看申请说明。待审核不占名额；批准时会重新核对资料、时间与岗位余量。</p>
    <div className="review-toolbar"><div className="button-row"><button className="button secondary" aria-pressed={filter === 'PENDING'} disabled={locked} onClick={() => setFilter('PENDING')}>待审核（{result.data?.pages[0].data.pendingCount || 0}）</button><button className="button secondary" aria-pressed={filter === 'ALL'} disabled={locked} onClick={() => setFilter('ALL')}>全部申请</button></div><button className="text-button" disabled={busy || result.isFetching} onClick={() => void refresh()}>刷新并核对申请</button></div>
    {result.isError && <ErrorState message={messageOf(result.error)} retry={() => void refresh()} />}
    {notice && <p className="success-notice" role="status">{notice}</p>}
    {selected && <form className="confirm-box form-stack" aria-label="确认审核申请" onSubmit={event => { event.preventDefault(); void review(); }}><h3 ref={heading} tabIndex={-1}>{selected.decision === 'APPROVE' ? '确认批准这份申请？' : '确认拒绝这份申请？'}</h3><p>{selected.row.applicant.nickname} · {selected.row.slotName}。{selected.decision === 'APPROVE' ? '通过后将成为有效成员并占用一个岗位名额。' : '拒绝后申请者需等待 10 分钟才能重新申请。'}</p><label>给申请者的说明<textarea aria-label="审核说明" maxLength={500} rows={3} value={reason} disabled={locked || blocked} onChange={event => setReason(event.target.value)} placeholder="可选，最多 500 字；申请者可见。" /></label>
      <FormError>{error}</FormError>{evidence.length > 0 && <ul className="review-evidence" aria-label="本次审核未通过的条件">{evidence.map(text => <li key={text}>{text}</li>)}</ul>}
      {uncertain && <p className="form-note" role="status">审核结果尚未确认，本次决定与说明已锁定。请重试核对原操作，或刷新查看已保存结果。</p>}
      {blocked && <p className="form-note">当前资料、名额或申请状态已有变化，请先刷新核对，再选择要处理的申请。</p>}
      <div className="button-row"><button className="button" type="submit" disabled={busy || blocked || result.isError}>{busy ? '正在核对……' : uncertain ? '核对并重试审核' : selected.decision === 'APPROVE' ? '确认批准入队' : '确认拒绝申请'}</button><button className="text-button" type="button" disabled={locked} onClick={() => { setSelected(null); setError(''); setEvidence([]); }}>返回申请列表</button></div>
    </form>}
    {!items.length ? <p className="form-note">{filter === 'PENDING' ? '当前没有可审核的待处理申请。' : '本队还没有申请记录。'}</p> : <div className="review-list">{items.map(row => <article className="review-card" key={row.id} aria-label={'岗位申请：' + row.applicant.nickname}><div className="review-card-heading"><h3>{row.applicant.nickname}</h3><strong>{statusLabels[row.status]}</strong></div><p>{row.slotName} · {row.applicant.schoolName}（自述）</p><p className="form-note">当前自述技能：{row.applicant.skills.join('、') || '未填写'}{!row.applicant.accountActive && ' · 账号当前不可申请'}</p><p className="post-body">{row.message || '未填写申请说明'}</p><p className="field-note">提交于 {beijingTime(row.submittedAt)}（北京时间）· 第 {row.submission} 次申请</p>
      <details className="review-conditions"><summary>查看提交时的条件依据</summary><ul>{row.eligibilitySnapshot.checks.map(check => <li key={check.code}><strong>{conditionLabels[check.status]} · {check.label}</strong><p>{check.reason}</p></li>)}</ul><p className="field-note">这里保留提交时的依据；批准时重新核对当前情况。</p></details>
      {row.review && <p className="review-result">{row.review.decision === 'APPROVE' ? '已批准入队' : '已拒绝'} · {beijingTime(row.review.reviewedAt)}（北京时间）{row.review.reason && ' · ' + row.review.reason}</p>}
      {row.canReview && <div className="button-row"><button className="button" disabled={locked || result.isError} onClick={() => select(row, 'APPROVE')}>批准入队</button><button className="button secondary" disabled={locked || result.isError} onClick={() => select(row, 'REJECT')}>拒绝申请</button></div>}
    </article>)}</div>}
    {result.hasNextPage && <button className="button secondary" disabled={locked || result.isFetchingNextPage} onClick={() => void result.fetchNextPage()}>查看更多申请</button>}
  </section>;
}
