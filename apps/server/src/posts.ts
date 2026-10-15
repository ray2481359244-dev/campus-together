import { Router } from 'express';
import { CategorySchema, CreatePostSchema, EditPostSchema, DeletePostSchema, IdSchema, PostsQuerySchema, PostCursorSchema } from '@campus/contracts';
import { db } from './db.js';
import { csrfGuard, requireUser, writeLimit } from './auth.js';
import { parse, ApiError } from './http.js';
import { publicProfile, userInclude } from './dto.js';
import type { Prisma } from './generated/prisma/client.js';

const postInclude = { topic: true, school: true, author: { include: userInclude } } as const;
type PostRecord = Prisma.PostGetPayload<{ include: typeof postInclude }>;
function postDTO(post: PostRecord, userId?: string) {
  return { id: post.id, title: post.title, body: post.body, revision: post.revision,
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
  const user = requireUser(res), input = parse(CreatePostSchema, req.body);
  const topic = await db.topic.findFirst({ where: { id: input.topicId, active: true } });
  if (!topic) throw new ApiError(422, 'TOPIC_UNAVAILABLE', '主题已停用或不存在，请重新选择。');
  if (!user.profile || !await db.school.findFirst({ where: { id: user.profile.schoolId, active: true } })) throw new ApiError(422, 'PROFILE_INCOMPLETE', '请先完善有效的学校资料。');
  const post = await db.post.create({ data: { ...input, authorId: user.id, schoolId: user.profile.schoolId }, include: postInclude });
  res.status(201).json({ data: postDTO(post, user.id) });
});
postsRouter.patch('/posts/:id', async (req, res) => {
  const user = requireUser(res), id = parse(IdSchema, req.params.id), input = parse(EditPostSchema, req.body);
  const post = await db.post.findFirst({ where: { id, status: 'PUBLISHED' } });
  if (!post) throw new ApiError(404, 'NOT_FOUND', '该讨论不存在或已经不可见。');
  if (post.authorId !== user.id) throw new ApiError(403, 'NOT_AUTHOR', '只有作者可以修改这条讨论。');
  const result = await db.post.updateMany({ where: { id, authorId: user.id, revision: input.revision, status: 'PUBLISHED' }, data: { title: input.title, body: input.body, revision: { increment: 1 } } });
  if (!result.count) throw new ApiError(409, 'REVISION_CONFLICT', '讨论已在其他页面更新，请重新载入后编辑。');
  const updated = await db.post.findUniqueOrThrow({ where: { id }, include: postInclude });
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
