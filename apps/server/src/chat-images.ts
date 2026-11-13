import express, { Router } from 'express';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { IdSchema } from '@campus/contracts';
import { db } from './db.js';
import { csrfGuard, requireUser, writeLimit } from './auth.js';
import { ApiError, parse } from './http.js';
import { teamChatAccess } from './chat.js';
import { socialAccess } from './social-access.js';

const upload = z.object({ requestKey: z.uuid(), base64: z.string().max(4_194_304).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict();
const readOptions = { isolationLevel: 'RepeatableRead' as const };
const invalidImage = () => new ApiError(422, 'INVALID_IMAGE', '请选择 3 MB 以内的 JPEG、PNG 或 WebP 静态图片。');
export const chatImagesRouter = Router();
chatImagesRouter.use('/chat-images', (_req, res, next) => {
  requireUser(res);
  res.setHeader('Cache-Control', 'no-store');
  next();
});

chatImagesRouter.post('/chat-images/:scope/:roomId', writeLimit, csrfGuard, express.json({ limit: '5mb' }), async (req, res) => {
  const user = requireUser(res).id, roomId = parse(IdSchema, req.params.roomId);
  const scope = parse(z.enum(['TEAM', 'SOCIAL']), req.params.scope);
  const input = parse(upload, req.body);
  const authorized = await db.$transaction(async tx => {
    const access = scope === 'TEAM' ? await teamChatAccess(tx, roomId, user, false) : await socialAccess(tx, roomId, user);
    return access.canWrite;
  }, readOptions);
  if (!authorized) throw new ApiError(409, 'CHAT_READ_ONLY', '当前会话暂不可发送图片。');
  const bytes = Buffer.from(input.base64, 'base64');
  if (!bytes.length || bytes.length > 3 * 1024 * 1024 || bytes.toString('base64') !== input.base64) throw invalidImage();
  const hash = createHash('sha256').update(bytes).digest('hex');
  let output: Buffer;
  try {
    const image = sharp(bytes, { limitInputPixels: 16_000_000, failOn: 'warning' });
    const meta = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(meta.format || '') || (meta.pages ?? 1) > 1) throw invalidImage();
    output = await image.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 83 }).toBuffer();
  } catch { throw invalidImage(); }
  const data = await db.$transaction(async tx => {
    const access = scope === 'TEAM' ? await teamChatAccess(tx, roomId, user) : await socialAccess(tx, roomId, user, true);
    if (!access.canWrite) throw new ApiError(409, 'CHAT_READ_ONLY', '当前会话暂不可发送图片。');
    const known = await tx.chatImage.findUnique({ where: { authorId_requestKey: { authorId: user, requestKey: input.requestKey } }, select: { id: true, scope: true, roomId: true, hash: true } });
    if (known) {
      if (known.hash !== hash || known.scope !== scope || known.roomId !== roomId) throw new ApiError(409, 'REQUEST_KEY_CONFLICT', '本次上传的图片已变化。');
      return { id: known.id };
    }
    if (await tx.chatImage.count({ where: { authorId: user, createdAt: { gt: new Date(Date.now() - 86_400_000) } } }) >= 30) {
      throw new ApiError(429, 'UPLOAD_LIMIT', '今天上传的聊天图片已达上限。');
    }
    return tx.chatImage.create({ data: { authorId: user, requestKey: input.requestKey, roomId, scope, hash, bytes: new Uint8Array(output) }, select: { id: true } });
  });
  res.json({ data });
});

chatImagesRouter.get('/chat-images/:id', async (req, res) => {
  const user = requireUser(res).id, id = parse(IdSchema, req.params.id);
  const bytes = await db.$transaction(async tx => {
    const identity = await tx.chatImage.findUnique({
      where: { id }, select: { scope: true, roomId: true, teamMessage: { select: { deletedAt: true } }, socialMessage: { select: { seq: true, deletedAt: true } } },
    });
    if (identity?.scope === 'TEAM' && identity.teamMessage && !identity.teamMessage.deletedAt) {
      await teamChatAccess(tx, identity.roomId, user, false);
    } else if (identity?.scope === 'SOCIAL' && identity.socialMessage && !identity.socialMessage.deletedAt) {
      const access = await socialAccess(tx, identity.roomId, user);
      if (identity.socialMessage.seq <= access.member.joinedAfterSeq) throw new ApiError(404, 'NOT_FOUND', '图片不可见。');
    } else throw new ApiError(404, 'NOT_FOUND', '图片不可见。');
    return (await tx.chatImage.findUniqueOrThrow({ where: { id }, select: { bytes: true } })).bytes;
  }, readOptions);
  res.type('image/webp').setHeader('Content-Disposition', 'inline');
  res.send(Buffer.from(bytes));
});
