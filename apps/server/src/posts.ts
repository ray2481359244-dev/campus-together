import { attachImages } from './community.js';
import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { CategorySchema, CreatePostSchema, EditPostSchema, DeletePostSchema, IdSchema, PostsQuerySchema, PostCursorSchema } from '@campus/contracts';
import { db } from './db.js';
import { csrfGuard, requireUser, writeLimit } from './auth.js';
import { parse, ApiError } from './http.js';
import { publicProfile, userInclude } from './dto.js';
import type { Prisma } from './generated/prisma/client.js';

const postInclude = { images: { select: { id: true, width: true, height: true }, orderBy: { position: 'asc' as const } }, _count: { select: { comments: { where: { status: 'PUBLISHED' as const } }, reactions: true } }, topic: true, school: true, author: { include: userInclude } } as const;
type PostRecord = Prisma.PostGetPayload<{ include: typeof postInclude }>;
function postDTO(post: PostRecord, userId?: string) {
  return { images: post.images, counts: { comments: post._count.comments, likes: post._count.reactions }, id: post.id, title: post.title, body: post.body, revision: post.revision,
    topic: { id: post.topic.id, name: post.topic.name, category: post.topic.category, description: post.topic.description, active: post.topic.active },
    school: { id: post.school.id, name: post.school.name, city: post.school.city, isDemo: post.school.isDemo },
    author: publicProfile(post.author), createdAt: post.createdAt.toISOString(), updatedAt: post.updatedAt.toISOString(), canEdit: userId === post.authorId };
}
export const postsRouter = Router();
postsRouter.get('/topics', async (req, res) => {
  const category = req.query.category === undefined ? undefined : parse(CategorySchema, req.query.category);
  const topics = await db.topic.findMany({ where: { active: true, category }, select: { id: true, category: true, name: true, description: true, active: true }, orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  res.json({ data: topics });
});
postsRouter.get('/posts', async (req, res) => {
  const input = parse(PostsQuerySchema, req.query);
  if (!await db.school.findFirst({ where: { id: input.schoolId, active: true } })) throw new ApiError(400, 'INVALID_SCHOOL', '请选择可用的浏览学校。');
  let after: { createdAt: string; id: string } | undefined;
  if (input.cursor) {
    try { after = parse(PostCursorSchema, JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8'))); }
    catch { throw new ApiError(400, 'INVALID_CURSOR', '分页位置无效，请重新加载。'); }
  }
  const where: Prisma.PostWhereInput = { status: 'PUBLISHED', schoolId: input.schoolId,
    topicId: input.topicId, topic: input.category ? { category: input.category } : undefined,
    AND: [
      ...(input.q ? [{ OR: [{ title: { contains: input.q, mode: 'insensitive' as const } }, { body: { contains: input.q, mode: 'insensitive' as const } }, { topic: { name: { contains: input.q, mode: 'insensitive' as const } } }] }] : []),
      ...(after ? [{ OR: [{ createdAt: { lt: new Date(after.createdAt) } }, { createdAt: new Date(after.createdAt), id: { lt: after.id } }] }] : []),
    ],
  };
  const rows = await db.post.findMany({ where, include: postInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: input.limit + 1 });
  const hasMore = rows.length > input.limit, items = rows.slice(0, input.limit), last = items.at(-1);
  const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ createdAt: last.createdAt.toISOString(), id: last.id })).toString('base64url') : null;
  res.setHeader('Cache-Control', 'no-store');
  res.json({ data: items.map(p => postDTO(p, res.locals.session?.userId ?? undefined)), meta: { nextCursor } });
});
postsRouter.get('/posts/:id', async (req, res) => {
  const id = parse(IdSchema, req.params.id);
  const post = await db.post.findFirst({ where: { id, status: 'PUBLISHED' }, include: postInclude });
  if (!post) throw new ApiError(404, 'NOT_FOUND', '该讨论不存在或已经不可见。');
  res.setHeader('Cache-Control', 'no-store');
  res.json({ data: postDTO(post, res.locals.session?.userId ?? undefined) });
});
postsRouter.use('/posts', (_req, res, next) => { requireUser(res); next(); }, writeLimit, csrfGuard);
postsRouter.post('/posts', async (req, res) => {
  const user = requireUser(res), { requestKey, ...content } = parse(CreatePostSchema, req.body);
  const hash = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  const where = { authorId_createRequestKey: { authorId: user.id, createRequestKey: requestKey } };
  function replay(post: PostRecord) {
    if (post.createRequestHash !== hash) throw new ApiError(409, 'REQUEST_KEY_CONFLICT', '本次发布内容与先前提交不一致，请先核对已发布讨论。');
    if (post.status !== 'PUBLISHED') throw new ApiError(410, 'POST_UNAVAILABLE', '本次发布的讨论已删除或不可见，不能通过重试重新发布。');
    return post;
  }
  const result = await db.$transaction(async tx => {
    // Resolve a committed request before checking references that may since have changed.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${user.id}::uuid FOR NO KEY UPDATE`;
    if (!await tx.user.findFirst({ where: { id: user.id, status: 'ACTIVE' } })) throw new ApiError(401,'AUTH_REQUIRED','账号不可用。');
    const existing = await tx.post.findUnique({ where, include: postInclude });
    if (existing) return { post: replay(existing), created: false };
    const topic = await tx.topic.findFirst({ where: { id: content.topicId, active: true } });
    if (!topic) throw new ApiError(422, 'TOPIC_UNAVAILABLE', '主题已停用或不存在，请重新选择。');
    const profile = await tx.profile.findUnique({ where: { userId: user.id }, include: { school: true } });
    if (!profile?.school.active) throw new ApiError(422, 'PROFILE_INCOMPLETE', '请先完善有效的学校资料。');
    const { imageIds, ...fields } = content;
    const created = await tx.post.createMany({ data: [{ id: randomUUID(), ...fields, authorId: user.id, schoolId: profile.schoolId, createRequestKey: requestKey, createRequestHash: hash }], skipDuplicates: true });
    const stored = await tx.post.findUniqueOrThrow({ where });
    if(created.count && imageIds) await attachImages(tx, stored.id, user.id, imageIds);
    const post = replay(await tx.post.findUniqueOrThrow({ where, include: postInclude }));
    return { post, created: created.count === 1 };
  });
  res.status(result.created ? 201 : 200).json({ data: postDTO(result.post, user.id) });
});
postsRouter.patch('/posts/:id', async (req, res) => {
  const user = requireUser(res), id = parse(IdSchema, req.params.id), input = parse(EditPostSchema, req.body);
  const post = await db.post.findFirst({ where: { id, status: 'PUBLISHED' } });
  if (!post) throw new ApiError(404, 'NOT_FOUND', '该讨论不存在或已经不可见。');
  if (post.authorId !== user.id) throw new ApiError(403, 'NOT_AUTHOR', '只有作者可以修改这条讨论。');
  const updated = await db.$transaction(async tx => {
    const result = await tx.post.updateMany({ where: { id, authorId: user.id, revision: input.revision, status: 'PUBLISHED' }, data: { title: input.title, body: input.body, revision: { increment: 1 } } });
    if (!result.count) throw new ApiError(409, 'REVISION_CONFLICT', '讨论已在其他页面更新，请核对已保存版本后编辑。');
    if (input.imageIds) await attachImages(tx, id, user.id, input.imageIds);
    // Hold the update's row lock until the matching response snapshot has been read.
    return tx.post.findUniqueOrThrow({ where: { id }, include: postInclude });
  });
  res.json({ data: postDTO(updated, user.id) });
});
postsRouter.delete('/posts/:id', async (req, res) => {
  const user = requireUser(res), id = parse(IdSchema, req.params.id), input = parse(DeletePostSchema, req.body);
  const post = await db.post.findFirst({ where: { id, status: 'PUBLISHED' } });
  if (!post) throw new ApiError(404, 'NOT_FOUND', '该讨论不存在或已经不可见。');
  if (post.authorId !== user.id) throw new ApiError(403, 'NOT_AUTHOR', '只有作者可以删除这条讨论。');
  const result = await db.post.updateMany({ where: { id, authorId: user.id, revision: input.revision, status: 'PUBLISHED' }, data: { status: 'DELETED', deletedAt: new Date(), revision: { increment: 1 } } });
  if (!result.count) throw new ApiError(409, 'REVISION_CONFLICT', '讨论已更新，请重新载入后操作。');
  res.json({ data: { deleted: true } });
});
