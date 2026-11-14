import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatBadgeDTO, ChatListItem, ChatMessageDTO, ConversationSource, PersonDTO } from '@campus/contracts';
import { api } from './api';

export type Room = { kind: 'TEAM' | 'SOCIAL'; id: string };
export type MessageInput = {
  clientMessageId: string;
  body: string;
  replyToId?: string;
  imageId?: string;
  mentionIds?: string[];
  source?: ConversationSource;
};
export type Attachment = { source: ConversationSource; label: string };
export type Draft = {
  body: string;
  reply?: ChatMessageDTO;
  image?: { id: string; name: string };
  mentions?: Pick<PersonDTO, 'id' | 'nickname'>[];
  attachment?: Attachment;
  outbox?: { input: MessageInput; status: 'sending' | 'unknown'; createdAt: string };
};
export const emptyChatDraft: Draft = { body: '' };
export const roomKey = (room: Room) => room.kind + ':' + room.id;
export const roomApi = (room: Room) => room.kind === 'TEAM' ? '/teams/' + room.id + '/chat' : '/conversations/' + room.id;
export function messageLink(room: Room, panel?: 'details' | 'applications' | 'search', extra?: URLSearchParams) {
  const params = new URLSearchParams(extra);
  params.delete('view'); params.delete('tab'); params.delete('team'); params.delete('chat'); params.delete('panel');
  params.set(room.kind === 'TEAM' ? 'team' : 'chat', room.id);
  if (panel) params.set('panel', panel);
  return '/messages?' + params;
}
export function listRoom(item: ChatListItem): Room {
  return { kind: item.kind === 'TEAM' ? 'TEAM' : 'SOCIAL', id: item.id };
}

type MessagesState = {
  drafts: Record<string, Draft>;
  edit: (key: string, update: (draft: Draft) => Draft) => void;
  connected: boolean;
};
const MessagesContext = createContext<MessagesState>({ drafts: {}, edit: () => {}, connected: false });
export const useMessages = () => useContext(MessagesContext);
export const chatChangeEvent = 'campus:chat-change';

export function MessagesProvider({ userId, children }: { userId?: string; children: ReactNode }) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [connected, setConnected] = useState(false);
  const client = useQueryClient();
  useEffect(() => {
    if (!userId || !window.EventSource) return;
    let timer: number | undefined;
    const stream = new EventSource('/api/v1/me/chat-events?account=' + encodeURIComponent(userId));
    function changed() {
      if (timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        for (const queryKey of ['chat-inbox', 'chat-badge', 'chat-pending', 'post-discussion', 'discussion-people', 'notification-summary', 'notifications']) {
          void client.invalidateQueries({ queryKey: [queryKey, userId] });
        }
        void client.invalidateQueries({
          predicate: ({ queryKey }) => (queryKey[0] === 'team' || queryKey[0] === 'team-applications') && queryKey.includes(userId),
        });
        window.dispatchEvent(new Event(chatChangeEvent));
      }, 100);
    }
    stream.onopen = () => { setConnected(true); changed(); };
    stream.onerror = () => setConnected(false);
    stream.addEventListener('changed', changed);
    stream.addEventListener('session-ended', () => {
      stream.close();
      setConnected(false);
      // The account-bound read resolves the current cookie before changing UI.
      void api<ChatBadgeDTO>('/me/chat-inbox/badge').catch(() => {});
    });
    return () => {
      stream.close();
      window.clearTimeout(timer);
    };
  }, [client, userId]);
  const edit = useCallback((key: string, update: (draft: Draft) => Draft) => {
    setDrafts(previous => {
      const value = update(previous[key] ?? emptyChatDraft);
      if (value === emptyChatDraft) {
        const next = { ...previous }; delete next[key]; return next;
      }
      return { ...previous, [key]: value };
    });
  }, []);
  return <MessagesContext value={{ drafts, edit, connected }}>{children}</MessagesContext>;
}

export function useChatBadge(userId?: string) {
  const { connected } = useMessages();
  return useQuery({
    queryKey: ['chat-badge', userId], enabled: !!userId, retry: false, staleTime: 0,
    refetchInterval: connected ? 12_000 : 4_000,
    queryFn: ({ signal }) => api<ChatBadgeDTO>('/me/chat-inbox/badge', { signal }),
  });
}
