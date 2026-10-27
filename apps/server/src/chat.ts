import { activeUser } from './community.js';
import { Router } from 'express';
import { createHash } from 'node:crypto';
import { AnnouncementSchema, ChatQuerySchema, IdSchema, ReadChatSchema, SendMessageSchema } from '@campus/contracts';
import type { ChatMessageDTO } from '@campus/contracts';
import type { Prisma, ChatMessage } from './generated/prisma/client.js';
import { db } from './db.js';
import { requireUser, csrfGuard, writeLimit } from './auth.js';
import { ApiError, parse } from './http.js';
import { databaseNow } from './time.js';
import { terminal } from './archive.js';

const systemText: Record<string,string> = { MEMBER_JOINED: '新成员已加入队伍。', TEAM_CREATED: '队伍已创建。新成员可查看本队现有历史。', APPLICATION_APPROVED: '一位申请者已正式入队。', MEMBER_LEFT: '一位成员已退出队伍。', MEMBER_REMOVED: '一位成员已被移出队伍。', TEAM_TRANSFER: '队长身份已转交，双方岗位保持不变。', TEAM_START: '活动已开始，停止招人。', TEAM_COMPLETE: '活动已结束，群聊转为只读。', TEAM_CANCEL: '活动已取消，群聊转为只读。', TEAM_EXPIRED: '队伍已到期，群聊转为只读。', RECRUITMENT_CLOSED: '招募已关闭，现有成员继续协作。', TEAM_ANNOUNCEMENT_CHANGED: '队长更新了队伍公告。' };
const messageDTO = (m: ChatMessage): ChatMessageDTO => ({ id: m.id, seq: m.seq, senderId: m.senderId, kind: m.kind, nickname: m.nickname, body: m.deletedAt ? null : m.body, createdAt: m.createdAt.toISOString(), deleted: !!m.deletedAt, redactsMessageId: m.redactsMessageId });
async function context(tx: Prisma.TransactionClient, teamId: string, userId: string) {
  await activeUser(tx,userId);
  const identity = await tx.team.findUnique({ where: { id: teamId }, select: { recruitmentId: true } });
  if (!identity) throw new ApiError(404, 'NOT_FOUND', '队伍不存在或你已不是有效成员。');
  await tx.$queryRaw`SELECT "id" FROM "Recruitment" WHERE "id"=${identity.recruitmentId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id"=${teamId}::uuid FOR UPDATE`;
  const team = await tx.team.findUniqueOrThrow({ where: { id: teamId }, include: { recruitment: true, chatSpace: true } });
  const member = await tx.teamMember.findFirst({ where: { teamId, userId, status: 'ACTIVE', user: { status: 'ACTIVE' } }, include: { user: { select: { profile: { select: { nickname: true } } } } } });
  if (!member || team.recruitment.publicationStatus !== 'PUBLISHED' || !team.chatSpace) throw new ApiError(404, 'NOT_FOUND', '你当前不是有效成员，队内内容已收起。');
  const now = await databaseNow(tx);
  if(team.chatSpace.purgedAt || terminal(team.status) && team.archiveUntil && team.archiveUntil <= now) throw new ApiError(410,'CHAT_ARCHIVE_EXPIRED','归档期限已到，聊天正文和公告已隐藏。');
  const canWrite = team.status === 'IN_PROGRESS' || ['OPEN','FULL'].includes(team.status) && !!team.recruitment.joinDeadline && team.recruitment.joinDeadline > now;
  return { team, member, now, canWrite, captain: team.captainUserId === userId && member.role === 'CAPTAIN' };
}
async function syncSystem(tx: Prisma.TransactionClient, teamId: string) {
  const events = await tx.domainEvent.findMany({ where: { teamId, kind: { in: Object.keys(systemText) }, id: { notIn: (await tx.chatMessage.findMany({ where: { teamId, systemEventId: { not: null } }, select: { systemEventId: true } })).map(m => m.systemEventId!) } }, orderBy: [{ createdAt: 'asc' },{ id: 'asc' }], take: 100 });
  for (const event of events) { const space = await tx.chatSpace.update({ where: { teamId }, data: { lastSeq: { increment: 1 } } }); await tx.chatMessage.create({ data: { teamId, seq: space.lastSeq, systemEventId: event.id, kind: 'SYSTEM', nickname: '队伍动态', body: systemText[event.kind], createdAt: event.createdAt } }); }
}
export const chatRouter = Router();
chatRouter.use('/teams/:id/chat', (_req, res, next) => { requireUser(res); res.setHeader('Cache-Control','no-store'); next(); });
chatRouter.get('/teams/:id/chat', async (req, res) => {
  const user = requireUser(res), teamId = parse(IdSchema, req.params.id), input = parse(ChatQuerySchema, req.query);
  const result = await db.$transaction(async tx => {
    const c = await context(tx, teamId, user.id); await syncSystem(tx, teamId);
    const highWater = (await tx.chatSpace.findUniqueOrThrow({ where: { teamId } })).lastSeq;
    if ((input.after ?? 0) > highWater || (input.before ?? 1) > highWater + 1) throw new ApiError(400, 'INVALID_CURSOR', '消息位置无效，请重新打开群聊。');
    const forward = input.after !== undefined;
    const rows = await tx.chatMessage.findMany({ where: { teamId, ...(forward ? { seq: { gt: input.after } } : input.before ? { seq: { lt: input.before } } : {}) }, orderBy: { seq: forward ? 'asc' : 'desc' }, take: input.limit + 1 });
    const selected = rows.slice(0,input.limit), items = (forward ? selected : selected.reverse()).map(messageDTO);
    return { title: c.team.recruitment.title, teamId, status: c.team.status, canWrite: c.canWrite, canAnnounce: c.canWrite && c.captain, archiveUntil: c.team.archiveUntil?.toISOString() ?? null,
      announcement: c.team.chatSpace!.announcement, announcementRevision: c.team.chatSpace!.announcementRevision, highWater, lastReadSeq: c.member.lastReadSeq,
      unreadCount: await tx.chatMessage.count({ where: { teamId, seq: { gt: c.member.lastReadSeq }, OR: [{ senderId: null },{ senderId: { not: user.id } }] } }),
      items, more: forward && rows.length > input.limit, previousBefore: !forward && rows.length > input.limit ? items[0].seq : null };
  }, { maxWait: 5000, timeout: 10000 }); res.json({ data: result });
});
chatRouter.post('/teams/:id/chat/messages', writeLimit, csrfGuard, async (req,res) => {
  const user = requireUser(res), teamId = parse(IdSchema,req.params.id), input = parse(SendMessageSchema,req.body), hash = createHash('sha256').update(input.body).digest('hex');
  const result = await db.$transaction(async tx => {
    const c = await context(tx,teamId,user.id);
    const prior = await tx.chatMessage.findUnique({ where: { teamId_senderId_clientMessageId: { teamId, senderId: user.id, clientMessageId: input.clientMessageId } } });
    if (prior) { if(prior.bodyHash !== hash) throw new ApiError(409,'REQUEST_KEY_CONFLICT','原消息标识的内容不同，请先核对历史。'); return messageDTO(prior); }
    if (!c.canWrite) throw new ApiError(409,'CHAT_READ_ONLY','队伍已结束、取消或到期，群聊只读。');
    if (await tx.chatMessage.count({ where: { teamId, senderId: user.id, kind:'TEXT', createdAt:{gt:new Date(c.now.getTime()-60_000)} } }) >= 20) throw new ApiError(429,'CHAT_RATE_LIMIT','本队发言过于频繁，请一分钟后再试。');
    await syncSystem(tx,teamId); const space = await tx.chatSpace.update({ where:{teamId},data:{lastSeq:{increment:1}} });
    return messageDTO(await tx.chatMessage.create({data:{teamId,seq:space.lastSeq,senderId:user.id,clientMessageId:input.clientMessageId,kind:'TEXT',nickname:c.member.user.profile?.nickname || '校园用户',body:input.body,bodyHash:hash,createdAt:c.now}}));
  },{maxWait:5000,timeout:10000}); res.json({data:result});
});
chatRouter.post('/teams/:id/chat/read', writeLimit, csrfGuard, async(req,res)=>{
  const user=requireUser(res),teamId=parse(IdSchema,req.params.id),input=parse(ReadChatSchema,req.body);
  const data=await db.$transaction(async tx=>{const c=await context(tx,teamId,user.id); if(input.seq>c.team.chatSpace!.lastSeq)throw new ApiError(400,'INVALID_CURSOR','不能标记尚未保存的消息。'); await tx.teamMember.update({where:{id:c.member.id},data:{lastReadSeq:Math.max(c.member.lastReadSeq,input.seq)}});return {lastReadSeq:Math.max(c.member.lastReadSeq,input.seq)};});res.json({data});
});
chatRouter.post('/teams/:id/chat/announcement',writeLimit,csrfGuard,async(req,res)=>{
  const user=requireUser(res),teamId=parse(IdSchema,req.params.id),input=parse(AnnouncementSchema,req.body);
  const data=await db.$transaction(async tx=>{const c=await context(tx,teamId,user.id);if(!c.captain)throw new ApiError(404,'NOT_FOUND','当前没有公告管理权限。');const space=c.team.chatSpace!;
    if(space.announcementRevision===input.revision+1&&space.announcement===input.body)return {revision:space.announcementRevision};
    if(!c.canWrite)throw new ApiError(409,'CHAT_READ_ONLY','当前群聊只读。');if(space.announcementRevision!==input.revision)throw new ApiError(409,'ANNOUNCEMENT_CHANGED','公告已有变化，请刷新核对。');
    await tx.chatSpace.update({where:{teamId},data:{announcement:input.body,announcementRevision:{increment:1}}});await tx.domainEvent.create({data:{teamId,actorId:user.id,kind:'TEAM_ANNOUNCEMENT_CHANGED',payload:{revision:input.revision+1}}});return {revision:input.revision+1};});res.json({data});
});
chatRouter.post('/teams/:id/chat/messages/:messageId/delete',writeLimit,csrfGuard,async(req,res)=>{
  const user=requireUser(res),teamId=parse(IdSchema,req.params.id),messageId=parse(IdSchema,req.params.messageId);
  if(Object.keys(req.body ?? {}).length)throw new ApiError(400,'INVALID_INPUT','无需其他参数。');
  const data=await db.$transaction(async tx=>{const c=await context(tx,teamId,user.id),m=await tx.chatMessage.findFirst({where:{id:messageId,teamId,kind:'TEXT',senderId:user.id}});if(!m)throw new ApiError(404,'NOT_FOUND','消息不存在或不是本人消息。');if(m.deletedAt)return messageDTO(m);if(!c.canWrite)throw new ApiError(409,'CHAT_READ_ONLY','当前群聊只读。');const deleted=await tx.chatMessage.update({where:{id:m.id},data:{body:null,deletedAt:c.now}});const space=await tx.chatSpace.update({where:{teamId},data:{lastSeq:{increment:1}}});await tx.chatMessage.create({data:{teamId,seq:space.lastSeq,kind:'SYSTEM',nickname:'队伍动态',body:'一条消息已删除。',redactsMessageId:m.id,createdAt:c.now}});return messageDTO(deleted);});res.json({data});
});
