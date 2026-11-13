import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import type { DiscussionDTO } from '@campus/contracts';
import { api, messageOf } from '../lib/api';
import { useAuth } from '../lib/auth';
import { messageLink, useMessages } from '../lib/messaging';
import { FormError } from './UI';

export function PostDiscussionGroup({ postId, title, author }: { postId: string; title: string; author: boolean }) {
  const { user } = useAuth(), { connected } = useMessages(), client = useQueryClient();
  const [create, setCreate] = useState(false), [confirm, setConfirm] = useState(false);
  const [name, setName] = useState(title.slice(0, 80)), [joinMode, setJoinMode] = useState<'OPEN' | 'APPROVAL'>('OPEN');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const key = ['post-discussion', user?.id, postId];
  const result = useQuery({
    queryKey: key, enabled: !!user, staleTime: 0, retry: false, refetchInterval: connected ? 12_000 : 5_000,
    queryFn: ({ signal }) => api<DiscussionDTO | null>('/post-discussions/' + postId, { signal }),
  });
  const group = result.data?.data;
  if (!user || result.isPending || !group && !author) return null;
  async function mutate(path: string, body: object) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      await api(path, { method: 'POST', body });
      setCreate(false); setConfirm(false);
      for (const name of ['post-discussion', 'chat-inbox', 'chat-badge', 'chat-pending']) void client.invalidateQueries({ queryKey: [name] });
    } catch (e) { setError(messageOf(e)); }
    finally { setBusy(false); }
  }
  return <section className="post-discussion-group" aria-label="帖子讨论群">
    <div className="post-discussion-head"><span className="message-group-avatar discussion"><Users size={21} aria-hidden="true" /></span>
      <div><h3>{group?.title || '帖子讨论群'}</h3>
        <p>{group ? group.memberCount + ' 人 · ' + (group.closed ? '已关闭' : group.joinMode === 'OPEN' ? '确认后加入' : '需要群主确认') : '和对这个话题感兴趣的同学聊聊'}</p></div>
    </div>
    {result.isError ? <button type="button" className="text-button" onClick={() => void result.refetch()}>重试读取群聊</button>
      : group ? <>
        {group.membership === 'ACTIVE' ? <Link className="button secondary" to={messageLink({ kind: 'SOCIAL', id: group.id })}>打开讨论群</Link>
          : group.membership === 'PENDING' ? <div className="button-row"><span role="status">等待群主确认</span><button type="button" className="text-button" disabled={busy}
            onClick={() => void mutate('/discussion-groups/' + group.id + '/leave', {})}>撤回请求</button></div>
          : group.membership === 'REMOVED' || group.closed ? <p className="message-muted">当前无法加入。</p>
          : confirm ? <div><p className="message-muted">加入后可参与讨论。正式报名请到招募页办理。</p>
            <div className="button-row"><button type="button" className="button" disabled={busy} onClick={() => void mutate('/discussion-groups/' + group.id + '/join', {})}>
              {busy ? '正在提交…' : group.joinMode === 'OPEN' ? '确认加入讨论群' : '提交入群申请'}</button>
              <button type="button" className="text-button" disabled={busy} onClick={() => setConfirm(false)}>取消</button></div></div>
          : <button type="button" className="button secondary" onClick={() => setConfirm(true)}>进群聊聊</button>}
      </> : create ? <form className="message-contact-form" onSubmit={e => { e.preventDefault(); void mutate('/post-discussions/' + postId, { title: name, joinMode }); }}>
        <label>群名<input value={name} maxLength={80} minLength={2} required onChange={e => setName(e.target.value)} /></label>
        <label>加入方式<select value={joinMode} onChange={e => setJoinMode(e.target.value as typeof joinMode)}>
          <option value="OPEN">确认后加入</option><option value="APPROVAL">我来确认</option></select></label>
        <div className="button-row"><button className="button" disabled={busy || name.trim().length < 2}>{busy ? '正在创建…' : '创建讨论群'}</button>
          <button type="button" className="text-button" disabled={busy} onClick={() => setCreate(false)}>取消</button></div>
      </form> : <button type="button" className="text-button" onClick={() => setCreate(true)}>创建讨论群</button>}
    <FormError>{error}</FormError>
  </section>;
}
