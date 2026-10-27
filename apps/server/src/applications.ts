import { Router, type RequestHandler } from 'express';
import { createHash } from 'node:crypto';
import { CreateApplicationSchema, EligibilityInputSchema, IdSchema, MyApplicationsQuerySchema, WithdrawApplicationSchema, ReviewApplicationSchema, CaptainApplicationsQuerySchema, RecruitmentDraftSchema } from '@campus/contracts';
import type { ApplicationDTO, EligibilityDTO, EligibilityInput, CaptainApplicationDTO } from '@campus/contracts';
import { db } from './db.js';
import { requireUser, csrfGuard, writeLimit } from './auth.js';
import { ApiError, parse } from './http.js';
import { recruitingWindow } from './team-rules.js';
import type { Prisma } from './generated/prisma/client.js';

const teamInclude = { recruitment: true, slots: { orderBy: { position: 'asc' as const } }, members: true } as const;
const applicationInclude = { team: { include: { recruitment: true, members: { include: { slot: { select: { name: true } } } } } }, slot: true, reviews: { orderBy: { createdAt: 'desc' as const }, take: 1 } } as const;
const captainInclude = { ...applicationInclude, applicant: { include: { profile: { include: { school: true } } } } } as const;
type Team = Prisma.TeamGetPayload<{ include: typeof teamInclude }>;
type Application = Prisma.ApplicationGetPayload<{ include: typeof applicationInclude }>;
const cooldownMs = 10 * 60_000;
const privateRead: RequestHandler = (_req, res, next) => { requireUser(res); res.setHeader('Cache-Control', 'no-store'); next(); };
async function publishedTeam(tx: Prisma.TransactionClient, id: string, lock = false) {
  const identity = await tx.team.findUnique({ where: { id }, select: { recruitmentId: true } });
  if (!identity) throw new ApiError(404, 'NOT_FOUND', '该招募不存在或尚未公开。');
  if (lock) {
    await tx.$queryRaw`SELECT "id" FROM "Recruitment" WHERE "id" = ${identity.recruitmentId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id" = ${id}::uuid FOR UPDATE`;
  }
  const team = await tx.team.findUnique({ where: { id }, include: teamInclude });
  if (!team || team.recruitment.publicationStatus !== 'PUBLISHED') throw new ApiError(404, 'NOT_FOUND', '该招募不存在或尚未公开。');
  return team;
}
export async function eligibility(tx: Prisma.TransactionClient, team: Team, userId: string, input: EligibilityInput, now: Date): Promise<EligibilityDTO> {
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, include: { profile: { include: { school: true } } } });
  const checks: EligibilityDTO['checks'] = [];
  const add = (code: string, label: string, status: 'PASS' | 'FAIL' | 'UNKNOWN', reason: string) => checks.push({ code, label, status, reason });
  add('ACCOUNT', '账号状态', user.status === 'ACTIVE' ? 'PASS' : 'FAIL', user.status === 'ACTIVE' ? '当前账号可提交申请。' : '当前账号不可申请。');
  const members = team.members.filter(m => m.status === 'ACTIVE');
  const open = recruitingWindow(team.status, team.recruitment.joinDeadline, now, team.recruitmentClosedAt);
  add('RECRUITING', '招募时间与总名额', open && members.length < team.recruitment.capacity ? 'PASS' : 'FAIL', !open ? '招募已停止或截止，不能提交新申请。' : members.length >= team.recruitment.capacity ? '当前队伍已满，不接收新申请。' : '招募进行中，待审核申请不占名额。');
  const member = team.members.find(m => m.userId === userId);
  add('MEMBERSHIP', '成员身份', member ? 'FAIL' : 'PASS', member?.status === 'ACTIVE' ? '你已是队伍成员，无需申请。' : member?.status === 'REMOVED' ? '被移除后不能再次申请同一队伍。' : member?.status === 'LEFT' ? '本版本退出后不能再次加入同一队伍。' : '你目前不是该队有效成员。');
  const profile = user.profile;
  add('SCHOOL', '学校范围（自述）', !profile?.school.active ? 'UNKNOWN' : team.recruitment.allowCrossSchool || profile.schoolId === team.recruitment.schoolId ? 'PASS' : 'FAIL', !profile?.school.active ? '请先补充有效的学校资料。' : team.recruitment.allowCrossSchool ? '发布者接受跨校意向；学校资料未核验。' : profile.schoolId === team.recruitment.schoolId ? '你的自述学校符合仅同校范围，未做认证。' : '你的身份资料学校不符合同校范围，浏览学校筛选不能替代身份资料。');
  const slot = team.slots.find(s => s.id === input.slotId);
  const occupied = members.filter(m => m.slotId === slot?.id).length;
  add('SLOT', '申请岗位', !input.slotId ? 'UNKNOWN' : !slot || occupied >= slot.capacity ? 'FAIL' : 'PASS', !input.slotId ? '请选择要申请的岗位。' : !slot ? '该岗位不属于这支队伍。' : occupied >= slot.capacity ? '这个岗位已满，请选择其他岗位。' : `岗位「${slot.name}」还有 ${slot.capacity - occupied} 个名额，审核通过才占位。`);
  const normalized = new Set((profile?.skills || []).map(s => s.normalize('NFKC').trim().toLowerCase()));
  const missing = slot?.requiredSkills.filter(s => !normalized.has(s.normalize('NFKC').trim().toLowerCase())) || [];
  add('SKILLS', '岗位技能（自述）', !slot || missing.length ? 'UNKNOWN' : 'PASS', !slot ? '选定岗位后才能核对技能。' : missing.length ? `资料尚未声明：${missing.join('、')}。请补充真实技能后重查；缺失不代表你没有能力。` : slot.requiredSkills.length ? '资料中的自述技能覆盖该岗位标签，仅作信息对照，不代表能力认证。' : '该岗位没有额外技能标签要求。');
  add('TIME', '本次时间确认', input.timeConfirmed === null ? 'UNKNOWN' : input.timeConfirmed ? 'PASS' : 'FAIL', input.timeConfirmed === null ? '请阅读协作起止、每周投入与时段，确认本次能否安排。' : input.timeConfirmed ? '你已确认本次可以安排所列协作时间与投入；不从自由文本自动推断时间匹配。' : '你本次无法安排所列协作时间，请选择其他招募。');
  const draft = RecruitmentDraftSchema.parse(team.recruitment.payload), answers = input.answers;
  const same = (a: string | undefined, b: string) => a?.normalize('NFKC').trim().toLowerCase() === b.normalize('NFKC').trim().toLowerCase();
  if (draft.category === 'GAME' && draft.game) {
    const g = draft.game;
    add('SERVER', '游戏服务器（自述）', g.server === '不限' ? 'PASS' : !answers?.server ? 'UNKNOWN' : same(answers.server, g.server) ? 'PASS' : 'FAIL', `所需服务器：${g.server}；本次填写：${answers?.server || '未填写'}。`);
    add('PLATFORM', '游戏平台（自述）', g.platform === 'ANY' ? 'PASS' : !answers?.platform ? 'UNKNOWN' : answers.platform === g.platform ? 'PASS' : 'FAIL', `所需平台：${g.platform}；本次填写：${answers?.platform || '未填写'}。`);
  }
  if (draft.category === 'STUDY' && draft.study?.methodRequired) add('STUDY_METHOD', '学习方式', !answers?.studyMethod ? 'UNKNOWN' : answers.studyMethod === draft.study.method ? 'PASS' : 'FAIL', `要求方式：${draft.study.method}；本次选择：${answers?.studyMethod || '未选择'}。`);
  for (const [field, label, requirement] of [['experienceConfirmed','经验要求',draft.outdoor?.experience],['equipmentConfirmed','装备要求',draft.outdoor?.equipment]] as const) {
    if (draft.category === 'OUTDOOR' && requirement) add(field, label, answers?.[field] === undefined ? 'UNKNOWN' : answers[field] ? 'PASS' : 'FAIL', `${requirement}；${answers?.[field] ? '本次已自行确认满足' : '需本人确认是否满足'}。`);
  }
  return { ruleVersion: draft.category === 'COMPETITION' ? 'competition-application-v2' : 'scene-application-v1', assessedAt: now.toISOString(), status: checks.some(c => c.status === 'FAIL') ? 'FAIL' : checks.some(c => c.status === 'UNKNOWN') ? 'UNKNOWN' : 'PASS', checks };
}
function dto(row: Application, now = new Date()): ApplicationDTO {
  const status = row.status === 'PENDING' && !recruitingWindow(row.team.status, row.team.recruitment.joinDeadline, now, row.team.recruitmentClosedAt) ? 'EXPIRED' : row.status;
  const review = row.reviews.find(r => r.submission === row.submission), member = row.team.members.find(m => m.userId === row.applicantId);
  return { id: row.id, teamId: row.teamId, recruitmentId: row.team.recruitmentId, recruitmentTitle: row.team.recruitment.title,
    slotId: row.slotId, slotName: row.slot.name, status, message: row.message, timeConfirmed: row.timeConfirmed,
    revision: row.revision, submission: row.submission, submittedAt: row.submittedAt.toISOString(), resolvedAt: row.resolvedAt?.toISOString() ?? null,
    canWithdraw: status === 'PENDING', reapplyAt: ['WITHDRAWN', 'REJECTED'].includes(row.status) && row.resolvedAt ? new Date(row.resolvedAt.getTime() + cooldownMs).toISOString() : null,
    eligibilitySnapshot: row.eligibilitySnapshot as unknown as EligibilityDTO, reviewAvailable: true,
    review: review ? { decision: review.decision, reason: review.reason, reviewedAt: review.createdAt.toISOString(), eligibilitySnapshot: review.eligibilitySnapshot as unknown as EligibilityDTO | null } : null,
    membership: member ? { status: member.status, slotName: member.slot.name, joinedAt: member.joinedAt.toISOString() } : null };
}
function captainDto(row: Prisma.ApplicationGetPayload<{ include: typeof captainInclude }>): CaptainApplicationDTO {
  const result = dto(row), profile = row.applicant.profile;
  return { ...result, canReview: result.status === 'PENDING', applicant: { id: row.applicantId, nickname: profile?.nickname || '校园用户', schoolName: profile?.school.name || '未填写', skills: profile?.skills || [], accountActive: row.applicant.status === 'ACTIVE' } };
}
function requireCaptain(team: Team, userId: string) {
  if (team.captainUserId !== userId || !team.members.some(m => m.userId === userId && m.role === 'CAPTAIN' && m.status === 'ACTIVE')) throw new ApiError(404, 'NOT_FOUND', '这支队伍不存在或无审核权限。');
}
export const applicationsRouter = Router();
applicationsRouter.post('/recruitments/:id/eligibility', privateRead, writeLimit, csrfGuard, async (req, res) => {
  const user = requireUser(res), id = parse(IdSchema, req.params.id), input = parse(EligibilityInputSchema, req.body);
  const result = await db.$transaction(async tx => {
    const identity = await tx.team.findUnique({ where: { recruitmentId: id }, select: { id: true } });
    if (!identity) throw new ApiError(404, 'NOT_FOUND', '该招募不存在或尚未公开。');
    return eligibility(tx, await publishedTeam(tx, identity.id), user.id, input, new Date());
  });
  res.json({ data: result });
});
applicationsRouter.get('/me/applications', privateRead, async (req, res) => {
  const user = requireUser(res), input = parse(MyApplicationsQuerySchema, req.query);
  const rows = await db.application.findMany({ where: { applicantId: user.id, teamId: input.teamId }, include: applicationInclude, orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], take: 50 });
  res.json({ data: rows.map(row => dto(row)) });
});
applicationsRouter.get('/teams/:id/applications', privateRead, async (req, res) => {
  const user = requireUser(res), teamId = parse(IdSchema, req.params.id), input = parse(CaptainApplicationsQuerySchema, req.query);
  const result = await db.$transaction(async tx => {
    const team = await publishedTeam(tx, teamId); requireCaptain(team, user.id);
    const now = new Date(), open = recruitingWindow(team.status, team.recruitment.joinDeadline, now, team.recruitmentClosedAt);
    const cursor = input.cursor ? await tx.application.findFirst({ where: { id: input.cursor, teamId } }) : null;
    if (input.cursor && !cursor) throw new ApiError(400, 'INVALID_CURSOR', '分页位置无效，请重新读取申请。');
    const where: Prisma.ApplicationWhereInput = { teamId, ...(input.status === 'PENDING' ? { status: { in: open ? ['PENDING'] : [] } } : {}),
      ...(cursor ? { OR: [{ submittedAt: { lt: cursor.submittedAt } }, { submittedAt: cursor.submittedAt, id: { lt: cursor.id } }] } : {}) };
    const rows = await tx.application.findMany({ where, include: captainInclude, orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }], take: 21 });
    const items = rows.slice(0, 20);
    return { items: items.map(captainDto), nextCursor: rows.length > 20 ? items.at(-1)!.id : null, pendingCount: open ? await tx.application.count({ where: { teamId, status: 'PENDING' } }) : 0 };
  });
  res.json({ data: result });
});
applicationsRouter.post('/applications/:id/review', privateRead, writeLimit, csrfGuard, async (req, res) => {
  const user = requireUser(res), id = parse(IdSchema, req.params.id), input = parse(ReviewApplicationSchema, req.body);
  const row = await db.$transaction(async tx => {
    const identity = await tx.application.findFirst({ where: { id, team: { captainUserId: user.id } }, select: { teamId: true, applicantId: true } });
    if (!identity) throw new ApiError(404, 'NOT_FOUND', '这份申请不存在或无审核权限。');
    // All account locks precede recruitment/team locks, including profile writes.
    const userIds = [identity.applicantId, user.id].sort();
    for (const userId of userIds) await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR NO KEY UPDATE`;
    const team = await publishedTeam(tx, identity.teamId, true); requireCaptain(team, user.id);
    if (!await tx.user.findFirst({ where: { id: user.id, status: 'ACTIVE' } })) throw new ApiError(401, 'AUTH_REQUIRED', '当前账号不可审核，请重新登录。');
    const current = await tx.application.findUniqueOrThrow({ where: { id }, include: captainInclude });
    const prior = await tx.applicationReview.findUnique({ where: { applicationId_expectedRevision: { applicationId: id, expectedRevision: input.revision } } });
    if (prior) {
      if (prior.submission !== current.submission || prior.decision !== input.decision || prior.reason !== input.reason || prior.reviewerId !== user.id) throw new ApiError(409, 'APPLICATION_CHANGED', '该版本已有审核结果或后续申请，请刷新核对。');
      return current;
    }
    if (current.revision !== input.revision || dto(current).status !== 'PENDING') throw new ApiError(409, 'APPLICATION_CHANGED', '申请已被处理、撤回或失效，请刷新核对。');
    const now = new Date();
    let assessment: EligibilityDTO | undefined;
    if (input.decision === 'APPROVE') {
      assessment = await eligibility(tx, team, current.applicantId, { slotId: current.slotId, timeConfirmed: current.timeConfirmed, ...(current.answers ? { answers: current.answers as EligibilityInput['answers'] } : {}) }, now);
      if (assessment.status !== 'PASS') throw new ApiError(422, 'ELIGIBILITY_NOT_PASSED', '当前条件或名额未通过，未批准也未占位。请核对下列依据。', Object.fromEntries(assessment.checks.filter(c => c.status !== 'PASS').map(c => [c.code, [c.reason]])));
      await tx.teamMember.upsert({ where: { teamId_userId: { teamId: current.teamId, userId: current.applicantId } },
        create: { teamId: current.teamId, userId: current.applicantId, slotId: current.slotId, role: 'MEMBER', joinedAt: now },
        update: { slotId: current.slotId, role: 'MEMBER', status: 'ACTIVE', joinedAt: now, leftAt: null, revision: { increment: 1 } } });
      await tx.team.update({ where: { id: team.id }, data: { status: team.members.filter(m => m.status === 'ACTIVE').length + 1 >= team.recruitment.capacity ? 'FULL' : 'OPEN' } });
    }
    await tx.application.update({ where: { id }, data: { status: input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', revision: { increment: 1 }, resolvedAt: now } });
    const review = await tx.applicationReview.create({ data: { applicationId: id, applicantId: current.applicantId, reviewerId: user.id, submission: current.submission, expectedRevision: input.revision,
      decision: input.decision, reason: input.reason, slotName: current.slot.name, recruitmentTitle: team.recruitment.title,
      ...(assessment ? { eligibilitySnapshot: assessment as unknown as Prisma.InputJsonValue } : {}), createdAt: now } });
    await tx.notification.create({ data: { recipientId: current.applicantId, reviewId: review.id, createdAt: now } });
    await tx.domainEvent.create({ data: { teamId: team.id, actorId: user.id, kind: input.decision === 'APPROVE' ? 'APPLICATION_APPROVED' : 'APPLICATION_REJECTED', payload: { applicationId: id, submission: current.submission, reviewId: review.id, slotId: current.slotId } } });
    return tx.application.findUniqueOrThrow({ where: { id }, include: captainInclude });
  }, { maxWait: 5000, timeout: 10000 });
  res.json({ data: captainDto(row) });
});
applicationsRouter.post('/teams/:id/applications', privateRead, writeLimit, csrfGuard, async (req, res) => {
  const user = requireUser(res), teamId = parse(IdSchema, req.params.id), input = parse(CreateApplicationSchema, req.body);
  const { requestKey, ...content } = input;
  const hash = createHash('sha256').update(JSON.stringify({ teamId, ...content })).digest('hex');
  const result = await db.$transaction(async tx => {
    // Applicant lock serializes their cross-team pending limit. NO KEY UPDATE permits FK checks.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id}::uuid FOR NO KEY UPDATE`;
    const prior = await tx.applicationRequest.findUnique({ where: { applicantId_requestKey: { applicantId: user.id, requestKey } }, include: { application: { include: applicationInclude } } });
    if (prior) {
      if (prior.requestHash !== hash) throw new ApiError(409, 'REQUEST_KEY_CONFLICT', '同一申请请求的内容不一致，请先查看我的申请。');
      if (prior.submission !== prior.application.submission) throw new ApiError(409, 'APPLICATION_SUPERSEDED', '这次申请已有后续提交，请刷新核对当前申请。');
      return { row: prior.application, created: false };
    }
    const team = await publishedTeam(tx, teamId, true), now = new Date();
    const direct = RecruitmentDraftSchema.parse(team.recruitment.payload).joinMode === 'AUTO';
    let row = await tx.application.findUnique({ where: { teamId_applicantId: { teamId, applicantId: user.id } }, include: applicationInclude });
    const duplicate = row?.status === 'PENDING';
    if (duplicate && row!.submissionHash !== hash) throw new ApiError(409, 'APPLICATION_EXISTS', '你已有该队申请，请先核对或撤回，不能覆盖原申请。');
    if (!duplicate) {
      const assessment = await eligibility(tx, team, user.id, input, now);
      if (assessment.status !== 'PASS') throw new ApiError(422, 'ELIGIBILITY_NOT_PASSED', '条件尚未通过，请重新核对并补齐信息。', Object.fromEntries(assessment.checks.filter(c => c.status !== 'PASS').map(c => [c.code, [c.reason]])));
      if (row && ['APPROVED'].includes(row.status)) throw new ApiError(409, 'APPLICATION_NOT_OPEN', '这份申请已处理，请核对当前状态。');
      if (row?.resolvedAt && ['WITHDRAWN', 'REJECTED'].includes(row.status) && now.getTime() < row.resolvedAt.getTime() + cooldownMs) throw new ApiError(409, 'APPLICATION_COOLDOWN', '撤回或被拒绝后需等待 10 分钟才能再次申请。');
      const pending = { status: 'PENDING' as const, team: { status: { in: ['OPEN', 'FULL'] as ('OPEN' | 'FULL')[] }, recruitmentClosedAt: null, recruitment: { joinDeadline: { gt: now } } } };
      if (await tx.application.count({ where: { ...pending, applicantId: user.id } }) >= 10 || await tx.application.count({ where: { ...pending, teamId } }) >= 100) throw new ApiError(409, 'APPLICATION_LIMIT', '待审核申请已达上限（每人 10 条、每队 100 条）。');
      const values = { ...(input.answers ? { answers: input.answers as Prisma.InputJsonValue } : {}), slotId: input.slotId, message: input.message, timeConfirmed: input.timeConfirmed, eligibilitySnapshot: assessment as unknown as Prisma.InputJsonValue, submissionHash: hash, status: direct ? 'APPROVED' as const : 'PENDING' as const, submittedAt: now, resolvedAt: direct ? now : null };
      row = row ? await tx.application.update({ where: { id: row.id }, data: { ...values, revision: { increment: 1 }, submission: { increment: 1 } }, include: applicationInclude })
        : await tx.application.create({ data: { ...values, teamId, applicantId: user.id }, include: applicationInclude });
      if (direct) {
        await tx.teamMember.create({ data: { teamId, userId: user.id, slotId: input.slotId, role: 'MEMBER', joinedAt: now } });
        await tx.team.update({ where: { id: teamId }, data: { status: team.members.filter(m => m.status === 'ACTIVE').length + 1 >= team.recruitment.capacity ? 'FULL' : 'OPEN' } });
      }
      await tx.domainEvent.create({ data: { teamId, actorId: user.id, kind: direct ? 'MEMBER_JOINED' : 'APPLICATION_SUBMITTED', payload: { applicationId: row.id, submission: row.submission, slotId: row.slotId } } });
    }
    if (!row) throw new Error('Application was not created');
    if (direct) row = await tx.application.findUniqueOrThrow({ where: { id: row.id }, include: applicationInclude });
    await tx.applicationRequest.create({ data: { applicantId: user.id, requestKey, requestHash: hash, applicationId: row.id, submission: row.submission,
      snapshot: { slotId: row.slotId, message: row.message, timeConfirmed: row.timeConfirmed, eligibility: row.eligibilitySnapshot } } });
    return { row, created: !duplicate };
  }, { maxWait: 5000, timeout: 10000 });
  res.status(result.created ? 201 : 200).json({ data: dto(result.row) });
});
applicationsRouter.post('/applications/:id/withdraw', privateRead, writeLimit, csrfGuard, async (req, res) => {
  const user = requireUser(res), id = parse(IdSchema, req.params.id), input = parse(WithdrawApplicationSchema, req.body);
  const row = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id}::uuid FOR NO KEY UPDATE`;
    const identity = await tx.application.findFirst({ where: { id, applicantId: user.id }, select: { teamId: true } });
    if (!identity) throw new ApiError(404, 'NOT_FOUND', '这份申请不存在或不可操作。');
    await publishedTeam(tx, identity.teamId, true);
    const current = await tx.application.findUniqueOrThrow({ where: { id }, include: applicationInclude });
    if (current.status === 'WITHDRAWN' && current.revision === input.revision + 1) return current;
    if (current.revision !== input.revision || !dto(current).canWithdraw) throw new ApiError(409, 'APPLICATION_CHANGED', '申请状态已有变化，请刷新核对后再操作。');
    const updated = await tx.application.update({ where: { id }, data: { status: 'WITHDRAWN', revision: { increment: 1 }, resolvedAt: new Date() }, include: applicationInclude });
    await tx.domainEvent.create({ data: { teamId: current.teamId, actorId: user.id, kind: 'APPLICATION_WITHDRAWN', payload: { applicationId: id, submission: current.submission } } });
    return updated;
  }, { maxWait: 5000, timeout: 10000 });
  res.json({ data: dto(row) });
});
