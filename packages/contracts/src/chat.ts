import { z } from 'zod';
import { ConversationSourceSchema } from './chat-source.js';
export const ChatQuerySchema = z.object({
  after: z.coerce.number().int().min(0).optional(), before: z.coerce.number().int().positive().optional(),
  around: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(50).default(30),
  contexts: z.string().max(1850).transform(s => s.split(',')).pipe(z.array(z.uuid()).max(50)).optional(),
}).strict().refine(v => [v.after, v.before, v.around].filter(n => n !== undefined).length <= 1, '请选择一种分页位置');
export const SendMessageSchema = z.object({
  clientMessageId: z.uuid(), body: z.string().trim().max(2000), replyToId: z.uuid().optional(),
  imageId: z.uuid().optional(), mentionIds: z.array(z.uuid()).max(20).optional(),
  source: ConversationSourceSchema.optional(),
}).strict().refine(v => !!v.body || !!v.imageId || !!v.source, '请输入文字、选择图片或附上内容');
export const ReadChatSchema = z.object({ seq: z.number().int().min(0) }).strict();
export const AnnouncementSchema = z.object({ revision: z.number().int().positive(), body: z.string().trim().max(2000) }).strict();
export interface ChatMessageDTO {
  id: string; seq: number; senderId: string | null; kind: string; nickname: string; body: string | null;
  createdAt: string; deleted: boolean; redactsMessageId: string | null;
  reply?: { id: string; seq: number; nickname: string; excerpt: string } | null;
  context?: { title: string; excerpt: string; href: string } | null;
  clientMessageId?: string | null;
  imageId?: string | null;
  mentions?: { id: string; nickname: string }[];
}
export interface ChatPageDTO { archiveUntil: string | null; title: string; teamId: string; status: string; canWrite: boolean; canAnnounce: boolean; announcement: string; announcementRevision: number; highWater: number; unreadCount: number; lastReadSeq: number; items: ChatMessageDTO[]; more: boolean; previousBefore: number | null; pinned?: boolean; muted?: boolean; memberCount?: number; recruitmentId?: string; firstUnreadSeq?: number | null; contextUpdates?: { id: string; context: ChatMessageDTO['context'] }[] }
