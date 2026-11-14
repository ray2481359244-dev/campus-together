import { Router } from 'express';
import type { ChatMessageDTO, SocialChatDTO } from '@campus/contracts';
import { ChatPreferencesSchema, ChatQuerySchema, IdSchema, ReadChatSchema, SendMessageSchema } from '@campus/contracts';
import { z } from 'zod';
import type { ConversationMessage, Prisma } from './generated/prisma/client.js';
import { db } from './db.js';
import { csrfGuard, requireUser, writeLimit } from './auth.js';
import { ApiError, parse } from './http.js';
import { chatSearch, contextsFor, mentionNames, messageHash, quoted, readContext, senderAvatarVersions, sourceColumns, verifyImage, windowStart } from './chat-content.js';
import { socialAccess } from './social-access.js';
import { signalChats } from './chat-events.js';

const writeOptions = { maxWait: 5000, timeout: 10000 };
const readOptions = { ...writeOptions, isolationLevel: 'RepeatableRead' as const };

async function messages(tx: Prisma.TransactionClient, rows: ConversationMessage[], id: string, floor: number, viewer: string): Promise<ChatMessageDTO[]> {
  if (!rows.length) return [];
  const targets = rows.flatMap(row => row.replyToId ?? []);
  const replies = new Map((targets.length ? await tx.conversationMessage.findMany({
    where: { id: { in: targets }, conversationId: id, seq: { gt: floor }, deletedAt: null, redactsMessageId: null },
    select: { id: true, seq: true, nickname: true, body: true, imageId: true },
  }) : []).map(row => [row.id, row]));
  const sources = await contextsFor(tx, rows.filter(row => row.sourcePostId || row.sourceRecruitmentId));
  const names = await mentionNames(tx, [...new Set(rows.flatMap(row => row.mentionIds))]);
  const avatars = await senderAvatarVersions(tx, rows);
  return rows.map(row => ({
    id: row.id, seq: row.seq, senderId: row.senderId, kind: row.redactsMessageId ? 'SYSTEM' : 'TEXT', nickname: row.nickname,
    senderAvatarVersion: row.senderId ? avatars.get(row.senderId) ?? null : null,
    body: row.deletedAt ? null : row.body, deleted: !!row.deletedAt, createdAt: row.createdAt.toISOString(),
    clientMessageId: row.senderId === viewer ? row.clientMessageId : undefined,
    redactsMessageId: row.redactsMessageId, imageId: row.deletedAt ? null : row.imageId,
    reply: row.replyToId && !row.deletedAt ? quoted(replies.get(row.replyToId)) : null,
    context: sources.get(row.id),
    mentions: row.deletedAt ? [] : row.mentionIds.flatMap(id => names.has(id) ? [{ id, nickname: names.get(id)! }] : []),
  }));
}

export const socialChatRouter = Router();
socialChatRouter.use('/conversations', (_req, res, next) => {
  requireUser(res);
  res.setHeader('Cache-Control', 'no-store');
  next();
});

socialChatRouter.get('/conversations/:id', async (req, res) => {
  const user = requireUser(res).id, id = parse(IdSchema, req.params.id), input = parse(ChatQuerySchema, req.query);
  const data = await db.$transaction(async tx => {
    const { room, member, peer, blockedByMe, discussion, request, canWrite } = await socialAccess(tx, id, user);
    const floor = member.joinedAfterSeq;
    const forward = input.after !== undefined || input.around !== undefined;
    const from = input.around ? windowStart(input.around, floor) : Math.max(input.after ?? floor, floor) + 1;
    if ((input.after ?? 0) > room.lastSeq || (input.before ?? 1) > room.lastSeq + 1 || (input.around ?? 0) > room.lastSeq) {
      throw new ApiError(400, 'INVALID_CURSOR', '消息位置已变化，请重新加载。');
    }
    const rows = await tx.conversationMessage.findMany({
      where: { conversationId: id, seq: forward ? { gte: from } : { gt: floor, lt: input.before } },
      orderBy: { seq: forward ? 'asc' : 'desc' }, take: input.limit + 1,
    });
    const page = rows.slice(0, input.limit);
    if (!forward) page.reverse();
    const unread = { conversationId: id, seq: { gt: Math.max(member.lastReadSeq, floor) }, senderId: { not: user }, deletedAt: null, redactsMessageId: null };
    const firstUnread = await tx.conversationMessage.findFirst({ where: unread, orderBy: { seq: 'asc' }, select: { seq: true } });
    const result: SocialChatDTO = {
      id, title: peer?.nickname || room.title, kind: room.kind, request, peer, blockedByMe, discussion, canWrite,
      pinned: !!member.pinnedAt, muted: member.muted, lastReadSeq: member.lastReadSeq, highWater: room.lastSeq,
      unreadCount: firstUnread ? await tx.conversationMessage.count({ where: unread }) : 0, firstUnreadSeq: firstUnread?.seq ?? null,
      items: await messages(tx, page, id, floor, user), more: forward && rows.length > input.limit,
      previousBefore: page[0] && page[0].seq > floor + 1 ? page[0].seq : null,
    };
    if (input.contexts?.length) {
      const tracked = await tx.conversationMessage.findMany({ where: { id: { in: input.contexts }, conversationId: id, seq: { gt: floor } } });
      result.contextUpdates = [...await contextsFor(tx, tracked)].map(([id, context]) => ({ id, context }));
    }
    return result;
  }, readOptions);
  res.json({ data });
});

socialChatRouter.post('/conversations/:id/messages', writeLimit, csrfGuard, async (req, res) => {
  const user = requireUser(res).id, id = parse(IdSchema, req.params.id), input = parse(SendMessageSchema, req.body);
  const { clientMessageId, source, mentionIds, ...content } = input;
  const hash = messageHash({ ...content, source, mentionIds });
  const result = await db.$transaction(async tx => {
    const { member, room, recipients, canWrite } = await socialAccess(tx, id, user, true);
    const prior = await tx.conversationMessage.findUnique({ where: { conversationId_senderId_clientMessageId: { conversationId: id, senderId: user, clientMessageId } } });
    if (prior && prior.seq > member.joinedAfterSeq) {
      if (prior.bodyHash !== hash) throw new ApiError(409, 'REQUEST_KEY_CONFLICT', '这条发送记录的内容已变化。');
      return { data: (await messages(tx, [prior], id, member.joinedAfterSeq, user))[0], recipients: [] };
    }
    if (prior) throw new ApiError(409, 'REQUEST_KEY_CONFLICT', '原消息属于上次入群记录，请重新编辑后发送。');
    if (!canWrite) throw new ApiError(409, 'CHAT_READ_ONLY', '当前会话暂不可发送。');
    const now = new Date();
    if (await tx.conversationMessage.count({ where: { conversationId: id, senderId: user, createdAt: { gt: new Date(now.getTime() - 60_000) } } }) >= 20) {
      throw new ApiError(429, 'CHAT_RATE_LIMIT', '发言太频繁，请稍后再试。');
    }
    if (input.replyToId && !await tx.conversationMessage.findFirst({
      where: { id: input.replyToId, conversationId: id, seq: { gt: member.joinedAfterSeq }, deletedAt: null, redactsMessageId: null },
      select: { id: true },
    })) throw new ApiError(422, 'REPLY_UNAVAILABLE', '原消息不可用，请取消引用后重试。');
    if (source && !await readContext(tx, source)) throw new ApiError(422, 'SOURCE_UNAVAILABLE', '来源内容已不可见。');
    if (input.imageId) await verifyImage(tx, input.imageId, user, 'SOCIAL', id);
    const mentions = [...new Set(mentionIds)].filter(target => target !== user);
    if (mentions.length && (room.kind !== 'DISCUSSION' || mentions.some(target => !recipients.includes(target)))) {
      throw new ApiError(422, 'MENTION_UNAVAILABLE', '有成员已不在这个群里，请重新选择。');
    }
    const space = await tx.conversation.update({ where: { id }, data: { lastSeq: { increment: 1 }, lastActivityAt: now } });
    const row = await tx.conversationMessage.create({
      data: { ...content, ...sourceColumns(source), conversationId: id, senderId: user, nickname: member.user.profile?.nickname || '校园用户',
        seq: space.lastSeq, clientMessageId, bodyHash: hash, mentionIds: mentions, createdAt: now },
    });
    return { data: (await messages(tx, [row], id, member.joinedAfterSeq, user))[0], recipients };
  }, writeOptions);
  signalChats(result.recipients);
  res.json({ data: result.data });
});

socialChatRouter.post('/conversations/:id/read', writeLimit, csrfGuard, async (req, res) => {
  const user = requireUser(res).id, id = parse(IdSchema, req.params.id), input = parse(ReadChatSchema, req.body);
  const data = await db.$transaction(async tx => {
    const { room, member } = await socialAccess(tx, id, user, true);
    if (input.seq > room.lastSeq) throw new ApiError(400, 'INVALID_CURSOR', '这条消息还未保存。');
    const lastReadSeq = Math.max(member.lastReadSeq, input.seq);
    if (lastReadSeq > member.lastReadSeq) await tx.conversationMember.update({ where: { conversationId_userId: { conversationId: id, userId: user } }, data: { lastReadSeq } });
    return { lastReadSeq };
  }, writeOptions);
  signalChats([user]);
  res.json({ data });
});

socialChatRouter.put('/conversations/:id/preferences', writeLimit, csrfGuard, async (req, res) => {
  const user = requireUser(res).id, id = parse(IdSchema, req.params.id), input = parse(ChatPreferencesSchema, req.body);
  const data = await db.$transaction(async tx => {
    const { member } = await socialAccess(tx, id, user, true);
    const row = await tx.conversationMember.update({
      where: { conversationId_userId: { conversationId: id, userId: user } },
      data: { ...(input.pinned === undefined ? {} : { pinnedAt: input.pinned ? member.pinnedAt ?? new Date() : null }), muted: input.muted },
    });
    return { pinned: !!row.pinnedAt, muted: row.muted };
  }, writeOptions);
  signalChats([user]);
  res.json({ data });
});

socialChatRouter.get('/conversations/:id/search', async (req, res) => {
  const user = requireUser(res).id, id = parse(IdSchema, req.params.id), input = parse(chatSearch, req.query);
  const data = await db.$transaction(async tx => {
    const { member } = await socialAccess(tx, id, user);
    const rows = await tx.conversationMessage.findMany({
      where: { conversationId: id, seq: { gt: member.joinedAfterSeq, lt: input.before }, deletedAt: null, redactsMessageId: null, body: { contains: input.q, mode: 'insensitive' } },
      orderBy: { seq: 'desc' }, take: 21,
    });
    return { items: await messages(tx, rows.slice(0, 20), id, member.joinedAfterSeq, user), nextBefore: rows.length > 20 ? rows[19].seq : null };
  }, readOptions);
  res.json({ data });
});

socialChatRouter.post('/conversations/:id/messages/:messageId/delete', writeLimit, csrfGuard, async (req, res) => {
  const user = requireUser(res).id, id = parse(IdSchema, req.params.id), messageId = parse(IdSchema, req.params.messageId);
  parse(z.object({}).strict(), req.body);
  const result = await db.$transaction(async tx => {
    const { member, canWrite, recipients } = await socialAccess(tx, id, user, true);
    const row = await tx.conversationMessage.findFirst({ where: { id: messageId, conversationId: id, senderId: user, seq: { gt: member.joinedAfterSeq } } });
    if (!row) throw new ApiError(404, 'NOT_FOUND', '消息不可操作。');
    if (row.deletedAt) return { data: (await messages(tx, [row], id, member.joinedAfterSeq, user))[0], recipients: [] };
    if (!canWrite) throw new ApiError(409, 'CHAT_READ_ONLY', '当前会话只读。');
    const removed = await redactSocialMessage(tx, row);
    return { data: (await messages(tx, [removed], id, member.joinedAfterSeq, user))[0], recipients };
  }, writeOptions);
  signalChats(result.recipients);
  res.json({ data: result.data });
});

export async function redactSocialMessage(tx: Prisma.TransactionClient, row: ConversationMessage) {
  const now = new Date();
  const removed = await tx.conversationMessage.update({ where: { id: row.id }, data: { deletedAt: now, body: null, imageId: null } });
  const space = await tx.conversation.update({ where: { id: row.conversationId }, data: { lastSeq: { increment: 1 } } });
  await tx.conversationMessage.create({
    data: { conversationId: row.conversationId, seq: space.lastSeq, nickname: '会话动态', body: '一条消息已删除。', redactsMessageId: row.id },
  });
  if (row.imageId) await tx.chatImage.deleteMany({ where: { id: row.imageId } });
  return removed;
}
