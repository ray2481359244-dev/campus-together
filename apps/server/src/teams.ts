import { Router, type RequestHandler } from 'express';
import { CloseRecruitmentSchema, IdSchema, LeaveTeamSchema, MyTeamsQuerySchema, RemoveMemberSchema } from '@campus/contracts';
import type { MembershipChangeDTO, TeamDetailDTO, TeamSummaryDTO } from '@campus/contracts';
import type { Prisma } from './generated/prisma/client.js';
import { db } from './db.js';
import { csrfGuard, requireUser, writeLimit } from './auth.js';
import { ApiError, parse } from './http.js';
import { acceptingStatus } from './team-rules.js';

const include = { recruitment: true, slots: true, members: { include: { user: { select: { profile: { select: { nickname: true, skills: true, school: { select: { name: true } } } } } } } } } as const;
type Team = Prisma.TeamGetPayload<{ include: typeof include }>;
const editable = (team: Team) => ['OPEN', 'FULL', 'IN_PROGRESS'].includes(team.status);
const privateRead: RequestHandler = (_req, res, next) => { requireUser(res); res.setHeader('Cache-Control', 'no-store'); next(); };
function captain(team: Team, userId: string) {
  if (team.captainUserId !== userId || !team.members.some(m => m.userId === userId && m.role === 'CAPTAIN' && m.status === 'ACTIVE')) throw new ApiError(404, 'NOT_FOUND', '这支队伍不存在或无管理权限。');
}
function summary(team: Team, userId: string): TeamSummaryDTO {
  const mine = team.members.find(m => m.userId === userId && m.status === 'ACTIVE');
  if (!mine) throw new ApiError(404, 'NOT_FOUND', '这支队伍不存在或你当前不是有效成员。');
  return { id: team.id, recruitmentId: team.recruitmentId, title: team.recruitment.title, captainUserId: team.captainUserId, status: team.status,
    closedAt: team.recruitmentClosedAt?.toISOString() ?? null, capacity: team.recruitment.capacity, memberCount: team.members.filter(m => m.status === 'ACTIVE').length,
    acceptingStatus: acceptingStatus(team.status, team.recruitment.joinDeadline, team.members.filter(m => m.status === 'ACTIVE').length, team.recruitment.capacity, team.recruitmentClosedAt),
    recruitmentRevision: team.recruitment.revision, myMembership: { id: mine.id, role: mine.role, revision: mine.revision, slotName: team.slots.find(s => s.id === mine.slotId)!.name, joinedAt: mine.joinedAt.toISOString() } };
}
function detail(team: Team, userId: string): TeamDetailDTO {
  const base = summary(team, userId), isCaptain = base.myMembership.role === 'CAPTAIN' && team.captainUserId === userId;
  return { ...base, canLeave: !isCaptain && editable(team), canClose: isCaptain && !team.recruitmentClosedAt && ['OPEN', 'FULL'].includes(team.status),
    members: team.members.filter(m => m.status === 'ACTIVE').sort((a, b) => Number(b.role === 'CAPTAIN') - Number(a.role === 'CAPTAIN') || a.joinedAt.getTime() - b.joinedAt.getTime() || a.id.localeCompare(b.id)).map(m => ({
      id: m.id, userId: m.userId, nickname: m.user.profile?.nickname || '校园用户', schoolName: m.user.profile?.school.name || '未填写', skills: m.user.profile?.skills || [], role: m.role,
      revision: m.revision, slotName: team.slots.find(s => s.id === m.slotId)!.name, joinedAt: m.joinedAt.toISOString(), canRemove: isCaptain && editable(team) && m.role === 'MEMBER' && m.userId !== userId })) };
}
async function lockedTeam(tx: Prisma.TransactionClient, id: string, userIds: string[]) {
  for (const userId of [...new Set(userIds)].sort()) await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId}::uuid FOR NO KEY UPDATE`;
  const identity = await tx.team.findUnique({ where: { id }, select: { recruitmentId: true } });
  if (!identity) throw new ApiError(404, 'NOT_FOUND', '这支队伍不存在。');
  await tx.$queryRaw`SELECT "id" FROM "Recruitment" WHERE "id" = ${identity.recruitmentId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id" = ${id}::uuid FOR UPDATE`;
  const team = await tx.team.findUnique({ where: { id }, include });
  if (!team || team.recruitment.publicationStatus !== 'PUBLISHED') throw new ApiError(404, 'NOT_FOUND', '这支队伍不存在。');
  return team;
}
async function activeActor(tx: Prisma.TransactionClient, userId: string) {
  if (!await tx.user.findFirst({ where: { id: userId, status: 'ACTIVE' } })) throw new ApiError(401, 'AUTH_REQUIRED', '当前账号不可操作，请重新登录。');
}
async function changeMember(input: { teamId: string; actorId: string; memberId?: string; revision: number; kind: 'LEFT' | 'REMOVED'; reason: string }): Promise<MembershipChangeDTO> {
  return db.$transaction(async tx => {
    const identity = await tx.teamMember.findFirst({ where: { teamId: input.teamId, ...(input.kind === 'LEFT' ? { userId: input.actorId } : { id: input.memberId }) }, select: { id: true, userId: true } });
    if (!identity) throw new ApiError(404, 'NOT_FOUND', '该成员不存在或不可操作。');
    const team = await lockedTeam(tx, input.teamId, [input.actorId, identity.userId]); await activeActor(tx, input.actorId);
    if (input.kind === 'REMOVED') captain(team, input.actorId);
    const member = team.members.find(m => m.id === identity.id)!;
    if (member.role === 'CAPTAIN' || member.userId === team.captainUserId) throw new ApiError(409, 'CAPTAIN_CANNOT_LEAVE', '队长不能直接退出或被移除；当前可关闭招募，队长转交与取消队伍将在后续开放。');
    const prior = await tx.membershipChange.findUnique({ where: { memberId_expectedRevision: { memberId: member.id, expectedRevision: input.revision } } });
    if (prior) {
      if (prior.actorId !== input.actorId || prior.kind !== input.kind || prior.reason !== input.reason || member.revision !== input.revision + 1 || member.status !== input.kind) throw new ApiError(409, 'MEMBERSHIP_CHANGED', '原版本已有操作或成员状态再次变化，请刷新核对。');
      return { teamId: team.id, recruitmentId: team.recruitmentId, memberId: member.id, status: prior.kind, revision: member.revision, reason: prior.reason, changedAt: prior.createdAt.toISOString() };
    }
    if (member.status !== 'ACTIVE' || member.revision !== input.revision) throw new ApiError(409, 'MEMBERSHIP_CHANGED', '成员状态已有变化，请刷新核对。');
    if (!editable(team)) throw new ApiError(409, 'TEAM_NOT_EDITABLE', '当前队伍阶段不能退出或移除成员。');
    const now = new Date();
    await tx.teamMember.update({ where: { id: member.id }, data: { status: input.kind, revision: { increment: 1 }, leftAt: now } });
    if (['OPEN', 'FULL'].includes(team.status)) await tx.team.update({ where: { id: team.id }, data: { status: team.members.filter(m => m.status === 'ACTIVE').length - 1 >= team.recruitment.capacity ? 'FULL' : 'OPEN' } });
    const change = await tx.membershipChange.create({ data: { memberId: member.id, memberUserId: member.userId, actorId: input.actorId, kind: input.kind, expectedRevision: input.revision, reason: input.reason,
      slotName: team.slots.find(s => s.id === member.slotId)!.name, recruitmentTitle: team.recruitment.title, createdAt: now } });
    await tx.notification.create({ data: { recipientId: member.userId, memberChangeId: change.id, createdAt: now } });
    await tx.domainEvent.create({ data: { teamId: team.id, actorId: input.actorId, kind: input.kind === 'LEFT' ? 'MEMBER_LEFT' : 'MEMBER_REMOVED', payload: { memberId: member.id, changeId: change.id, expectedRevision: input.revision } } });
    return { teamId: team.id, recruitmentId: team.recruitmentId, memberId: member.id, status: input.kind, revision: member.revision + 1, reason: input.reason, changedAt: now.toISOString() };
  }, { maxWait: 5000, timeout: 10000 });
}

export const teamsRouter = Router();
teamsRouter.get('/me/teams', privateRead, async (req, res) => {
  const user = requireUser(res), input = parse(MyTeamsQuerySchema, req.query);
  const result = await db.$transaction(async tx => {
    const cursor = input.cursor ? await tx.team.findFirst({ where: { id: input.cursor, members: { some: { userId: user.id, status: 'ACTIVE' } } } }) : null;
    if (input.cursor && !cursor) throw new ApiError(400, 'INVALID_CURSOR', '分页位置无效，请刷新我的队伍。');
    const rows = await tx.team.findMany({ where: { recruitment: { publicationStatus: 'PUBLISHED' }, members: { some: { userId: user.id, status: 'ACTIVE' } },
      ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) }, include, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 21 });
    const items = rows.slice(0, 20); return { items: items.map(team => summary(team, user.id)), nextCursor: rows.length > 20 ? items.at(-1)!.id : null };
  }, { isolationLevel: 'RepeatableRead' });
  res.json({ data: result });
});
teamsRouter.use('/teams', privateRead);
teamsRouter.get('/teams/:id', async (req, res) => {
  const user = requireUser(res), id = parse(IdSchema, req.params.id);
  const result = await db.$transaction(async tx => {
    const team = await tx.team.findFirst({ where: { id, recruitment: { publicationStatus: 'PUBLISHED' }, members: { some: { userId: user.id, status: 'ACTIVE' } } }, include });
    if (!team) throw new ApiError(404, 'NOT_FOUND', '这支队伍不存在或你当前不是有效成员。');
    return detail(team, user.id);
  }, { isolationLevel: 'RepeatableRead' });
  res.json({ data: result });
});
teamsRouter.post('/teams/:id/leave', writeLimit, csrfGuard, async (req, res) => {
  const user = requireUser(res), teamId = parse(IdSchema, req.params.id), input = parse(LeaveTeamSchema, req.body);
  res.json({ data: await changeMember({ teamId, actorId: user.id, revision: input.revision, kind: 'LEFT', reason: '成员主动退出队伍。' }) });
});
teamsRouter.post('/teams/:id/members/:memberId/remove', writeLimit, csrfGuard, async (req, res) => {
  const user = requireUser(res), teamId = parse(IdSchema, req.params.id), memberId = parse(IdSchema, req.params.memberId), input = parse(RemoveMemberSchema, req.body);
  res.json({ data: await changeMember({ teamId, memberId, actorId: user.id, ...input, kind: 'REMOVED' }) });
});
teamsRouter.post('/teams/:id/close-recruitment', writeLimit, csrfGuard, async (req, res) => {
  const user = requireUser(res), teamId = parse(IdSchema, req.params.id), input = parse(CloseRecruitmentSchema, req.body);
  const result = await db.$transaction(async tx => {
    const team = await lockedTeam(tx, teamId, [user.id]); await activeActor(tx, user.id); captain(team, user.id);
    const prior = await tx.recruitmentClosure.findUnique({ where: { teamId } });
    if (prior) {
      if (prior.actorId !== user.id || prior.expectedRevision !== input.revision || prior.reason !== input.reason || team.recruitment.revision !== input.revision + 1) throw new ApiError(409, 'RECRUITMENT_CHANGED', '招募已被关闭或版本已有变化，请刷新核对。');
      return { teamId, closedAt: prior.createdAt.toISOString(), expiredCount: prior.expiredCount, reason: prior.reason };
    }
    if (team.recruitmentClosedAt || team.recruitment.revision !== input.revision || !['OPEN', 'FULL'].includes(team.status)) throw new ApiError(409, 'RECRUITMENT_CHANGED', '招募版本或队伍阶段已有变化，请刷新核对。');
    const pending = await tx.application.findMany({ where: { teamId, status: 'PENDING' }, select: { id: true, applicantId: true } }), now = new Date();
    await tx.team.update({ where: { id: teamId }, data: { recruitmentClosedAt: now } });
    await tx.recruitment.update({ where: { id: team.recruitmentId }, data: { revision: { increment: 1 } } });
    const closure = await tx.recruitmentClosure.create({ data: { teamId, actorId: user.id, expectedRevision: input.revision, reason: input.reason, recruitmentTitle: team.recruitment.title, expiredCount: pending.length, createdAt: now } });
    await tx.application.updateMany({ where: { teamId, status: 'PENDING' }, data: { status: 'EXPIRED', revision: { increment: 1 }, resolvedAt: now } });
    if (pending.length) await tx.notification.createMany({ data: pending.map(row => ({ recipientId: row.applicantId, closureId: closure.id, teamId, applicationId: row.id, createdAt: now })) });
    await tx.domainEvent.create({ data: { teamId, actorId: user.id, kind: 'RECRUITMENT_CLOSED', payload: { closureId: closure.id, expiredCount: pending.length } } });
    return { teamId, closedAt: now.toISOString(), expiredCount: pending.length, reason: input.reason };
  }, { maxWait: 5000, timeout: 10000 });
  res.json({ data: result });
});
