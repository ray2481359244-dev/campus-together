import { z } from 'zod';
import { profilePhotoMaxBytes } from './profile-album.js';

export const avatarMaxBytes = profilePhotoMaxBytes;
export const avatarImageSize = 320;
export const AvatarRevisionSchema = z.object({ revision: z.number().int().min(0).max(2_147_483_647) }).strict();
export const UploadAvatarSchema = AvatarRevisionSchema.extend({
  base64: z.string().max(Math.ceil(avatarMaxBytes / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/),
});

export interface AvatarStateDTO { avatarRevision: number; avatarVersion: number | null }
