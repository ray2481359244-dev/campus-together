import { z } from 'zod';

export const profileAlbumLimit = 9;
export const profilePhotoMaxBytes = 3 * 1024 * 1024;
export const PhotoVisibilitySchema = z.enum(['PRIVATE', 'CAMPUS']);
export type PhotoVisibility = z.infer<typeof PhotoVisibilitySchema>;
export const UploadProfilePhotoSchema = z.object({
  requestKey: z.uuid(),
  base64: z.string().max(Math.ceil(profilePhotoMaxBytes / 3) * 4).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  visibility: PhotoVisibilitySchema.default('PRIVATE'),
}).strict();
export const ProfilePhotoVisibilitySchema = z.object({
  visibility: PhotoVisibilitySchema,
  revision: z.number().int().positive(),
}).strict();
const photoIds = z.array(z.uuid()).max(profileAlbumLimit).refine(ids => new Set(ids).size === ids.length);
export const ProfilePhotoOrderSchema = z.object({ previous: photoIds, order: photoIds }).strict();
export interface ProfilePhotoDTO {
  id: string;
  width: number;
  height: number;
  visibility: PhotoVisibility;
  revision: number;
}
