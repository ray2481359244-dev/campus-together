import express, { Router } from 'express';
import { createHash } from 'node:crypto';
import {
  IdSchema, ProfilePhotoOrderSchema, ProfilePhotoVisibilitySchema, UploadProfilePhotoSchema, profileAlbumLimit, profilePhotoMaxBytes,
} from '@campus/contracts';
import type { Prisma } from './generated/prisma/client.js';
import { csrfGuard, requireUser, writeLimit } from './auth.js';
import { activeUser } from './community.js';
import { db } from './db.js';
import { ApiError, parse } from './http.js';
import { normalizePhoto } from './image-processing.js';

export const profileAlbumRouter = Router();
const photoSelect = { id: true, width: true, height: true, visibility: true, revision: true } as const;
const orderBy = [{ position: 'asc' as const }, { id: 'asc' as const }];
const missing = () => new ApiError(404, 'PHOTO_UNAVAILABLE', '这张照片已不可见。');
const invalidImage = () => new ApiError(422, 'INVALID_IMAGE', '请选择 3 MB 以内的静态 JPEG、PNG 或 WebP 图片。');

function visiblePhotos(viewerId: string): Prisma.ProfilePhotoWhereInput {
  return {
    removedAt: null, owner: { status: 'ACTIVE' }, OR: [
      { ownerId: viewerId },
      { visibility: 'CAMPUS', owner: { blocks: { none: { blockedId: viewerId } }, blockedBy: { none: { blockerId: viewerId } } } },
    ],
  };
}

// Apply the same visibility check to reports, album lists and both image sizes.
export function visibleProfilePhoto(tx: Prisma.TransactionClient, id: string, viewerId: string) {
  return tx.profilePhoto.findFirst({
    where: { id, ...visiblePhotos(viewerId) },
    select: { id: true, ownerId: true, revision: true, owner: { select: { profile: { select: { nickname: true } } } } },
  });
}

profileAlbumRouter.get('/admin/profile-photo-reports/:reportId/image', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (requireUser(res).role !== 'ADMIN') throw missing();
  const reportId = parse(IdSchema, req.params.reportId);
  const bytes = await db.$transaction(async tx => {
    const report = await tx.report.findFirst({ where: { id: reportId, targetType: 'PROFILE_PHOTO', status: 'PENDING' }, select: { targetId: true } });
    if (!report) throw missing();
    return (await tx.profilePhoto.findFirst({
      where: { id: report.targetId, visibility: 'CAMPUS', removedAt: null, owner: { status: 'ACTIVE' } }, select: { bytes: true },
    }))?.bytes;
  }, { isolationLevel: 'RepeatableRead' });
  if (!bytes) throw missing();
  res.type('image/webp').setHeader('Content-Disposition', 'inline').send(Buffer.from(bytes));
});

profileAlbumRouter.use(['/profiles/:userId/album', '/me/album', '/profile-photos'], (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  requireUser(res);
  next();
});

profileAlbumRouter.get('/profiles/:userId/album', async (req, res) => {
  const viewer = requireUser(res), ownerId = parse(IdSchema, req.params.userId);
  const data = await db.profilePhoto.findMany({ where: { ownerId, ...visiblePhotos(viewer.id) }, orderBy, select: photoSelect });
  res.json({ data });
});

profileAlbumRouter.get('/profile-photos/:id/:size', async (req, res) => {
  const viewer = requireUser(res), id = parse(IdSchema, req.params.id), size = req.params.size;
  if (size !== 'thumb' && size !== 'full') throw missing();
  const bytes = await db.$transaction(async tx => {
    if (!await visibleProfilePhoto(tx, id, viewer.id)) throw missing();
    const row = await tx.profilePhoto.findUnique({ where: { id }, select: { bytes: size === 'full', thumbnail: size === 'thumb' } });
    return size === 'full' ? row?.bytes : row?.thumbnail;
  }, { isolationLevel: 'RepeatableRead' });
  if (!bytes) throw missing();
  res.type('image/webp').setHeader('Content-Disposition', 'inline').send(Buffer.from(bytes));
});

profileAlbumRouter.post('/me/album', writeLimit, csrfGuard, express.json({ limit: '5mb' }), async (req, res) => {
  const { id: ownerId } = requireUser(res), input = parse(UploadProfilePhotoSchema, req.body);
  const bytes = Buffer.from(input.base64, 'base64');
  if (!bytes.length || bytes.length > profilePhotoMaxBytes || bytes.toString('base64') !== input.base64) throw invalidImage();
  const requestHash = createHash('sha256').update(input.visibility).update(bytes).digest('hex');
  const key = { ownerId_requestKey: { ownerId, requestKey: input.requestKey } };
  const uploadSelect = { ...photoSelect, requestHash: true, removedAt: true } as const;
  function replay(known: Prisma.ProfilePhotoGetPayload<{ select: typeof uploadSelect }>) {
    if (known.requestHash !== requestHash) throw new ApiError(409, 'REQUEST_KEY_CONFLICT', '这次上传与原请求不同。');
    if (known.removedAt) throw new ApiError(410, 'PHOTO_REMOVED', '原上传已被移除，请重新选择照片。');
    const { id, width, height, visibility, revision } = known;
    return { id, width, height, visibility, revision };
  }
  const known = await db.profilePhoto.findUnique({ where: key, select: uploadSelect });
  if (known) { res.json({ data: replay(known) }); return; }
  let full: Awaited<ReturnType<typeof normalizePhoto>>, thumbnail: Awaited<ReturnType<typeof normalizePhoto>>;
  try {
    full = await normalizePhoto(bytes, 1600, 83);
    thumbnail = await normalizePhoto(full.data, 420, 78);
  } catch { throw invalidImage(); }
  const data = await db.$transaction(async tx => {
    await activeUser(tx, ownerId);
    const prior = await tx.profilePhoto.findUnique({ where: key, select: uploadSelect });
    if (prior) return replay(prior);
    const current = await tx.profilePhoto.findMany({ where: { ownerId, removedAt: null }, orderBy, select: { position: true } });
    if (current.length >= profileAlbumLimit) throw new ApiError(409, 'ALBUM_FULL', '相册已满，移除一张后可继续添加。');
    if (await tx.profilePhoto.count({ where: { ownerId, createdAt: { gte: new Date(Date.now() - 86_400_000) } } }) >= 30) {
      throw new ApiError(429, 'UPLOAD_LIMIT', '今天最多上传 30 张照片，请明天再试。');
    }
    return tx.profilePhoto.create({ select: photoSelect, data: {
      ownerId, requestKey: input.requestKey, requestHash, visibility: input.visibility, position: (current.at(-1)?.position ?? -1) + 1,
      width: full.info.width, height: full.info.height, bytes: new Uint8Array(full.data), thumbnail: new Uint8Array(thumbnail.data),
    } });
  });
  res.status(201).json({ data });
});

profileAlbumRouter.put('/me/album/order', writeLimit, csrfGuard, async (req, res) => {
  const { id: ownerId } = requireUser(res), { order, previous } = parse(ProfilePhotoOrderSchema, req.body);
  const data = await db.$transaction(async tx => {
    await activeUser(tx, ownerId);
    const photos = await tx.profilePhoto.findMany({ where: { ownerId, removedAt: null }, orderBy, select: photoSelect });
    const current = photos.map(photo => photo.id);
    if (current.length === order.length && order.every((id, i) => current[i] === id)) return photos;
    if (current.length !== order.length || order.some(id => !current.includes(id)) ||
      current.length !== previous.length || previous.some((id, i) => current[i] !== id)) {
      throw new ApiError(409, 'ALBUM_CHANGED', '相册在其他页面有更新，请刷新后排序。');
    }
    for (const [position, id] of order.entries()) {
      const updated = await tx.profilePhoto.updateMany({ where: { id, removedAt: null }, data: { position } });
      if (!updated.count) throw new ApiError(409, 'ALBUM_CHANGED', '相册在其他页面有更新，请刷新后排序。');
    }
    return order.map(id => photos.find(photo => photo.id === id)!);
  });
  res.json({ data });
});

profileAlbumRouter.patch('/me/album/:id', writeLimit, csrfGuard, async (req, res) => {
  const ownerId = requireUser(res).id, id = parse(IdSchema, req.params.id), input = parse(ProfilePhotoVisibilitySchema, req.body);
  const data = await db.$transaction(async tx => {
    await activeUser(tx, ownerId);
    await tx.$queryRaw`SELECT "id" FROM "ProfilePhoto" WHERE "id" = ${id}::uuid AND "ownerId" = ${ownerId}::uuid FOR UPDATE`;
    const current = await tx.profilePhoto.findFirst({ where: { id, ownerId, removedAt: null }, select: photoSelect });
    if (!current) throw missing();
    if (current.visibility === input.visibility) return current;
    if (current.revision !== input.revision) throw new ApiError(409, 'PHOTO_CHANGED', '照片的可见范围已变化，请刷新后重试。');
    return tx.profilePhoto.update({ where: { id }, select: photoSelect, data: { visibility: input.visibility, revision: { increment: 1 } } });
  });
  res.json({ data });
});

export async function removeProfilePhoto(tx: Prisma.TransactionClient, id: string, ownerId?: string) {
  const result = await tx.profilePhoto.updateMany({ where: { id, ...(ownerId ? { ownerId } : {}), removedAt: null }, data: {
    removedAt: new Date(), bytes: null, thumbnail: null, revision: { increment: 1 },
  } });
  return result.count > 0;
}
profileAlbumRouter.delete('/me/album/:id', writeLimit, csrfGuard, async (req, res) => {
  const ownerId = requireUser(res).id, id = parse(IdSchema, req.params.id);
  await db.$transaction(async tx => {
    await activeUser(tx, ownerId);
    if (!await removeProfilePhoto(tx, id, ownerId) && !await tx.profilePhoto.findFirst({ where: { id, ownerId }, select: { id: true } })) throw missing();
  });
  res.json({ data: { removed: true } });
});
