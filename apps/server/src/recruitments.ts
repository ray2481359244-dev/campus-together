import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { CreateRecruitmentSchema, UpdateRecruitmentSchema, RecruitmentRevisionSchema, RecruitmentDraftSchema, PublishableRecruitmentSchema, RecruitmentsQuerySchema, RecruitmentCursorSchema, IdSchema } from '@campus/contracts';
import type { RecruitmentDraft, RecruitmentDTO } from '@campus/contracts';
import { db } from './db.js';
import { csrfGuard, requireUser, writeLimit } from './auth.js';
import { parse, ApiError } from './http.js';
import { userInclude } from './dto.js';
import type { Prisma } from './generated/prisma/client.js';

const include = { school: true, topic: true, sourcePost: { select: { status: true } }, author: { include: userInclude }, team: { include: { slots: { orderBy: { position: 'asc' as const } }, members: { where: { status: 'ACTIVE' as const }, select: { userId: true, slotId: true, role: true } } } } } as const;
type Record = Prisma.RecruitmentGetPayload<{ include: typeof include }>;
function dto(row: Record, userId?: string): RecruitmentDTO {
  const draft = RecruitmentDraftSchema.parse(row.payload);
  return { id: row.id, publicationStatus: row.publicationStatus, revision: row.revision, title: row.title, description: row.description,
    category: 'COMPETITION', school: { id: row.school.id, name: row.school.name, isDemo: row.school.isDemo },
    topic: row.topic ? { id: row.topic.id, name: row.topic.name } : null,
    author: { id: row.authorId, nickname: row.author.profile?.nickname || '校园用户' },
    canEditDraft: row.publicationStatus === 'DRAFT' && row.authorId === userId, sourceAvailable: row.sourcePost?.status === 'PUBLISHED',
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), publishedAt: row.publishedAt?.toISOString() ?? null,
    draft, team: row.team ? { id: row.team.id, status: row.team.status, memberCount: row.team.members.length, capacity: row.capacity,
      captainUserId: row.team.captainUserId, acceptingStatus: row.joinDeadline && row.joinDeadline > new Date() ? 'OPEN' : 'CLOSED', chatAvailable: false,
      slots: row.team.slots.map(s => ({ id: s.id, name: s.name, capacity: s.capacity, requiredSkills: s.requiredSkills, occupied: row.team!.members.filter(m => m.slotId === s.id).length })),
    } : null };
}
async function references(tx: Prisma.TransactionClient, userId: string, draft: RecruitmentDraft, publishing = false) {
  const user = await tx.user.findUnique({ where: { id: userId }, include: userInclude });
  if (!user || user.status !== 'ACTIVE') throw new ApiError(401, 'AUTH_REQUIRED', '当前账号不可继续发布，请重新登录。');
  if (!user.profile?.school.active) throw new ApiError(422, 'PROFILE_INCOMPLETE', '请先设置有效的学校资料。');
  if (draft.topicId) {
    const topic = await tx.topic.findUnique({ where: { id: draft.topicId } });
    if (!topic || topic.category !== 'COMPETITION' || (publishing && !topic.active)) throw new ApiError(422, 'TOPIC_UNAVAILABLE', '请选择有效的竞赛主题。');
  }
  if (draft.sourcePostId) {
    const post = await tx.post.findFirst({ where: { id: draft.sourcePostId, authorId: userId, schoolId: user.profile.schoolId, status: 'PUBLISHED', topic: { category: 'COMPETITION' } } });
    if (!post) throw new ApiError(422, 'INVALID_SOURCE_POST', '只能从自己当前学校的可见竞赛讨论发起招募。');
  }
  return user.profile.schoolId;
}
function columns(draft: RecruitmentDraft) {
  return { title: draft.title, description: draft.description, topicId: draft.topicId, sourcePostId: draft.sourcePostId,
    payload: draft as Prisma.InputJsonValue, capacity: draft.capacity, allowCrossSchool: draft.allowCrossSchool };
}
async function ownedLocked(tx: Prisma.TransactionClient, id: string, userId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Recruitment" WHERE "id" = ${id}::uuid FOR UPDATE`;
  const row = await tx.recruitment.findUnique({ where: { id }, include });
  if (!row || row.authorId !== userId) throw new ApiError(404, 'NOT_FOUND', '该草稿不存在或不可操作。');
  return row;
}
function editable(row: Record, revision: number) {
  if (row.publicationStatus !== 'DRAFT') throw new ApiError(409, 'ALREADY_PUBLISHED', '这条招募已发布，当前阶段不支持发布后编辑或删除。');
  if (row.revision !== revision) throw new ApiError(409, 'REVISION_CONFLICT', '草稿已有更新，请重新读取后再修改。');
}
export const recruitmentsRouter = Router();
recruitmentsRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
recruitmentsRouter.get('/me/recruitments', async (_req, res) => {
  const user = requireUser(res);
  const rows = await db.recruitment.findMany({ where: { authorId: user.id }, include, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: 50 });
  res.json({ data: rows.map(row => dto(row, user.id)) });
});
recruitmentsRouter.get('/recruitments', async (req, res) => {
  const input = parse(RecruitmentsQuerySchema, req.query);
  if (!await db.school.findFirst({ where: { id: input.schoolId, active: true } })) throw new ApiError(400, 'INVALID_SCHOOL', '请选择可用的浏览学校。');
  let cursor: { publishedAt: string; id: string } | undefined;
  if (input.cursor) {
    try { cursor = parse(RecruitmentCursorSchema, JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'))); }
    catch { throw new ApiError(400, 'INVALID_CURSOR', '分页位置无效，请重新加载。'); }
  }
  const rows = await db.recruitment.findMany({ where: { schoolId: input.schoolId, category: 'COMPETITION', topicId: input.topicId, publicationStatus: 'PUBLISHED', AND: [
    ...(input.q ? [{ OR: [{ title: { contains: input.q, mode: 'insensitive' as const } }, { description: { contains: input.q, mode: 'insensitive' as const } }, { payload: { path: ['competitionName'], string_contains: input.q, mode: 'insensitive' as const } }, { payload: { path: ['direction'], string_contains: input.q, mode: 'insensitive' as const } }] }] : []),
    ...(cursor ? [{ OR: [{ publishedAt: { lt: new Date(cursor.publishedAt) } }, { publishedAt: new Date(cursor.publishedAt), id: { lt: cursor.id } }] }] : []),
  ] }, include, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], take: input.limit + 1 });
  const items = rows.slice(0, input.limit), last = items.at(-1);
  const nextCursor = rows.length > input.limit && last?.publishedAt ? Buffer.from(JSON.stringify({ publishedAt: last.publishedAt.toISOString(), id: last.id })).toString('base64url') : null;
  res.json({ data: items.map(row => dto(row, res.locals.session?.userId ?? undefined)), meta: { nextCursor } });
});
recruitmentsRouter.get('/recruitments/:id', async (req, res) => {
  const id = parse(IdSchema, req.params.id), userId = res.locals.session?.userId;
  const row = await db.recruitment.findUnique({ where: { id }, include });
  if (!row || (row.publicationStatus === 'DRAFT' && row.authorId !== userId)) throw new ApiError(404, 'NOT_FOUND', '该招募不存在或尚未公开。');
  res.json({ data: dto(row, userId ?? undefined) });
});
recruitmentsRouter.use('/recruitments', (_req, res, next) => { requireUser(res); next(); }, writeLimit, csrfGuard);
recruitmentsRouter.post('/recruitments', async (req, res) => {
  const user = requireUser(res), input = parse(CreateRecruitmentSchema, req.body);
  const hash = createHash('sha256').update(JSON.stringify(input.draft)).digest('hex');
  const result = await db.$transaction(async tx => {
    const where = { authorId_requestKey: { authorId: user.id, requestKey: input.requestKey } };
    // The unique request claim is committed with creation; deleted drafts retain the claim.
    const claim = await tx.recruitmentCreateRequest.createMany({ data: [{ authorId: user.id, requestKey: input.requestKey, requestHash: hash }], skipDuplicates: true });
    const request = await tx.recruitmentCreateRequest.findUniqueOrThrow({ where, include: { recruitment: { include } } });
    if (request.requestHash !== hash) throw new ApiError(409, 'REQUEST_KEY_CONFLICT', '重复请求的内容不一致，请先核对已保存的草稿。');
    if (!claim.count) {
      if (!request.recruitment) throw new ApiError(410, 'DRAFT_DELETED', '本次创建的草稿已删除，不能通过重试重新创建。当前输入仍可自行复制保留。');
      return { row: request.recruitment, created: false };
    }
    // Support requests written by the preceding app version during migration/deployment.
    const legacy = await tx.recruitment.findUnique({ where: { authorId_createRequestKey: { authorId: user.id, createRequestKey: input.requestKey } }, include });
    if (legacy) {
      if (legacy.createRequestHash !== hash) throw new ApiError(409, 'REQUEST_KEY_CONFLICT', '重复请求的内容不一致，请先核对已保存的草稿。');
      await tx.recruitmentCreateRequest.update({ where, data: { recruitmentId: legacy.id } });
      return { row: legacy, created: false };
    }
    const schoolId = await references(tx, user.id, input.draft);
    const created = await tx.recruitment.createMany({ data: [{ id: randomUUID(), authorId: user.id, schoolId, createRequestKey: input.requestKey, createRequestHash: hash, ...columns(input.draft) }], skipDuplicates: true });
    const row = await tx.recruitment.findUniqueOrThrow({ where: { authorId_createRequestKey: { authorId: user.id, createRequestKey: input.requestKey } }, include });
    if (row.createRequestHash !== hash) throw new ApiError(409, 'REQUEST_KEY_CONFLICT', '重复请求的内容不一致，请重新发起草稿。');
    await tx.recruitmentCreateRequest.update({ where, data: { recruitmentId: row.id } });
    return { row, created: created.count === 1 };
  });
  res.status(result.created ? 201 : 200).json({ data: dto(result.row, user.id) });
});
recruitmentsRouter.patch('/recruitments/:id', async (req, res) => {
  const user = requireUser(res), id = parse(IdSchema, req.params.id), input = parse(UpdateRecruitmentSchema, req.body);
  const row = await db.$transaction(async tx => {
    const current = await ownedLocked(tx, id, user.id); editable(current, input.revision);
    const schoolId = await references(tx, user.id, input.draft);
    return tx.recruitment.update({ where: { id }, data: { ...columns(input.draft), schoolId, revision: { increment: 1 } }, include });
  });
  res.json({ data: dto(row, user.id) });
});
recruitmentsRouter.delete('/recruitments/:id', async (req, res) => {
  const user = requireUser(res), id = parse(IdSchema, req.params.id), input = parse(RecruitmentRevisionSchema, req.body);
  await db.$transaction(async tx => { const current = await ownedLocked(tx, id, user.id); editable(current, input.revision); await tx.recruitment.delete({ where: { id } }); });
  res.json({ data: { deleted: true } });
});
recruitmentsRouter.post('/recruitments/:id/publish', async (req, res) => {
  const user = requireUser(res), id = parse(IdSchema, req.params.id), input = parse(RecruitmentRevisionSchema, req.body);
  const result = await db.$transaction(async tx => {
    const current = await ownedLocked(tx, id, user.id);
    if (current.publicationStatus === 'PUBLISHED') return { row: current, created: false };
    editable(current, input.revision);
    const draft = parse(PublishableRecruitmentSchema, current.payload);
    const schoolId = await references(tx, user.id, draft, true);
    if (schoolId !== current.schoolId) throw new ApiError(422, 'SCHOOL_CHANGED', '你的学校资料已有变化，请重新保存草稿再发布。');
    const deadline = new Date(draft.joinDeadline || draft.startAt!);
    if (deadline <= new Date() || new Date(draft.competitionDeadline!) <= new Date()) throw new ApiError(422, 'INVALID_TIME', '招募截止与比赛截止须晚于现在，请修改后发布。');
    const team = await tx.team.create({ data: { recruitmentId: id, captainUserId: user.id } });
    let captainSlotId = '';
    for (const [position, slot] of draft.slots.entries()) {
      const saved = await tx.teamSlot.create({ data: { teamId: team.id, name: slot.name, capacity: slot.capacity, requiredSkills: slot.requiredSkills, position } });
      if (slot.key === draft.captainSlotKey) captainSlotId = saved.id;
    }
    await tx.teamMember.create({ data: { teamId: team.id, userId: user.id, slotId: captainSlotId, role: 'CAPTAIN' } });
    await tx.chatSpace.create({ data: { teamId: team.id } });
    await tx.domainEvent.create({ data: { teamId: team.id, actorId: user.id, kind: 'TEAM_CREATED', payload: { recruitmentId: id, capacity: draft.capacity, captainSlotId } } });
    const row = await tx.recruitment.update({ where: { id }, data: { publicationStatus: 'PUBLISHED', publishedAt: new Date(), startAt: new Date(draft.startAt!), endAt: new Date(draft.endAt!), joinDeadline: deadline, revision: { increment: 1 } }, include });
    return { row, created: true };
  }, { maxWait: 5000, timeout: 10000 });
  res.status(result.created ? 201 : 200).json({ data: dto(result.row, user.id) });
});
