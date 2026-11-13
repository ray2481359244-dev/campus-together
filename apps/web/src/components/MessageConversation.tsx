import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ArrowDown, ArrowLeft, Ellipsis, Info, Search, Users } from 'lucide-react';
import { api, messageOf } from '../lib/api';
import { emptyChatDraft, roomApi } from '../lib/messaging';
import type { Attachment, Room } from '../lib/messaging';
import { useConversation } from '../lib/useConversation';
import { beijingTime, teamStatusLabel } from '../lib/recruitments';
import { useVisualPreferences } from '../lib/visual-preferences';
import { rememberScroll } from '../lib/scroll';
import { ErrorState, FormError, Loading } from './UI';
import { ReportButton } from './ReportButton';
import { MessageComposer } from './MessageComposer';
import { MessageRoomPanel } from './MessageRoomPanels';
import { StudentAvatar } from './visual/StudentArtwork';

const clock = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false });
const calendarDay = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric' });
export type RoomPanel = 'details' | 'applications' | 'search';
type Props = {
  room: Room; userId: string; panel?: RoomPanel; onPanel: (panel?: RoomPanel) => void;
  onBack: () => void; onLeave: () => void; attachment?: Attachment; body?: string; title?: string; returnLabel?: string;
};

export function MessageConversation({ room, userId, panel, onPanel, onBack, onLeave, attachment, body, title, returnLabel = '返回消息列表' }: Props) {
  const conversation = useConversation(room, userId);
  const location = useLocation();
  const { page, draft, setDraft, problem, busy, load, send, read, remove, invalidate } = conversation;
  const { motionEnabled } = useVisualPreferences();
  const viewport = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const panelTrigger = useRef<HTMLElement | null>(null);
  const initial = useRef(false), bottom = useRef(true);
  const anchor = useRef<{ seq: number; offset: number } | null>(null);
  const target = useRef<number | null>(null);
  const previousLast = useRef(0), firstUnread = useRef<number | null>(null), latestSeen = useRef(0);
  const arriving = useRef<Animation | null>(null);
  const messageActionTrigger = useRef<HTMLButtonElement | null>(null);
  const readRef = useRef(read);
  readRef.current = read;
  const [incoming, setIncoming] = useState(0), [menu, setMenu] = useState<string | null>(null);
  const [selection, setSelection] = useState<number | null>(null);
  const [actionBusy, setActionBusy] = useState(false), [actionError, setActionError] = useState('');
  const [overlayPanel, setOverlayPanel] = useState(() => matchMedia('(max-width: 1239px)').matches);
  const previousPanel = useRef(panel);
  const isTeam = room.kind === 'TEAM', meta = page?.meta;
  const team = meta && 'teamId' in meta ? meta : undefined;
  const social = meta && 'kind' in meta ? meta : undefined;
  const blocked = problem && [401, 403, 404, 410].includes(problem.status);
  const inaccessible = !!blocked && problem.status !== 410;
  const archiveExpired = !!blocked && problem.status === 410;

  useEffect(() => {
    if (!motionEnabled) arriving.current?.cancel();
    return () => arriving.current?.cancel();
  }, [motionEnabled]);
  useEffect(() => {
    if (attachment || body) setDraft(value => ({ ...value, body: value.body || body || '', attachment: attachment ?? value.attachment }));
  }, []);
  useEffect(() => {
    const media = matchMedia('(max-width: 1239px)');
    const sync = () => setOverlayPanel(media.matches);
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  useEffect(() => {
    if (previousPanel.current && !panel) panelTrigger.current?.focus({ preventScroll: true });
    previousPanel.current = panel;
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')) return;
      if (menu) { setMenu(null); messageActionTrigger.current?.focus({ preventScroll: true }); }
      else if (panel) onPanel();
      else return;
      event.preventDefault();
    }
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [panel, menu, onPanel]);
  useEffect(() => {
    if (inaccessible) onLeave();
  }, [inaccessible, onLeave]);
  useEffect(() => {
    if (!menu) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Element && !event.target.closest('.message-bubble-actions') && !document.querySelector('dialog[open]')) setMenu(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [menu]);

  function scrollBottom() {
    const node = viewport.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
    bottom.current = true;
    setIncoming(0);
  }
  function jump(seq: number) {
    target.current = seq;
    bottom.current = false;
    setSelection(seq);
    onPanel();
    if (!page?.items.some(row => row.seq === seq)) void load('around', seq);
    else window.requestAnimationFrame(() => positionTarget());
  }
  function positionTarget() {
    const node = viewport.current, seq = target.current;
    if (!node || !seq) return false;
    const item = node.querySelector<HTMLElement>('[data-seq="' + seq + '"]');
    if (!item) return false;
    const offset = item.getBoundingClientRect().top - node.getBoundingClientRect().top;
    node.scrollTop += offset - 36;
    target.current = null;
    return true;
  }

  useLayoutEffect(() => {
    const node = viewport.current;
    if (!page || !node) return;
    const tail = page.items.at(-1)?.seq ?? 0;
    if (!initial.current) {
      initial.current = true;
      latestSeen.current = page.meta.highWater;
      firstUnread.current = page.meta.firstUnreadSeq ?? null;
      if (firstUnread.current && page.items.some(row => row.seq === firstUnread.current)) {
        target.current = firstUnread.current;
        positionTarget();
        bottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 45;
      } else scrollBottom();
    } else if (target.current) {
      positionTarget();
      latestSeen.current = Math.max(latestSeen.current, page.meta.highWater);
    } else if (anchor.current) {
      const old = node.querySelector<HTMLElement>('[data-seq="' + anchor.current.seq + '"]');
      if (old) node.scrollTop += old.getBoundingClientRect().top - node.getBoundingClientRect().top - anchor.current.offset;
      anchor.current = null;
    } else if (tail > previousLast.current && !page.more) {
      const arrived = page.items.filter(row => row.seq > latestSeen.current && row.kind === 'TEXT' && row.senderId !== userId);
      latestSeen.current = Math.max(latestSeen.current, tail);
      if (bottom.current) {
        scrollBottom();
        const last = arrived.at(-1);
        const bubble = last && node.querySelector<HTMLElement>('[data-seq="' + last.seq + '"] .message-bubble');
        if (motionEnabled && bubble && document.visibilityState === 'visible') {
          arriving.current?.cancel();
          const animation = bubble.animate(
            [{ opacity: .62, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }],
            { duration: 160, easing: 'cubic-bezier(.2,.75,.25,1)' },
          );
          arriving.current = animation;
          bubble.dataset.cloudArriving = 'true';
          void animation.finished.catch(() => {}).finally(() => delete bubble.dataset.cloudArriving);
        }
      } else if (arrived.length) {
        setIncoming(n => n + arrived.length);
      }
    }
    previousLast.current = tail;
  }, [page?.items, page?.more]);

  useEffect(() => {
    const node = viewport.current;
    if (!node || !page || panel || social?.request || !page.meta.firstUnreadSeq) return;
    let timer: number | undefined;
    function updateRead() {
      window.clearTimeout(timer);
      if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
      timer = window.setTimeout(() => {
        if (document.hidden || !document.hasFocus()) return;
        const box = node!.getBoundingClientRect();
        let seq = Math.max(page!.meta.lastReadSeq, page!.meta.firstUnreadSeq! - 1);
        let seen = false;
        const nodes = node!.querySelectorAll<HTMLElement>('[data-seq]');
        for (const row of nodes) {
          const next = Number(row.dataset.seq);
          if (next <= seq) continue;
          if (next !== seq + 1) break;
          if (row.dataset.unread === 'false') { seq = next; continue; }
          const area = (row.querySelector('.message-bubble') || row).getBoundingClientRect();
          const visible = Math.min(area.bottom, box.bottom) - Math.max(area.top, box.top);
          if (visible < Math.min(area.height * 0.6, 48)) break;
          seq = next;
          seen = true;
        }
        if (seen) void readRef.current(seq);
      }, 300);
    }
    updateRead();
    node.addEventListener('scroll', updateRead, { passive: true });
    window.addEventListener('focus', updateRead);
    document.addEventListener('visibilitychange', updateRead);
    return () => {
      window.clearTimeout(timer);
      node.removeEventListener('scroll', updateRead);
      window.removeEventListener('focus', updateRead);
      document.removeEventListener('visibilitychange', updateRead);
    };
  }, [page, panel, social?.request]);

  function earlier() {
    const node = viewport.current;
    if (node) {
      const top = node.getBoundingClientRect().top;
      const item = Array.from(node.querySelectorAll<HTMLElement>('[data-seq]')).find(el => el.getBoundingClientRect().bottom > top);
      if (item) anchor.current = { seq: Number(item.dataset.seq), offset: item.getBoundingClientRect().top - top };
    }
    void load('older').finally(() => {
      requestAnimationFrame(() => { anchor.current = null; });
    });
  }
  function openPanel(value: RoomPanel, trigger: HTMLElement) {
    panelTrigger.current = trigger;
    onPanel(panel === value && !archiveExpired ? undefined : value);
  }
  async function requestDecision(accept: boolean) {
    if (actionBusy) return;
    setActionBusy(true); setActionError('');
    try {
      await api('/contacts/requests/' + room.id, { method: 'POST', body: { accept } });
      invalidate();
      if (accept) await load();
      else onBack();
    } catch (e) { setActionError(messageOf(e)); }
    finally { setActionBusy(false); }
  }

  function leave() { setDraft(() => emptyChatDraft); onLeave(); }
  const banner = team?.announcement;
  const group = isTeam || social?.kind === 'DISCUSSION';
  const heading = meta?.title || title || (isTeam ? '队伍群聊' : '会话');
  const subtitle = team ? (team.memberCount ?? 0) + ' 人 · ' + teamStatusLabel(team.status)
    : social?.discussion ? social.discussion.memberCount + ' 人 · 讨论群' : social?.peer?.school;
  const visiblePanel = inaccessible || archiveExpired && panel !== 'details' ? undefined : panel;
  const bodyInert = !!visiblePanel && overlayPanel;
  return <div className={'message-room-layout' + (visiblePanel ? ' panel-open' : '')}>
    <section className="message-conversation" aria-label={isTeam ? '队伍群聊' : group ? '讨论群聊' : '私聊'} inert={bodyInert}>
      <header className="message-room-head">
        <button className="message-icon message-room-back" type="button" aria-label={panel ? '返回聊天' : returnLabel} onClick={onBack}><ArrowLeft size={21} /></button>
        <button className="message-room-title" type="button" aria-label={(group ? '群资料 ' : '联系人资料 ') + heading}
          disabled={inaccessible} onClick={e => openPanel('details', e.currentTarget)}>
          {group ? <span className="message-group-avatar"><Users size={20} aria-hidden="true" /></span> : <StudentAvatar seed={social?.peer?.id || room.id} />}
          <span><strong>{heading}</strong>{subtitle && <small>{subtitle}</small>}</span>
        </button>
        {meta && <button className="message-icon" type="button" aria-label="查找聊天记录" onClick={e => openPanel('search', e.currentTarget)}><Search size={19} /></button>}
        {!inaccessible && <button className="message-icon" type="button" aria-label={group ? '群资料' : '联系人资料'} onClick={e => openPanel('details', e.currentTarget)}><Info size={20} /></button>}
      </header>
      {banner && <button type="button" className="message-announcement" onClick={e => openPanel('details', e.currentTarget)}><strong>公告</strong><span>{banner}</span></button>}
      {archiveExpired && <div className="message-room-empty" role="alert"><h2>聊天归档已到期</h2><p>{problem.message}</p><button className="button secondary" type="button" onClick={e => openPanel('details', e.currentTarget)}>查看队伍资料</button></div>}
      {inaccessible && <div className="message-room-empty" role="status">{problem.message}</div>}
      {!blocked && !page && (problem ? <ErrorState message={problem.message} retry={() => void load('initial')} /> : <Loading label="正在读取会话…" />)}
      {page && <>
        {problem && <div className="message-network" role="status">消息同步中断 <button className="text-button" onClick={() => void load()}>重试</button></div>}
        <div className="message-transcript" ref={viewport} aria-label="已保存消息" data-page-scroll={panel ? undefined : ''} onScroll={() => {
          const node = viewport.current!;
          bottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 45;
          if (bottom.current && !page.more && incoming) setIncoming(0);
        }}>
          {page.before && <button className="text-button message-earlier" type="button" disabled={busy} onClick={earlier}>加载更早消息</button>}
          {!page.items.length && !draft.outbox && <p className="message-room-empty">{group ? '发条消息约个时间。' : '发条消息打个招呼。'}</p>}
          {page.items.map((item, index) => {
            const own = item.senderId === userId;
            const day = calendarDay.format(new Date(item.createdAt));
            const dayChanged = !index || day !== calendarDay.format(new Date(page.items[index - 1].createdAt));
            return <div key={item.id} className="message-record" data-seq={item.seq} data-unread={item.kind === 'TEXT' && !own && !item.deleted}>
              {dayChanged && <time className="message-day" dateTime={item.createdAt}>{day}</time>}
              {(firstUnread.current ?? page.meta.firstUnreadSeq) === item.seq && <div className="message-unread-line">以下为新消息</div>}
              {item.kind === 'SYSTEM' ? <p className="message-system">{item.body}</p> :
                <article className={'message-bubble-row' + (own ? ' own' : '') + (selection === item.seq ? ' located' : '')}>
                  {!own && <StudentAvatar seed={item.senderId || item.id} />}
                  <div className="message-bubble-wrap">
                    <div className="message-byline"><strong>{own ? '我' : item.nickname}</strong><time dateTime={item.createdAt}>{clock.format(new Date(item.createdAt))}</time></div>
                    <div data-cloud-id={item.id} className={'message-bubble ' + (own ? 'chat-own' : 'chat-peer')}>
                      {item.deleted ? <span className="message-muted">消息已删除</span> : <>
                        {item.reply && <button type="button" className="message-quote" onClick={() => jump(item.reply!.seq)}>
                          <strong>{item.reply.nickname}</strong><span>{item.reply.excerpt}</span></button>}
                        {item.mentions?.length ? <p className="message-mentions">{item.mentions.map(p => '@' + p.nickname).join(' ')}</p> : null}
                        {item.body && <p>{item.body}</p>}
                        {item.imageId && <a className="message-image" href={'/api/v1/chat-images/' + item.imageId} target="_blank" rel="noopener noreferrer">
                          <img src={'/api/v1/chat-images/' + item.imageId} alt="聊天图片" loading="lazy" onLoad={() => { if (bottom.current) scrollBottom(); }} />
                        </a>}
                        {item.context && <Link className="message-quote" to={item.context.href} state={{ fromChat: true }} onClick={() => rememberScroll(location.key)}>
                          <strong>{item.context.title}</strong><span>{item.context.excerpt}</span></Link>}
                        {item.context === null && !item.body && !item.imageId && <span className="message-muted">来源内容已不可见。</span>}
                      </>}
                    </div>
                  </div>
                  {!item.deleted && <div className="message-bubble-actions">
                    <button className="message-icon" type="button" aria-label="消息操作" aria-expanded={menu === item.id} onClick={e => {
                      messageActionTrigger.current = e.currentTarget;
                      setMenu(menu === item.id ? null : item.id);
                    }}><Ellipsis size={18} /></button>
                    {menu === item.id && <div className="message-inline-menu">
                      {meta?.canWrite && <button type="button" className="text-button" onClick={() => {
                        setDraft(value => ({ ...value, reply: item })); setMenu(null); input.current?.focus();
                      }}>回复</button>}
                      {item.body && <button type="button" className="text-button" onClick={async () => {
                        try { await navigator.clipboard.writeText(item.body!); setMenu(null); }
                        catch { setActionError('复制失败，可以选中文字后复制。'); }
                      }}>复制</button>}
                      {own && meta?.canWrite && <button type="button" className="text-button danger" onClick={() => { setMenu(null); void remove(item.id); }}>删除我的消息</button>}
                      <ReportButton type={isTeam ? 'CHAT_MESSAGE' : 'SOCIAL_MESSAGE'} id={item.id} evidence={item.body || (item.imageId ? '[图片]' : '[内容卡片]')} />
                    </div>}
                  </div>}
                </article>}
            </div>;
          })}
          {draft.outbox && <div className="message-bubble-row own pending-message" data-motion={motionEnabled ? 'on' : 'off'}>
            <div className="message-bubble-wrap"><div className="message-byline">{draft.outbox.status === 'sending' ? '发送中…' : '待确认'}</div>
              <div className="message-bubble"><p>{draft.outbox.input.body || (draft.outbox.input.imageId ? '[图片]' : draft.attachment?.label)}</p></div></div>
          </div>}
          {page.more && <button className="text-button message-earlier" type="button" disabled={busy} onClick={() => void load('newer')}>继续加载后面的消息</button>}
        </div>
        {(incoming > 0 || page.more) && <button className="message-new" type="button" onClick={() => {
          if (page.more) { bottom.current = true; setIncoming(0); void load('latest').then(() => requestAnimationFrame(scrollBottom)); }
          else scrollBottom();
        }}><ArrowDown size={16} />{incoming ? '有 ' + incoming + ' 条新消息' : '跳到最新消息'}</button>}
        {social?.request === 'INCOMING' ? <div className="message-contact-request">
          <p>接受后可以继续私聊。</p><FormError>{actionError}</FormError>
          <div className="button-row"><button className="button" disabled={actionBusy} onClick={() => void requestDecision(true)}>接受联系</button>
            <button className="button secondary" disabled={actionBusy} onClick={() => void requestDecision(false)}>拒绝</button></div>
        </div> : meta?.canWrite || draft.outbox ? <MessageComposer room={room} userId={userId} group={group} draft={draft} setDraft={setDraft}
          onSend={() => { bottom.current = true; void send(); requestAnimationFrame(scrollBottom); }}
          error={conversation.failure || actionError} input={input} /> : <div className="message-readonly"><FormError>{conversation.failure || actionError}</FormError>
          {social?.request === 'OUTGOING' ? '等待对方接受联系。' : social?.request === 'DECLINED' ? '这条联系请求已结束。'
            : team?.archiveUntil ? '群聊只读至 ' + beijingTime(team.archiveUntil) + '（北京时间）' : '当前会话只读。'}
        </div>}
      </>}
    </section>
    {visiblePanel && overlayPanel && <button type="button" tabIndex={-1} aria-hidden="true" className="message-panel-backdrop" onClick={() => onPanel()} />}
    {visiblePanel && <MessageRoomPanel key={visiblePanel} room={room} userId={userId} meta={meta} panel={visiblePanel}
      onClose={() => onPanel()} onApplications={() => onPanel('applications')} onLeave={leave} onJump={jump} onUpdate={() => void load()} />}
  </div>;
}
