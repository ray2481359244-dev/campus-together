import { z } from 'zod';
export const ChatQuerySchema = z.object({ after: z.coerce.number().int().min(0).optional(), before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(50).default(30) }).strict().refine(v => !(v.after !== undefined && v.before !== undefined), '不能同时请求前后分页');
export const SendMessageSchema = z.object({ clientMessageId: z.uuid(), body: z.string().trim().min(1).max(2000) }).strict();
export const ReadChatSchema = z.object({ seq: z.number().int().min(0) }).strict();
export const AnnouncementSchema = z.object({ revision: z.number().int().positive(), body: z.string().trim().max(2000) }).strict();
export interface ChatMessageDTO { id: string; seq: number; senderId: string | null; kind: string; nickname: string; body: string | null; createdAt: string; deleted: boolean; redactsMessageId: string | null }
export interface ChatPageDTO { archiveUntil: string | null; title: string; teamId: string; status: string; canWrite: boolean; canAnnounce: boolean; announcement: string; announcementRevision: number; highWater: number; unreadCount: number; lastReadSeq: number; items: ChatMessageDTO[]; more: boolean; previousBefore: number | null }
