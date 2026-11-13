import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { ChatMessageDTO, ConversationSource } from '@campus/contracts';
import type { Prisma } from './generated/prisma/client.js';
import { ApiError } from './http.js';

type Tx = Prisma.TransactionClient;
type Context = NonNullable<ChatMessageDTO['context']>;
export const messageHash = (input: object) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
export const chatSearch = z.object({ q: z.string().trim().min(1).max(100), before: z.coerce.number().int().positive().optional() }).strict();
export const chatProfile = { profile: { select: { nickname: true, bio: true, school: { select: { name: true } } } } } as const;
export const person = (user: Prisma.UserGetPayload<{ include: typeof chatProfile }>) => ({
  id: user.id, nickname: user.profile?.nickname || '校园用户',
  bio: user.profile?.bio || '', school: user.profile?.school.name || '',
});

export function sourceColumns(source?: ConversationSource) {
  if (!source) return {};
  if (source.kind === 'POST') return { sourcePostId: source.postId, sourceCommentId: source.commentId };
  return { sourceRecruitmentId: source.recruitmentId };
}

export async function readContext(tx: Tx, source: ConversationSource): Promise<{ context: Context; authorId: string } | null> {
  if (source.kind === 'RECRUITMENT') {
    const row = await tx.recruitment.findFirst({
      where: { id: source.recruitmentId, publicationStatus: 'PUBLISHED', hiddenAt: null },
      select: { title: true, description: true, authorId: true },
    });
    return row ? { authorId: row.authorId, context: { title: row.title, excerpt: row.description.slice(0, 96), href: '/recruitments/' + source.recruitmentId } } : null;
  }
  const row = await tx.post.findFirst({
    where: { id: source.postId, status: 'PUBLISHED' },
    select: { title: true, body: true, authorId: true },
  });
  if (!row) return null;
  if (!source.commentId) return { authorId: row.authorId, context: { title: row.title, excerpt: row.body.slice(0, 96), href: '/posts/' + source.postId } };
  const comment = await tx.comment.findFirst({
    where: { id: source.commentId, postId: source.postId, status: 'PUBLISHED', post: { status: 'PUBLISHED' } },
    select: { body: true, authorId: true },
  });
  return comment ? { authorId: comment.authorId, context: { title: row.title, excerpt: comment.body.slice(0, 96), href: '/posts/' + source.postId + '?comment=' + source.commentId + '#conversation' } } : null;
}

type References = {
  id: string;
  deletedAt: Date | null;
  sourcePostId: string | null;
  sourceCommentId: string | null;
  sourceRecruitmentId: string | null;
};

// Read source excerpts from live public records, never from copies in private messages.
export async function contextsFor(tx: Tx, rows: References[]) {
  if (!rows.length) return new Map<string, Context | null | undefined>();
  const posts = new Map((await tx.post.findMany({
    where: { status: 'PUBLISHED', id: { in: rows.flatMap(row => row.sourcePostId ?? []) } },
    select: { id: true, title: true, body: true },
  })).map(row => [row.id, row]));
  const comments = new Map((await tx.comment.findMany({
    where: { status: 'PUBLISHED', id: { in: rows.flatMap(row => row.sourceCommentId ?? []) } },
    select: { id: true, postId: true, body: true },
  })).map(row => [row.id, row]));
  const recruitments = new Map((await tx.recruitment.findMany({
    where: { publicationStatus: 'PUBLISHED', hiddenAt: null, id: { in: rows.flatMap(row => row.sourceRecruitmentId ?? []) } },
    select: { id: true, title: true, description: true },
  })).map(row => [row.id, row]));
  return new Map(rows.map(row => {
    let context: Context | null | undefined;
    if (row.deletedAt) context = null;
    else if (row.sourcePostId) {
      const post = posts.get(row.sourcePostId), comment = row.sourceCommentId ? comments.get(row.sourceCommentId) : null;
      context = post && (!row.sourceCommentId || comment?.postId === post.id)
        ? { title: post.title, excerpt: (comment?.body ?? post.body).slice(0, 96), href: '/posts/' + post.id + (comment ? '?comment=' + comment.id + '#conversation' : '') }
        : null;
    } else if (row.sourceRecruitmentId) {
      const recruitment = recruitments.get(row.sourceRecruitmentId);
      context = recruitment ? { title: recruitment.title, excerpt: recruitment.description.slice(0, 96), href: '/recruitments/' + recruitment.id } : null;
    }
    return [row.id, context] as const;
  }));
}

export async function mentionNames(tx: Tx, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await tx.profile.findMany({ where: { userId: { in: ids }, user: { status: 'ACTIVE' } }, select: { userId: true, nickname: true } });
  return new Map(rows.map(row => [row.userId, row.nickname]));
}

export async function verifyImage(tx: Tx, id: string, user: string, scope: 'TEAM' | 'SOCIAL', roomId: string) {
  await tx.$queryRaw`SELECT "id" FROM "ChatImage" WHERE "id" = ${id}::uuid FOR UPDATE`;
  const image = await tx.chatImage.findFirst({
    where: { id, authorId: user, scope, roomId, teamMessage: null, socialMessage: null },
    select: { id: true },
  });
  if (!image) throw new ApiError(422, 'IMAGE_UNAVAILABLE', '图片已使用或不可用，请重新选择。');
}

export function quoted(row: { id: string; seq: number; nickname: string; body: string | null; imageId: string | null } | undefined) {
  return row ? { id: row.id, seq: row.seq, nickname: row.nickname, excerpt: row.body?.slice(0, 96) || (row.imageId ? '[图片]' : '[内容卡片]') } : null;
}

export function windowStart(around: number, floor = 0) {
  return Math.max(around - 7, floor + 1);
}
