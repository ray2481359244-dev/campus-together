import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, Pin, Search, X } from 'lucide-react';
import type { ChatMessageDTO, ChatPageDTO, DiscussionPeopleDTO, SocialChatDTO, TeamDetailDTO } from '@campus/contracts';
import { api, ApiError, messageOf } from '../lib/api';
import { roomApi } from '../lib/messaging';
import type { Room } from '../lib/messaging';
import type { ConversationPage } from '../lib/useConversation';
import { beijingTime } from '../lib/recruitments';
import { TeamDetail } from '../pages/TeamDetail';
import { CaptainApplications } from './CaptainApplications';
import { ContactAction } from './ContactAction';
import { ErrorState, FormError, Loading } from './UI';
import { StudentAvatar } from './visual/StudentArtwork';

type Props = {
  room: Room; userId: string; meta?: ConversationPage; panel: 'details' | 'applications' | 'search';
  onClose: () => void; onApplications: () => void; onLeave: () => void;
  onJump: (seq: number) => void; onUpdate: () => void;
};
export function MessageRoomPanel({ room, userId, meta, panel, onClose, onApplications, onLeave, onJump, onUpdate }: Props) {
  const head = useRef<HTMLButtonElement>(null);
  const client = useQueryClient();
  useEffect(() => { head.current?.focus({ preventScroll: true }); }, [panel]);
  const team = useQuery({
    queryKey: ['team', room.id, userId], enabled: room.kind === 'TEAM' && panel !== 'search', staleTime: 0, retry: false,
    queryFn: ({ signal }) => api<TeamDetailDTO>('/teams/' + room.id, { signal }),
  });
  const social = meta && 'kind' in meta ? meta : undefined;
  const group = social?.discussion;
  const title = panel === 'search' ? '聊天记录' : panel === 'applications' ? '加入申请' : social?.kind === 'DIRECT' ? '联系人资料' : '群资料';
  function updated() {
    for (const key of ['chat-inbox', 'chat-badge', 'chat-pending', 'discussion-people', 'post-discussion', 'contact']) {
      void client.invalidateQueries({ queryKey: [key] });
    }
    onUpdate();
  }
  return <aside className="message-room-panel" aria-label={title}>
    <header className="message-panel-head"><h2>{title}</h2><button ref={head} type="button" className="message-icon" aria-label="关闭资料面板" onClick={onClose}><X size={20} /></button></header>
    <div className="message-panel-scroll">
      {panel === 'search' ? <HistorySearch room={room} onJump={onJump} /> : room.kind === 'TEAM' ? <>
        {team.isPending && <Loading label="正在读取队伍资料…" />}
        {team.isError && <ErrorState message={messageOf(team.error)} retry={() => void team.refetch()} />}
        {team.data && !team.isError && (panel === 'applications'
          ? team.data.data.myMembership.role === 'CAPTAIN'
            ? <CaptainApplications compact teamId={room.id} recruitmentId={team.data.data.recruitmentId} captainId={team.data.data.captainUserId} />
            : <p className="message-muted">只有队长可以处理加入申请。</p>
          : <>
            {meta && 'teamId' in meta && <TeamAnnouncement team={meta} path={roomApi(room)} onUpdate={updated} />}
            {team.data.data.myMembership.role === 'CAPTAIN' && <button type="button" className="message-setting" onClick={onApplications}>加入申请</button>}
            {meta && <Preferences room={room} meta={meta} onUpdate={updated} />}
            <TeamDetail teamId={room.id} onLeave={onLeave} />
          </>)}
      </> : social ? <>
        {social.peer && <PeerDetails social={social} onUpdate={updated} />}
        {group && <DiscussionDetails social={social} userId={userId} pendingOnly={panel === 'applications'} onUpdate={updated} onLeave={onLeave} />}
        {panel === 'details' && <Preferences room={room} meta={meta!} onUpdate={updated} />}
      </> : <Loading label="正在读取会话资料…" />}
    </div>
  </aside>;
}

function Preferences({ room, meta, onUpdate }: { room: Room; meta: ConversationPage; onUpdate: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [saved, setSaved] = useState<{ pinned: boolean; muted: boolean }>();
  const pinned = saved?.pinned ?? !!meta.pinned, muted = saved?.muted ?? !!meta.muted;
  useEffect(() => { if (saved?.pinned === meta.pinned && saved?.muted === meta.muted) setSaved(undefined); }, [meta.pinned, meta.muted, saved]);
  async function save(field: 'pinned' | 'muted') {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const { data } = await api<{ pinned: boolean; muted: boolean }>(roomApi(room) + '/preferences', {
        method: 'PUT', body: { [field]: !(field === 'pinned' ? pinned : muted) },
      });
      setSaved(data); onUpdate();
    }
    catch (e) { setError(messageOf(e)); }
    finally { setBusy(false); }
  }
  return <section className="message-setting-list" aria-label="会话设置">
    <button type="button" className="message-setting" disabled={busy} aria-pressed={pinned} onClick={() => void save('pinned')}>
      <Pin size={17} aria-hidden="true" />会话置顶<span>{pinned ? '已开启' : '已关闭'}</span>
    </button>
    <button type="button" className="message-setting" disabled={busy} aria-pressed={muted} onClick={() => void save('muted')}>
      {muted ? <BellOff size={17} aria-hidden="true" /> : <Bell size={17} aria-hidden="true" />}消息免打扰<span>{muted ? '已开启' : '已关闭'}</span>
    </button>
    <FormError>{error}</FormError>
  </section>;
}

function TeamAnnouncement({ team, path, onUpdate }: { team: ChatPageDTO; path: string; onUpdate: () => void }) {
  const [revision, setRevision] = useState<number | null>(null), [body, setBody] = useState(''), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  const editing = revision !== null;
  return <section className="message-panel-section">
    <h3>队伍公告</h3>
    {!editing && <p className="post-body">{team.announcement || '暂无公告'}</p>}
    {team.canAnnounce && (editing ? <form className="message-contact-form" onSubmit={async e => {
      e.preventDefault(); if (busy) return;
      setBusy(true); setError(''); setSaved(false);
      try { await api(path + '/announcement', { method: 'POST', body: { revision, body } }); setRevision(null); setSaved(true); onUpdate(); }
      catch (e) { setError(messageOf(e)); if (e instanceof ApiError && e.code === 'ANNOUNCEMENT_CHANGED') onUpdate(); }
      finally { setBusy(false); }
    }}>
      <label>更新队伍公告<textarea rows={3} value={body} maxLength={2000} onChange={e => setBody(e.target.value)} /></label>
      <div className="button-row"><button className="button secondary" disabled={busy}>{busy ? '正在保存…' : '保存公告'}</button>
        <button className="text-button" type="button" disabled={busy} onClick={() => { setRevision(null); setError(''); }}>取消</button></div>
    </form> : <button className="text-button" type="button" onClick={() => { setRevision(team.announcementRevision); setBody(team.announcement); setSaved(false); }}>编辑公告</button>)}
    {saved && <p role="status">公告已保存。</p>}
    <FormError>{error}</FormError>
  </section>;
}

function PeerDetails({ social, onUpdate }: { social: SocialChatDTO; onUpdate: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const peer = social.peer!;
  return <section className="message-panel-section">
    <div className="message-person"><StudentAvatar seed={peer.id} /><div><h3>{peer.nickname}</h3>{peer.school && <p>{peer.school}</p>}</div></div>
    {peer.bio && <p className="post-body">{peer.bio}</p>}
    <button className="message-setting" type="button" aria-pressed={social.blockedByMe} disabled={busy} onClick={async () => {
      setBusy(true); setError('');
      try { await api('/contacts/' + peer.id + '/block', { method: 'PUT', body: { blocked: !social.blockedByMe } }); onUpdate(); }
      catch (e) { setError(messageOf(e)); }
      finally { setBusy(false); }
    }}>{social.blockedByMe ? '解除拉黑' : '拉黑此联系人'}</button>
    <FormError>{error}</FormError>
  </section>;
}

function DiscussionDetails({ social, userId, pendingOnly, onUpdate, onLeave }: {
  social: SocialChatDTO; userId: string; pendingOnly: boolean; onUpdate: () => void; onLeave: () => void;
}) {
  const group = social.discussion!, people = useQuery({
    queryKey: ['discussion-people', userId, group.id], retry: false, staleTime: 0,
    queryFn: ({ signal }) => api<DiscussionPeopleDTO>('/discussion-groups/' + group.id + '/people', { signal }),
  });
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [confirm, setConfirm] = useState(false);
  async function action(path: string, body: object, after?: () => void) {
    if (busy) return;
    setBusy(path); setError('');
    try { await api('/discussion-groups/' + group.id + path, { method: 'POST', body }); onUpdate(); after?.(); }
    catch (e) { setError(messageOf(e)); }
    finally { setBusy(''); }
  }
  return <section className="message-panel-section">
    {!pendingOnly && <><h3>{group.title}</h3><p className="message-muted">讨论群 · {group.memberCount} 人 · {group.closed ? '已关闭' : group.joinMode === 'OPEN' ? '确认后加入' : '群主审核'}</p>
      <Link className="text-button" to={'/posts/' + group.postId + '#conversation'} state={{ fromChat: true }}>返回原帖</Link></>}
    {people.isPending && <Loading label="正在读取群成员…" />}
    {people.isError && <ErrorState message={messageOf(people.error)} retry={() => void people.refetch()} />}
    {people.data && !people.isError && <>
      {group.canManage && !group.closed && <section className="message-panel-section">
        <h3>加入申请</h3>
        {!people.data.data.pending.length && <p className="message-muted">暂无待处理申请。</p>}
        {people.data.data.pending.map(member => <div className="message-setting group-person" key={member.id}>
          <strong>{member.nickname}</strong>
          <button className="text-button" disabled={!!busy} onClick={() => void action('/people/' + member.id, { action: 'APPROVE' })}>同意</button>
          <button className="text-button" disabled={!!busy} onClick={() => void action('/people/' + member.id, { action: 'DECLINE' })}>拒绝</button>
        </div>)}
      </section>}
      {!pendingOnly && <><h3>群成员</h3>{people.data.data.members.map(member => <div className="message-setting group-person" key={member.id}>
        <ContactAction userId={member.id} nickname={member.nickname} className="message-person"><StudentAvatar seed={member.id} />{member.nickname}</ContactAction>
        {group.canManage && !group.closed && member.id !== userId && <button className="text-button danger" disabled={!!busy} onClick={() => void action('/people/' + member.id, { action: 'REMOVE' })}>移除</button>}
      </div>)}</>}
    </>}
    {!pendingOnly && (!group.canManage || !group.closed) && (confirm
      ? <div className="button-row"><button type="button" className="button secondary" disabled={!!busy}
        onClick={() => void action(group.canManage ? '/close' : '/leave', {}, group.canManage ? () => setConfirm(false) : onLeave)}>
        {group.canManage ? '确认关闭群聊' : '确认退出群聊'}</button>
        <button type="button" className="text-button" disabled={!!busy} onClick={() => setConfirm(false)}>取消</button></div>
      : <button type="button" className="text-button danger" onClick={() => setConfirm(true)}>{group.canManage ? '关闭讨论群' : '退出讨论群'}</button>)}
    <FormError>{error}</FormError>
  </section>;
}

function HistorySearch({ room, onJump }: { room: Room; onJump: (seq: number) => void }) {
  const [draft, setDraft] = useState(''), [q, setQ] = useState('');
  const [items, setItems] = useState<ChatMessageDTO[]>([]), [before, setBefore] = useState<number | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function search(value: string, cursor?: number) {
    if (!value.trim() || busy) return;
    setBusy(true); setError(''); setQ(value);
    if (!cursor) { setItems([]); setBefore(null); }
    try {
      const params = new URLSearchParams({ q: value });
      if (cursor) params.set('before', String(cursor));
      const { data } = await api<{ items: ChatMessageDTO[]; nextBefore: number | null }>(roomApi(room) + '/search?' + params);
      setItems(old => cursor ? [...old, ...data.items] : data.items);
      setBefore(data.nextBefore);
    } catch (e) {
      if (e instanceof ApiError && [401, 403, 404, 410].includes(e.status)) setItems([]);
      setError(messageOf(e));
    } finally { setBusy(false); }
  }
  return <section className="message-panel-section">
    <form className="message-search" onSubmit={e => { e.preventDefault(); void search(draft.trim()); }}>
      <input type="search" aria-label="搜索本会话聊天记录" placeholder="输入关键词" value={draft} maxLength={100} onChange={e => setDraft(e.target.value)} />
      <button type="submit" className="message-icon" aria-label="搜索聊天记录" disabled={busy || !draft.trim()}><Search size={18} /></button>
    </form>
    <FormError>{error}</FormError>
    {busy && <p role="status">正在搜索…</p>}
    {q && !busy && !items.length && !error && <p className="message-muted">没有找到相关消息。</p>}
    {items.map(item => <button type="button" className="history-result" key={item.id} onClick={() => onJump(item.seq)}>
      <strong>{item.nickname}</strong><time>{beijingTime(item.createdAt)}</time><span>{item.body || '[图片]'}</span>
    </button>)}
    {before && <button type="button" className="text-button" disabled={busy} onClick={() => void search(q, before)}>查看更多</button>}
  </section>;
}
