import { z } from 'zod';
import type { ChatMessageDTO } from './chat.js';
import { ConversationSourceSchema } from './chat-source.js';
export * from './chat-source.js';
export const ContactSchema = z.object({
  peerId: z.uuid(), clientMessageId: z.uuid(), body: z.string().trim().min(1).max(500),
  source: ConversationSourceSchema.optional(),
}).strict();
export const ChatPreferencesSchema = z.object({ pinned: z.boolean().optional(), muted: z.boolean().optional() }).strict()
  .refine(v => v.pinned !== undefined || v.muted !== undefined, '请选择要更新的会话设置');

export interface PersonDTO { id: string; nickname: string; avatarVersion: number | null; school: string; bio: string }
export interface ContactDTO { person: PersonDTO; conversationId: string | null; canContact: boolean; blockedByMe: boolean }
export interface ChatListItem {
  id: string; kind: 'TEAM' | 'DIRECT' | 'DISCUSSION'; title: string; preview: string; activityAt: string;
  unreadCount: number; pinned: boolean; muted: boolean; archived: boolean; request: 'INCOMING' | 'OUTGOING' | null;
  peerId?: string; peerAvatarVersion?: number | null; status?: string; captain?: boolean; archiveExpired?: boolean; pendingCount?: number; mentioned?: boolean;
}
export interface InboxDTO { items: ChatListItem[]; nextCursor: string | null }
export interface ChatBadgeDTO { unreadCount: number; requests: number }
export interface PendingChatItemsDTO {
  contacts: ChatListItem[];
  teams: { id: string; title: string; pendingCount: number }[];
  discussions: { id: string; title: string; pendingCount: number }[];
}
export interface DiscussionDTO {
  id: string; postId: string; title: string; memberCount: number; joinMode: 'OPEN' | 'APPROVAL'; closed: boolean;
  membership: 'ACTIVE' | 'PENDING' | 'LEFT' | 'REMOVED' | null; canManage: boolean;
}
export interface SocialChatDTO {
  id: string; kind: 'DIRECT' | 'DISCUSSION'; title: string; canWrite: boolean;
  request: 'INCOMING' | 'OUTGOING' | 'DECLINED' | null;
  peer: PersonDTO | null; blockedByMe: boolean; discussion: DiscussionDTO | null;
  pinned: boolean; muted: boolean; items: ChatMessageDTO[]; lastReadSeq: number; highWater: number;
  more: boolean; previousBefore: number | null; unreadCount: number; firstUnreadSeq: number | null;
  contextUpdates?: { id: string; context: ChatMessageDTO['context'] }[];
}
export interface DiscussionPeopleDTO { members: PersonDTO[]; pending: PersonDTO[] }
