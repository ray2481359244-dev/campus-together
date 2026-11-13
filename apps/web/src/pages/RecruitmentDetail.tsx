import { ContactAction } from '../components/ContactAction';
import { ReportButton } from '../components/ReportButton';
import { SaveRecruitment } from '../components/Community';
import { PublishedRecruitmentEdit } from '../components/PublishedRecruitmentEdit';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { RecruitmentDTO } from '@campus/contracts';
import { Users, ArrowUpRight } from 'lucide-react';
import { api, messageOf } from '../lib/api';
import { beijingTime, budgetLabel, scheduleLabel } from '../lib/recruitments';
import { useAuth } from '../lib/auth';
import { messageLink } from '../lib/messaging';
import { rememberScroll } from '../lib/scroll';
import { Loading, ErrorState, PageTitle } from '../components/UI';
import { ApplicationPanel } from '../components/ApplicationPanel';

import { MatchExplanation } from '../components/MatchExplanation';

export function RecruitmentDetail() {
  const { id } = useParams(), { user } = useAuth(), location = useLocation(), navigate = useNavigate();
  const result = useQuery({ queryKey: ['recruitment', id, user?.id], queryFn: () => api<RecruitmentDTO>('/recruitments/' + id), retry: false });
  if (result.isPending) return <Loading label="正在读取招募……" />;
  if (result.isError) return <><Link className="text-button" to="/recruitments">返回招募大厅</Link><ErrorState message={messageOf(result.error)} retry={() => void result.refetch()} /></>;
  const r = result.data.data, d = r.draft, team = r.team;
  const fromNotice = location.state?.fromNotice, fromChat = location.state?.fromChat;
  const subtitle = d.competitionName || d.game?.playMode || d.study?.subject || d.outdoor?.activity;
  const close = r.joinClosesAt || d.joinDeadline || d.startAt;
  const schedule = d.plan ? scheduleLabel(d) : beijingTime(d.startAt) + ' 至 ' + beijingTime(d.endAt);
  const workload = [d.weeklyHours ? '每周约 ' + d.weeklyHours + ' 小时' : '', d.collaboration].filter(Boolean).join(' · ');
  const facts = [
    ['协作形式', d.mode === 'ONLINE' ? '线上' : '线下 · ' + d.locationPublic],
    ['协作时间', schedule + (d.startAt ? '（北京时间）' : '')],
    ['招募截止', close ? beijingTime(close) + '（北京时间）' : '发布后 7 天内'],
    ['比赛截止', d.competitionDeadline && beijingTime(d.competitionDeadline) + '（北京时间）'],
    ['投入与时段', workload],
    ['目标', d.goal],
    ['已有技能', d.existingSkills.length ? d.existingSkills.join('、') + '（自述）' : ''],
    ['学校范围', (d.allowCrossSchool ? '接受跨校意向' : '仅限同校意向') + ' · 学校未核验'],
    ['加入方式', d.joinMode === 'AUTO' ? '直接加入' : '发起人确认'],
  ];
  return <section className="form-page">
    {fromNotice || fromChat ? <button type="button" className="text-button" onClick={() => navigate(-1)}>{fromNotice ? '返回通知' : '返回会话'}</button>
      : <Link className="text-button" to="/recruitments">返回招募大厅</Link>}
    <PageTitle contentTitle title={r.title || '未命名招募草稿'} eyebrow={r.publicationStatus === 'DRAFT' ? 'PRIVATE DRAFT / ONLY YOU' : undefined} />
    {r.canEditDraft && <div className="success-notice">这份草稿仅自己可见，尚未创建队伍。<Link to={'/recruitments/' + id + '/edit'}>继续编辑 →</Link></div>}
    {location.state?.justPublished && team && <div className="success-notice">
      <p role="status">招募已发布，队伍群已创建。</p>
      <Link className="button" to={messageLink({ kind: 'TEAM', id: team.id })} state={{ returnTo: location.pathname }} onClick={() => rememberScroll(location.key)}>进入队伍群</Link>
    </div>}
    <article className="recruitment-detail layered-detail">
      <section className="surface-story">
        <div className="post-card-top"><span className={'topic-badge cat-' + r.category}>{r.topic?.name || '主题待选'}</span><span>{r.author.nickname} · {r.school.name}</span></div>
        {subtitle && <h2>{subtitle}</h2>}{d.direction && <p className="recruitment-direction">{d.direction}</p>}
        {r.description && <div className="post-body">{r.description}</div>}
      </section>
      <section className="surface-reference"><h2>时间、条件与协作安排</h2>
        <dl className="recruitment-facts">
          {facts.map(([label, value]) => value ? <div key={label}><dt>{label}</dt><dd>{value}</dd></div> : null)}
          {d.game && <div><dt>服务器 / 平台 / 语音</dt><dd>{[d.game.server || '不限服务器', { PC: '电脑', MOBILE: '手机', CONSOLE: '主机', ANY: '不限平台' }[d.game.platform], d.game.voice].filter(Boolean).join(' · ')}</dd></div>}
          {d.study && <div><dt>学习安排</dt><dd>{[{ SELF: '安静自习', DISCUSS: '讨论', TEACH: '互相讲题' }[d.study.method], d.study.frequency, d.study.level].filter(Boolean).join(' · ')}{d.study.methodRequired ? '（须选择相同学习方式）' : ''}</dd></div>}
          {d.outdoor && <>
            <div><dt>预算与强度</dt><dd>{[budgetLabel(d), d.outdoor.intensity === 'LOW' ? '低强度' : '中等强度', d.outdoor.distance].filter(Boolean).join(' · ')}</dd></div>
            {(d.outdoor.experience || d.outdoor.equipment) && <div><dt>经验与装备</dt><dd>{[d.outdoor.experience, d.outdoor.equipment].filter(Boolean).join(' · ')}</dd></div>}
          </>}
        </dl>
      </section>
      {d.officialUrl && <a className="text-button" href={d.officialUrl} target="_blank" rel="noopener noreferrer">查看发布者提供的比赛链接<ArrowUpRight size={16} /></a>}
      {team && <>
        <section className="surface-action"><h2 className="recruit-section-title"><Users size={22} />岗位与名额</h2>
          <p className="form-note">当前 {team.memberCount} / {team.capacity} 人，总人数包含队长。每位成员只占一个岗位。</p>
          <div className="slot-list">{team.slots.map(slot => <div className="slot-summary" key={slot.id}><div><strong>{slot.name}</strong>
            {slot.requiredSkills.length > 0 && <p>{d.plan && !d.plan.skillsRequired ? '技能偏好' : '所需自述技能'}：{slot.requiredSkills.join('、')}</p>}</div>
            <span>{slot.occupied} / {slot.capacity} 已占 · 余 {slot.capacity - slot.occupied}</span></div>)}</div>
        </section>
        <section className="surface-talk">
          <ApplicationPanel key={r.id} recruitment={r} />
          <ContactAction userId={r.author.id} nickname={r.author.nickname} source={{ kind: 'RECRUITMENT', recruitmentId: r.id }} sourceLabel="附上这条招募" text="私聊询问" />
        </section>
        {d.category === 'COMPETITION' && <MatchExplanation key={r.id} recruitment={r} />}
      </>}
      {d.sourcePostId && (r.sourceAvailable ? <Link className="text-button" to={'/posts/' + d.sourcePostId}>查看来源讨论<ArrowUpRight size={16} /></Link>
        : <p className="form-note">来源讨论已不可用；这份已发布招募仍独立保留。</p>)}
      <p className="detail-time">{r.publishedAt ? '发布于 ' + beijingTime(r.publishedAt) : '草稿更新于 ' + beijingTime(r.updatedAt)}（北京时间）。</p>
      <ReportButton type="RECRUITMENT" id={r.id} /><SaveRecruitment id={r.id} /><PublishedRecruitmentEdit value={r} />
    </article>
  </section>;
}
