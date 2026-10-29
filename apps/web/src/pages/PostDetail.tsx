import { ReportButton } from '../components/ReportButton';
import { Community } from '../components/Community';
import { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PostDTO, RecruitmentDTO } from '@campus/contracts';
import { ArrowLeft, Pencil, Trash2, MessageSquare } from 'lucide-react';
import { categoryInfo } from '@campus/contracts';
import { api, messageOf } from '../lib/api';
import { Loading, ErrorState, FormError, SwipePanel, SectionLink } from '../components/UI';

export function PostDetail() {
  const { id } = useParams(), location = useLocation(), navigate = useNavigate(), client = useQueryClient();
  const [deleting, setDeleting] = useState(false), [confirming, setConfirming] = useState(false), [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const post = useQuery({ queryKey: ['post', id], queryFn: ({ signal }) => api<PostDTO>('/posts/' + id, { signal }), retry: false });
  const linked = useQuery({ queryKey: ['post-recruitments', id], queryFn: () => api<RecruitmentDTO[]>('/post-recruitments/' + id), enabled: post.isSuccess });
  const back = () => { if (location.state?.backgroundLocation) navigate(-1); else navigate('/discover' + (post.data ? '?category=' + post.data.data.topic.category : '')); };
  useLayoutEffect(() => { if (post.isSuccess) heading.current?.focus({ preventScroll: true }); }, [id, post.isSuccess]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || deleting || (event.target as HTMLElement)?.closest('input,textarea,select,[contenteditable=true]')) return;
      event.preventDefault(); if (confirming) { setConfirming(false); deleteTrigger.current?.focus({ preventScroll: true }); } else back();
    };
    window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close);
  });
  if (post.isPending) return <Loading label="正在展开讨论……" />;
  if (post.isError) return <><button className="text-button" onClick={back}><ArrowLeft size={18} />返回讨论板</button><ErrorState message={messageOf(post.error)} retry={() => void post.refetch()} /></>;
  const p = post.data.data;
  return <SwipePanel onBack={back}><div className="detail-top reading-heading"><button className="icon-button" onClick={back} aria-label="返回讨论板"><ArrowLeft /></button><div><p className="page-location">发现 / {categoryInfo[p.topic.category].short} / <strong>帖子详情</strong></p><span className={'topic-badge cat-' + p.topic.category}>{p.topic.name}</span></div><span className="page-mode-label"><MessageSquare size={16} aria-hidden="true" />正在看帖</span></div><nav className="post-section-nav" aria-label="帖子内容导航"><SectionLink target="post-content">01 帖子正文</SectionLink><SectionLink target="conversation">02 评论互动</SectionLink><SectionLink target="linked-recruitments">03 相关招募</SectionLink></nav>
    {location.state?.justPublished && <div className="success-notice" role="status">讨论已发布，其他人现在可以看到。</div>}
    <article className="post-detail paper"><span className="eyebrow" id="post-content">A CONVERSATION STARTS HERE.</span><h1 ref={heading} tabIndex={-1}>{p.title}</h1><div className="detail-author"><span className="avatar large">{p.author.nickname.slice(0, 1)}</span><div><strong>{p.author.nickname}</strong><p>{p.school.name} · 学校未核验</p></div></div><div className="post-body">{p.body}</div><div className="post-images">{p.images.map(i => <img key={i.id} src={'/api/v1/media/'+i.id} width={i.width} height={i.height} alt="讨论配图" />)}</div><ReportButton type="POST" id={p.id} /><Community key={p.id} postId={p.id} /><div className="detail-time">发布于 {new Date(p.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）{p.revision > 1 && <span> · 已编辑</span>}</div>
    {!p.canEdit && <Link className="button secondary" to={'/recruitments/new?sourcePost=' + id}>从讨论发起我的招募</Link>}
    {p.canEdit && <div className="author-actions"><Link className="button secondary" to={'/posts/' + id + '/edit'}><Pencil size={16} />编辑讨论</Link>{<Link className="button secondary" to={'/recruitments/new?sourcePost=' + id}>从讨论发起招募</Link>}<button ref={deleteTrigger} className="text-button danger" onClick={() => setConfirming(true)}><Trash2 size={16} />删除讨论</button></div>}
    {confirming && <section className="confirm-box" aria-label="确认删除讨论"><h2>删除这条讨论？</h2><p>删除后将从讨论板和原链接中移除。此操作无法在当前界面撤销。</p><div className="button-row"><button className="button secondary" disabled={deleting} onClick={() => setConfirming(false)}>先保留</button><button className="button danger-button" disabled={deleting} onClick={async () => { setDeleting(true); setError(''); try { await api('/posts/' + id, { method: 'DELETE', body: { revision: p.revision } }); await client.invalidateQueries({ queryKey: ['posts'] }); client.removeQueries({ queryKey: ['post', id] }); navigate('/discover?category=' + p.topic.category, { replace: true }); } catch (e) { setError(messageOf(e)); setDeleting(false); } }}>{deleting ? '删除中……' : '确认删除'}</button></div><FormError>{error}</FormError></section>}
    <section className="linked-recruitments" id="linked-recruitments"><span className="eyebrow">FROM TALK TO ACTION.</span><h2>从这条讨论出发的招募</h2>{linked.isPending ? <Loading /> : linked.isError ? <ErrorState message={messageOf(linked.error)} retry={() => void linked.refetch()} /> : linked.data.data.length ? linked.data.data.map(r => <p key={r.id}><Link to={'/recruitments/' + r.id}>{r.title}</Link> · {r.author.id === p.author.id ? '原作者发起' : '读者发起'} · {r.author.nickname}</p>) : <p className="form-note">暂无关联招募。</p>}</section></article><p className="detail-footnote">讨论会真实保存。可从任意区域的可见讨论发起自己的相关招募。</p>
  </SwipePanel>;
}
