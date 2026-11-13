import type { DiscussionDTO, SocialChatDTO } from '@campus/contracts';
import type { Prisma } from './generated/prisma/client.js';
import { chatProfile, person } from './chat-content.js';
import { ApiError } from './http.js';

type Tx = Prisma.TransactionClient;
export const discussionCap = 100;
export const socialInclude = {
  post: { select: { id: true, status: true } },
  members: { include: { user: { include: chatProfile } } },
} as const;
type Room = Prisma.ConversationGetPayload<{ include: typeof socialInclude }>;

export async function lockPeople(tx: Tx, ids: string[]) {
  for (const id of [...new Set(ids)].sort()) {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id}::uuid FOR NO KEY UPDATE`;
  }
}

export async function pairBlocks(tx: Tx, first: string, second: string) {
  return tx.userBlock.findMany({
    where: { OR: [{ blockerId: first, blockedId: second }, { blockerId: second, blockedId: first }] },
    select: { blockerId: true },
  });
}

export async function lockRoom(tx: Tx, roomId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Conversation" WHERE "id" = ${roomId}::uuid FOR UPDATE`;
}

export function discussionInfo(room: Room, user: string): DiscussionDTO {
  return {
    id: room.id, postId: room.postId!, title: room.title,
    memberCount: room.members.filter(m => m.status === 'ACTIVE' && m.user.status === 'ACTIVE').length,
    joinMode: room.joinMode, closed: !!room.closedAt || room.post?.status !== 'PUBLISHED',
    membership: room.members.find(m => m.userId === user)?.status ?? null, canManage: room.ownerId === user,
  };
}

export async function socialAccess(tx: Tx, id: string, user: string, writing = false) {
  if (writing) {
    // Match the order used by contact creation and blocking. Every direct
    // mutation locks the pair before the conversation.
    const identity = await tx.conversation.findFirst({
      where: { id, members: { some: { userId: user, status: 'ACTIVE' } } },
      select: { kind: true, members: { select: { userId: true } } },
    });
    if (!identity) throw new ApiError(404, 'NOT_FOUND', '你当前没有这个会话的访问权限。');
    await lockPeople(tx, identity.kind === 'DIRECT' ? identity.members.map(m => m.userId) : [user]);
    await lockRoom(tx, id);
  }
  const room = await tx.conversation.findFirst({ where: { id, members: { some: { userId: user, status: 'ACTIVE', user: { status: 'ACTIVE' } } } }, include: socialInclude });
  if (!room) throw new ApiError(404, 'NOT_FOUND', '你当前没有这个会话的访问权限。');
  const member = room.members.find(m => m.userId === user)!;
  const peer = room.kind === 'DIRECT' ? room.members.find(m => m.userId !== user)?.user : null;
  const blocks = peer ? await pairBlocks(tx, user, peer.id) : [];
  if (peer && (room.state === 'DECLINED' && room.ownerId !== user || room.state === 'REQUESTED' && blocks.length && room.ownerId !== user)) {
    throw new ApiError(404, 'NOT_FOUND', '这条联系请求已不可用。');
  }
  const discussion = room.kind === 'DISCUSSION' ? discussionInfo(room, user) : null;
  const request: SocialChatDTO['request'] = room.state === 'DECLINED' ? 'DECLINED' : room.state === 'REQUESTED' ? room.ownerId === user ? 'OUTGOING' : 'INCOMING' : null;
  return {
    room, member, peer: peer ? person(peer) : null, request, discussion,
    blockedByMe: blocks.some(block => block.blockerId === user),
    canWrite: room.state === 'ACTIVE' && !room.closedAt && (discussion ? !discussion.closed : peer?.status === 'ACTIVE' && !blocks.length),
    recipients: room.members.filter(m => m.status === 'ACTIVE' && m.user.status === 'ACTIVE').map(m => m.userId),
  };
}
