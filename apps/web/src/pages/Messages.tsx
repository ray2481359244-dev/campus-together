import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bell, BellOff, ChevronDown, Ellipsis, MessageCircle, Pin, Search, Users } from 'lucide-react';
import { IdSchema } from '@campus/contracts';
import type { ChatListItem, InboxDTO, PendingChatItemsDTO } from '@campus/contracts';
import { api, messageOf } from '../lib/api';
import { useAuth } from '../lib/auth';
import { chatChangeEvent, listRoom, messageLink, roomApi, roomKey, useChatBadge, useMessages } from '../lib/messaging';
import type { Attachment, Room } from '../lib/messaging';
import { useNotificationSummary } from '../lib/notifications';
import { rememberScroll } from '../lib/scroll';
import { MessageConversation } from '../components/MessageConversation';
import type { RoomPanel } from '../components/MessageConversation';
import { ErrorState, FormError, Loading } from '../components/UI';
import { Notifications } from './Notifications';
import { StudentAvatar } from '../components/visual/StudentArtwork';

type Filter = 'all' | 'direct' | 'team';
type MessageLocation = { returnTo?: string; returnNotice?: boolean; attachment?: Attachment; body?: string; notice?: string; panelFromRoom?: boolean };
const filters = { all: '全部', direct: '私聊', team: '我的队伍' };
const day = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric' });
const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric' });
const time = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false });
function previewTime(date: string) {
  const value = new Date(date);
  return parts.format(value) === parts.format(new Date()) ? time.format(value) : day.format(value);
}
const countText = (count: number) => count > 99 ? '99+' : String(count);
const validId = (value: string | null) => IdSchema.safeParse(value).success ? value : null;

export function Messages() {
  const { user } = useAuth(), location = useLocation(), navigate = useNavigate(), client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const { connected, drafts } = useMessages();
  const [notice, setNotice] = useState('');
  const team = validId(params.get('team')), chat = validId(params.get('chat'));
  const room: Room | undefined = team ? { kind: 'TEAM', id: team } : chat ? { kind: 'SOCIAL', id: chat } : undefined;
  const filterValue = params.get('filter'), filter: Filter = filterValue === 'team' || filterValue === 'direct' ? filterValue : 'all';
  const rawPanel = params.get('panel');
  const panel = rawPanel === 'details' || rawPanel === 'applications' || rawPanel === 'search' ? rawPanel : undefined;
  const inNotice = params.get('view') === 'notifications' && !room;
  const q = (params.get('q') || '').slice(0, 100);
  const [search, setSearch] = useState(q);
  const [archive, setArchive] = useState(false);
  const [collapsedSearch, setCollapsedSearch] = useState<string | null>(null);
  const showArchive = q ? collapsedSearch !== q : archive;
  const [rowError, setRowError] = useState('');
  const [menu, setMenu] = useState<string | null>(null), [saving, setSaving] = useState<string | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const menuTrigger = useRef<HTMLButtonElement | null>(null);
  const roomReturn = useRef(false);
  const badge = useChatBadge(user?.id), notices = useNotificationSummary(user?.id);
  const refetchInterval = connected ? 10_000 : 3_000;
  const results = useInfiniteQuery({
    queryKey: ['chat-inbox', user?.id, filter, q], enabled: !!user, initialPageParam: '', retry: false, staleTime: 0, refetchInterval,
    queryFn: ({ pageParam, signal }) => api<InboxDTO>('/me/chat-inbox?' + new URLSearchParams({ filter, q, ...(pageParam ? { cursor: pageParam } : {}) }), { signal }),
    getNextPageParam: last => last.data.nextCursor || undefined,
  });
  const archived = useInfiniteQuery({
    queryKey: ['chat-inbox', user?.id, 'archive', q], enabled: !!user && filter !== 'direct' && showArchive,
    initialPageParam: '', retry: false, staleTime: 0, refetchInterval,
    queryFn: ({ pageParam, signal }) => api<InboxDTO>('/me/chat-inbox?' + new URLSearchParams({ filter: 'archive', q, ...(pageParam ? { cursor: pageParam } : {}) }), { signal }),
    getNextPageParam: last => last.data.nextCursor || undefined,
  });
  const rows = uniqueRows(results.data?.pages.flatMap(p => p.data.items) ?? []);
  const archiveRows = uniqueRows(archived.data?.pages.flatMap(p => p.data.items) ?? []).filter(row => filter !== 'team' || row.kind === 'TEAM');
  const selected = [...rows, ...archiveRows].find(row => room && roomKey(listRoom(row)) === roomKey(room));
  useEffect(() => { setSearch(q); setCollapsedSearch(null); }, [q]);
  useEffect(() => {
    if (!inNotice || params.get('tab') || !badge.isSuccess && !badge.isError) return;
    const next = new URLSearchParams(params);
    next.set('tab', (badge.data?.data.requests ?? 0) > 0 ? 'pending' : 'activity');
    setParams(next, { replace: true, state: location.state });
  }, [inNotice, params, badge.isSuccess, badge.isError, badge.data, setParams, location.state]);
  useLayoutEffect(() => {
    if (!room && !inNotice && roomReturn.current) {
      trigger.current?.focus({ preventScroll: true });
      roomReturn.current = false;
    }
  }, [room?.id, inNotice]);
  useEffect(() => {
    if (!menu) return;
    function dismiss(event: Event) {
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        menuTrigger.current?.focus({ preventScroll: true });
      } else if (event.target instanceof Element && event.target.closest('.message-row-controls')) return;
      setMenu(null);
    }
    window.addEventListener('pointerdown', dismiss);
    window.addEventListener('keydown', dismiss);
    return () => { window.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', dismiss); };
  }, [menu]);

  const initialState = location.state as MessageLocation | null;
  const change = useCallback((values: Record<string, string | undefined>, replace = false, state = initialState) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) value ? next.set(key, value) : next.delete(key);
    setParams(next, { replace, state });
  }, [params, setParams, initialState]);
  function setPanel(next?: RoomPanel) {
    if (next) change({ panel: next }, !!panel, { ...initialState, panelFromRoom: panel ? initialState?.panelFromRoom : true });
    else if (panel && initialState?.panelFromRoom) navigate(-1);
    else if (panel) change({ panel: undefined }, true);
  }
  function back() {
    if (panel) { setPanel(); return; }
    if (typeof initialState?.returnTo === 'string' && /^\/(posts|recruitments)\//.test(initialState.returnTo)) { navigate(-1); return; }
    if (initialState?.returnNotice) { navigate(-1); return; }
    roomReturn.current = true;
    change({ team: undefined, chat: undefined, panel: undefined }, true, null);
  }
  const returnLabel = initialState?.returnNotice ? '返回通知'
    : initialState?.returnTo?.startsWith('/posts/') ? '返回讨论' : initialState?.returnTo?.startsWith('/recruitments/') ? '返回招募' : undefined;
  function select(event: React.MouseEvent<HTMLAnchorElement>, item: ChatListItem) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    trigger.current = event.currentTarget;
    setMenu(null); setNotice('');
    if (item.archived) { setArchive(true); setCollapsedSearch(null); }
  }
  async function rowAction(item: ChatListItem, operation: 'pinned' | 'muted' | 'read') {
    if (saving) return;
    setSaving(roomKey(listRoom(item))); setRowError('');
    const path = roomApi(listRoom(item));
    try {
      if (operation === 'read') {
        const { data } = await api<{ highWater: number }>(path + '?limit=1');
        await api(path + '/read', { method: 'POST', body: { seq: data.highWater } });
      } else {
        await api(path + '/preferences', { method: 'PUT', body: { [operation]: !item[operation] } });
      }
      for (const key of ['chat-inbox', 'chat-badge']) void client.invalidateQueries({ queryKey: [key, user?.id] });
      window.dispatchEvent(new Event(chatChangeEvent));
      setMenu(null);
      menuTrigger.current?.focus({ preventScroll: true });
    } catch (e) { setRowError(messageOf(e)); }
    finally { setSaving(null); }
  }
  const leave = useCallback(() => {
    change({ team: undefined, chat: undefined, panel: undefined }, true, null);
    setNotice('当前会话已不可用，队内内容已收起。');
  }, [change]);
  if (!user) return null;
  const pending = badge.data?.data.requests ?? 0;
  const dynamic = notices.data?.data.activityUnreadCount ?? notices.data?.data.unreadCount ?? 0;
  const renderRow = (item: ChatListItem) => {
    const key = roomKey(listRoom(item)), draft = drafts[key];
    const current = !!room && roomKey(room) === key;
    return <div className={'message-row' + (current ? ' selected' : '')} key={key}>
      <Link to={messageLink(listRoom(item), undefined, params)} className="message-row-link" aria-current={current ? 'page' : undefined}
        onClick={e => select(e, item)} replace={current && !panel}>
        {item.kind === 'DIRECT' ? <StudentAvatar seed={item.peerId || item.id} /> : <span className={'message-group-avatar ' + (item.kind === 'DISCUSSION' ? 'discussion' : '')}><Users size={21} aria-hidden="true" /></span>}
        <div className="message-row-text"><div className="message-row-name"><strong>{item.title}</strong>
          {item.kind !== 'DIRECT' && <span className="message-row-tag">{item.kind === 'TEAM' ? '队伍' : '讨论群'}</span>}
          {item.pinned && <Pin size={13} aria-label="已置顶" />}{item.muted && <BellOff size={13} aria-label="免打扰" />}</div>
          <p>{draft?.outbox ? <><b>待确认</b> {draft.outbox.input.body || '[附件]'}</> : draft?.body || draft?.attachment || draft?.image
            ? <><b>草稿</b> {draft.body || draft.attachment?.label || '[图片]'}</>
            : item.mentioned ? <><b>有人 @ 我</b> {item.preview}</>
            : item.archiveExpired ? '聊天归档已到期' : item.request === 'OUTGOING' ? '等待对方接受联系' : item.preview || (item.archived ? '活动已结束' : '发条消息约个时间')}</p></div>
        <span className="message-row-end"><time dateTime={item.activityAt}>{previewTime(item.activityAt)}</time>
          {item.unreadCount > 0 && !item.request && <span className={item.muted ? 'message-muted-dot' : 'message-count'} aria-label={item.unreadCount + ' 条未读消息'}>{item.muted ? '' : countText(item.unreadCount)}</span>}
        </span>
      </Link>
      {!item.archiveExpired && <div className="message-row-controls">
        <button type="button" className="message-icon message-row-more" aria-label={'更多操作 ' + item.title} aria-expanded={menu === key} onClick={e => {
          menuTrigger.current = e.currentTarget;
          setMenu(menu === key ? null : key);
        }}><Ellipsis size={17} /></button>
        {menu === key && <div className="message-row-menu">
          <button type="button" className="text-button" disabled={!!saving} onClick={() => void rowAction(item, 'pinned')}>{item.pinned ? '取消置顶' : '置顶会话'}</button>
          <button type="button" className="text-button" disabled={!!saving} onClick={() => void rowAction(item, 'muted')}>{item.muted ? '关闭免打扰' : '消息免打扰'}</button>
          {item.unreadCount > 0 && <button type="button" className="text-button" disabled={!!saving} onClick={() => void rowAction(item, 'read')}>标为已读</button>}
          {!!item.pendingCount && <Link className="text-button" to={messageLink(listRoom(item), 'applications', params)} onClick={() => setMenu(null)}>处理加入申请</Link>}
        </div>}
      </div>}
    </div>;
  };
  return <section className={'messages-page' + (room || inNotice ? ' showing-room' : '')} aria-label="消息">
    <div className="message-list">
      <header className="message-list-head"><h1>消息</h1>
        <Link className="message-notice-link" to={'/messages?' + new URLSearchParams({ ...(filter === 'all' ? {} : { filter }), ...(q ? { q } : {}), view: 'notifications' })}
          onClick={e => { trigger.current = e.currentTarget; rememberScroll(location.key); }}>
          <Bell size={19} aria-hidden="true" />通知{pending ? <span className="message-count" aria-label={pending + ' 项待处理'}>{countText(pending)}</span>
            : dynamic ? <span className="message-dot" aria-label="有新动态" /> : null}
        </Link>
      </header>
      <form className="message-search" onSubmit={e => {
        e.preventDefault(); change({ q: search.trim() || undefined, team: undefined, chat: undefined, view: undefined, panel: undefined });
      }}><input type="search" aria-label="搜索会话" placeholder="搜索联系人或队伍" value={search}
        maxLength={100} onChange={e => { setSearch(e.target.value); if (!e.target.value && q) change({ q: undefined }, true); }} />
        <button type="submit" className="message-icon" aria-label="提交会话搜索"><Search size={17} /></button>
      </form>
      <div className="message-filters" aria-label="会话筛选">{Object.entries(filters).map(([id, name]) =>
        <button type="button" key={id} aria-pressed={filter === id} onClick={() => {
          setArchive(false); setCollapsedSearch(null); setMenu(null); change({ filter: id === 'all' ? undefined : id, view: undefined, tab: undefined });
        }}>{name}</button>)}</div>
      <div className="message-list-scroll" aria-label="会话列表" data-page-scroll={!room && !inNotice ? '' : undefined}>
        {(notice || initialState?.notice) && <p className="message-list-feedback" role="status">{notice || initialState?.notice}</p>}
        <FormError>{rowError}</FormError>
        {results.isPending && <Loading label="正在读取会话…" />}
        {results.isError && <ErrorState message={messageOf(results.error)} retry={() => void results.refetch()} />}
        {results.isSuccess && !rows.length && <div className="message-list-empty"><MessageCircle size={25} aria-hidden="true" />
          <p>{q ? '没有匹配的会话' : filter === 'team' ? '还没有加入队伍' : '还没有会话'}</p>
          {!q && <Link className="text-button" to={filter === 'direct' ? '/discover' : '/recruitments'}>{filter === 'direct' ? '去发现看看' : '浏览招募'}</Link>}</div>}
        {!results.isError && rows.map(renderRow)}
        {results.hasNextPage && <button type="button" className="text-button message-load" disabled={results.isFetchingNextPage} onClick={() => void results.fetchNextPage()}>加载更多会话</button>}
        {filter !== 'direct' && <div className="message-archive">
          <button type="button" className="message-setting" aria-expanded={showArchive}
            onClick={() => { if (q) setCollapsedSearch(showArchive ? q : null); else setArchive(!archive); }}>
            <ChevronDown size={16} />{filter === 'team' ? '已归档队伍' : '已归档会话'}
          </button>
          {showArchive && <>{archived.isPending && <Loading label="正在读取归档…" />}
            {archived.isError && <ErrorState message={messageOf(archived.error)} retry={() => void archived.refetch()} />}
            {archived.isSuccess && !archiveRows.length && <p className="message-muted message-load">暂无匹配的归档。</p>}
            {!archived.isError && archiveRows.map(renderRow)}
            {archived.hasNextPage && <button type="button" className="text-button message-load" disabled={archived.isFetchingNextPage} onClick={() => void archived.fetchNextPage()}>加载更多归档</button>}</>}
        </div>}
      </div>
    </div>
    <div className="message-focus">
      {room ? <MessageConversation key={roomKey(room)} room={room} userId={user.id} panel={panel} onPanel={setPanel}
        onBack={back} onLeave={leave} title={selected?.title} attachment={initialState?.attachment} body={initialState?.body} returnLabel={returnLabel} />
        : inNotice ? <MessageNotices userId={user.id} selectedTab={params.get('tab') === 'pending' ? 'pending' : 'activity'}
          onTab={tab => change({ tab }, true)} onBack={() => { roomReturn.current = true; change({ view: undefined, tab: undefined }, true); }} pending={pending} />
          : <div className="message-placeholder"><MessageCircle aria-hidden="true" size={42} /><p>选择一个会话</p></div>}
    </div>
  </section>;
}

function uniqueRows(items: ChatListItem[]) {
  return [...new Map(items.map(item => [item.kind + ':' + item.id, item])).values()];
}

function MessageNotices({ userId, selectedTab, onTab, onBack, pending }: {
  userId: string; selectedTab: 'pending' | 'activity'; onTab: (tab: 'pending' | 'activity') => void; onBack: () => void; pending: number;
}) {
  const { connected } = useMessages(), location = useLocation();
  const remember = () => rememberScroll(location.key);
  const result = useQuery({
    queryKey: ['chat-pending', userId], enabled: selectedTab === 'pending', retry: false, staleTime: 0, refetchInterval: connected ? 10_000 : 3_000,
    queryFn: ({ signal }) => api<PendingChatItemsDTO>('/me/chat-inbox/pending', { signal }),
  });
  const data = result.data?.data;
  return <section className="message-notices" aria-label="通知">
    <header className="message-room-head"><button className="message-icon" type="button" onClick={onBack} aria-label="返回消息列表"><ArrowLeft size={20} /></button><h2>通知</h2></header>
    <div className="message-filters"><button type="button" aria-pressed={selectedTab === 'pending'} onClick={() => onTab('pending')}>待处理{pending ? ' ' + countText(pending) : ''}</button>
      <button type="button" aria-pressed={selectedTab === 'activity'} onClick={() => onTab('activity')}>动态</button></div>
    <div className="message-notices-scroll" data-page-scroll>
      {selectedTab === 'activity' ? <Notifications embedded /> : <>
        {result.isPending && <Loading label="正在读取待处理事项…" />}
        {result.isError && <ErrorState message={messageOf(result.error)} retry={() => void result.refetch()} />}
        {data && !result.isError && <>
          {!data.contacts.length && !data.teams.length && !data.discussions.length && <p className="message-list-empty">暂无待处理事项。</p>}
          {data.contacts.map(item => <Link className="message-task" key={item.id} to={messageLink(listRoom(item))} state={{ returnNotice: true }} onClick={remember}>
            <StudentAvatar seed={item.peerId || item.id} /><div><strong>{item.title}</strong><p>{item.preview || '发来一条联系请求'}</p></div><span>查看请求</span></Link>)}
          {data.teams.map(item => <Link className="message-task" key={item.id} to={messageLink({ kind: 'TEAM', id: item.id }, 'applications')} state={{ returnNotice: true }} onClick={remember}>
            <span className="message-group-avatar"><Users size={18} /></span><div><strong>{item.title}</strong><p>{item.pendingCount} 份加入申请</p></div><span>处理</span></Link>)}
          {data.discussions.map(item => <Link className="message-task" key={item.id} to={messageLink({ kind: 'SOCIAL', id: item.id }, 'applications')} state={{ returnNotice: true }} onClick={remember}>
            <span className="message-group-avatar discussion"><Users size={18} /></span><div><strong>{item.title}</strong><p>{item.pendingCount} 份入群申请</p></div><span>处理</span></Link>)}
        </>}
      </>}
    </div>
  </section>;
}
