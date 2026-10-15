import { useState, useRef } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight, Asterisk, BookOpen, Gamepad2, Mountain, Code2, Sun, Search, Plus, ArrowDown } from 'lucide-react';
import { categoryInfo } from '@campus/contracts';
import type { Category, PostDTO, TopicDTO } from '@campus/contracts';
import { api, messageOf } from '../lib/api';
import { useSchool } from '../components/Layout';
import { Loading, EmptyState, ErrorState } from '../components/UI';

const order: Category[] = ['COMPETITION', 'STUDY', 'GAME', 'OUTDOOR'];
const icons = { COMPETITION: Asterisk, STUDY: BookOpen, GAME: Gamepad2, OUTDOOR: Mountain };
const categoryFrom = (s: string | null): Category => order.includes(s as Category) ? s as Category : 'COMPETITION';
function InterestChip({ category, label, rotation, choose }: { category: Category; label: string; rotation: number; choose: (c: Category) => void }) {
  const lastDrag = useRef(0), reduce = useReducedMotion(), Icon = category === 'COMPETITION' ? Code2 : category === 'STUDY' ? BookOpen : Sun;
  return <motion.button type="button" className={'interest-chip cat-' + category} data-testid={'interest-' + category} style={{ rotate: rotation }} drag dragConstraints={{ left: -35, right: 35, top: -20, bottom: 20 }} dragElastic={.15} dragSnapToOrigin dragTransition={{ bounceStiffness: reduce ? 1000 : 440, bounceDamping: reduce ? 100 : 34 }} onDragStart={() => { lastDrag.current = Infinity; }} onDragEnd={() => { lastDrag.current = performance.now(); }} onClick={() => { if (performance.now() - lastDrag.current > 300) choose(category); }} aria-label={label + '，可拖动回弹或点击进入分区'}><Icon size={17} />{label}</motion.button>;
}
export function PostCard({ post }: { post: PostDTO }) {
  const location = useLocation();
  return <Link className="post-card" to={'/posts/' + post.id} state={{ backgroundLocation: location }}>
    <div className="post-card-top"><span className={'topic-badge cat-' + post.topic.category}>{post.topic.name}</span><span className="metadata">{new Date(post.createdAt).toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric' })}</span></div>
    <h3>{post.title}</h3><p className="post-excerpt">{post.body.slice(0, 120)}{post.body.length > 120 ? '……' : ''}</p>
    <div className="post-card-footer"><span className="author-line"><span className="avatar">{post.author.nickname.slice(0, 1)}</span>{post.author.nickname}</span><ArrowUpRight size={20} aria-hidden="true" /></div>
  </Link>;
}
export function Discover() {
  const [params, setParams] = useSearchParams(), [search, setSearch] = useState(params.get('q') || ''), { schoolId } = useSchool(), reduce = useReducedMotion();
  const category = categoryFrom(params.get('category')), topicId = params.get('topic') || '', q = params.get('q') || '';
  const topics = useQuery({ queryKey: ['topics', category], queryFn: ({ signal }) => api<TopicDTO[]>('/topics?category=' + category, { signal }) });
  const posts = useInfiniteQuery({ queryKey: ['posts', schoolId, category, topicId, q], initialPageParam: '' as string, enabled: !!schoolId,
    queryFn: ({ pageParam, signal }) => api<PostDTO[]>('/posts?' + new URLSearchParams({ schoolId, category, ...(topicId ? { topicId } : {}), ...(q ? { q } : {}), ...(pageParam ? { cursor: pageParam } : {}) }), { signal }),
    getNextPageParam: last => last.meta?.nextCursor || undefined,
  });
  function choose(c: Category) {
    setParams({ category: c }); setSearch('');
    document.getElementById('discussion-board')?.scrollIntoView({ behavior: reduce ? 'instant' : 'smooth', block: 'start' });
  }
  return <div className="discover-page">
    <section className="hero"><div className="hero-copy"><span className="eyebrow">GOOD IDEAS NEED GOOD PEOPLE.</span><h1>别只想，<br /><span>一起做。</span></h1><p>在校园，找到把想法变成现实的人。</p></div><span className="hero-arrow" aria-hidden="true"><ArrowUpRight /></span><div className="interest-board"><InterestChip category="COMPETITION" label="做点项目" rotation={-7} choose={choose} /><InterestChip category="STUDY" label="一起进步" rotation={5} choose={choose} /><InterestChip category="OUTDOOR" label="出去走走" rotation={-5} choose={choose} /></div></section>
    <div className="section-heading"><h2>从一个兴趣开始</h2><span className="serial">PICK YOUR SIDE ↘</span></div>
    <div className="category-grid">{order.map((c, i) => { const Icon = icons[c]; return <button key={c} className={'category-card cat-' + c} onClick={() => choose(c)} aria-label={'进入' + categoryInfo[c].name}><span className="category-card-top"><span className="serial">0{i + 1} / {categoryInfo[c].english}</span><span className="category-symbol"><Icon size={23} /></span></span><strong>{categoryInfo[c].name}</strong><p>{categoryInfo[c].description}</p><span className="category-action">进入分区<ArrowUpRight size={17} /></span></button>; })}</div>
    <Link className="launch-strip" to={'/publish?category=' + category}><div><strong>你的想法，值得被看见。</strong><p>先发起一次讨论，再找到一起行动的人。</p></div><ArrowUpRight size={34} /></Link>
    <div className="community-layout"><section className="discussion-board" id="discussion-board" aria-label="校园讨论">
      <div className="section-heading"><h2>兴趣讨论板</h2><span className="serial">RECENT DISCUSSIONS</span></div>
      <div className="category-tabs" aria-label="讨论区域筛选">{order.map(c => <button key={c} aria-pressed={c === category} onClick={() => choose(c)}>{c === category && <motion.span className="tab-indicator" layoutId="category-tab" transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 440, damping: 34 }} />}<span>{categoryInfo[c].short}</span></button>)}</div>
      <div className="board-tabs"><span aria-current="page">讨论</span><Link to="/recruitments">招募 · 后续开放<ArrowUpRight size={14} /></Link></div>
      <div className="filter-row"><label className="topic-picker">主题<select aria-label="筛选讨论主题" value={topicId} onChange={e => setParams({ category, ...(e.target.value ? { topic: e.target.value } : {}), ...(q ? { q } : {}) })}><option value="">全部主题</option>{topics.data?.data.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label><form className="search-form" onSubmit={e => { e.preventDefault(); setParams({ category, ...(topicId ? { topic: topicId } : {}), ...(search.trim() ? { q: search.trim() } : {}) }); }}><label className="visually-hidden" htmlFor="discussion-search">搜索讨论</label><input id="discussion-search" placeholder="搜索讨论" maxLength={100} value={search} onChange={e => setSearch(e.target.value)} /><button type="submit" aria-label="搜索讨论"><Search size={19} /></button></form></div>
      {topics.isError && <ErrorState message={messageOf(topics.error)} retry={() => void topics.refetch()} />}
      {!schoolId || posts.isPending ? <Loading label="正在读取校园讨论……" /> : posts.isError ? <ErrorState message={messageOf(posts.error)} retry={() => void posts.refetch()} /> : posts.data.pages[0].data.length === 0 ? <EmptyState title={q ? '没有找到相关讨论' : '这里的第一条讨论，等你来写'}><p>{q ? '换一个关键词，或清除搜索再试试。' : '分享一个问题、一个灵感，或一次想尝试的事。'}</p><Link className="button" to={'/publish?category=' + category}><Plus size={18} />发布讨论</Link></EmptyState> : <div className="post-list">{posts.data.pages.flatMap(page => page.data).map(p => <PostCard post={p} key={p.id} />)}{posts.hasNextPage && <button className="button secondary load-more" disabled={posts.isFetchingNextPage} onClick={() => void posts.fetchNextPage()}>{posts.isFetchingNextPage ? '加载中……' : '看看更早的讨论'}<ArrowDown size={17} /></button>}</div>}
    </section><aside className="community-aside"><div className="aside-note"><span className="serial">START SMALL.</span><h3>一个好问题，<br />就是好的开始。</h3><p>聊聊最近在做的事，<br />也许就能遇见同频的人。</p><Link className="button" to={'/publish?category=' + category}>写点什么<ArrowUpRight size={17} /></Link></div><p className="aside-caption">不必很厉害才开始。<br />把想法说清楚，把时间留给行动。</p></aside></div>
  </div>;
}
