import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import type { CSSProperties } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { ArrowUpRight, ArrowRight, ArrowLeft, Search, Plus, ArrowDown, X, Sparkles } from 'lucide-react';
import { categoryInfo } from '@campus/contracts';
import type { Category, PostDTO, TopicDTO, ApiResponse } from '@campus/contracts';
import { api, messageOf } from '../lib/api';
import { useSchool } from '../lib/school';
import { useVisualPreferences } from '../lib/visual-preferences';
import { Loading, EmptyState, ErrorState } from '../components/UI';
import { rememberScroll } from '../lib/scroll';
import { ThoughtTable } from '../components/visual/ThoughtTable';
import { CloudTransition } from '../components/visual/CloudTransition';
import type { CloudTransitionHandle } from '../components/visual/CloudTransition';
import { StudentArtwork } from '../components/visual/StudentArtwork';
import { categories } from '../components/visual/categories';

const order: Category[] = ['COMPETITION', 'STUDY', 'GAME', 'OUTDOOR'];
type Panel = 'home' | 'interests' | 'discussion';
const categoryFrom = (s: string | null): Category => order.includes(s as Category) ? s as Category : 'COMPETITION';

export function PostCard({ post }: { post: PostDTO }) {
  const location = useLocation();
  return <Link className="post-card" data-post-id={post.id} to={'/posts/' + post.id} state={{ backgroundLocation: location }} onClick={() => rememberScroll(location.key, post.id)}>
    <div className="post-card-top"><span className={'topic-badge cat-' + post.topic.category}>{post.topic.name}</span><span className="metadata">{new Date(post.createdAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric' })}</span></div>
    {post.images[0] && <img className="post-cover" src={'/api/v1/media/' + post.images[0].id} alt="讨论封面" loading="lazy" width={640} height={360} />}<h3>{post.title}</h3><p className="post-excerpt">{post.body.slice(0, 120)}{post.body.length > 120 ? '……' : ''}</p>
    <div className="post-card-footer"><span className="author-line"><span className="avatar">{post.author.nickname.slice(0, 1)}</span>{post.author.nickname} · {post.counts.comments} 评论 · {post.counts.likes} 赞</span><ArrowUpRight size={20} aria-hidden="true" /></div>
  </Link>;
}

export function Discover() {
  const [params, setParams] = useSearchParams(), location = useLocation();
  const [search, setSearch] = useState(params.get('q') || ''), [transitionError, setTransitionError] = useState(''), [bump, setBump] = useState(0);
  const { schoolId } = useSchool(), { motionEnabled } = useVisualPreferences();
  const transition = useRef<CloudTransitionHandle>(null), heading = useRef<HTMLHeadingElement>(null), previousPanel = useRef<Panel | null>(null);
  const returnCloud = useRef<Category | null>(null), navigation = useRef(location.key), cloudNavigation = useRef(false);
  const category = categoryFrom(params.get('category')), topicId = params.get('topic') || '', q = params.get('q') || '';
  const requested = params.get('panel');
  // Existing shared discussion/filter URLs continue to open the board directly.
  const panel: Panel = requested === 'home' || requested === 'interests' || requested === 'discussion' ? requested : params.has('category') || topicId || q ? 'discussion' : 'home';
  useEffect(() => { setSearch(q); }, [q]);
  useEffect(() => {
    if (navigation.current !== location.key && !cloudNavigation.current) transition.current?.cancel();
    cloudNavigation.current = false;
    navigation.current = location.key;
  }, [location.key]);
  useLayoutEffect(() => {
    const changed = previousPanel.current !== null && previousPanel.current !== panel;
    previousPanel.current = panel;
    if (!changed) return;
    const cloud = panel === 'interests' && returnCloud.current ? document.querySelector<HTMLAnchorElement>('.ct-cloud-' + returnCloud.current.toLowerCase()) : null;
    (cloud || heading.current)?.focus({ preventScroll: true });
  }, [panel]);
  const topics = useQuery({ queryKey: ['topics', category], enabled: panel === 'discussion', queryFn: ({ signal }) => api<TopicDTO[]>('/topics?category=' + category, { signal }) });
  const posts = useInfiniteQuery<ApiResponse<PostDTO[]>, Error, InfiniteData<ApiResponse<PostDTO[]>>, string[], string>({
    queryKey: ['posts', schoolId, category, topicId, q], initialPageParam: '', enabled: !!schoolId && panel === 'discussion',
    queryFn: ({ pageParam, signal }) => api<PostDTO[]>('/posts?' + new URLSearchParams({ schoolId, category, ...(topicId ? { topicId } : {}), ...(q ? { q } : {}), ...(pageParam ? { cursor: pageParam } : {}) }), { signal }),
    getNextPageParam: last => last.meta?.nextCursor || undefined,
  });
  const href = (next: Panel) => '/discover?' + new URLSearchParams({ panel: next, category, ...(topicId ? { topic: topicId } : {}), ...(q ? { q } : {}) });
  function choose(c: Category) { setSearch(''); setParams({ panel: 'discussion', category: c }); }
  async function unfold(c: Category, source: HTMLAnchorElement) {
    returnCloud.current = c; setTransitionError('');
    try { await transition.current?.reveal(c, source, () => { cloudNavigation.current = true; choose(c); }); }
    catch (error) { setTransitionError(messageOf(error)); }
  }
  function filter(next: { topic?: string; q?: string }) { setParams({ panel: 'discussion', category, ...(next.topic ? { topic: next.topic } : {}), ...(next.q ? { q: next.q } : {}) }); }

  return <div className={'discover-page discover-panel-stage panel-' + panel} style={{ '--board-color': categories[category].color } as CSSProperties}>
    <nav className="discovery-nav" aria-label="发现页板块">{(['home', 'interests', 'discussion'] as const).map((value, index) => <Link key={value} to={href(value)} aria-current={panel === value ? 'page' : undefined}>{['开始碰头', '想法圆桌', '兴趣讨论'][index]}</Link>)}</nav>
    <section key={panel} className={'discover-panel ' + (panel === 'discussion' ? 'discussion-panel' : '')} data-page-scroll aria-labelledby="discover-title">
      {panel === 'home' ? <div className="welcome-layout"><div className="welcome-copy"><p className="welcome-note"><Sparkles size={17} aria-hidden="true" />好点子，正在靠近。</p><h1 id="discover-title" ref={heading} tabIndex={-1}>别只想，<br /><span>一起做。</span></h1><p className="welcome-description">在校园，找到把想法变成现实的人。<span>把一句「一起吗」，变成一件了不起的小事。</span></p><div className="welcome-actions"><Link className="button" to={href('interests')}>去碰个想法<ArrowRight size={19} aria-hidden="true" /></Link><Link className="text-button" to={href('discussion')}>先看看讨论<ArrowUpRight size={17} aria-hidden="true" /></Link></div><div className="welcome-stickers">{(['COMPETITION', 'STUDY', 'OUTDOOR'] as const).map((c, i) => <Link key={c} className={'welcome-sticker cat-' + c} to={'/discover?panel=discussion&category=' + c}>{['做点项目', '一起进步', '出去走走'][i]}</Link>)}</div></div>
        <button className="welcome-art" aria-label="让两位同学的想法碰一下" onClick={() => setBump(n => n + 1)}><span className="welcome-orbit" aria-hidden="true" /><span className="welcome-thought">一个人有想法，<br /><strong>一群人有办法。</strong><Sparkles size={24} aria-hidden="true" /></span><motion.span key={'left' + bump} className="welcome-student welcome-left" animate={motionEnabled && bump ? { x: [0, 20, -9, 0], rotate: [-6, 4, -9, -6] } : { rotate: -6 }} transition={{ duration: .7 }}><StudentArtwork kind="pink" pose="wave" /></motion.span><motion.span key={'right' + bump} className="welcome-student welcome-right" animate={motionEnabled && bump ? { x: [0, -20, 9, 0], rotate: [6, -4, 9, 6] } : { rotate: 6 }} transition={{ duration: .7 }}><StudentArtwork kind="violet" pose="cheer" /></motion.span><span className="welcome-art-note">点一下，灵感碰头。</span></button></div>
      : panel === 'interests' ? <div className="interests-panel"><header className="roundtable-heading"><div><h1 id="discover-title" ref={heading} tabIndex={-1}>让想法，碰个头。</h1><p>选一朵想法云，看看谁和你想到了一起。</p></div><Link className="text-button" to={href('home')}><ArrowLeft size={17} aria-hidden="true" />回到开始</Link></header><ThoughtTable motionEnabled={motionEnabled} onChoose={(c, source) => void unfold(c, source)} /><p className="roundtable-hint">不必准备好一切，从一个兴趣开始就好。</p>{transitionError && <ErrorState message={transitionError} retry={() => choose(returnCloud.current || category)} />}</div>
      : <><header className="discussion-heading"><div><h1 id="discover-title" ref={heading} tabIndex={-1}>{categoryInfo[category].short}，一起聊聊。</h1><p>一个好问题，就是好的开始。</p></div><Link className="text-button" to={href('interests')}><ArrowLeft size={17} aria-hidden="true" />回到想法圆桌</Link></header><div className="community-layout"><section className="discussion-board" id="discussion-board" aria-label="校园讨论">
        <div className="category-tabs" role="group" aria-label="讨论区域筛选" onKeyDown={e => {
          if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
          e.preventDefault();
          const buttons = Array.from(e.currentTarget.querySelectorAll('button')), index = buttons.indexOf(e.target as HTMLButtonElement);
          const next = e.key === 'Home' ? 0 : e.key === 'End' ? order.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + order.length) % order.length;
          buttons[next]?.focus(); choose(order[next]);
        }}><motion.span aria-hidden="true" className="tab-indicator" data-testid="category-indicator" initial={false} animate={{ x: `calc(${order.indexOf(category) * 100}% + ${order.indexOf(category) * 4}px)` }} transition={motionEnabled ? { type: 'spring', stiffness: 440, damping: 34 } : { duration: 0 }} />{order.map(c => <button key={c} aria-pressed={c === category} onClick={() => choose(c)}><span>{categoryInfo[c].short}</span></button>)}</div>
        <div className="board-tabs"><span aria-current="page">讨论</span><Link to="/recruitments">查看招募<ArrowUpRight size={14} aria-hidden="true" /></Link></div>
        <div className="filter-row"><label className="topic-picker">主题<select aria-label="筛选讨论主题" disabled={topics.isPending} value={topicId} onChange={e => filter({ topic: e.target.value, q })}><option value="">全部主题</option>{topics.data?.data.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><form className="search-form" onSubmit={e => { e.preventDefault(); filter({ topic: topicId, q: search.trim() }); }}><label className="visually-hidden" htmlFor="discussion-search">搜索讨论</label><input id="discussion-search" name="q" autoComplete="off" placeholder="搜索讨论…" maxLength={100} value={search} onChange={e => setSearch(e.target.value)} />{q && <button type="button" aria-label="清除讨论搜索" onClick={() => { document.getElementById('discussion-search')?.focus(); setSearch(''); filter({ topic: topicId }); }}><X size={18} aria-hidden="true" /></button>}<button type="submit" aria-label="搜索讨论"><Search size={19} aria-hidden="true" /></button></form></div>
        {topics.isError && <ErrorState message={messageOf(topics.error)} retry={() => void topics.refetch()} />}
        <div className="post-results" aria-busy={posts.isFetching}>
          {!schoolId || posts.isPending ? <Loading label="正在读取校园讨论……" /> : posts.isError ? <ErrorState message={messageOf(posts.error)} retry={() => void posts.refetch()} /> : posts.data.pages[0].data.length === 0 ? <EmptyState title={q ? '没有找到相关讨论' : '这里的第一条讨论，等你来写'}><p>{q ? '换一个关键词，或清除搜索再试试。' : '分享一个问题、一个灵感，或一次想尝试的事。'}</p><Link className="button" to={'/publish?category=' + category}><Plus size={18} aria-hidden="true" />发布讨论</Link></EmptyState> : <div className="post-list">{posts.data.pages.flatMap(page => page.data).map(p => <PostCard post={p} key={p.id} />)}{posts.hasNextPage && <button className="button secondary load-more" disabled={posts.isFetchingNextPage} onClick={() => void posts.fetchNextPage()}>{posts.isFetchingNextPage ? '加载中……' : '看看更早的讨论'}<ArrowDown size={17} aria-hidden="true" /></button>}</div>}
        </div>
      </section><aside className="community-aside"><div className="aside-note"><StudentArtwork kind={category === 'GAME' ? 'pink' : category === 'STUDY' ? 'blue' : category === 'OUTDOOR' ? 'green' : 'violet'} /><h2>你的想法，<br />值得被看见。</h2><p>聊聊最近在做的事，<br />也许就能遇见同频的人。</p><Link className="button" to={'/publish?category=' + category}>写点什么<Plus size={17} aria-hidden="true" /></Link></div></aside></div></>}
    </section>
    <CloudTransition ref={transition} motionEnabled={motionEnabled} />
  </div>;
}
