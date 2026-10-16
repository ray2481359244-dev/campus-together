import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RecruitmentDTO, TopicDTO } from '@campus/contracts';
import { ArrowUpRight, Clock3, Plus, Users, FileText } from 'lucide-react';
import { api, messageOf } from '../lib/api';
import { beijingTime } from '../lib/recruitments';
import { useAuth } from '../lib/auth';
import { useSchool } from '../components/Layout';
import { PageTitle, Loading, ErrorState, EmptyState, FormError } from '../components/UI';

export function RecruitmentCard({ value }: { value: RecruitmentDTO }) {
  return <Link className="post-card recruitment-card" to={'/recruitments/' + value.id}><div className="post-card-top"><span className="topic-badge cat-COMPETITION">{value.topic?.name || '竞赛招募'}</span><span className="metadata">{value.team?.acceptingStatus === 'CLOSED' ? '招募时间已截止' : '公开招募'}</span></div><h3>{value.title}</h3><p className="post-excerpt">{value.draft.competitionName} · {value.draft.direction}</p><div className="recruitment-meta"><span><Users size={16} />{value.team?.memberCount || 0} / {value.draft.capacity} 人（含队长）</span><span><Clock3 size={16} />{value.draft.mode === 'ONLINE' ? '线上协作' : value.draft.locationPublic}</span></div><p className="field-note">截止 {beijingTime(value.draft.joinDeadline || value.draft.startAt)}（北京时间）</p><div className="post-card-footer"><span>{value.author.nickname} · 岗位与时间已说明</span><ArrowUpRight size={20} /></div></Link>;
}
function MyDrafts() {
  const { user } = useAuth(), client = useQueryClient();
  const [remove, setRemove] = useState<RecruitmentDTO | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const mine = useQuery({ queryKey: ['my-recruitments', user?.id], queryFn: () => api<RecruitmentDTO[]>('/me/recruitments'), enabled: !!user });
  if (!user) return null;
  const drafts = mine.data?.data.filter(r => r.publicationStatus === 'DRAFT') || [];
  return <section className="my-drafts" aria-label="我的招募草稿"><details><summary><FileText size={18} />我的私有草稿 {drafts.length ? `(${drafts.length})` : ''}</summary>{mine.isPending ? <Loading label="正在读取私有草稿……" /> : mine.isError ? <ErrorState message={messageOf(mine.error)} retry={() => void mine.refetch()} /> : drafts.length === 0 ? <p className="form-note">暂无草稿。保存后可在这里继续填写，别人看不到。</p> : <div className="draft-list">{drafts.map(r => <div className="draft-row" key={r.id}><Link to={'/recruitments/' + r.id + '/edit'}><strong>{r.title || '未命名竞赛草稿'}</strong><span>更新于 {beijingTime(r.updatedAt)}</span></Link><button className="text-button danger" onClick={() => { setRemove(r); setError(''); }}>删除草稿</button></div>)}</div>}<p className="field-note">显示最近 50 条招募中的私有草稿；草稿不建队、不占位。</p></details>{remove && <div className="confirm-box"><h3>删除这份私有草稿？</h3><p>仅删除草稿，不影响已发布的讨论。删除后不能恢复。</p><div className="button-row"><button className="button secondary" disabled={busy} onClick={() => setRemove(null)}>先保留</button><button className="button danger-button" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await api('/recruitments/' + remove.id, { method: 'DELETE', body: { revision: remove.revision } }); await client.invalidateQueries({ queryKey: ['my-recruitments'] }); client.removeQueries({ queryKey: ['recruitment', remove.id] }); setRemove(null); } catch (e) { setError(messageOf(e)); } finally { setBusy(false); } }}>确认删除草稿</button></div><FormError>{error}</FormError></div>}</section>;
}
export function Recruitments() {
  const { schoolId } = useSchool();
  const [topic, setTopic] = useState(''), [text, setText] = useState(''), [q, setQ] = useState('');
  const topics = useQuery({ queryKey: ['topics', 'COMPETITION'], queryFn: () => api<TopicDTO[]>('/topics?category=COMPETITION') });
  const results = useInfiniteQuery({ queryKey: ['recruitments', schoolId, topic, q], enabled: !!schoolId, initialPageParam: '',
    queryFn: ({ pageParam, signal }) => api<RecruitmentDTO[]>('/recruitments?' + new URLSearchParams({ schoolId, ...(topic ? { topicId: topic } : {}), ...(q ? { q } : {}), ...(pageParam ? { cursor: pageParam } : {}) }), { signal }),
    getNextPageParam: last => last.meta?.nextCursor || undefined,
  });
  return <section><PageTitle title="把想法，变成一支队伍。" eyebrow="COMPETITION / FIRST TEAM" /><div className="recruitment-intro"><p>竞赛招募的草稿、发布与岗位展示已开放。申请审核、入队和群聊将在后续阶段接入。</p><Link className="button" to="/recruitments/new"><Plus size={18} />发起竞赛招募</Link></div><MyDrafts /><div className="section-heading"><h2>竞赛招募大厅</h2><span className="serial">BUILD SOMETHING TOGETHER</span></div><p className="form-note">当前先开放竞赛区。游戏、学习、户外的场景招募表单尚未开放。</p><div className="filter-row"><label className="topic-picker">竞赛主题<select aria-label="筛选招募主题" value={topic} onChange={e => setTopic(e.target.value)} disabled={!topics.data}><option value="">全部主题</option>{topics.data?.data.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><form className="search-form" onSubmit={e => { e.preventDefault(); setQ(text.trim()); }}><input aria-label="搜索招募" value={text} onChange={e => setText(e.target.value)} maxLength={100} placeholder="搜索比赛或项目" /><button type="submit" aria-label="提交招募搜索"><ArrowUpRight size={18} /></button></form></div>{topics.isError && <ErrorState message="主题读取失败" retry={() => void topics.refetch()} />}{!schoolId || results.isPending ? <Loading label="正在读取竞赛招募……" /> : results.isError ? <ErrorState message={messageOf(results.error)} retry={() => void results.refetch()} /> : !results.data.pages[0].data.length ? <EmptyState title={q ? '没有找到相关招募' : '第一支队伍，等你发起'}><p>先明确想做什么、需要哪些岗位，再把招募发布出来。</p><Link className="button" to="/recruitments/new">写一份招募<ArrowUpRight size={17} /></Link></EmptyState> : <div className="recruitment-grid">{results.data.pages.flatMap(p => p.data).map(r => <RecruitmentCard key={r.id} value={r} />)}{results.hasNextPage && <button className="button secondary" disabled={results.isFetchingNextPage} onClick={() => void results.fetchNextPage()}>查看更多招募</button>}</div>}</section>;
}
