import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, X } from 'lucide-react';
import type { ContactDTO, ConversationSource } from '@campus/contracts';
import { api, ApiError, messageOf } from '../lib/api';
import { useAuth } from '../lib/auth';
import { messageLink } from '../lib/messaging';
import { rememberScroll } from '../lib/scroll';
import { ErrorState, FormError, Loading } from './UI';
import { StudentAvatar } from './visual/StudentArtwork';

type Props = {
  userId: string; nickname: string; source?: ConversationSource; sourceLabel?: string;
  children?: ReactNode; className?: string; label?: string; text?: string;
};
export function ContactAction({ userId, nickname, source, sourceLabel, children, className = 'text-button', label, text = '私聊' }: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  if (!user || user.id === userId) return <>{children}</>;
  return <>
    <button type="button" className={className} aria-label={label} onClick={() => setOpen(true)}>
      {children ?? <><MessageCircle size={15} aria-hidden="true" />{text}</>}
    </button>
    {open && <ContactDialog key={userId} userId={userId} nickname={nickname} source={source} sourceLabel={sourceLabel} onClose={() => setOpen(false)} />}
  </>;
}

function ContactDialog({ userId, nickname, source, sourceLabel, onClose }: Props & { onClose: () => void }) {
  const { user } = useAuth(), client = useQueryClient(), navigate = useNavigate(), location = useLocation();
  const dialog = useRef<HTMLDialogElement>(null);
  const [body, setBody] = useState(''), [withSource, setWithSource] = useState(!!source);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const attempt = useRef<{ peerId: string; clientMessageId: string; body: string; source?: ConversationSource } | null>(null);
  const contact = useQuery({
    queryKey: ['contact', user?.id, userId], staleTime: 0, retry: false,
    queryFn: ({ signal }) => api<ContactDTO>('/contacts/' + userId, { signal }),
  });
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  const row = contact.data?.data;
  const chat = row?.conversationId ? messageLink({ kind: 'SOCIAL', id: row.conversationId }) : null;
  const attachment = source && withSource ? { source, label: sourceLabel || '来自当前内容' } : undefined;
  function remember() { rememberScroll(location.key); }
  async function send() {
    if (busy || !body.trim()) return;
    setBusy(true); setError('');
    attempt.current ??= { peerId: userId, clientMessageId: crypto.randomUUID(), body: body.trim(), source: attachment?.source };
    try {
      const { data } = await api<{ id: string; sent: boolean }>('/contacts', { method: 'POST', body: attempt.current });
      const pending = attempt.current;
      attempt.current = null;
      for (const key of ['contact', 'chat-inbox', 'chat-badge']) void client.invalidateQueries({ queryKey: [key, user?.id] });
      remember();
      navigate(messageLink({ kind: 'SOCIAL', id: data.id }), {
        state: { returnTo: location.pathname + location.search + location.hash, ...(data.sent ? {} : { body: pending.body, attachment }) },
      });
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) attempt.current = null;
      setError(messageOf(e));
    } finally { setBusy(false); }
  }
  return <dialog className="contact-dialog message-dialog" ref={dialog} onKeyDown={e => { if (e.key === 'Escape') e.stopPropagation(); }}
    onCancel={e => { e.preventDefault(); if (!busy) onClose(); }} aria-labelledby="contact-name">
    <header className="message-dialog-head"><StudentAvatar seed={userId} /><h2 id="contact-name">{row?.person.nickname || nickname}</h2>
      <button type="button" className="message-icon" aria-label="关闭私聊窗口" disabled={busy} onClick={onClose}><X size={20} /></button></header>
    {contact.isPending && <Loading label="正在读取联系人…" />}
    {contact.isError && <ErrorState message={messageOf(contact.error)} retry={() => void contact.refetch()} />}
    {row && <>
      {row.person.school && <p className="message-muted">{row.person.school}</p>}
      {row.person.bio && <p className="post-body">{row.person.bio}</p>}
      {source && (chat || row.canContact) && <label className="message-check"><input type="checkbox" checked={withSource} disabled={busy || !!attempt.current}
        onChange={e => setWithSource(e.target.checked)} />{sourceLabel || '附上当前内容'}</label>}
      {chat ? <Link className="button" to={chat} state={{ attachment, returnTo: location.pathname + location.search + location.hash }} onClick={() => { remember(); onClose(); }}>打开私聊</Link>
        : row.canContact ? <form className="message-contact-form" onSubmit={e => { e.preventDefault(); void send(); }}>
          <label>第一条消息<textarea value={body} rows={3} maxLength={500} placeholder="说说你想聊什么" readOnly={busy || !!attempt.current}
            onChange={e => setBody(e.target.value)} /></label>
          <p className="message-muted">对方接受后即可继续聊天。</p>
          <FormError>{error}</FormError>
          <button className="button" disabled={busy || !body.trim()}>{busy ? '正在发送…' : attempt.current ? '核对并重试' : '发送联系请求'}</button>
        </form> : <p role="status">对方当前无法接收新联系。</p>}
    </>}
  </dialog>;
}
