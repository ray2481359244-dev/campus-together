import { z } from 'zod';
export * from './recruitments.js';

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
const PasswordSchema = z.string().min(10, '密码至少 10 位').max(128, '密码最多 128 位');
export const RegisterSchema = z.object({ email: EmailSchema, password: PasswordSchema, nickname: z.string().trim().min(2).max(20), schoolId: IdSchema }).strict();
export const LoginSchema = z.object({ email: EmailSchema, password: z.string().min(1).max(128) }).strict();
export const ProfileSchema = z.object({
  nickname: z.string().trim().min(2).max(20), schoolId: IdSchema,
  bio: z.string().trim().max(300), grade: z.string().trim().max(20),
  skills: z.array(z.string().trim().min(1).max(30)).max(15),
  interests: z.array(CategorySchema).max(4).refine(a => new Set(a).size === a.length, '兴趣不能重复'),
}).strict();
export const PostContentSchema = z.object({ topicId: IdSchema, title: z.string().trim().min(5, '标题至少 5 个字').max(60), body: z.string().trim().min(10, '正文至少 10 个字').max(5000) }).strict();
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
export interface PostDTO { id: string; title: string; body: string; revision: number; topic: TopicDTO; school: SchoolDTO; author: PublicProfileDTO; createdAt: string; updatedAt: string; canEdit: boolean }
export interface ApiErrorBody { error: { code: string; message: string; fields?: Record<string, string[]> }; requestId: string }
export interface ApiResponse<T> { data: T; meta?: { nextCursor?: string | null; appMode?: 'DEMO' | 'STANDARD' } }
