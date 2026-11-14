import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AtSign, ImagePlus, Link2, Send, X } from 'lucide-react';
import { ConversationSourceSchema } from '@campus/contracts';
import type { ChatMessageDTO, ConversationSource, DiscussionPeopleDTO, PersonDTO, TeamDetailDTO } from '@campus/contracts';
import { api, messageOf } from '../lib/api';
import type { Draft, Room } from '../lib/messaging';
import { FormError } from './UI';

type Props = {
  room: Room; userId: string; group: boolean; draft: Draft;
  setDraft: (update: (draft: Draft) => Draft) => void;
  onSend: () => void; error: string; input: React.RefObject<HTMLTextAreaElement | null>;
};
export function MessageComposer({ room, userId, group, draft, setDraft, onSend, error, input }: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadAttempt = useRef<{ file: File; requestKey: string } | null>(null);
  const [uploading, setUploading] = useState(false), [uploadError, setUploadError] = useState('');
  const [mention, setMention] = useState(false), [share, setShare] = useState(false), [url, setUrl] = useState('');
  const [shareBusy, setShareBusy] = useState(false), [shareError, setShareError] = useState('');
  const locked = !!draft.outbox;
  const mentionList = useQuery({
    queryKey: ['mention-people', room.kind, room.id, userId], enabled: mention && group, staleTime: 0, retry: false,
    queryFn: async ({ signal }): Promise<Pick<PersonDTO, 'id' | 'nickname'>[]> => {
      if (room.kind === 'TEAM') {
        const { data } = await api<TeamDetailDTO>('/teams/' + room.id, { signal });
        return data.members.map(member => ({ id: member.userId, nickname: member.nickname }));
      }
      return (await api<DiscussionPeopleDTO>('/discussion-groups/' + room.id + '/people', { signal })).data.members;
    },
  });
  async function upload(file: File) {
    if (uploading || locked) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 3 * 1024 * 1024) {
      setUploadError('请选择 3 MB 以内的 JPEG、PNG 或 WebP 图片。'); return;
    }
    if (uploadAttempt.current?.file !== file) uploadAttempt.current = { file, requestKey: crypto.randomUUID() };
    setUploading(true); setUploadError('');
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(',', 2)[1] || '');
        reader.onerror = () => reject(new Error('无法读取图片。'));
        reader.readAsDataURL(file);
      });
      const { data } = await api<{ id: string }>('/chat-images/' + room.kind + '/' + room.id, {
        method: 'POST', body: { requestKey: uploadAttempt.current.requestKey, base64 },
      });
      uploadAttempt.current = null;
      setDraft(value => ({ ...value, image: { id: data.id, name: file.name } }));
    } catch (e) { setUploadError(messageOf(e)); }
    finally { setUploading(false); }
  }
  async function attach() {
    if (shareBusy || locked) return;
    setShareError('');
    let source: ConversationSource;
    try {
      const link = new URL(url.trim(), window.location.origin);
      if (link.origin !== window.location.origin) throw new Error('origin');
      const [, section, id, tail] = link.pathname.split('/');
      if (tail || !['posts', 'recruitments'].includes(section)) throw new Error('path');
      source = ConversationSourceSchema.parse(section === 'posts'
        ? { kind: 'POST', postId: id, commentId: link.searchParams.get('comment') ?? undefined }
        : { kind: 'RECRUITMENT', recruitmentId: id });
    } catch { setShareError('请粘贴本站帖子或招募详情链接。'); return; }
    setShareBusy(true);
    try {
      const { data } = await api<NonNullable<ChatMessageDTO['context']>>('/contacts/context', { method: 'POST', body: source });
      setDraft(value => ({ ...value, attachment: { source, label: data.title } }));
      setUrl(''); setShare(false); input.current?.focus();
    } catch (e) { setShareError(messageOf(e)); }
    finally { setShareBusy(false); }
  }
  const ready = !!(draft.body.trim() || draft.image || draft.attachment);
  return <form className="message-composer" aria-label={room.kind === 'TEAM' ? '发送队伍消息' : '发送聊天消息'} onSubmit={e => {
    e.preventDefault();
    if (!uploading && !shareBusy && (ready || draft.outbox) && draft.outbox?.status !== 'sending') onSend();
  }}>
    {!locked && (draft.reply || draft.image || draft.attachment || draft.mentions?.length) ? <div className="message-compose-attachments">
      {draft.reply && <div><span>回复 {draft.reply.nickname} · {draft.reply.body?.slice(0, 42) || '[图片]'}</span>
        <button type="button" className="message-icon" aria-label="取消回复" onClick={() => setDraft(value => ({ ...value, reply: undefined }))}><X size={14} /></button></div>}
      {draft.image && <div><span>{draft.image.name}</span><button type="button" className="message-icon" aria-label="移除图片" onClick={() => setDraft(value => ({ ...value, image: undefined }))}><X size={14} /></button></div>}
      {draft.attachment && <div><span>{draft.attachment.label}</span><button type="button" className="message-icon" aria-label="移除内容卡片" onClick={() => setDraft(value => ({ ...value, attachment: undefined }))}><X size={14} /></button></div>}
      {draft.mentions?.map(person => <div key={person.id}><span>@{person.nickname}</span><button type="button" className="message-icon" aria-label={'取消提醒 ' + person.nickname}
        onClick={() => setDraft(value => ({ ...value, mentions: value.mentions?.filter(p => p.id !== person.id) }))}><X size={14} /></button></div>)}
    </div> : null}
    {!locked && mention && <div className="message-compose-menu" aria-label="选择要提醒的成员">
      {mentionList.isPending && <p role="status">正在读取成员…</p>}
      <FormError>{mentionList.isError ? messageOf(mentionList.error) : ''}</FormError>
      {mentionList.data?.filter(person => person.id !== userId).map(person => <button key={person.id} type="button" className="text-button" onClick={() => {
        setDraft(value => ({ ...value, mentions: [...(value.mentions ?? []).filter(p => p.id !== person.id), person].slice(-20) }));
        setMention(false); input.current?.focus();
      }}>@{person.nickname}</button>)}
      {mentionList.isSuccess && !mentionList.data.some(person => person.id !== userId) && <p className="message-muted">暂无其他成员。</p>}
    </div>}
    {!locked && share && <div className="message-compose-menu">
      <label>帖子或招募链接<input inputMode="url" value={url} onChange={e => setUrl(e.target.value)} onKeyDown={e => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); void attach(); }
      }} /></label>
      <button type="button" className="button secondary" disabled={shareBusy || !url.trim()} onClick={() => void attach()}>附上内容</button>
      <FormError>{shareError}</FormError>
    </div>}
    <FormError>{error || uploadError}</FormError>
    {uploadError && uploadAttempt.current && !locked && <button type="button" className="text-button" disabled={uploading} onClick={() => void upload(uploadAttempt.current!.file)}>重试上传</button>}
    {draft.outbox?.status === 'unknown' && <p className="message-muted" role="status">结果尚未确认，重试会核对同一条消息。</p>}
    <div className="message-compose-line">
      <input ref={fileInput} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={e => {
        const file = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (file) void upload(file);
      }} />
      {!locked && <div className="message-compose-actions">
        <button type="button" className="message-icon" aria-label="添加图片" disabled={uploading} onClick={() => fileInput.current?.click()}><ImagePlus size={19} /></button>
        {group && <button type="button" className="message-icon" aria-pressed={mention} aria-label="提醒群成员" onClick={() => { setMention(v => !v); setShare(false); }}><AtSign size={19} /></button>}
        <button type="button" className="message-icon" aria-pressed={share} aria-label="分享帖子或招募" onClick={() => { setShare(v => !v); setMention(false); }}><Link2 size={19} /></button>
      </div>}
      <textarea ref={input} aria-label="消息内容" placeholder="输入消息" rows={1} maxLength={2000} value={locked ? '' : draft.body} readOnly={locked}
        onChange={e => setDraft(value => ({ ...value, body: e.target.value }))}
        onKeyDown={e => {
          if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229 || !matchMedia('(pointer:fine)').matches) return;
          e.preventDefault(); e.currentTarget.form?.requestSubmit();
        }} />
      <button type="submit" className="button message-send" disabled={uploading || shareBusy || draft.outbox?.status === 'sending' || !ready && !locked}>
        <Send size={17} aria-hidden="true" />{uploading ? '上传中…' : draft.outbox?.status === 'sending' ? '发送中…' : draft.outbox ? '核对并重试消息' : '发送消息'}
      </button>
    </div>
  </form>;
}
