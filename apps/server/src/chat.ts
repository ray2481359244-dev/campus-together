import { activeUser } from './community.js';
import { Router } from 'express';
import { createHash } from 'node:crypto';
import { AnnouncementSchema, ChatPreferencesSchema, ChatQuerySchema, IdSchema, ReadChatSchema, SendMessageSchema } from '@campus/contracts';
import type { ChatMessageDTO } from '@campus/contracts';
import type { Prisma, ChatMessage } from './generated/prisma/client.js';
import { db } from './db.js';
import { requireUser, csrfGuard, writeLimit } from './auth.js';
import { ApiError, parse } from './http.js';
import { databaseNow } from './time.js';
import { terminal } from './archive.js';
import { chatSearch, contextsFor, mentionNames, messageHash, quoted, readContext, sourceColumns, verifyImage, windowStart } from './chat-content.js';
import { signalChats, signalTeamChat } from './chat-events.js';

const systemText: Record<string,string> = { MEMBER_JOINED: '新成员已加入队伍。', TEAM_CREATED: '队伍已创建。新成员可查看本队现有历史。', APPLICATION_APPROVED: '一位申请者已正式入队。', MEMBER_LEFT: '一位成员已退出队伍。', MEMBER_REMOVED: '一位成员已被移出队伍。', TEAM_TRANSFER: '队长身份已转交，双方岗位保持不变。', TEAM_START: '活动已开始，停止招人。', TEAM_COMPLETE: '活动已结束，群聊转为只读。', TEAM_CANCEL: '活动已取消，群聊转为只读。', TEAM_EXPIRED: '队伍已到期，群聊转为只读。', RECRUITMENT_CLOSED: '招募已关闭，现有成员继续协作。', TEAM_ANNOUNCEMENT_CHANGED: '队长更新了队伍公告。' };
const messageDTO = (m: ChatMessage, viewer: string): ChatMessageDTO => ({
  id: m.id, seq: m.seq, senderId: m.senderId, kind: m.kind, nickname: m.nickname,
  body: m.deletedAt ? null : m.body, createdAt: m.createdAt.toISOString(), deleted: !!m.deletedAt, redactsMessageId: m.redactsMessageId,
  clientMessageId: m.senderId === viewer ? m.clientMessageId : undefined, imageId: m.deletedAt ? null : m.imageId,
});
async function messages(tx: Prisma.TransactionClient, rows: ChatMessage[], teamId: string, viewer: string) {
  if (!rows.length) return [];
  const targets = rows.flatMap(row => row.replyToId ?? []);
  const replies = new Map((targets.length ? await tx.chatMessage.findMany({
    where: { id: { in: targets }, teamId, kind: 'TEXT', deletedAt: null },
    select: { id: true, seq: true, nickname: true, body: true, imageId: true },
  }) : []).map(row => [row.id, row]));
  const contexts = await contextsFor(tx, rows.filter(row => row.sourcePostId || row.sourceRecruitmentId));
  const names = await mentionNames(tx, [...new Set(rows.flatMap(row => row.mentionIds))]);
  return rows.map(row => ({
    ...messageDTO(row, viewer),
    reply: row.replyToId && !row.deletedAt ? quoted(replies.get(row.replyToId)) : null,
    context: contexts.get(row.id),
    mentions: row.deletedAt ? [] : row.mentionIds.flatMap(id => names.has(id) ? [{ id, nickname: names.get(id)! }] : []),
  }));
}
export async function teamChatAccess(tx: Prisma.TransactionClient, teamId: string, userId: string, lock = true) {
  if (lock) await activeUser(tx, userId);
  const identity = await tx.team.findUnique({ where: { id: teamId }, select: { recruitmentId: true } });
  if (!identity) throw new ApiError(404, 'NOT_FOUND', '队伍不存在或你已不是有效成员。');
  if (lock) {
    await tx.$queryRaw`SELECT "id" FROM "Recruitment" WHERE "id"=${identity.recruitmentId}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id"=${teamId}::uuid FOR UPDATE`;
  }
  const team = await tx.team.findUniqueOrThrow({ where: { id: teamId }, include: { recruitment: true, chatSpace: true } });
  const member = await tx.teamMember.findFirst({ where: { teamId, userId, status: 'ACTIVE', user: { status: 'ACTIVE' } }, include: { user: { select: { profile: { select: { nickname: true } } } } } });
  if (!member || team.recruitment.publicationStatus !== 'PUBLISHED' || !team.chatSpace) throw new ApiError(404, 'NOT_FOUND', '你当前不是有效成员，队内内容已收起。');
  const now = await databaseNow(tx);
  if(team.chatSpace.purgedAt || terminal(team.status) && team.archiveUntil && team.archiveUntil <= now) throw new ApiError(410,'CHAT_ARCHIVE_EXPIRED','归档期限已到，聊天正文和公告已隐藏。');
  const canWrite = team.status === 'IN_PROGRESS' || ['OPEN','FULL'].includes(team.status) && !!team.recruitment.joinDeadline && team.recruitment.joinDeadline > now;
  return { team, member, now, canWrite, captain: team.captainUserId === userId && member.role === 'CAPTAIN' };
}
const context = teamChatAccess;
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
    if ((input.after ?? 0) > highWater || (input.before ?? 1) > highWater + 1 || (input.around ?? 0) > highWater) throw new ApiError(400, 'INVALID_CURSOR', '消息位置无效，请重新打开群聊。');
    const forward = input.after !== undefined || input.around !== undefined;
    const rows = await tx.chatMessage.findMany({ where: { teamId, seq: input.around ? { gte: windowStart(input.around) } : forward ? { gt: input.after } : { lt: input.before } }, orderBy: { seq: forward ? 'asc' : 'desc' }, take: input.limit + 1 });
    const selected = rows.slice(0, input.limit);
    const items = await messages(tx, forward ? selected : selected.reverse(), teamId, user.id);
    const unread = { teamId, seq: { gt: c.member.lastReadSeq }, kind: 'TEXT', deletedAt: null, senderId: { not: user.id } };
    const firstUnread = await tx.chatMessage.findFirst({ where: unread, orderBy: { seq: 'asc' }, select: { seq: true } });
    const tracked = input.contexts?.length ? await tx.chatMessage.findMany({ where: { id: { in: input.contexts }, teamId } }) : [];
    return { title: c.team.recruitment.title, teamId, recruitmentId: c.team.recruitmentId, status: c.team.status, canWrite: c.canWrite, canAnnounce: c.canWrite && c.captain, archiveUntil: c.team.archiveUntil?.toISOString() ?? null,
      announcement: c.team.chatSpace!.announcement, announcementRevision: c.team.chatSpace!.announcementRevision, highWater, lastReadSeq: c.member.lastReadSeq,
      pinned: !!c.member.chatPinnedAt, muted: c.member.chatMuted, memberCount: await tx.teamMember.count({ where: { teamId, status: 'ACTIVE' } }),
      unreadCount: firstUnread ? await tx.chatMessage.count({ where: unread }) : 0, firstUnreadSeq: firstUnread?.seq ?? null,
      items, more: forward && rows.length > input.limit, previousBefore: items[0] && items[0].seq > 1 ? items[0].seq : null,
      contextUpdates: [...await contextsFor(tx, tracked)].map(([id, context]) => ({ id, context })) };
  }, { maxWait: 5000, timeout: 10000 }); res.json({ data: result });
});
chatRouter.post('/teams/:id/chat/messages', writeLimit, csrfGuard, async (req,res) => {
  const user = requireUser(res), teamId = parse(IdSchema,req.params.id), input = parse(SendMessageSchema,req.body);
  const { clientMessageId, source, mentionIds, ...content } = input;
  const hash = source || input.replyToId || input.imageId || mentionIds?.length
    ? messageHash({ ...content, source, mentionIds }) : createHash('sha256').update(input.body).digest('hex');
  const result = await db.$transaction(async tx => {
    const c = await context(tx,teamId,user.id);
    const prior = await tx.chatMessage.findUnique({ where: { teamId_senderId_clientMessageId: { teamId, senderId: user.id, clientMessageId: input.clientMessageId } } });
    if (prior) { if(prior.bodyHash !== hash) throw new ApiError(409,'REQUEST_KEY_CONFLICT','原消息标识的内容不同，请先核对历史。'); return (await messages(tx, [prior], teamId, user.id))[0]; }
    if (!c.canWrite) throw new ApiError(409,'CHAT_READ_ONLY','队伍已结束、取消或到期，群聊只读。');
    if (await tx.chatMessage.count({ where: { teamId, senderId: user.id, kind:'TEXT', createdAt:{gt:new Date(c.now.getTime()-60_000)} } }) >= 20) throw new ApiError(429,'CHAT_RATE_LIMIT','本队发言过于频繁，请一分钟后再试。');
    if (input.replyToId && !await tx.chatMessage.findFirst({ where: { id: input.replyToId, teamId, kind: 'TEXT', deletedAt: null }, select: { id: true } })) {
      throw new ApiError(422, 'REPLY_UNAVAILABLE', '原消息不可用，请取消引用。');
    }
    if (source && !await readContext(tx, source)) throw new ApiError(422, 'SOURCE_UNAVAILABLE', '来源内容已不可见。');
    if (input.imageId) await verifyImage(tx, input.imageId, user.id, 'TEAM', teamId);
    const mentions = [...new Set(mentionIds)].filter(id => id !== user.id);
    if (mentions.length && await tx.teamMember.count({ where: { teamId, status: 'ACTIVE', userId: { in: mentions }, user: { status: 'ACTIVE' } } }) !== mentions.length) {
      throw new ApiError(422, 'MENTION_UNAVAILABLE', '有成员已不在队伍，请重新选择。');
    }
    await syncSystem(tx,teamId);
    const space = await tx.chatSpace.update({ where:{teamId},data:{lastSeq:{increment:1}} });
    const message = await tx.chatMessage.create({ data: {
      ...content, ...sourceColumns(source), teamId, seq: space.lastSeq, senderId: user.id, clientMessageId,
      kind: 'TEXT', nickname: c.member.user.profile?.nickname || '校园用户', bodyHash: hash, mentionIds: mentions, createdAt: c.now,
    } });
    return (await messages(tx, [message], teamId, user.id))[0];
  },{maxWait:5000,timeout:10000});
  signalTeamChat(teamId);
  res.json({data:result});
});
chatRouter.post('/teams/:id/chat/read', writeLimit, csrfGuard, async(req,res)=>{
  const user=requireUser(res),teamId=parse(IdSchema,req.params.id),input=parse(ReadChatSchema,req.body);
  const data=await db.$transaction(async tx=>{const c=await context(tx,teamId,user.id); if(input.seq>c.team.chatSpace!.lastSeq)throw new ApiError(400,'INVALID_CURSOR','不能标记尚未保存的消息。'); const lastReadSeq=Math.max(c.member.lastReadSeq,input.seq); if(lastReadSeq>c.member.lastReadSeq)await tx.teamMember.update({where:{id:c.member.id},data:{lastReadSeq}});return {lastReadSeq};});
  signalChats([user.id]);res.json({data});
});
chatRouter.put('/teams/:id/chat/preferences', writeLimit, csrfGuard, async (req, res) => {
  const user = requireUser(res), teamId = parse(IdSchema, req.params.id), input = parse(ChatPreferencesSchema, req.body);
  const data = await db.$transaction(async tx => {
    const { member } = await context(tx, teamId, user.id);
    const row = await tx.teamMember.update({ where: { id: member.id }, data: {
      ...(input.pinned === undefined ? {} : { chatPinnedAt: input.pinned ? member.chatPinnedAt ?? new Date() : null }),
      chatMuted: input.muted,
    } });
    return { pinned: !!row.chatPinnedAt, muted: row.chatMuted };
  });
  signalChats([user.id]);
  res.json({ data });
});
chatRouter.get('/teams/:id/chat/search', async (req, res) => {
  const user = requireUser(res), teamId = parse(IdSchema, req.params.id), input = parse(chatSearch, req.query);
  const data = await db.$transaction(async tx => {
    await teamChatAccess(tx, teamId, user.id, false);
    const rows = await tx.chatMessage.findMany({
      where: { teamId, seq: { lt: input.before }, kind: 'TEXT', deletedAt: null, body: { contains: input.q, mode: 'insensitive' } },
      orderBy: { seq: 'desc' }, take: 21,
    });
    return { items: await messages(tx, rows.slice(0, 20), teamId, user.id), nextBefore: rows.length > 20 ? rows[19].seq : null };
  }, { isolationLevel: 'RepeatableRead' });
  res.json({ data });
});
chatRouter.post('/teams/:id/chat/announcement',writeLimit,csrfGuard,async(req,res)=>{
  const user=requireUser(res),teamId=parse(IdSchema,req.params.id),input=parse(AnnouncementSchema,req.body);
  const data=await db.$transaction(async tx=>{const c=await context(tx,teamId,user.id);if(!c.captain)throw new ApiError(404,'NOT_FOUND','当前没有公告管理权限。');const space=c.team.chatSpace!;
    if(space.announcementRevision===input.revision+1&&space.announcement===input.body)return {revision:space.announcementRevision};
    if(!c.canWrite)throw new ApiError(409,'CHAT_READ_ONLY','当前群聊只读。');if(space.announcementRevision!==input.revision)throw new ApiError(409,'ANNOUNCEMENT_CHANGED','公告已有变化，请刷新核对。');
    await tx.chatSpace.update({where:{teamId},data:{announcement:input.body,announcementRevision:{increment:1}}});await tx.domainEvent.create({data:{teamId,actorId:user.id,kind:'TEAM_ANNOUNCEMENT_CHANGED',payload:{revision:input.revision+1}}});return {revision:input.revision+1};});
  signalTeamChat(teamId);res.json({data});
});
chatRouter.post('/teams/:id/chat/messages/:messageId/delete',writeLimit,csrfGuard,async(req,res)=>{
  const user=requireUser(res),teamId=parse(IdSchema,req.params.id),messageId=parse(IdSchema,req.params.messageId);
  if(Object.keys(req.body ?? {}).length)throw new ApiError(400,'INVALID_INPUT','无需其他参数。');
  const data=await db.$transaction(async tx=>{
    const c=await context(tx,teamId,user.id);
    const m=await tx.chatMessage.findFirst({where:{id:messageId,teamId,kind:'TEXT',senderId:user.id}});
    if(!m)throw new ApiError(404,'NOT_FOUND','消息不存在或不是本人消息。');
    if(m.deletedAt)return messageDTO(m,user.id);
    if(!c.canWrite)throw new ApiError(409,'CHAT_READ_ONLY','当前群聊只读。');
    const deleted=await tx.chatMessage.update({where:{id:m.id},data:{body:null,imageId:null,deletedAt:c.now}});
    if (m.imageId) await tx.chatImage.deleteMany({ where: { id: m.imageId } });
    const space=await tx.chatSpace.update({where:{teamId},data:{lastSeq:{increment:1}}});
    await tx.chatMessage.create({data:{teamId,seq:space.lastSeq,kind:'SYSTEM',nickname:'队伍动态',body:'一条消息已删除。',redactsMessageId:m.id,createdAt:c.now}});
    return messageDTO(deleted,user.id);
  });
  signalTeamChat(teamId);res.json({data});
});
