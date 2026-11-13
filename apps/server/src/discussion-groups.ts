import { Router } from 'express';
import { z } from 'zod';
import { IdSchema } from '@campus/contracts';
import type { DiscussionPeopleDTO } from '@campus/contracts';
import { db } from './db.js';
import { activeUser } from './community.js';
import { csrfGuard, requireUser, writeLimit } from './auth.js';
import { ApiError, parse } from './http.js';
import { person } from './chat-content.js';
import { discussionCap, discussionInfo, lockPeople, lockRoom, socialAccess, socialInclude } from './social-access.js';
import { signalChats } from './chat-events.js';

const roomOptions = z.object({ title: z.string().trim().min(2).max(80), joinMode: z.enum(['OPEN', 'APPROVAL']) }).strict();
const decision = z.object({ action: z.enum(['APPROVE', 'DECLINE', 'REMOVE']) }).strict();
const empty = z.object({}).strict();

export const discussionsRouter = Router();
discussionsRouter.use(['/post-discussions', '/discussion-groups'], (_req, res, next) => {
  requireUser(res);
  res.setHeader('Cache-Control', 'no-store');
  next();
});
discussionsRouter.get('/post-discussions/:postId', async (req, res) => {
  const user = requireUser(res).id, postId = parse(IdSchema, req.params.postId);
  const room = await db.conversation.findFirst({ where: { postId, post: { status: 'PUBLISHED' } }, include: socialInclude });
  res.json({ data: room ? discussionInfo(room, user) : null });
});
discussionsRouter.post('/post-discussions/:postId', writeLimit, csrfGuard, async (req, res) => {
  const user = requireUser(res).id, postId = parse(IdSchema, req.params.postId), input = parse(roomOptions, req.body);
  const room = await db.$transaction(async tx => {
    await activeUser(tx, user);
    await tx.$queryRaw`SELECT "id" FROM "Post" WHERE "id" = ${postId}::uuid FOR UPDATE`;
    const post = await tx.post.findFirst({ where: { id: postId, authorId: user, status: 'PUBLISHED' }, select: { id: true } });
    if (!post) throw new ApiError(404, 'NOT_FOUND', '只有原帖作者可以创建讨论群。');
    const known = await tx.conversation.findUnique({ where: { postId }, include: socialInclude });
    if (known) return known;
    return tx.conversation.create({ data: { ...input, kind: 'DISCUSSION', ownerId: user, postId, members: { create: { userId: user } } }, include: socialInclude });
  });
  signalChats([user]);
  res.json({ data: discussionInfo(room, user) });
});

discussionsRouter.post('/discussion-groups/:id/join', writeLimit, csrfGuard, async (req, res) => {
  const user = requireUser(res).id, id = parse(IdSchema, req.params.id);
  parse(empty, req.body);
  const result = await db.$transaction(async tx => {
    await activeUser(tx, user);
    await lockRoom(tx, id);
    const room = await tx.conversation.findFirst({ where: { id, kind: 'DISCUSSION', post: { status: 'PUBLISHED' }, closedAt: null }, include: socialInclude });
    if (!room) throw new ApiError(404, 'NOT_FOUND', '讨论群已关闭或原帖不可见。');
    const current = discussionInfo(room, user);
    if (current.membership === 'ACTIVE' || current.membership === 'PENDING') return { data: current, owner: room.ownerId };
    if (current.membership === 'REMOVED') throw new ApiError(409, 'DISCUSSION_MEMBERSHIP', '当前无法加入此讨论群。');
    if (current.memberCount >= discussionCap || room.members.filter(m => m.status === 'PENDING').length >= discussionCap) {
      throw new ApiError(409, 'DISCUSSION_FULL', '群成员或待处理申请已达上限。');
    }
    const status = room.joinMode === 'OPEN' ? 'ACTIVE' : 'PENDING';
    const change = { status, joinedAfterSeq: room.lastSeq, lastReadSeq: room.lastSeq } as const;
    await tx.conversationMember.upsert({
      where: { conversationId_userId: { conversationId: id, userId: user } }, update: change,
      create: { conversationId: id, userId: user, ...change },
    });
    return { owner: room.ownerId, data: { ...current, membership: status, memberCount: current.memberCount + Number(status === 'ACTIVE') } };
  });
  signalChats([user, result.owner]);
  res.json({ data: result.data });
});

discussionsRouter.get('/discussion-groups/:id/people', async (req, res) => {
  const user = requireUser(res).id, id = parse(IdSchema, req.params.id);
  const data = await db.$transaction(async tx => {
    const { room, discussion } = await socialAccess(tx, id, user);
    if (!discussion) throw new ApiError(404, 'NOT_FOUND', '找不到讨论群。');
    const result: DiscussionPeopleDTO = { members: [], pending: [] };
    for (const member of room.members) {
      if (member.user.status !== 'ACTIVE') continue;
      if (member.status === 'ACTIVE') result.members.push(person(member.user));
      if (member.status === 'PENDING' && discussion.canManage && !discussion.closed) result.pending.push(person(member.user));
    }
    return result;
  }, { isolationLevel: 'RepeatableRead' });
  res.json({ data });
});

discussionsRouter.post('/discussion-groups/:id/people/:memberId', writeLimit, csrfGuard, async (req, res) => {
  const user = requireUser(res).id, id = parse(IdSchema, req.params.id), memberId = parse(IdSchema, req.params.memberId);
  const { action } = parse(decision, req.body);
  if (user === memberId) throw new ApiError(400, 'INVALID_MEMBER', '发起人可以关闭讨论群。');
  const recipients = await db.$transaction(async tx => {
    await lockPeople(tx, [user, memberId]);
    await lockRoom(tx, id);
    const access = await socialAccess(tx, id, user);
    if (!access.discussion?.canManage || access.discussion.closed) throw new ApiError(404, 'NOT_FOUND', '讨论群不可管理。');
    const member = access.room.members.find(m => m.userId === memberId);
    const desired = action === 'APPROVE' ? 'ACTIVE' : 'REMOVED';
    if (member?.status === desired) return access.recipients;
    if (!member || member.status !== (action === 'REMOVE' ? 'ACTIVE' : 'PENDING')) {
      throw new ApiError(409, 'DISCUSSION_MEMBERSHIP', '成员状态已变化，请刷新核对。');
    }
    if (action === 'APPROVE' && (member.user.status !== 'ACTIVE' || access.discussion.memberCount >= discussionCap)) {
      throw new ApiError(409, 'DISCUSSION_FULL', '成员状态或群人数已变化。');
    }
    await tx.conversationMember.update({
      where: { conversationId_userId: { conversationId: id, userId: memberId } },
      data: { status: desired, joinedAfterSeq: access.room.lastSeq, lastReadSeq: access.room.lastSeq },
    });
    return access.recipients;
  });
  signalChats([user, memberId, ...recipients]);
  res.json({ data: { saved: true } });
});

discussionsRouter.post('/discussion-groups/:id/leave', writeLimit, csrfGuard, async (req, res) => {
  const user = requireUser(res).id, id = parse(IdSchema, req.params.id);
  parse(empty, req.body);
  const recipients = await db.$transaction(async tx => {
    await activeUser(tx, user);
    await lockRoom(tx, id);
    const room = await tx.conversation.findFirst({ where: { id, kind: 'DISCUSSION', members: { some: { userId: user } } }, include: socialInclude });
    if (!room) throw new ApiError(404, 'NOT_FOUND', '讨论群不可用。');
    if (room.ownerId === user) throw new ApiError(409, 'DISCUSSION_OWNER', '发起人可以关闭讨论群。');
    await tx.conversationMember.updateMany({ where: { conversationId: id, userId: user, status: { in: ['ACTIVE', 'PENDING'] } }, data: { status: 'LEFT' } });
    return room.members.filter(m => m.status === 'ACTIVE').map(m => m.userId).concat(room.ownerId);
  });
  signalChats([user, ...recipients]);
  res.json({ data: { left: true } });
});

discussionsRouter.post('/discussion-groups/:id/close', writeLimit, csrfGuard, async (req, res) => {
  const user = requireUser(res).id, id = parse(IdSchema, req.params.id);
  parse(empty, req.body);
  const recipients = await db.$transaction(async tx => {
    const { room, discussion, recipients } = await socialAccess(tx, id, user, true);
    if (!discussion?.canManage) throw new ApiError(404, 'NOT_FOUND', '讨论群不可管理。');
    if (!room.closedAt) {
      await tx.conversation.update({ where: { id }, data: { closedAt: new Date() } });
      await tx.conversationMember.updateMany({ where: { conversationId: id, status: 'PENDING' }, data: { status: 'LEFT' } });
    }
    return recipients;
  });
  signalChats(recipients);
  res.json({ data: { closed: true } });
});
