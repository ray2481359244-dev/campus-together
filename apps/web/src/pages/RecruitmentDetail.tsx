import { ContactAction } from '../components/ContactAction';
import { ReportButton } from '../components/ReportButton';
import { SaveRecruitment } from '../components/Community';
import { PublishedRecruitmentEdit } from '../components/PublishedRecruitmentEdit';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import type { RecruitmentDTO } from '@campus/contracts';
import { gameRequirements, hasNamedSeats, isTabletop, recruitmentCopy } from '@campus/contracts';
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
  const copy = recruitmentCopy(r.category), tabletop = isTabletop(d);
  const competition = r.category === 'COMPETITION';
  const named = !!team && hasNamedSeats(team.slots);
  const subtitle = { COMPETITION: d.competitionName, GAME: d.game?.playMode, STUDY: d.study?.subject, OUTDOOR: d.outdoor?.activity }[r.category];
  const close = r.joinClosesAt || d.joinDeadline || d.startAt;
  const time = (value: string | null) => value && beijingTime(value) + '（北京时间）';
  const onlineGame = r.category === 'GAME' && !tabletop && d.game;
  const requiredGame = gameRequirements(d);
  const study = r.category === 'STUDY' && d.study;
  const outdoor = r.category === 'OUTDOOR' && d.outdoor;
  const locationLabel = outdoor || d.mode === 'OFFLINE' || tabletop ? copy.place : '参加方式';
  const place = outdoor ? outdoor.region || d.locationPublic : tabletop ? d.locationPublic : d.mode === 'OFFLINE' ? d.locationPublic : '线上';
  const facts: [string, string | false | null | undefined][] = [
    [tabletop && !place ? '参加方式' : locationLabel, place || (tabletop ? '线下桌游' : '')],
    [copy.start, time(d.startAt) || scheduleLabel(d)],
    [copy.end, time(d.endAt)],
    ['报名截止', time(close)],
    ['赛事截止', competition && time(d.competitionDeadline)],
    [competition ? '协作安排' : '补充安排', [competition && d.weeklyHours ? '每周约 ' + d.weeklyHours + ' 小时' : '', d.collaboration].filter(Boolean).join(' · ')],
    [competition ? '项目目标' : '想一起做', d.goal],
    ['已有技能', competition && d.existingSkills.length > 0 && d.existingSkills.join('、') + '（本人填写）'],
    ['区服', (onlineGame || requiredGame.server) && d.game?.server !== '不限' && d.game?.server],
    ['平台', (onlineGame || requiredGame.platform) && d.game && { PC: '电脑', MOBILE: '手机', CONSOLE: '主机', ANY: '' }[d.game.platform]],
    ['语音', onlineGame && onlineGame.voice],
    ['学习方式', study && ({ SELF: '安静自习', DISCUSS: '讨论', TEACH: '互相讲题' }[study.method] + (study.methodRequired ? '（需要方式一致）' : ''))],
    ['学习频次', study && study.frequency],
    ['基础偏好', study && study.level],
    ['费用', outdoor && budgetLabel(d)],
    ['强度与路程', outdoor && [outdoor.intensity === 'LOW' ? '低强度' : '中等强度', outdoor.distance].filter(Boolean).join(' · ')],
    ['注意事项', outdoor && [outdoor.experience, outdoor.equipment].filter(Boolean).join(' · ')],
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
        {subtitle && <h2>{subtitle}</h2>}{competition && d.direction && <p className="recruitment-direction">{d.direction}</p>}
        {r.description && <div className="post-body">{r.description}</div>}
      </section>
      <section className="surface-reference"><h2>{copy.details}</h2>
        <dl className="recruitment-facts">
          {facts.map(([label, value]) => value && <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
      </section>
      {competition && d.officialUrl && <a className="text-button" href={d.officialUrl} target="_blank" rel="noopener noreferrer">查看发布者提供的比赛链接<ArrowUpRight size={16} /></a>}
      {team && <>
        <section className="surface-action"><h2 className="recruit-section-title"><Users size={22} aria-hidden="true" />{competition && named ? '分工与名额' : copy.capacity}</h2>
          <p className="form-note">当前 {team.memberCount} / {team.capacity} 人，含发起人 · {team.acceptingStatus === 'FULL' ? '已满员' : team.acceptingStatus === 'CLOSED' ? '报名已结束' : `还差 ${team.capacity - team.memberCount} 位`}</p>
          {named && <div className="slot-list">{team.slots.map(slot => <div className="slot-summary" key={slot.id}><div><strong>{slot.name}</strong>
            {slot.requiredSkills.length > 0 && <p>{d.plan && !d.plan.skillsRequired ? '技能偏好' : '所需自述技能'}：{slot.requiredSkills.join('、')}</p>}</div>
            <span>{slot.occupied} / {slot.capacity} 已占 · 余 {slot.capacity - slot.occupied}</span></div>)}</div>}
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
