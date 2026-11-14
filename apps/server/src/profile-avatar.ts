import express, { Router } from 'express';
import { createHash } from 'node:crypto';
import { AvatarRevisionSchema, IdSchema, UploadAvatarSchema, avatarImageSize, avatarMaxBytes } from '@campus/contracts';
import { csrfGuard, requireUser, writeLimit } from './auth.js';
import { activeUser } from './community.js';
import { db } from './db.js';
import { avatarSelect, avatarVersion } from './dto.js';
import { ApiError, parse } from './http.js';
import { normalizePhoto } from './image-processing.js';

export const profileAvatarRouter = Router();
const conflict = () => new ApiError(409, 'AVATAR_CHANGED', '头像已在其他页面更新，请核对后再保存。');
const invalidImage = () => new ApiError(422, 'INVALID_IMAGE', '请选择 3 MB 以内的静态 JPEG、PNG 或 WebP 照片。');
const state = (profile: { avatarRevision: number; hasCustomAvatar: boolean }) => ({
  avatarRevision: profile.avatarRevision, avatarVersion: avatarVersion(profile),
});

profileAvatarRouter.get('/profiles/:userId/avatar/:version', async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const viewerId = res.locals.session?.userId;
  const profileId = parse(IdSchema, req.params.userId);
  const { revision } = parse(AvatarRevisionSchema, { revision: Number(req.params.version) });
  const avatar = viewerId && await db.profileAvatar.findFirst({
    where: { profileId, profile: { avatarRevision: revision, hasCustomAvatar: true, user: {
      status: 'ACTIVE', blocks: { none: { blockedId: viewerId } }, blockedBy: { none: { blockerId: viewerId } },
    } } }, select: { bytes: true },
  });
  if (!avatar) throw new ApiError(404, 'AVATAR_UNAVAILABLE', '头像已不可见。');
  res.type('image/webp').setHeader('Content-Disposition', 'inline').send(Buffer.from(avatar.bytes));
});

profileAvatarRouter.use('/me/avatar', (_req, res, next) => {
  requireUser(res);
  res.setHeader('Cache-Control', 'no-store');
  next();
}, writeLimit, csrfGuard);

profileAvatarRouter.put('/me/avatar', express.json({ limit: '5mb' }), async (req, res) => {
  const { id: profileId } = requireUser(res);
  const { base64, revision } = parse(UploadAvatarSchema, req.body);
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length || bytes.length > avatarMaxBytes || bytes.toString('base64') !== base64) throw invalidImage();
  const requestHash = createHash('sha256').update(bytes).digest('hex');
  let normalized;
  try { normalized = await normalizePhoto(bytes, avatarImageSize, 84, 'cover'); }
  catch { throw invalidImage(); }

  const data = await db.$transaction(async tx => {
    await activeUser(tx, profileId);
    const current = await tx.profile.findUniqueOrThrow({ where: { userId: profileId },
      select: { ...avatarSelect, avatar: { select: { requestHash: true } } },
    });
    // Accept a retry of the last upload if its response was lost.
    if (current.avatar?.requestHash === requestHash && [revision, revision + 1].includes(current.avatarRevision)) return state(current);
    if (current.avatarRevision !== revision) throw conflict();
    const image = { requestHash, bytes: new Uint8Array(normalized.data) };
    await tx.profileAvatar.upsert({ where: { profileId }, create: { profileId, ...image }, update: image });
    return state(await tx.profile.update({ where: { userId: profileId },
      data: { hasCustomAvatar: true, avatarRevision: { increment: 1 } }, select: avatarSelect,
    }));
  });
  res.json({ data });
});

profileAvatarRouter.delete('/me/avatar', async (req, res) => {
  const { id: profileId } = requireUser(res), { revision } = parse(AvatarRevisionSchema, req.body);
  const data = await db.$transaction(async tx => {
    await activeUser(tx, profileId);
    const current = await tx.profile.findUniqueOrThrow({ where: { userId: profileId }, select: avatarSelect });
    if (!current.hasCustomAvatar && (revision === current.avatarRevision || revision + 1 === current.avatarRevision)) return state(current);
    if (current.avatarRevision !== revision) throw conflict();
    await tx.profileAvatar.delete({ where: { profileId } });
    return state(await tx.profile.update({ where: { userId: profileId },
      data: { hasCustomAvatar: false, avatarRevision: { increment: 1 } }, select: avatarSelect,
    }));
  });
  res.json({ data });
});
