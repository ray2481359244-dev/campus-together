import type { RecruitmentDraft, TopicDTO } from '@campus/contracts';
import { categories, categoryInfo, hasNamedSeats, isTabletop, recruitmentCopy } from '@campus/contracts';
import { CalendarDays, Plus } from 'lucide-react';
import { beijingInput, fromBeijingInput } from '../lib/recruitments';
import { SoftDisclosure } from './SoftDisclosure';

const templates = { GAME: '今晚开黑', STUDY: '一起自习', COMPETITION: '找竞赛队友', OUTDOOR: '周末走走' };
const platformNames = { ANY: '不限', PC: '电脑', CONSOLE: '主机', MOBILE: '手机' };

function upcomingTime(day: 'tonight' | 'tomorrow' | 'weekend') {
  const local = new Date(Date.now() + 8 * 3600_000);
  if (day === 'tomorrow') local.setUTCDate(local.getUTCDate() + 1);
  if (day === 'weekend') {
    const saturday = (6 - local.getUTCDay() + 7) % 7;
    local.setUTCDate(local.getUTCDate() + (saturday || (local.getUTCHours() >= 14 ? 7 : 0)));
  }
  local.setUTCHours(day === 'tonight' ? 20 : day === 'tomorrow' ? 19 : 14, 0, 0, 0);
  return new Date(local.getTime() - 8 * 3600_000).toISOString();
}

type Props = {
  draft: RecruitmentDraft;
  update: (values: Partial<RecruitmentDraft>) => void;
  onCategory: (category: RecruitmentDraft['category']) => void;
  topics: TopicDTO[] | undefined;
  sourceLocked: boolean;
  skills: string;
  onSkills: (skills: string) => void;
  slotSkills: Record<string, string>;
  onSlotSkills: (key: string, skills: string) => void;
  errors: Record<string, string>;
};

export function RecruitmentFields({ draft: d, update, onCategory, topics, sourceLocked, skills, onSkills, slotSkills, onSlotSkills, errors }: Props) {
  const plan = d.plan, fixed = !plan || plan.schedule === 'FIXED';
  const detailed = hasNamedSeats(d.slots);
  const copy = recruitmentCopy(d.category), tabletop = isTabletop(d);
  const isOutdoor = d.category === 'OUTDOOR';
  const report = (key: string) => errors[key] && <span className="field-error">{errors[key]}</span>;
  const date = (key: 'startAt' | 'endAt' | 'joinDeadline' | 'competitionDeadline', label: string) =>
    <label>{label}<input type="datetime-local" aria-label={label} aria-invalid={!!errors[key]} value={beijingInput(d[key])}
      onChange={e => update({ [key]: fromBeijingInput(e.target.value) })} />{report(key)}</label>;
  const changePlan = (values: Partial<NonNullable<RecruitmentDraft['plan']>>) => { if (plan) update({ plan: { ...plan, ...values } }); };
  function schedule(value: NonNullable<RecruitmentDraft['plan']>['schedule']) {
    if (!plan) return;
    update({
      plan: { ...plan, schedule: value },
      ...(value === 'FIXED' ? {} : { startAt: null, endAt: null }),
      ...(isOutdoor && value === 'FLEXIBLE' ? { joinMode: 'APPROVAL' as const } : {}),
    });
  }
  function setCapacity(capacity: number) {
    update({ capacity, ...(detailed ? {} : { slots: d.slots.map(slot => ({ ...slot, capacity })) }) });
  }
  function setMode(mode: RecruitmentDraft['mode']) {
    const resetGame = d.category === 'GAME' && d.game && (mode === 'OFFLINE' || tabletop);
    update({
      mode,
      ...(resetGame ? { game: { ...d.game!, server: '', platform: 'ANY' as const, voice: '' } } : {}),
      ...(resetGame && plan ? { plan: { ...plan, serverRequired: false, platformRequired: false } } : {}),
    });
  }
  function splitRoles(enabled: boolean) {
    const key = d.slots[0].key;
    update({
      captainSlotKey: key,
      slots: enabled
        ? [{ key, name: d.category === 'GAME' ? '带新手' : '项目统筹', capacity: 1, requiredSkills: [] }, { key: crypto.randomUUID(), name: d.category === 'GAME' ? '新手体验' : '开发伙伴', capacity: Math.max(d.capacity - 1, 1), requiredSkills: [] }]
        : [{ key, name: '成员', capacity: d.capacity, requiredSkills: [] }],
    });
    if (!enabled) onSlotSkills(key, '');
  }
  return <>
    <section className="form-chapter">
      <div className="form-row">
        <label>招募区域<select value={d.category} disabled={sourceLocked} onChange={e => onCategory(e.target.value as RecruitmentDraft['category'])}>
          {categories.map(c => <option key={c} value={c}>{categoryInfo[c].name}</option>)}
        </select></label>
        <label>招募主题<select value={d.topicId || ''} disabled={!topics} aria-invalid={!!errors.topicId} onChange={e => update({ topicId: e.target.value || null })}>
          <option value="">请选择</option>{topics?.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>{report('topicId')}</label>
      </div>
      <label>招募标题<input value={d.title} maxLength={60} aria-invalid={!!errors.title} placeholder={'例如：' + templates[d.category]}
        onChange={e => update({ title: e.target.value })} />{report('title')}</label>
      {plan && !d.title && <button type="button" className="text-button" onClick={() => update({ title: templates[d.category] })}>使用「{templates[d.category]}」模板</button>}
      <label>招募说明 <span className="optional-label">{plan ? '可选' : ''}</span><textarea aria-label="招募说明" rows={2} maxLength={3000} value={d.description}
        placeholder="有想补充的安排，可以写在这里" onChange={e => update({ description: e.target.value })} />{report('description')}</label>
      <label>{'再找几位' + copy.guest}<input type="number" min={1} max={19} value={d.capacity > 1 ? d.capacity - 1 : ''} aria-invalid={!!errors.capacity}
        onChange={e => setCapacity(e.target.valueAsNumber + 1 || 0)} />{report('capacity')}</label>
      <p className="form-note">你{d.capacity > 1 ? ' + ' + (d.capacity - 1) + ' 位伙伴，共 ' + d.capacity + ' 人' : '也占 1 个名额'}</p>
    </section>
    <section className="form-chapter chapter-reference">
      <h2><CalendarDays size={20} aria-hidden="true" /> {copy.details}</h2>
      {plan && <><div className="choice-strip" aria-label="时间快捷选择">
        {(['tonight', 'tomorrow', 'weekend'] as const).map((day, i) => <button key={day} type="button" disabled={Date.parse(upcomingTime(day)) <= Date.now()}
          aria-pressed={fixed && d.startAt === upcomingTime(day)} onClick={() => update({ plan: { ...plan, schedule: 'FIXED' }, startAt: upcomingTime(day), endAt: null })}>
          {['今晚 20:00', '明晚 19:00', '周六 14:00'][i]}
        </button>)}
      </div><label>时间安排<select value={plan.schedule} onChange={e => schedule(e.target.value as typeof plan.schedule)}>
        <option value="FLEXIBLE">{isOutdoor ? '筹划中，时间待确认' : '时间待商量'}</option><option value="FIXED">确定时间</option>
        {!isOutdoor && <option value="RECURRING">长期招募</option>}
      </select>{!fixed && report('startAt')}</label></>}
      {fixed && date('startAt', copy.start)}
      <div className="form-row">
        {!isOutdoor && <label>{d.category === 'GAME' ? '怎么玩' : '参加方式'}<select value={tabletop ? 'OFFLINE' : d.mode}
          onChange={e => setMode(e.target.value as RecruitmentDraft['mode'])}>
          <option value="ONLINE">{d.category === 'GAME' ? '线上联机' : '线上'}</option><option value="OFFLINE">{d.category === 'GAME' ? '线下桌游' : '线下'}</option></select></label>}
        {(d.mode === 'OFFLINE' || tabletop || isOutdoor) && <label>{copy.place}<input value={d.locationPublic} maxLength={120} placeholder="例如：学校东区"
          aria-invalid={!!errors.locationPublic} onChange={e => update({ locationPublic: e.target.value,
            ...(d.outdoor && plan ? { outdoor: { ...d.outdoor, region: e.target.value } } : {}) })} />{report('locationPublic')}</label>}
      </div>
      {isOutdoor && <p className="field-note">公开填写大致区域，具体集合点可在队伍群里确认。</p>}
      {d.outdoor && isOutdoor && <div className="form-row">
        <label>活动强度<select value={d.outdoor.intensity} onChange={e => update({ outdoor: { ...d.outdoor!, intensity: e.target.value as 'LOW' | 'MEDIUM' } })}>
          <option value="LOW">低强度</option><option value="MEDIUM">中等强度</option></select></label>
        {plan && <label>费用<select value={plan.budgetKnown ? 'KNOWN' : 'UNKNOWN'} onChange={e => changePlan({ budgetKnown: e.target.value === 'KNOWN' })}>
          <option value="UNKNOWN">费用待确认</option><option value="KNOWN">填写每人预算</option></select></label>}
        {(!plan || plan.budgetKnown) && <label>每人预算上限（元）<input type="number" min={0} max={100000} value={d.outdoor.budget}
          onChange={e => update({ outdoor: { ...d.outdoor!, budget: e.target.valueAsNumber || 0 } })} /></label>}
      </div>}
      <label>加入方式<select value={d.joinMode} onChange={e => update({ joinMode: e.target.value as RecruitmentDraft['joinMode'] })}>
        <option value="AUTO" disabled={isOutdoor && plan?.schedule === 'FLEXIBLE'}>直接加入</option><option value="APPROVAL">我来确认</option>
      </select>{report('joinMode')}</label>
      <p className="form-note">{d.joinMode === 'AUTO' ? '符合条件即可占位并进入队伍群。' : '由发起人确认后入队，待确认期间不占位。'}</p>
    </section>
    <SoftDisclosure title="更多安排与要求" initialOpen={!plan}>
      <section className="form-stack recruitment-options">
        <div className="form-row">{fixed && date('endAt', copy.end)}{date('joinDeadline', '报名截止时间（可选）')}</div>
        <p className="form-note">按北京时间填写。未指定截止时，默认用活动开始时间。时间待商量时默认招募 7 天。</p>
        <label>{d.category === 'COMPETITION' ? '协作时段说明' : '补充安排'}<textarea rows={2} maxLength={300} value={d.collaboration} onChange={e => update({ collaboration: e.target.value })} />{report('collaboration')}</label>
        <label>{d.category === 'COMPETITION' ? '本次目标' : '想一起做什么'}<input maxLength={100} value={d.goal} onChange={e => update({ goal: e.target.value })} />{report('goal')}</label>
        <label className="checkbox-field"><input type="checkbox" checked={d.allowCrossSchool} onChange={e => update({ allowCrossSchool: e.target.checked })} />接受跨校意向（按身份资料校验）</label>
        {d.category === 'COMPETITION' && <>
          <div className="form-row">
            <label>比赛名称<input maxLength={100} value={d.competitionName} onChange={e => update({ competitionName: e.target.value })} />{report('competitionName')}</label>
            <label>项目方向<input maxLength={200} value={d.direction} onChange={e => update({ direction: e.target.value })} /></label>
          </div>
          {date('competitionDeadline', '赛事截止时间')}
          <label>比赛官方链接（可选）<input type="url" maxLength={500} value={d.officialUrl} placeholder="https://" onChange={e => update({ officialUrl: e.target.value })} />{report('officialUrl')}</label>
          <label>预计每周投入（小时）<input type="number" min={1} max={60} value={d.weeklyHours ?? ''} onChange={e => update({ weeklyHours: e.target.valueAsNumber || null })} /></label>
          <label>已有技能（自述）<input value={skills} onChange={e => onSkills(e.target.value)} placeholder="用逗号分隔" /></label>
        </>}
        {(d.category === 'COMPETITION' || d.category === 'GAME' && plan) && <>
          <label className="checkbox-field"><input type="checkbox" checked={detailed} onChange={e => splitRoles(e.target.checked)} />{d.category === 'COMPETITION' ? '设置具体分工' : '区分队友类型'}</label>
          {detailed && <>
            <div className="slot-editor-list">{d.slots.map((slot, i) => <section className="slot-editor" key={slot.key}>
              <div className="form-row">
                <label>{copy.slot} {i + 1} 名称<input value={slot.name} maxLength={30} onChange={e => update({ slots: d.slots.map(s => s.key === slot.key ? { ...s, name: e.target.value } : s) })} /></label>
                <label>{copy.slot} {i + 1} 人数<input type="number" min={1} max={20} value={slot.capacity || ''} onChange={e => update({ slots: d.slots.map(s => s.key === slot.key ? { ...s, capacity: e.target.valueAsNumber || 0 } : s) })} /></label>
              </div>
              {d.category === 'COMPETITION' && <label>分工 {i + 1} 所需技能<input value={slotSkills[slot.key] || ''} placeholder="用逗号分隔" onChange={e => onSlotSkills(slot.key, e.target.value)} /></label>}
              {d.slots.length > 1 && <button type="button" className="text-button danger" onClick={() => update({ slots: d.slots.filter(s => s.key !== slot.key), ...(d.captainSlotKey === slot.key ? { captainSlotKey: null } : {}) })}>移除{copy.slot} {i + 1}</button>}
            </section>)}</div>
            <p className="form-note">名额合计 {d.slots.reduce((sum, slot) => sum + slot.capacity, 0)} 人 / 队伍 {d.capacity} 人</p>{report('slots')}
            {d.slots.length < 8 && <button type="button" className="button secondary" onClick={() => update({ slots: [...d.slots, { key: crypto.randomUUID(), name: '', capacity: 1, requiredSkills: [] }] })}><Plus size={16} />增加{copy.slot}</button>}
            <label>{'我的' + copy.slot}<select value={d.captainSlotKey || ''} onChange={e => update({ captainSlotKey: e.target.value || null })}>
              <option value="">请选择</option>{d.slots.map((s, i) => <option key={s.key} value={s.key}>{s.name || copy.slot + ' ' + (i + 1)}</option>)}
            </select>{report('captainSlotKey')}</label>
            {plan && d.category === 'COMPETITION' && <label className="checkbox-field"><input type="checkbox" checked={plan.skillsRequired} onChange={e => changePlan({ skillsRequired: e.target.checked })} />分工技能为必要条件</label>}
          </>}
        </>}
        {d.game && d.category === 'GAME' && <>
          <label>{tabletop ? '桌游名称或玩法' : '游戏名称或玩法'}<input value={d.game.playMode} maxLength={100} onChange={e => update({ game: { ...d.game!, playMode: e.target.value } })} /></label>
          {!tabletop && <>
          <label>服务器或大区<input value={d.game.server} maxLength={80} onChange={e => update({ game: { ...d.game!, server: e.target.value } })} />{report('server')}</label>
          {plan && <label className="checkbox-field"><input type="checkbox" checked={plan.serverRequired} onChange={e => changePlan({ serverRequired: e.target.checked })} />必须在同一服务器</label>}
          <label>游戏平台<select value={d.game.platform} onChange={e => update({ game: { ...d.game!, platform: e.target.value as keyof typeof platformNames } })}>
            {Object.entries(platformNames).map(([value, name]) => <option key={value} value={value}>{name}</option>)}
          </select>{report('platform')}</label>
          {plan && <label className="checkbox-field"><input type="checkbox" checked={plan.platformRequired} onChange={e => changePlan({ platformRequired: e.target.checked })} />必须在同一平台</label>}
          <label>语音偏好<input value={d.game.voice || ''} maxLength={100} onChange={e => update({ game: { ...d.game!, voice: e.target.value } })} /></label>
          </>}
        </>}
        {d.study && d.category === 'STUDY' && <>
          <label>科目与学习目标<input value={d.study.subject} maxLength={100} onChange={e => update({ study: { ...d.study!, subject: e.target.value } })} /></label>
          <label>学习方式<select value={d.study.method} onChange={e => update({ study: { ...d.study!, method: e.target.value as 'SELF' | 'DISCUSS' | 'TEACH' } })}>
            <option value="SELF">安静自习</option><option value="DISCUSS">讨论</option><option value="TEACH">互相讲题</option>
          </select></label>
          <label className="checkbox-field"><input type="checkbox" checked={d.study.methodRequired} onChange={e => update({ study: { ...d.study!, methodRequired: e.target.checked } })} />必须选择相同学习方式</label>
          <label>基础水平偏好<input value={d.study.level} maxLength={100} onChange={e => update({ study: { ...d.study!, level: e.target.value } })} /></label>
          <label>频次与具体时段<input value={d.study.frequency} maxLength={200} onChange={e => update({ study: { ...d.study!, frequency: e.target.value } })} /></label>
        </>}
        {d.outdoor && isOutdoor && <>
          <label>活动类型<input value={d.outdoor.activity} maxLength={100} onChange={e => update({ outdoor: { ...d.outdoor!, activity: e.target.value } })} /></label>
          {!plan && <label>出发及集合区域<input value={d.outdoor.region} maxLength={120} onChange={e => update({ outdoor: { ...d.outdoor!, region: e.target.value } })} /></label>}
          <label>预计路程或时长<input value={d.outdoor.distance} maxLength={100} onChange={e => update({ outdoor: { ...d.outdoor!, distance: e.target.value } })} /></label>
          {(['experience', 'equipment'] as const).map((field, i) => <div className="form-stack" key={field}>
            <label>{i ? '装备建议' : '经验建议'}<input value={d.outdoor![field]} maxLength={200} onChange={e => update({ outdoor: { ...d.outdoor!, [field]: e.target.value } })} />{report(field)}</label>
            {plan && <label className="checkbox-field"><input type="checkbox" checked={plan[i ? 'equipmentRequired' : 'experienceRequired']} onChange={e => changePlan({ [i ? 'equipmentRequired' : 'experienceRequired']: e.target.checked })} />{i ? '装备' : '经验'}为必要条件</label>}
          </div>)}
        </>}
      </section>
    </SoftDisclosure>
  </>;
}
