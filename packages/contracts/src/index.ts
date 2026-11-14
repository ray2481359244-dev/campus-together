export * from './chat.js';
export * from './social.js';
export * from './assistance.js';
import { z } from 'zod';
export * from './recruitments.js';
export * from './recruitment-copy.js';
export * from './profile-album.js';
export * from './applications.js';
export * from './teams.js';

export const categories = ['GAME', 'STUDY', 'COMPETITION', 'OUTDOOR'] as const;
export const CategorySchema = z.enum(categories);
export type Category = z.infer<typeof CategorySchema>;
export const categoryInfo: Record<Category, { name: string; short: string; english: string; description: string }> = {
  GAME: { name: '游戏开黑', short: '游戏', english: 'PLAY', description: '课后快乐，默契开局。' },
  STUDY: { name: '学习搭子', short: '学习', english: 'GROW', description: '一起专注，一起有进步。' },
  COMPETITION: { name: '竞赛组队', short: '竞赛', english: 'BUILD', description: '不同技能，同一个目标。' },
  OUTDOOR: { name: '周末户外', short: '户外', english: 'ROAM', description: '离开屏幕，去看看世界。' },
};
export const IdSchema = z.uuid();
const EmailSchema = z.email().max(254).transform(v => v.normalize('NFKC').toLowerCase());
export const passwordLimits = { demo: 6, standard: 10, max: 128 } as const;
export const NicknameSchema = z.string().trim().min(2).max(20);
export const RenameProfileSchema = z.object({ nickname: NicknameSchema }).strict();
export function registrationSchema(minimum: typeof passwordLimits.demo | typeof passwordLimits.standard) {
  return z.object({
    email: EmailSchema, password: z.string().min(minimum, `密码至少 ${minimum} 个字符`).max(passwordLimits.max, `密码最多 ${passwordLimits.max} 个字符`),
    nickname: NicknameSchema, schoolId: IdSchema,
  }).strict();
}
export const RegisterSchema = registrationSchema(passwordLimits.standard);
export const LoginSchema = z.object({ email: EmailSchema, password: z.string().min(1).max(128) }).strict();
export const ProfileSchema = z.object({
  nickname: NicknameSchema, schoolId: IdSchema,
  bio: z.string().trim().max(300), grade: z.string().trim().max(20),
  skills: z.array(z.string().trim().min(1).max(30)).max(15),
  interests: z.array(CategorySchema).max(4).refine(a => new Set(a).size === a.length, '兴趣不能重复'),
}).strict();
export const ProfileDetailsSchema = ProfileSchema.omit({ nickname: true });
export const PostContentSchema = z.object({ topicId: IdSchema, title: z.string().trim().min(5, '标题至少 5 个字').max(60), body: z.string().trim().min(10, '正文至少 10 个字').max(5000), imageIds: z.array(IdSchema).max(6).refine(a => new Set(a).size === a.length).optional() }).strict();
export type PostContent = z.infer<typeof PostContentSchema>;
export const CreatePostSchema = PostContentSchema.extend({ requestKey: IdSchema }).strict();
export type CreatePost = z.infer<typeof CreatePostSchema>;
export const EditPostSchema = PostContentSchema.omit({ topicId: true }).extend({ revision: z.number().int().positive() }).strict();
export const DeletePostSchema = z.object({ revision: z.number().int().positive() }).strict();
export const PostCursorSchema = z.object({ createdAt: z.iso.datetime(), id: IdSchema }).strict();
export const PostsQuerySchema = z.object({
  schoolId: IdSchema, category: CategorySchema.optional(), topicId: IdSchema.optional(),
  q: z.string().trim().max(100).optional(), cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
export interface SchoolDTO { id: string; name: string; city: string; isDemo: boolean }
export interface TopicDTO { id: string; category: Category; name: string; description: string; active: boolean }
export interface PublicProfileDTO { id: string; nickname: string; bio: string; grade: string; skills: string[]; interests: Category[]; school: SchoolDTO; identityStatus: 'SELF_REPORTED' }
export interface MeDTO extends PublicProfileDTO { email: string; emailVerified: false; role: 'USER' | 'ADMIN' }
export interface ProfileActivityDTO { id: string; type: 'POST' | 'RECRUITMENT'; title: string; createdAt: string }
export interface PostDTO { id: string; title: string; body: string; revision: number; topic: TopicDTO; school: SchoolDTO; author: PublicProfileDTO; createdAt: string; updatedAt: string; canEdit: boolean; images: { id: string; width: number; height: number }[]; counts: { comments: number; likes: number } }
export interface ApiErrorBody { error: { code: string; message: string; fields?: Record<string, string[]> }; requestId: string }
export interface ApiResponse<T> { data: T; meta?: { nextCursor?: string | null; appMode?: 'DEMO' | 'STANDARD' } }

export interface CommentDTO { id: string; authorId: string; body: string; replyId: string | null; reply: { body: string; nickname: string } | null; nickname: string; canDelete: boolean; createdAt: string }
export interface CommunityDTO { likes: number; liked: boolean; saved: boolean; notificationsMuted: boolean; comments: CommentDTO[]; commentCount?: number; nextCursor: string | null }
export interface SavedDTO { id: string; postId: string | null; recruitmentId: string | null; title: string; available: boolean }
