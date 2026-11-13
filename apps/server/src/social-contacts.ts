import { Router } from 'express';
import { z } from 'zod';
import { ContactSchema, ConversationSourceSchema, IdSchema } from '@campus/contracts';
import { db } from './db.js';
import { csrfGuard, requireUser, writeLimit } from './auth.js';
import { ApiError, parse } from './http.js';
import { chatProfile, messageHash, person, readContext, sourceColumns } from './chat-content.js';
import { lockPeople, lockRoom, pairBlocks, socialAccess } from './social-access.js';
import { signalChats } from './chat-events.js';

const directKey = (user: string, peer: string) => [user, peer].sort().join(':');
const txOptions = { maxWait: 5000, timeout: 10000 };

export const contactsRouter = Router();
contactsRouter.use('/contacts', (_req, res, next) => {
  requireUser(res);
  res.setHeader('Cache-Control', 'no-store');
  next();
});

contactsRouter.get('/contacts/:peerId', async (req, res) => {
  const user = requireUser(res).id, peerId = parse(IdSchema, req.params.peerId);
  if (peerId === user) throw new ApiError(400, 'INVALID_CONTACT', '请从其他同学的帖子或评论发起私聊。');
  const data = await db.$transaction(async tx => {
    const peer = await tx.user.findFirst({ where: { id: peerId, status: 'ACTIVE' }, include: chatProfile });
    if (!peer) throw new ApiError(404, 'NOT_FOUND', '这个联系人当前不可用。');
    const room = await tx.conversation.findUnique({ where: { directKey: directKey(user, peerId) } });
    const blocks = await pairBlocks(tx, user, peerId);
    const blockedByMe = blocks.some(block => block.blockerId === user);
    const canContact = !blocks.length && (room ? room.state === 'ACTIVE' : peer.allowMessageRequests);
    const conversationId = room && (room.state === 'ACTIVE' || !blocks.length && room.state === 'REQUESTED' || room.ownerId === user && room.state === 'DECLINED') ? room.id : null;
    return { person: person(peer), conversationId, canContact, blockedByMe };
  }, { isolationLevel: 'RepeatableRead' });
  res.json({ data });
});

contactsRouter.post('/contacts/context', writeLimit, csrfGuard, async (req, res) => {
  requireUser(res);
  const source = parse(ConversationSourceSchema, req.body);
  const found = await db.$transaction(tx => readContext(tx, source), { isolationLevel: 'RepeatableRead' });
  if (!found) throw new ApiError(404, 'SOURCE_UNAVAILABLE', '来源内容已不可见。');
  res.json({ data: found.context });
});

contactsRouter.post('/contacts', writeLimit, csrfGuard, async (req, res) => {
  const user = requireUser(res).id, input = parse(ContactSchema, req.body);
  if (user === input.peerId) throw new ApiError(400, 'INVALID_CONTACT', '请选择其他同学。');
  const { peerId, ...content } = input;
  const hash = messageHash(content);
  const result = await db.$transaction(async tx => {
    await lockPeople(tx, [user, peerId]);
    const peer = await tx.user.findFirst({ where: { id: peerId, status: 'ACTIVE' }, select: { allowMessageRequests: true } });
    if (!peer || (await pairBlocks(tx, user, peerId)).length) throw new ApiError(409, 'CONTACT_UNAVAILABLE', '这个联系人当前无法接收新消息。');
    const me = await tx.user.findFirst({ where: { id: user, status: 'ACTIVE' }, include: chatProfile });
    if (!me) throw new ApiError(401, 'AUTH_REQUIRED', '请重新登录。');
    const key = directKey(user, peerId);
    const existing = await tx.conversation.findUnique({ where: { directKey: key } });
    if (existing) {
      const prior = await tx.conversationMessage.findUnique({
        where: { conversationId_senderId_clientMessageId: { conversationId: existing.id, senderId: user, clientMessageId: input.clientMessageId } },
      });
      if (prior && prior.bodyHash !== hash) throw new ApiError(409, 'REQUEST_KEY_CONFLICT', '同一次请求的文字已变化。');
      return { id: existing.id, created: false, accepted: !!prior };
    }
    if (!peer.allowMessageRequests) throw new ApiError(409, 'CONTACT_UNAVAILABLE', '对方关闭了新联系人请求。');
    if (input.source) {
      const source = await readContext(tx, input.source);
      if (!source || source.authorId !== peerId) throw new ApiError(422, 'SOURCE_UNAVAILABLE', '这条帖子、评论或招募已不可用。');
    }
    const cutoff = new Date(Date.now() - 86_400_000);
    if (await tx.conversation.count({ where: { kind: 'DIRECT', ownerId: user, createdAt: { gt: cutoff } } }) >= 20) {
      throw new ApiError(429, 'CONTACT_LIMIT', '今天发起的联系请求已达上限。');
    }
    const room = await tx.conversation.create({
      data: { kind: 'DIRECT', state: 'REQUESTED', ownerId: user, directKey: key, lastSeq: 1,
        members: { create: [{ userId: user, lastReadSeq: 1 }, { userId: peerId }] },
        messages: { create: {
          senderId: user, nickname: person(me).nickname, seq: 1, clientMessageId: input.clientMessageId,
          body: input.body, bodyHash: hash, ...sourceColumns(input.source),
        } } },
    });
    return { id: room.id, created: true, accepted: true };
  }, txOptions);
  signalChats([user, peerId]);
  res.status(result.created ? 201 : 200).json({ data: { id: result.id, sent: result.accepted } });
});

contactsRouter.post('/contacts/requests/:id', writeLimit, csrfGuard, async (req, res) => {
  const user = requireUser(res).id, id = parse(IdSchema, req.params.id);
  const { accept } = parse(z.object({ accept: z.boolean() }).strict(), req.body);
  const recipients = await db.$transaction(async tx => {
    // Declined contacts are still writable here for a retry of the same refusal.
    const row = await tx.conversation.findFirst({
      where: { id, kind: 'DIRECT', ownerId: { not: user }, members: { some: { userId: user, status: 'ACTIVE', user: { status: 'ACTIVE' } } } },
      select: { ownerId: true, state: true },
    });
    if (!row) throw new ApiError(404, 'NOT_FOUND', '这条联系请求不存在。');
    await lockPeople(tx, [user, row.ownerId]);
    await lockRoom(tx, id);
    const fresh = await tx.conversation.findUniqueOrThrow({ where: { id } });
    const desired = accept ? 'ACTIVE' : 'DECLINED';
    if (fresh.state === desired) return [user, row.ownerId];
    if (fresh.state !== 'REQUESTED') throw new ApiError(409, 'CONTACT_CHANGED', '这条请求已处理，请刷新核对。');
    const context = await socialAccess(tx, id, user);
    if (context.request !== 'INCOMING' || !await tx.user.findFirst({ where: { id: row.ownerId, status: 'ACTIVE' }, select: { id: true } })) {
      throw new ApiError(409, 'CONTACT_UNAVAILABLE', '发起人当前不可用。');
    }
    await tx.conversation.update({ where: { id }, data: { state: desired } });
    return [user, row.ownerId];
  }, txOptions);
  signalChats(recipients);
  res.json({ data: { accepted: accept } });
});

contactsRouter.put('/contacts/:peerId/block', writeLimit, csrfGuard, async (req, res) => {
  const user = requireUser(res).id, peerId = parse(IdSchema, req.params.peerId);
  const { blocked } = parse(z.object({ blocked: z.boolean() }).strict(), req.body);
  if (user === peerId) throw new ApiError(400, 'INVALID_CONTACT', '请选择其他同学。');
  await db.$transaction(async tx => {
    await lockPeople(tx, [user, peerId]);
    const me = await tx.user.findFirst({ where: { id: user, status: 'ACTIVE' }, select: { id: true } });
    const peer = await tx.user.findUnique({ where: { id: peerId }, select: { id: true } });
    if (!me || !peer) throw new ApiError(404, 'NOT_FOUND', '联系人不可用。');
    const where = { blockerId: user, blockedId: peerId };
    if (blocked) {
      await tx.userBlock.createMany({ data: [where], skipDuplicates: true });
      await tx.conversation.updateMany({ where: { directKey: directKey(user, peerId), state: 'REQUESTED' }, data: { state: 'DECLINED' } });
    } else await tx.userBlock.deleteMany({ where });
  }, txOptions);
  signalChats([user, peerId]);
  res.json({ data: { blocked } });
});

contactsRouter.get('/me/contact-preferences', async (_req, res) => {
  const user = requireUser(res);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ data: { allowRequests: user.allowMessageRequests } });
});

contactsRouter.put('/me/contact-preferences', writeLimit, csrfGuard, async (req, res) => {
  const user = requireUser(res);
  const { allowRequests } = parse(z.object({ allowRequests: z.boolean() }).strict(), req.body);
  const changed = await db.user.updateMany({ where: { id: user.id, status: 'ACTIVE' }, data: { allowMessageRequests: allowRequests } });
  if (!changed.count) throw new ApiError(401, 'AUTH_REQUIRED', '请重新登录。');
  res.setHeader('Cache-Control', 'no-store');
  res.json({ data: { allowRequests } });
});
