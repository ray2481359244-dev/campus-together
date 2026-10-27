import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { categories, categoryInfo, PublishableRecruitmentSchema, RecruitmentDraftSchema } from '@campus/contracts';
import type { RecruitmentDTO, RecruitmentDraft, TopicDTO, PostDTO } from '@campus/contracts';
import { ArrowUpRight, Plus, Save } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { emptyRecruitment, splitSkills, beijingInput, fromBeijingInput, beijingTime, recruitmentError } from '../lib/recruitments';
import { useAuth } from '../lib/auth';
import { PageTitle, Loading, LoginGate, ErrorState, FormError } from '../components/UI';

import { DraftAssistant } from '../components/DraftAssistant';

export function RecruitmentEditor() {
  const { id } = useParams(), [params] = useSearchParams(), sourceId = !id ? params.get('sourcePost') : null;
  const { user, loading, error: authError, reload } = useAuth(), navigate = useNavigate(), location = useLocation(), client = useQueryClient();
  const [draft, setDraft] = useState(emptyRecruitment), [skills, setSkills] = useState(''), [slotSkills, setSlotSkills] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<RecruitmentDraft | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [hydrated, setHydrated] = useState('');
  const [recoveryBlocked, setRecoveryBlocked] = useState(false);
  const saved = useRef<RecruitmentDTO | null>(null), createAttempt = useRef<{ key: string; draft: RecruitmentDraft } | null>(null), prefilled = useRef(false);
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
      const p = source.data.data; setDraft(d => ({ ...sceneDraft(d, p.topic.category), title: p.title, description: p.body.slice(0, 3000), topicId: p.topic.id, sourcePostId: p.id })); prefilled.current = true;
    }
  }, [source.data]);
  useEffect(() => { if (!id && topics.data) setDraft(d => d.topicId ? d : { ...d, topicId: topics.data.data[0]?.id || null }); }, [topics.data, id]);
  const hasDraft = !!id && hydrated === id && saved.current?.id === id;
  const unavailable = hasDraft && ((record.data && !record.data.data.canEditDraft) || (record.error instanceof ApiError && record.error.status === 404));
  const retryReads = () => { if (record.isError) void record.refetch(); if (source.isError) void source.refetch(); };
  const change = <K extends keyof RecruitmentDraft>(key: K, value: RecruitmentDraft[K]) => setDraft(d => ({ ...d, [key]: value }));
  function sceneDraft(current: RecruitmentDraft, category: RecruitmentDraft['category']): RecruitmentDraft {
    if (category === 'COMPETITION') return { ...current, ...emptyRecruitment(), category, topicId: null, title: current.title, description: current.description };
    const key = crypto.randomUUID();
    return { ...current, category, topicId: null, sourcePostId: null, slots: [{ key, name: '成员', capacity: current.capacity, requiredSkills: [] }], captainSlotKey: key,
      game: { server: '不限', platform: 'ANY', playMode: '', voice: '' }, study: { subject: '', level: '', method: 'SELF', methodRequired: false, frequency: '' }, outdoor: { activity: '', region: '', budget: 0, distance: '', intensity: 'LOW', experience: '', equipment: '' } };
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
    if (busy || unavailable || recoveryBlocked) return;
    const parsed = RecruitmentDraftSchema.safeParse(materialize());
    if (!parsed.success) { setError(parsed.error.issues.slice(0, 5).map(i => i.message).join('；')); return; }
    setBusy(true); setError('');
    try { const r = await persist(parsed.data); navigate('/recruitments/' + r.id + '/edit', { replace: true, state: { draftSaved: true } }); setHydrated(''); }
    catch (e) { setError(recruitmentError(e)); }
    finally { setBusy(false); }
  }
  function previewDraft() {
    if (busy || unavailable || recoveryBlocked) return;
    const parsed = PublishableRecruitmentSchema.safeParse(materialize());
    if (!parsed.success) { setError(parsed.error.issues.slice(0, 6).map(i => i.message).join('；')); return; }
    setError(''); setPreview(parsed.data);
  }
  if (loading) return <Loading />;
  if (authError) return <ErrorState message={authError.message} retry={() => void reload()} />;
  if (!user) return <LoginGate next={id ? '/recruitments/' + id + '/edit' : '/recruitments/new'} />;
  if ((id && !hasDraft && (record.isPending || (record.data?.data.canEditDraft && hydrated !== id))) || (sourceId && source.isPending)) return <Loading label="正在读取招募草稿……" />;
  if ((record.isError && !hasDraft) || (source.isError && !prefilled.current)) return <><Link className="text-button" to="/recruitments">返回招募大厅</Link><ErrorState message={recruitmentError(record.error || source.error)} retry={retryReads} /></>;
  if (id && !hasDraft && record.data && !record.data.data.canEditDraft) return <ErrorState message="这条内容不是你可编辑的草稿；当前阶段已发布招募只读。" />;

  const dateField = (key: 'startAt' | 'endAt' | 'joinDeadline' | 'competitionDeadline', label: string) => <label>{label}<input type="datetime-local" aria-label={label} value={beijingInput(draft[key])} onChange={e => change(key, fromBeijingInput(e.target.value))} /></label>;
  return <section className="form-page"><PageTitle title={preview ? '确认这份招募。' : '先把队伍想清楚。'} eyebrow="COMPETITION / RECRUITMENT DRAFT" back={() => preview ? setPreview(null) : navigate('/recruitments')} />
    {(record.isError || source.isError) && <ErrorState message={recruitmentError(record.error || source.error) + '。本页尚未保存的输入仍保留，重新读取不会替换输入。'} retry={retryReads} />}
    {unavailable && <div className="inline-error" role="status">这份草稿已发布、删除或不可编辑，本页输入仍保留，已停止保存和发布。{record.data?.data.publicationStatus === 'PUBLISHED' && <Link to={'/recruitments/' + id}>查看已发布招募</Link>}</div>}
    {hasDraft && !unavailable && record.data && record.data.data.revision !== saved.current!.revision && <p className="form-note" role="status">草稿已在其他页面更新。本页输入仍基于原版本；保存时会检查版本，不能覆盖其他页面的修改。</p>}
    <p className="form-note recruitment-form-note">草稿仅自己可见。确认发布后内容公开，并创建队伍与队长关系。发布后可申请审核入队并使用队伍群聊。</p>
    {createAttempt.current && error && <p className="form-note" role="status">上次创建结果尚未确认。你可以继续修改；再次保存会先找回上次创建的草稿，再保存本页修改，不会另建一份。</p>}
    {recoveryBlocked && <p className="form-note" role="status">本次恢复已停止保存和发布。当前输入仍在，关闭或刷新前请自行复制保留。</p>}
    {!preview && !id && saved.current && error && <Link className="text-button" to={'/recruitments/' + saved.current.id + (saved.current.publicationStatus === 'DRAFT' ? '/edit' : '')} target="_blank" rel="noopener noreferrer">在新标签页核对已保存内容</Link>}
    {!preview && location.state?.draftSaved && <div className="success-notice" role="status">草稿已保存到数据库，仅自己可见。继续修改后请再次保存。</div>}
    {!preview && draft.category === 'COMPETITION' && <DraftAssistant disabled={busy || unavailable || recoveryBlocked || !!createAttempt.current} onApply={fields => { setDraft(current => ({ ...current, ...fields })); setPreview(null); }} />}
    {preview ? <div className="paper form-stack" aria-label="招募发布预览"><h2>{preview.title}</h2><p className="post-body">{preview.description}</p><dl className="recruitment-facts"><div><dt>招募主题</dt><dd>{topics.data?.data.find(t => t.id === preview.topicId)?.name || "正在读取主题"}</dd></div>{preview.category === 'COMPETITION' && <div><dt>比赛与方向</dt><dd>{preview.competitionName} · {preview.direction}</dd></div>}<div><dt>学校与形式</dt><dd>{user.school.name} · {preview.mode === 'ONLINE' ? '线上' : preview.locationPublic}</dd></div><div><dt>协作时间</dt><dd>{beijingTime(preview.startAt)} 至 {beijingTime(preview.endAt)}（北京时间）</dd></div><div><dt>招募截止</dt><dd>{beijingTime(preview.joinDeadline || preview.startAt)}（北京时间）</dd></div>{preview.category === 'COMPETITION' && <div><dt>比赛截止</dt><dd>{beijingTime(preview.competitionDeadline)}（北京时间）</dd></div>}<div><dt>投入与时段</dt><dd>每周 {preview.weeklyHours} 小时 · {preview.collaboration}</dd></div><div><dt>目标</dt><dd>{preview.goal}</dd></div><div><dt>已有技能</dt><dd>{preview.existingSkills.join("、") || "未填写"}（自述）</dd></div><div><dt>学校范围</dt><dd>{preview.allowCrossSchool ? "接受跨校意向" : "仅限同校意向"}</dd></div>{preview.officialUrl && <div><dt>比赛链接</dt><dd><a href={preview.officialUrl} target="_blank" rel="noopener noreferrer">{preview.officialUrl}</a></dd></div>}{preview.game && preview.category === 'GAME' && <div><dt>游戏条件</dt><dd>{preview.game.server} · {preview.game.platform} · {preview.game.playMode}</dd></div>}{preview.study && preview.category === 'STUDY' && <div><dt>学习安排</dt><dd>{preview.study.subject} · {preview.study.method} · {preview.study.frequency}</dd></div>}{preview.outdoor && preview.category === 'OUTDOOR' && <div><dt>户外安排</dt><dd>{preview.outdoor.activity} · {preview.outdoor.region} · 每人 {preview.outdoor.budget} 元以内 · {preview.outdoor.distance} · {preview.outdoor.intensity} · {preview.outdoor.experience || '经验不限'} · {preview.outdoor.equipment || '装备不限'}</dd></div>}<div><dt>加入方式</dt><dd>{preview.joinMode === 'AUTO' ? '符合条件直接加入' : '申请审核'}</dd></div><div><dt>队伍总人数</dt><dd>{preview.capacity} 人，包含我作为队长</dd></div></dl><div className="slot-list">{preview.slots.map(s => <div className="slot-summary" key={s.key}><strong>{s.name}{s.key === preview.captainSlotKey ? ' · 我负责' : ''}</strong><span>{s.capacity} 人{s.requiredSkills.length ? ' · ' + s.requiredSkills.join('、') : ''}</span></div>)}</div><FormError>{error}</FormError><div className="button-row"><button className="button secondary" disabled={busy} onClick={() => { setPreview(null); setError(''); }}>返回修改</button><button className="button" disabled={busy || unavailable || recoveryBlocked} onClick={async () => {
      if (busy || unavailable || recoveryBlocked) return;
      setBusy(true); setError('');
      try { const stored = await persist(preview); const response = await api<RecruitmentDTO>('/recruitments/' + stored.id + '/publish', { method: 'POST', body: { revision: stored.revision } }); await client.invalidateQueries({ queryKey: ['recruitments'] }); await client.invalidateQueries({ queryKey: ['my-recruitments'] }); client.setQueryData(['recruitment', stored.id, user.id], response); navigate('/recruitments/' + stored.id, { replace: true }); }
      catch (e) { setError(recruitmentError(e)); }
      finally { setBusy(false); }
    }}>{busy ? '正在发布……' : '确认发布招募'}<ArrowUpRight size={18} /></button></div>{saved.current && error && <Link className="text-button" to={'/recruitments/' + saved.current.id} target="_blank" rel="noopener noreferrer">查看已经保存的内容 →</Link>}</div>
    : <form className="paper form-stack" noValidate onSubmit={e => { e.preventDefault(); previewDraft(); }}><fieldset className="recruitment-fields" disabled={busy || unavailable}>
      <h2>这次一起做什么</h2><label>招募区域<select aria-label="招募区域" value={draft.category} disabled={!!sourceId} onChange={e => { setDraft(d => sceneDraft(d, e.target.value as RecruitmentDraft['category'])); setSlotSkills({}); }}>{categories.map(c => <option key={c} value={c}>{categoryInfo[c].name}</option>)}</select></label><label>招募主题<select aria-label={draft.category === 'COMPETITION' ? '竞赛主题' : '招募主题'} value={draft.topicId || ''} disabled={!topics.data} onChange={e => change('topicId', e.target.value || null)}><option value="">请选择</option>{topics.data?.data.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>{topics.isError && <ErrorState message="读取主题失败，请重试" retry={() => void topics.refetch()} />}
      <label>招募标题<input aria-label="招募标题" value={draft.title} onChange={e => change('title', e.target.value)} maxLength={60} placeholder="5—60 个字，说明想找怎样的伙伴" /></label>
      <label>招募说明<textarea aria-label="招募说明" rows={5} value={draft.description} onChange={e => change('description', e.target.value)} maxLength={3000} placeholder="20—3000 个字，说明项目、分工与合作期待" /></label>
      {draft.category === 'COMPETITION' && <><label>比赛名称<input aria-label="比赛名称" value={draft.competitionName} maxLength={100} onChange={e => change('competitionName', e.target.value)} /></label>
      <label>比赛官方链接（可选）<input type="url" value={draft.officialUrl} onChange={e => change('officialUrl', e.target.value)} placeholder="https://" maxLength={500} /></label>
      <label>项目方向<input aria-label="项目方向" value={draft.direction} onChange={e => change('direction', e.target.value)} maxLength={200} /></label>
      </>}
      <label>本次目标<input aria-label="本次目标" value={draft.goal} onChange={e => change('goal', e.target.value)} maxLength={100} placeholder="例如：完成可以演示的校园应用" /></label>
      {draft.category === 'COMPETITION' && <label>已有技能（自述，可选）<input value={skills} onChange={e => setSkills(e.target.value)} placeholder="用逗号分隔，例如：前端开发，设计" /></label>}
      <h2>时间和协作方式</h2><p className="form-note">所有日期按北京时间填写和展示。招募截止留空时使用协作开始时间，且发布时必须晚于现在。</p>
      <div className="form-row">{dateField('startAt', '协作开始时间')}{dateField('endAt', '协作结束时间')}</div><div className="form-row">{dateField('joinDeadline', '招募截止时间（可选）')}{draft.category === 'COMPETITION' && dateField('competitionDeadline', '比赛截止时间')}</div>
      <div className="form-row"><label>协作形式<select value={draft.mode} onChange={e => change('mode', e.target.value as 'ONLINE' | 'OFFLINE')}><option value="ONLINE">线上</option><option value="OFFLINE">线下</option></select></label><label>预计每周投入（小时）<input aria-label="预计每周投入（小时）" type="number" min={1} max={60} value={draft.weeklyHours} onChange={e => change('weeklyHours', Number(e.target.value))} /></label></div>
      {draft.mode === 'OFFLINE' && <label>公开集合区域<input value={draft.locationPublic} onChange={e => change('locationPublic', e.target.value)} maxLength={120} placeholder="只填粗粒度区域，不填私人联系方式" /></label>}
      <label>协作时段说明<textarea aria-label="协作时段说明" rows={2} value={draft.collaboration} onChange={e => change('collaboration', e.target.value)} maxLength={300} placeholder="例如：周二、周四 19:00—21:00，申请前再确认具体安排" /></label>
      <label className="checkbox-field"><input type="checkbox" checked={draft.allowCrossSchool} onChange={e => change('allowCrossSchool', e.target.checked)} />接受跨校意向（按身份资料校验）</label>
      <label>加入方式<select aria-label="加入方式" value={draft.joinMode} onChange={e => change('joinMode', e.target.value as 'AUTO' | 'APPROVAL')}><option value="APPROVAL">申请后由队长审核</option><option value="AUTO">条件通过后直接加入</option></select></label>
      {draft.category === 'GAME' && draft.game && <><h2>游戏安排</h2><label>服务器或大区<input aria-label="服务器或大区" value={draft.game.server} maxLength={80} onChange={e => change('game', { ...draft.game!, server: e.target.value })} /></label><label>游戏平台<select value={draft.game.platform} onChange={e => change('game', { ...draft.game!, platform: e.target.value as 'PC' })}><option value="ANY">不限</option><option value="PC">PC</option><option value="CONSOLE">主机</option><option value="MOBILE">手机</option></select></label><label>游戏玩法<input aria-label="游戏玩法" value={draft.game.playMode} maxLength={100} onChange={e => change('game', { ...draft.game!, playMode: e.target.value })} /></label><label>语音偏好<input value={draft.game.voice || ''} maxLength={100} onChange={e => change('game', { ...draft.game!, voice: e.target.value })} /></label></>}
      {draft.category === 'STUDY' && draft.study && <><h2>学习安排</h2><label>科目与学习目标<input aria-label="科目与学习目标" value={draft.study.subject} maxLength={100} onChange={e => change('study', { ...draft.study!, subject: e.target.value })} /></label><label>基础水平偏好<input value={draft.study.level} maxLength={100} onChange={e => change('study', { ...draft.study!, level: e.target.value })} /></label><label>学习方式<select value={draft.study.method} onChange={e => change('study', { ...draft.study!, method: e.target.value as 'SELF' })}><option value="SELF">安静自习</option><option value="DISCUSS">讨论</option><option value="TEACH">互相讲题</option></select></label><label className="checkbox-field"><input type="checkbox" checked={draft.study.methodRequired} onChange={e => change('study', { ...draft.study!, methodRequired: e.target.checked })} />要求参与者选择相同学习方式</label><label>频次与具体时段<input aria-label="频次与具体时段" value={draft.study.frequency} maxLength={200} onChange={e => change('study', { ...draft.study!, frequency: e.target.value })} /></label></>}
      {draft.category === 'OUTDOOR' && draft.outdoor && <><h2>户外安排</h2>{(['activity','region','distance','experience','equipment'] as const).map((field, i) => <label key={field}>{['活动类型','出发及集合区域','预计路程或时长','经验要求（空为不限）','装备要求（空为不限）'][i]}<input aria-label={['活动类型','出发及集合区域','预计路程或时长','经验要求','装备要求'][i]} value={draft.outdoor![field]} maxLength={field === 'region' ? 120 : field === 'experience' || field === 'equipment' ? 200 : 100} onChange={e => change('outdoor', { ...draft.outdoor!, [field]: e.target.value })} /></label>)}<label>每人预算上限（元）<input aria-label="每人预算上限（元）" type="number" min={0} max={100000} value={draft.outdoor.budget} onChange={e => change('outdoor', { ...draft.outdoor!, budget: Number(e.target.value) })} /></label><label>活动强度<select value={draft.outdoor.intensity} onChange={e => change('outdoor', { ...draft.outdoor!, intensity: e.target.value as 'LOW' })}><option value="LOW">低强度</option><option value="MEDIUM">中等强度</option></select></label><p className="form-note">公开页仅填粗略区域，具体集合点入队后在公告约定。平台不收取费用。</p></>}
      <h2>岗位和人数</h2><label>队伍总人数（含队长）<input aria-label="队伍总人数（含队长）" type="number" min={2} max={20} value={draft.capacity} onChange={e => change('capacity', Number(e.target.value))} /></label><p className="form-note">岗位合计 {draft.slots.reduce((sum, s) => sum + s.capacity, 0)} 人 / 队伍 {draft.capacity} 人。每位成员占一个岗位，我也占一个名额。</p>
      {draft.category === 'COMPETITION' && <><div className="slot-editor-list">{draft.slots.map((s, i) => <section className="slot-editor" key={s.key}><div className="form-row"><label>岗位 {i + 1} 名称<input aria-label={`岗位 ${i + 1} 名称`} value={s.name} maxLength={30} onChange={e => change('slots', draft.slots.map(v => v.key === s.key ? { ...v, name: e.target.value } : v))} /></label><label>岗位 {i + 1} 人数<input aria-label={`岗位 ${i + 1} 人数`} type="number" min={1} max={20} value={s.capacity} onChange={e => change('slots', draft.slots.map(v => v.key === s.key ? { ...v, capacity: Number(e.target.value) } : v))} /></label></div><label>所需技能（逗号分隔）<input aria-label={`岗位 ${i + 1} 所需技能`} value={slotSkills[s.key] || ''} onChange={e => setSlotSkills(v => ({ ...v, [s.key]: e.target.value }))} /></label>{draft.slots.length > 1 && <button type="button" className="text-button danger" onClick={() => { change('slots', draft.slots.filter(v => v.key !== s.key)); if (draft.captainSlotKey === s.key) change('captainSlotKey', null); }}>移除岗位 {i + 1}</button>}</section>)}</div>
      {draft.slots.length < 8 && <button type="button" className="button secondary" onClick={() => change('slots', [...draft.slots, { key: crypto.randomUUID(), name: '', capacity: 1, requiredSkills: [] }])}><Plus size={16} />增加岗位</button>}
      <label>我负责的岗位<select aria-label="我负责的岗位" value={draft.captainSlotKey || ''} onChange={e => change('captainSlotKey', e.target.value || null)}><option value="">请选择自己占据的岗位</option>{draft.slots.map((s, i) => <option key={s.key} value={s.key}>{s.name || `岗位 ${i + 1}`}</option>)}</select></label></>}
      <div className="publish-school">发布学校：{user.school.name}<span>学校与技能均为自述，未做认证。发布后可按所选方式入队，成员可使用群聊。</span>{draft.sourcePostId && <span>已关联来源讨论，发布不会修改原帖。</span>}</div>
      <FormError>{error}</FormError><div className="button-row"><button className="button secondary" type="button" disabled={busy || recoveryBlocked} onClick={() => void saveDraft()}><Save size={17} />{busy ? '正在保存……' : '保存私有草稿'}</button><button className="button" type="submit" disabled={busy || topics.isError || recoveryBlocked}>预览并发布<ArrowUpRight size={17} /></button></div><p className="form-note">保存草稿可暂不填正文和时间。失败时当前输入保留；只有收到保存成功后才已写入数据库。</p>
    </fieldset></form>}
  </section>;
}
