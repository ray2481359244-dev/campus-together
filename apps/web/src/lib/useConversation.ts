import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ChatMessageDTO, ChatPageDTO, SocialChatDTO } from '@campus/contracts';
import { api, ApiError, messageOf } from './api';
import { chatChangeEvent, emptyChatDraft, roomApi, roomKey, useMessages } from './messaging';
import type { Draft, MessageInput, Room } from './messaging';

export type ConversationPage = ChatPageDTO | SocialChatDTO;
type Window = { meta: ConversationPage; items: ChatMessageDTO[]; before: number | null; more: boolean; isolated: boolean };
type Mode = 'initial' | 'refresh' | 'older' | 'latest' | 'around' | 'newer';

function merge(existing: ChatMessageDTO[], incoming: ChatMessageDTO[], contextUpdates: ConversationPage['contextUpdates'] = []) {
  const items = new Map(existing.map(row => [row.id, row]));
  for (const row of incoming) items.set(row.id, row);
  const redacted = new Set([...items.values()].flatMap(row => row.redactsMessageId ?? []));
  for (const row of contextUpdates) {
    const current = items.get(row.id);
    if (current) items.set(row.id, { ...current, context: row.context });
  }
  return [...items.values()].map(row => {
    if (redacted.has(row.id)) return { ...row, deleted: true, body: null, imageId: null, reply: null, context: null, mentions: [] };
    if (row.reply && redacted.has(row.reply.id)) return { ...row, reply: null };
    return row;
  }).sort((a, b) => a.seq - b.seq);
}

const revoked = (error: unknown) => error instanceof ApiError && [401, 403, 404, 410].includes(error.status);
export function useConversation(room: Room, userId: string) {
  const client = useQueryClient(), { edit, drafts, connected } = useMessages();
  const key = roomKey(room), path = roomApi(room);
  const draft = drafts[key] ?? emptyChatDraft;
  const [page, setPage] = useState<Window | null>(null);
  const [problem, setProblem] = useState<ApiError | null>(null);
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const current = useRef<Window | null>(null);
  const request = useRef<AbortController | null>(null);
  const running = useRef(false), writing = useRef(false), reading = useRef(false);
  const queued = useRef(false);
  const generation = useRef(0);
  const liveDraft = useRef(draft);
  liveDraft.current = draft;
  const localRead = useRef(0);
  const setDraft = (change: (value: Draft) => Draft) => edit(key, change);
  function invalidate() {
    for (const name of ['chat-inbox', 'chat-badge', 'chat-pending']) void client.invalidateQueries({ queryKey: [name, userId] });
  }
  const load = useCallback(async function load(mode: Mode = 'refresh', sequence?: number) {
    const prior = current.current;
    if (mode === 'older' && !prior?.before || document.hidden && mode === 'refresh') return;
    if (running.current) {
      if (mode === 'refresh') { queued.current = true; return; }
      request.current?.abort();
    }
    const controller = new AbortController();
    request.current = controller;
    running.current = true;
    if (mode !== 'refresh') setBusy(true);
    const flags = new URLSearchParams({ limit: '40' });
    const tail = prior?.items.at(-1)?.seq ?? 0;
    if (mode === 'older' && prior?.before) flags.set('before', String(prior.before));
    else if (mode === 'around' && sequence) flags.set('around', String(sequence));
    else if (prior && (mode === 'refresh' || mode === 'newer')) {
      flags.set('after', String(mode === 'refresh' && prior.isolated && prior.more ? prior.meta.highWater : tail));
    }
    const contexts = prior?.items.filter(row => row.context).slice(-50).map(row => row.id);
    if (contexts?.length) flags.set('contexts', contexts.join(','));
    try {
      let { data } = await api<ConversationPage>(path + '?' + flags, { signal: controller.signal });
      const unreadWindow = !prior && mode !== 'latest' && data.firstUnreadSeq && data.items[0] && data.firstUnreadSeq < data.items[0].seq;
      if (unreadWindow) {
        ({ data } = await api<ConversationPage>(path + '?limit=40&around=' + data.firstUnreadSeq, { signal: controller.signal }));
      }
      if (controller.signal.aborted) return;
      localRead.current = Math.max(localRead.current, data.lastReadSeq);
      data = { ...data, lastReadSeq: localRead.current };
      const replace = mode === 'initial' || mode === 'latest' || mode === 'around' || !prior;
      const ignoreGap = mode === 'refresh' && prior?.isolated && prior.more;
      const items = merge(replace ? [] : (current.current ?? prior).items, ignoreGap ? [] : data.items, data.contextUpdates);
      const next = {
        meta: data, items,
        before: replace || mode === 'older' ? data.previousBefore : prior.before,
        more: mode === 'older' || ignoreGap ? !!prior?.more : data.more,
        isolated: replace ? mode === 'around' || !!unreadWindow : prior.isolated,
      };
      current.current = next;
      setPage(next);
      setProblem(null);
      if (mode === 'refresh' && next.more && !next.isolated) queued.current = true;
      const outbox = liveDraft.current.outbox;
      if (outbox && data.items.some(row => row.clientMessageId === outbox.input.clientMessageId)) {
        edit(key, value => value.outbox?.input.clientMessageId === outbox.input.clientMessageId ? emptyChatDraft : value);
        setFailure('');
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      if (revoked(e)) {
        current.current = null;
        setPage(null);
        edit(key, () => emptyChatDraft);
        for (const name of ['chat-inbox', 'chat-badge', 'chat-pending']) void client.invalidateQueries({ queryKey: [name, userId] });
      }
      setProblem(e instanceof ApiError ? e : new ApiError(messageOf(e), 0, 'NETWORK_ERROR'));
    } finally {
      if (request.current === controller && !controller.signal.aborted) {
        running.current = false;
        setBusy(false);
        if (queued.current) { queued.current = false; void load(); }
      }
    }
  }, [path, key, userId, client, edit]);

  useEffect(() => {
    const refresh = () => void load();
    void load('initial');
    window.addEventListener(chatChangeEvent, refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      generation.current++;
      request.current?.abort();
      request.current = null; running.current = false; queued.current = false;
      window.removeEventListener(chatChangeEvent, refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => void load(), connected ? 8_000 : 2_000);
    return () => window.clearInterval(timer);
  }, [load, connected]);

  async function send() {
    const { body, image, reply, mentions, attachment, outbox } = liveDraft.current;
    if (writing.current || !current.current || !outbox && (!current.current.meta.canWrite || !body.trim() && !image && !attachment)) return;
    writing.current = true;
    setFailure('');
    const marker = generation.current;
    const input: MessageInput = outbox?.input ?? {
      clientMessageId: crypto.randomUUID(), body: body.trim(),
      ...(reply ? { replyToId: reply.id } : {}), ...(image ? { imageId: image.id } : {}),
      ...(mentions?.length ? { mentionIds: mentions.map(person => person.id) } : {}),
      ...(attachment ? { source: attachment.source } : {}),
    };
    const createdAt = outbox?.createdAt ?? new Date().toISOString();
    setDraft(value => ({ ...value, outbox: { input, status: 'sending', createdAt } }));
    try {
      const { data: saved } = await api<ChatMessageDTO>(path + '/messages', { method: 'POST', body: input });
      const visible = marker === generation.current ? current.current : null;
      if (visible && !visible.more && saved.seq === (visible.items.at(-1)?.seq ?? visible.meta.highWater) + 1) {
        const next = { ...visible, items: merge(visible.items, [saved]) };
        current.current = next; setPage(next);
      }
      setDraft(value => value.outbox?.input.clientMessageId === input.clientMessageId ? emptyChatDraft : value);
      if (marker === generation.current) { await load('refresh'); invalidate(); }
    } catch (e) {
      setDraft(value => {
        if (value.outbox?.input.clientMessageId !== input.clientMessageId) return value;
        return { ...value, outbox: e instanceof ApiError && e.status >= 400 && e.status < 500 ? undefined : { input, status: 'unknown', createdAt } };
      });
      if (marker === generation.current) {
        setFailure(messageOf(e));
        if (revoked(e)) void load();
      }
    } finally { writing.current = false; }
  }

  async function read(seq: number) {
    if (reading.current || seq <= localRead.current || !current.current) return;
    reading.current = true;
    const marker = generation.current;
    try {
      const { data } = await api<{ lastReadSeq: number }>(path + '/read', { method: 'POST', body: { seq } });
      if (marker !== generation.current || !current.current) return;
      localRead.current = Math.max(localRead.current, data.lastReadSeq);
      invalidate();
    } catch (error) {
      if (marker === generation.current && revoked(error)) void load();
    } finally { reading.current = false; }
  }

  async function remove(id: string) {
    if (writing.current) return;
    writing.current = true;
    setFailure('');
    try { await api(path + '/messages/' + id + '/delete', { method: 'POST', body: {} }); await load(); invalidate(); }
    catch (e) { setFailure(messageOf(e)); if (revoked(e)) void load(); }
    finally { writing.current = false; }
  }

  return { page, draft, setDraft, problem, failure, busy, load, send, read, remove, invalidate };
}
