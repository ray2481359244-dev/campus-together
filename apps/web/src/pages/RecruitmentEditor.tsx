import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PublishableRecruitmentSchema, RecruitmentDraftSchema } from '@campus/contracts';
import type { RecruitmentDTO, RecruitmentDraft, TopicDTO, PostDTO } from '@campus/contracts';
import { ArrowUpRight, Plus, Save } from 'lucide-react';
import { api } from '../lib/api';
import { emptyRecruitment, splitSkills, beijingInput, fromBeijingInput, beijingTime, recruitmentError } from '../lib/recruitments';
import { useAuth } from '../lib/auth';
import { PageTitle, Loading, LoginGate, ErrorState, FormError } from '../components/UI';

export function RecruitmentEditor() {
  const { id } = useParams(), [params] = useSearchParams(), sourceId = !id ? params.get('sourcePost') : null;
  const { user, loading, error: authError, reload } = useAuth(), navigate = useNavigate(), location = useLocation(), client = useQueryClient();
  const [draft, setDraft] = useState(emptyRecruitment), [skills, setSkills] = useState(''), [slotSkills, setSlotSkills] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<RecruitmentDraft | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [hydrated, setHydrated] = useState('');
  const saved = useRef<RecruitmentDTO | null>(null), createAttempt = useRef({ body: '', key: crypto.randomUUID() }), prefilled = useRef(false);
  const record = useQuery({ queryKey: ['recruitment', id, user?.id], queryFn: () => api<RecruitmentDTO>('/recruitments/' + id), enabled: !!id && !!user, retry: false });
  const topics = useQuery({ queryKey: ['topics', 'COMPETITION'], queryFn: () => api<TopicDTO[]>('/topics?category=COMPETITION') });
  const source = useQuery({ queryKey: ['post', sourceId], queryFn: () => api<PostDTO>('/posts/' + sourceId), enabled: !!sourceId && !!user, retry: false });
  useEffect(() => {
    if (id && record.data && hydrated !== id) {
      const r = record.data.data; saved.current = r; setDraft(r.draft); setSkills(r.draft.existingSkills.join('，'));
      setSlotSkills(Object.fromEntries(r.draft.slots.map(s => [s.key, s.requiredSkills.join('，')]))); setHydrated(id);
    }
  }, [id, record.data, hydrated]);
  useEffect(() => {
    if (source.data && !prefilled.current && source.data.data.canEdit && source.data.data.topic.category === 'COMPETITION') {
      const p = source.data.data; setDraft(d => ({ ...d, title: p.title, description: p.body.slice(0, 3000), topicId: p.topic.id, sourcePostId: p.id })); prefilled.current = true;
    }
  }, [source.data]);
  useEffect(() => { if (!id && topics.data) setDraft(d => d.topicId ? d : { ...d, topicId: topics.data.data[0]?.id || null }); }, [topics.data, id]);
  const change = <K extends keyof RecruitmentDraft>(key: K, value: RecruitmentDraft[K]) => setDraft(d => ({ ...d, [key]: value }));
  function materialize() { return { ...draft, existingSkills: splitSkills(skills), slots: draft.slots.map(s => ({ ...s, requiredSkills: splitSkills(slotSkills[s.key] || '') })) }; }
  async function persist(values: RecruitmentDraft) {
    if (saved.current && JSON.stringify(saved.current.draft) === JSON.stringify(values)) return saved.current;
    const body = JSON.stringify(values);
    if (createAttempt.current.body !== body) createAttempt.current = { body, key: crypto.randomUUID() };
    const response = saved.current
      ? await api<RecruitmentDTO>('/recruitments/' + saved.current.id, { method: 'PATCH', body: { revision: saved.current.revision, draft: values } })
      : await api<RecruitmentDTO>('/recruitments', { method: 'POST', body: { requestKey: createAttempt.current.key, draft: values } });
    saved.current = response.data;
    client.setQueryData(['recruitment', response.data.id, user?.id], response);
    await client.invalidateQueries({ queryKey: ['my-recruitments'] });
    return response.data;
  }
  async function saveDraft() {
    const parsed = RecruitmentDraftSchema.safeParse(materialize());
    if (!parsed.success) { setError(parsed.error.issues.slice(0, 5).map(i => i.message).join('；')); return; }
    setBusy(true); setError('');
    try { const r = await persist(parsed.data); navigate('/recruitments/' + r.id + '/edit', { replace: true, state: { draftSaved: true } }); setHydrated(''); }
    catch (e) { setError(recruitmentError(e)); }
    finally { setBusy(false); }
  }
  function previewDraft() {
    const parsed = PublishableRecruitmentSchema.safeParse(materialize());
    if (!parsed.success) { setError(parsed.error.issues.slice(0, 6).map(i => i.message).join('；')); return; }
    setError(''); setPreview(parsed.data);
  }
  if (loading) return <Loading />;
  if (authError) return <ErrorState message={authError.message} retry={() => void reload()} />;
  if (!user) return <LoginGate next={id ? '/recruitments/' + id + '/edit' : '/recruitments/new'} />;
  if ((id && (record.isPending || (record.data && hydrated !== id))) || (sourceId && source.isPending)) return <Loading label="正在读取招募草稿……" />;
  if (record.isError || source.isError) return <ErrorState message={recruitmentError(record.error || source.error)} />;
  if (id && record.data && !record.data.data.canEditDraft) return <ErrorState message="这条内容不是你可编辑的草稿；当前阶段已发布招募只读。" />;
  if (source.data && (!source.data.data.canEdit || source.data.data.topic.category !== 'COMPETITION')) return <ErrorState message="只能从自己的竞赛讨论发起关联招募。" />;
  const dateField = (key: 'startAt' | 'endAt' | 'joinDeadline' | 'competitionDeadline', label: string) => <label>{label}<input type="datetime-local" aria-label={label} value={beijingInput(draft[key])} onChange={e => change(key, fromBeijingInput(e.target.value))} /></label>;
  return <section className="form-page"><PageTitle title={preview ? '确认这份招募。' : '先把队伍想清楚。'} eyebrow="COMPETITION / RECRUITMENT DRAFT" back={() => preview ? setPreview(null) : navigate('/recruitments')} />
    <p className="form-note recruitment-form-note">草稿仅自己可见。确认发布后内容公开，并创建队伍与队长关系。当前尚不能申请入队或群聊。</p>
    {!preview && location.state?.draftSaved && <div className="success-notice" role="status">草稿已保存到数据库，仅自己可见。继续修改后请再次保存。</div>}
    {preview ? <div className="paper form-stack" aria-label="招募发布预览"><h2>{preview.title}</h2><p className="post-body">{preview.description}</p><dl className="recruitment-facts"><div><dt>竞赛主题</dt><dd>{topics.data?.data.find(t => t.id === preview.topicId)?.name || "正在读取主题"}</dd></div><div><dt>比赛与方向</dt><dd>{preview.competitionName} · {preview.direction}</dd></div><div><dt>学校与形式</dt><dd>{user.school.name} · {preview.mode === 'ONLINE' ? '线上' : preview.locationPublic}</dd></div><div><dt>协作时间</dt><dd>{beijingTime(preview.startAt)} 至 {beijingTime(preview.endAt)}（北京时间）</dd></div><div><dt>招募截止</dt><dd>{beijingTime(preview.joinDeadline || preview.startAt)}（北京时间）</dd></div><div><dt>比赛截止</dt><dd>{beijingTime(preview.competitionDeadline)}（北京时间）</dd></div><div><dt>投入与时段</dt><dd>每周 {preview.weeklyHours} 小时 · {preview.collaboration}</dd></div><div><dt>目标</dt><dd>{preview.goal}</dd></div><div><dt>已有技能</dt><dd>{preview.existingSkills.join("、") || "未填写"}（自述）</dd></div><div><dt>学校范围</dt><dd>{preview.allowCrossSchool ? "接受跨校意向" : "仅限同校意向"}</dd></div>{preview.officialUrl && <div><dt>比赛链接</dt><dd><a href={preview.officialUrl} target="_blank" rel="noopener noreferrer">{preview.officialUrl}</a></dd></div>}<div><dt>队伍总人数</dt><dd>{preview.capacity} 人，包含我作为队长</dd></div></dl><div className="slot-list">{preview.slots.map(s => <div className="slot-summary" key={s.key}><strong>{s.name}{s.key === preview.captainSlotKey ? ' · 我负责' : ''}</strong><span>{s.capacity} 人{s.requiredSkills.length ? ' · ' + s.requiredSkills.join('、') : ''}</span></div>)}</div><FormError>{error}</FormError><div className="button-row"><button className="button secondary" disabled={busy} onClick={() => { setPreview(null); setError(''); }}>返回修改</button><button className="button" disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try { const stored = await persist(preview); const response = await api<RecruitmentDTO>('/recruitments/' + stored.id + '/publish', { method: 'POST', body: { revision: stored.revision } }); await client.invalidateQueries({ queryKey: ['recruitments'] }); await client.invalidateQueries({ queryKey: ['my-recruitments'] }); client.setQueryData(['recruitment', stored.id, user.id], response); navigate('/recruitments/' + stored.id, { replace: true }); }
      catch (e) { setError(recruitmentError(e)); }
      finally { setBusy(false); }
    }}>{busy ? '正在发布……' : '确认发布招募'}<ArrowUpRight size={18} /></button></div>{saved.current && error && <Link className="text-button" to={'/recruitments/' + saved.current.id}>查看已经保存的内容 →</Link>}</div>
    : <form className="paper form-stack" noValidate onSubmit={e => { e.preventDefault(); previewDraft(); }}><fieldset className="recruitment-fields" disabled={busy}>
      <h2>这次一起做什么</h2><label>竞赛主题<select aria-label="竞赛主题" value={draft.topicId || ''} disabled={!topics.data} onChange={e => change('topicId', e.target.value || null)}><option value="">请选择</option>{topics.data?.data.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>{topics.isError && <ErrorState message="读取主题失败，请重试" retry={() => void topics.refetch()} />}
      <label>招募标题<input aria-label="招募标题" value={draft.title} onChange={e => change('title', e.target.value)} maxLength={60} placeholder="5—60 个字，说明想找怎样的伙伴" /></label>
      <label>招募说明<textarea aria-label="招募说明" rows={5} value={draft.description} onChange={e => change('description', e.target.value)} maxLength={3000} placeholder="20—3000 个字，说明项目、分工与合作期待" /></label>
      <label>比赛名称<input aria-label="比赛名称" value={draft.competitionName} maxLength={100} onChange={e => change('competitionName', e.target.value)} /></label>
      <label>比赛官方链接（可选）<input type="url" value={draft.officialUrl} onChange={e => change('officialUrl', e.target.value)} placeholder="https://" maxLength={500} /></label>
      <label>项目方向<input aria-label="项目方向" value={draft.direction} onChange={e => change('direction', e.target.value)} maxLength={200} /></label>
      <label>本次目标<input aria-label="本次目标" value={draft.goal} onChange={e => change('goal', e.target.value)} maxLength={100} placeholder="例如：完成可以演示的校园应用" /></label>
      <label>已有技能（自述，可选）<input value={skills} onChange={e => setSkills(e.target.value)} placeholder="用逗号分隔，例如：前端开发，设计" /></label>
      <h2>时间和协作方式</h2><p className="form-note">所有日期按北京时间填写和展示。招募截止留空时使用协作开始时间，且发布时必须晚于现在。</p>
      <div className="form-row">{dateField('startAt', '协作开始时间')}{dateField('endAt', '协作结束时间')}</div><div className="form-row">{dateField('joinDeadline', '招募截止时间（可选）')}{dateField('competitionDeadline', '比赛截止时间')}</div>
      <div className="form-row"><label>协作形式<select value={draft.mode} onChange={e => change('mode', e.target.value as 'ONLINE' | 'OFFLINE')}><option value="ONLINE">线上</option><option value="OFFLINE">线下</option></select></label><label>预计每周投入（小时）<input aria-label="预计每周投入（小时）" type="number" min={1} max={60} value={draft.weeklyHours} onChange={e => change('weeklyHours', Number(e.target.value))} /></label></div>
      {draft.mode === 'OFFLINE' && <label>公开集合区域<input value={draft.locationPublic} onChange={e => change('locationPublic', e.target.value)} maxLength={120} placeholder="只填粗粒度区域，不填私人联系方式" /></label>}
      <label>协作时段说明<textarea aria-label="协作时段说明" rows={2} value={draft.collaboration} onChange={e => change('collaboration', e.target.value)} maxLength={300} placeholder="例如：周二、周四 19:00—21:00，申请前再确认具体安排" /></label>
      <label className="checkbox-field"><input type="checkbox" checked={draft.allowCrossSchool} onChange={e => change('allowCrossSchool', e.target.checked)} />接受跨校意向（实际入队校验后续接入）</label>
      <h2>岗位和人数</h2><label>队伍总人数（含队长）<input aria-label="队伍总人数（含队长）" type="number" min={2} max={20} value={draft.capacity} onChange={e => change('capacity', Number(e.target.value))} /></label><p className="form-note">岗位合计 {draft.slots.reduce((sum, s) => sum + s.capacity, 0)} 人 / 队伍 {draft.capacity} 人。每位成员占一个岗位，我也占一个名额。</p>
      <div className="slot-editor-list">{draft.slots.map((s, i) => <section className="slot-editor" key={s.key}><div className="form-row"><label>岗位 {i + 1} 名称<input aria-label={`岗位 ${i + 1} 名称`} value={s.name} maxLength={30} onChange={e => change('slots', draft.slots.map(v => v.key === s.key ? { ...v, name: e.target.value } : v))} /></label><label>岗位 {i + 1} 人数<input aria-label={`岗位 ${i + 1} 人数`} type="number" min={1} max={20} value={s.capacity} onChange={e => change('slots', draft.slots.map(v => v.key === s.key ? { ...v, capacity: Number(e.target.value) } : v))} /></label></div><label>所需技能（逗号分隔）<input aria-label={`岗位 ${i + 1} 所需技能`} value={slotSkills[s.key] || ''} onChange={e => setSlotSkills(v => ({ ...v, [s.key]: e.target.value }))} /></label>{draft.slots.length > 1 && <button type="button" className="text-button danger" onClick={() => { change('slots', draft.slots.filter(v => v.key !== s.key)); if (draft.captainSlotKey === s.key) change('captainSlotKey', null); }}>移除岗位 {i + 1}</button>}</section>)}</div>
      {draft.slots.length < 8 && <button type="button" className="button secondary" onClick={() => change('slots', [...draft.slots, { key: crypto.randomUUID(), name: '', capacity: 1, requiredSkills: [] }])}><Plus size={16} />增加岗位</button>}
      <label>我负责的岗位<select aria-label="我负责的岗位" value={draft.captainSlotKey || ''} onChange={e => change('captainSlotKey', e.target.value || null)}><option value="">请选择自己占据的岗位</option>{draft.slots.map((s, i) => <option key={s.key} value={s.key}>{s.name || `岗位 ${i + 1}`}</option>)}</select></label>
      <div className="publish-school">发布学校：{user.school.name}<span>学校与技能均为自述，未做认证。当前为申请审核模式；申请、批准和群聊尚未开放。</span>{draft.sourcePostId && <span>已关联来源讨论，发布不会修改原帖。</span>}</div>
      <FormError>{error}</FormError><div className="button-row"><button className="button secondary" type="button" disabled={busy} onClick={() => void saveDraft()}><Save size={17} />{busy ? '正在保存……' : '保存私有草稿'}</button><button className="button" type="submit" disabled={busy || topics.isError}>预览并发布<ArrowUpRight size={17} /></button></div><p className="form-note">保存草稿可暂不填正文和时间。失败时当前输入保留；只有收到保存成功后才已写入数据库。</p>
    </fieldset></form>}
  </section>;
}
