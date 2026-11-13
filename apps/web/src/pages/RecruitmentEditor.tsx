import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { categories, PublishableRecruitmentSchema, RecruitmentDraftSchema } from '@campus/contracts';
import type { RecruitmentDTO, RecruitmentDraft, TopicDTO, PostDTO } from '@campus/contracts';
import { ArrowUpRight, Save } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { emptyRecruitment, splitSkills, beijingTime, budgetLabel, scheduleLabel, recruitmentError } from '../lib/recruitments';
import { useAuth } from '../lib/auth';
import { PageTitle, Loading, LoginGate, ErrorState, FormError } from '../components/UI';

import { DraftAssistant } from '../components/DraftAssistant';
import { RecruitmentFields } from '../components/RecruitmentFields';

export function RecruitmentEditor() {
  const { id } = useParams(), [params] = useSearchParams(), sourceId = !id ? params.get('sourcePost') : null;
  const { user, loading, error: authError, reload } = useAuth(), navigate = useNavigate(), location = useLocation(), client = useQueryClient();
  const [draft, setDraft] = useState(() => {
    const category = categories.find(c => c === params.get('category'));
    return { ...emptyRecruitment(category), topicId: params.get('topicId') };
  });
  const [skills, setSkills] = useState(''), [slotSkills, setSlotSkills] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<RecruitmentDraft | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [hydrated, setHydrated] = useState('');
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const saved = useRef<RecruitmentDTO | null>(null), createAttempt = useRef<{ key: string; draft: RecruitmentDraft } | null>(null), prefilled = useRef(false);
  const publishAttempt = useRef<{ id: string; revision: number } | null>(null);
  const record = useQuery({ queryKey: ['recruitment', id, user?.id], queryFn: () => api<RecruitmentDTO>('/recruitments/' + id), enabled: !!id && !!user, retry: false });
  const topics = useQuery({ queryKey: ['topics', draft.category], queryFn: () => api<TopicDTO[]>('/topics?category=' + draft.category) });
  const source = useQuery({ queryKey: ['post', sourceId], queryFn: () => api<PostDTO>('/posts/' + sourceId), enabled: !!sourceId && !!user, retry: false });
  useEffect(() => {
    if (id && record.data?.data.canEditDraft && hydrated !== id) {
      const r = record.data.data; saved.current = r; setDraft(r.draft); setSkills(r.draft.existingSkills.join('，'));
      setRecoveryBlocked(false); createAttempt.current = null; setError(''); setPreview(null);
      setSlotSkills(Object.fromEntries(r.draft.slots.map(s => [s.key, s.requiredSkills.join('，')]))); setHydrated(id);
    }
  }, [id, record.data, hydrated]);
  useEffect(() => {
    if (source.data && !prefilled.current && source.data.data.topic.active) {
      const p = source.data.data;
      setDraft(d => ({ ...emptyRecruitment(p.topic.category, d.capacity), title: p.title, description: p.body.slice(0, 3000), topicId: p.topic.id, sourcePostId: p.id }));
      prefilled.current = true;
    }
  }, [source.data]);
  useEffect(() => {
    if (id || sourceId || !topics.data) return;
    setDraft(d => topics.data.data.some(t => t.id === d.topicId) ? d : { ...d, topicId: topics.data.data[0]?.id || null });
  }, [topics.data, id, sourceId]);
  const hasDraft = !!id && hydrated === id && saved.current?.id === id;
  const unavailable = hasDraft && ((record.data && !record.data.data.canEditDraft) || (record.error instanceof ApiError && record.error.status === 404));
  const retryReads = () => { if (record.isError) void record.refetch(); if (source.isError) void source.refetch(); };
  function update(values: Partial<RecruitmentDraft>) {
    setDraft(d => ({ ...d, ...values }));
    setFields({});
  }
  function materialize() { return { ...draft, existingSkills: splitSkills(skills), slots: draft.category === 'COMPETITION' ? draft.slots.map(s => ({ ...s, requiredSkills: splitSkills(slotSkills[s.key] || '') })) : draft.slots.map(s => ({ ...s, capacity: draft.capacity, requiredSkills: [] })) }; }
  async function persist(values: RecruitmentDraft) {
    if (!saved.current) {
      const attempt = createAttempt.current ?? { key: crypto.randomUUID(), draft: structuredClone(values) };
      createAttempt.current = attempt;
      let response;
      try { response = await api<RecruitmentDTO>('/recruitments', { method: 'POST', body: { requestKey: attempt.key, draft: attempt.draft } }); }
      catch (e) {
        if (e instanceof ApiError) {
          if ([400, 422].includes(e.status) && ['INVALID_INPUT', 'PROFILE_INCOMPLETE', 'TOPIC_UNAVAILABLE', 'INVALID_SOURCE_POST'].includes(e.code)) createAttempt.current = null;
          if (['DRAFT_DELETED', 'REQUEST_KEY_CONFLICT'].includes(e.code)) setRecoveryBlocked(true);
        }
        throw e;
      }
      saved.current = response.data; createAttempt.current = null;
      client.setQueryData(['recruitment', response.data.id, user?.id], response);
      await client.invalidateQueries({ queryKey: ['my-recruitments'] });
      if (response.data.publicationStatus !== 'DRAFT' || response.data.revision !== 1 || JSON.stringify(response.data.draft) !== JSON.stringify(attempt.draft)) {
        setRecoveryBlocked(true);
        throw new ApiError('已找回原草稿，但它已在其他页面更新或发布。本页输入仍保留，请核对已保存内容后手动合并，当前已停止保存。', 409, 'RECOVERED_DRAFT_CHANGED');
      }
    }
    if (saved.current && JSON.stringify(saved.current.draft) === JSON.stringify(values)) return saved.current;
    const response = await api<RecruitmentDTO>('/recruitments/' + saved.current.id, { method: 'PATCH', body: { revision: saved.current.revision, draft: values } });
    saved.current = response.data;
    client.setQueryData(['recruitment', response.data.id, user?.id], response);
    await client.invalidateQueries({ queryKey: ['my-recruitments'] });
    return response.data;
  }
  async function saveDraft() {
    if (busy || unavailable || recoveryBlocked || publishAttempt.current) return;
    const parsed = RecruitmentDraftSchema.safeParse(materialize());
    if (!parsed.success) { setError(parsed.error.issues.slice(0, 5).map(i => i.message).join('；')); return; }
    setBusy(true); setError('');
    try { const r = await persist(parsed.data); navigate('/recruitments/' + r.id + '/edit', { replace: true, state: { draftSaved: true } }); setHydrated(''); }
    catch (e) { setError(recruitmentError(e)); }
    finally { setBusy(false); }
  }
  function validate() {
    const parsed = PublishableRecruitmentSchema.safeParse(materialize());
    if (parsed.success) { setFields({}); setError(''); return parsed.data; }
    setFields(Object.fromEntries(parsed.error.issues.map(i => [String(i.path[0]), i.message])));
    setError(parsed.error.issues.slice(0, 6).map(i => i.message).join('。'));
    return null;
  }
  async function publish(values?: RecruitmentDraft) {
    if (busy || recoveryBlocked || unavailable && !publishAttempt.current) return;
    const ready = publishAttempt.current ? null : values || validate();
    if (!ready && !publishAttempt.current) return;
    setBusy(true);
    setError('');
    try {
      if (!publishAttempt.current && ready) {
        const stored = await persist(ready);
        publishAttempt.current = { id: stored.id, revision: stored.revision };
      }
      const attempt = publishAttempt.current!;
      const response = await api<RecruitmentDTO>('/recruitments/' + attempt.id + '/publish', { method: 'POST', body: { revision: attempt.revision } });
      publishAttempt.current = null;
      await Promise.all([
        client.invalidateQueries({ queryKey: ['recruitments'] }),
        client.invalidateQueries({ queryKey: ['my-recruitments'] }),
        client.invalidateQueries({ queryKey: ['chat-inbox'] }),
      ]);
      client.setQueryData(['recruitment', attempt.id, user?.id], response);
      navigate('/recruitments/' + attempt.id, { replace: true, state: { justPublished: true } });
    } catch (e) {
      if (e instanceof ApiError && [400, 404, 409, 422].includes(e.status) && e.code !== 'STALE_SESSION_RESPONSE') publishAttempt.current = null;
      setError(recruitmentError(e));
    } finally { setBusy(false); }
  }
  if (loading) return <Loading />;
  if (authError) return <ErrorState message={authError.message} retry={() => void reload()} />;
  if (!user) return <LoginGate next={id ? '/recruitments/' + id + '/edit' : '/recruitments/new'} />;
  if ((id && !hasDraft && (record.isPending || (record.data?.data.canEditDraft && hydrated !== id))) || (sourceId && source.isPending)) return <Loading label="正在读取招募草稿……" />;
  if ((record.isError && !hasDraft) || (source.isError && !prefilled.current)) return <><Link className="text-button" to="/recruitments">返回招募大厅</Link><ErrorState message={recruitmentError(record.error || source.error)} retry={retryReads} /></>;
  if (id && !hasDraft && record.data && !record.data.data.canEditDraft) return <ErrorState message="这条内容不是你可编辑的草稿；当前阶段已发布招募只读。" />;

  const locked = busy || unavailable || recoveryBlocked || !!publishAttempt.current;
  const confirmText = publishAttempt.current ? '核对发布结果' : '发布招募';
  return <section className="form-page quick-recruitment">
    <PageTitle title={preview ? '确认这份招募。' : '找搭子'} back={() => preview ? setPreview(null) : navigate('/recruitments')} />
    {!id && !sourceId && <div className="publish-modes"><Link to={'/publish?category=' + draft.category}>发布讨论</Link><span className="current">发起招募</span></div>}
    {(record.isError || source.isError) && <ErrorState message={recruitmentError(record.error || source.error) + '。本页尚未保存的输入仍保留。'} retry={retryReads} />}
    {unavailable && <div className="inline-error" role="status">这份草稿已发布、删除或不可编辑，本页输入仍保留，已停止保存和发布。{record.data?.data.publicationStatus === 'PUBLISHED' && <Link to={'/recruitments/' + id}>查看已发布招募</Link>}</div>}
    {hasDraft && !unavailable && record.data && record.data.data.revision !== saved.current!.revision && <p className="form-note" role="status">草稿已在其他页面更新。保存时会检查版本。</p>}
    {createAttempt.current && error && <p className="form-note" role="status">上次创建结果尚未确认。再次保存会先找回原草稿。</p>}
    {publishAttempt.current && error && <p className="form-note" role="status">正在核对同一次发布。可以重试，也可以打开招募查看结果。</p>}
    {recoveryBlocked && <p className="form-note" role="status">本次恢复已停止保存和发布。当前输入仍在，关闭或刷新前请自行复制保留。</p>}
    {!id && saved.current && error && <Link className="text-button" to={'/recruitments/' + saved.current.id + (saved.current.publicationStatus === 'DRAFT' && !publishAttempt.current ? '/edit' : '')} target="_blank" rel="noopener noreferrer">在新标签页核对已保存内容</Link>}
    {!preview && location.state?.draftSaved && <div className="success-notice" role="status">草稿已保存到数据库，仅自己可见。继续修改后请再次保存。</div>}
    {!preview && draft.category === 'COMPETITION' && <DraftAssistant disabled={!!locked || !!createAttempt.current} onApply={update} />}
    {preview ? <div className="paper form-stack" aria-label="招募发布预览">
      <h2>{preview.title}</h2>{preview.description && <p className="post-body">{preview.description}</p>}
      <dl className="recruitment-facts">
        <div><dt>主题</dt><dd>{topics.data?.data.find(t => t.id === preview.topicId)?.name || '正在读取主题'}</dd></div>
        <div><dt>协作时间</dt><dd>{scheduleLabel(preview)}</dd></div>
        <div><dt>协作地点</dt><dd>{preview.mode === 'ONLINE' ? '线上' : preview.locationPublic}</dd></div>
        <div><dt>招募截止</dt><dd>{preview.joinDeadline || preview.startAt ? beijingTime(preview.joinDeadline || preview.startAt) : '发布后 7 天内'}</dd></div>
        <div><dt>加入方式</dt><dd>{preview.joinMode === 'AUTO' ? '直接加入' : '发起人确认'}</dd></div>
        <div><dt>招募人数</dt><dd>再找 {preview.capacity - 1} 位，共 {preview.capacity} 人</dd></div>
        {preview.category === 'OUTDOOR' && <div><dt>费用</dt><dd>{budgetLabel(preview)}</dd></div>}
        {preview.competitionName && <div><dt>比赛</dt><dd>{preview.competitionName}</dd></div>}
      </dl>
      {preview.slots.length > 1 && <div className="slot-list">{preview.slots.map(s => <div className="slot-summary" key={s.key}>
        <strong>{s.name}{s.key === preview.captainSlotKey ? ' · 我负责' : ''}</strong>
        <span>{s.capacity} 人{s.requiredSkills.length ? ' · ' + s.requiredSkills.join('、') : ''}</span>
      </div>)}</div>}
      <FormError>{error}</FormError>
      <div className="button-row">
        <button className="button secondary" disabled={busy || !!publishAttempt.current} onClick={() => setPreview(null)}>返回修改</button>
        <button className="button" disabled={busy || unavailable && !publishAttempt.current || recoveryBlocked} onClick={() => void publish(preview)}>{busy ? '正在发布……' : publishAttempt.current ? '核对发布结果' : '确认发布招募'}</button>
      </div>
    </div> : <form className="paper form-stack" noValidate onSubmit={e => { e.preventDefault(); void publish(); }}>
      <fieldset className="recruitment-fields" disabled={!!locked}>
        <RecruitmentFields draft={draft} update={update} topics={topics.data?.data} sourceLocked={!!sourceId || !!draft.sourcePostId}
          onCategory={category => {
            const { title, description, capacity } = draft;
            setDraft({ ...emptyRecruitment(category, capacity >= 2 ? capacity : 2), title, description });
            setSkills(''); setSlotSkills({}); setFields({}); setError('');
          }} skills={skills} onSkills={setSkills} slotSkills={slotSkills}
          onSlotSkills={(key, value) => setSlotSkills(v => ({ ...v, [key]: value }))} errors={fields} />
      </fieldset>
      {topics.isError && <ErrorState message="读取主题失败" retry={() => void topics.refetch()} />}
      <p className="publish-school">{user.school.name} · {draft.allowCrossSchool ? '接受跨校' : '仅本校'}{draft.sourcePostId ? ' · 已关联来源讨论' : ''}</p>
      <FormError>{error}</FormError>
      <div className="button-row">
        <button className="button secondary" type="button" disabled={!!locked} onClick={() => void saveDraft()}><Save size={17} />保存私有草稿</button>
        <button className="text-button" type="button" disabled={!!locked || topics.isError} onClick={() => { const data = validate(); if (data) setPreview(data); }}>预览并发布</button>
        <button className="button" type="submit" disabled={busy || topics.isError || recoveryBlocked || unavailable && !publishAttempt.current}>{busy ? '正在提交……' : confirmText}<ArrowUpRight size={17} /></button>
      </div>
    </form>}
  </section>;
}
