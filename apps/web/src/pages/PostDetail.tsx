import { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PostDTO } from '@campus/contracts';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { api, messageOf } from '../lib/api';
import { Loading, ErrorState, FormError, SwipePanel } from '../components/UI';

export function PostDetail() {
  const { id } = useParams(), location = useLocation(), navigate = useNavigate(), client = useQueryClient();
  const [deleting, setDeleting] = useState(false), [confirming, setConfirming] = useState(false), [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const post = useQuery({ queryKey: ['post', id], queryFn: ({ signal }) => api<PostDTO>('/posts/' + id, { signal }), retry: false });
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
  return <SwipePanel onBack={back}><div className="detail-top"><button className="icon-button" onClick={back} aria-label="返回讨论板"><ArrowLeft /></button><span className={'topic-badge cat-' + p.topic.category}>{p.topic.name}</span><span className="swipe-hint">左边缘右滑或 Esc 返回</span></div>
    {location.state?.justPublished && <div className="success-notice" role="status">讨论已发布，其他人现在可以看到。</div>}
    <article className="post-detail paper"><span className="eyebrow">A CONVERSATION STARTS HERE.</span><h1 ref={heading} tabIndex={-1}>{p.title}</h1><div className="detail-author"><span className="avatar large">{p.author.nickname.slice(0, 1)}</span><div><strong>{p.author.nickname}</strong><p>{p.school.name} · 学校未核验</p></div></div><div className="post-body">{p.body}</div><div className="detail-time">发布于 {new Date(p.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）{p.revision > 1 && <span> · 已编辑</span>}</div>
    {p.canEdit && <div className="author-actions"><Link className="button secondary" to={'/posts/' + id + '/edit'}><Pencil size={16} />编辑讨论</Link>{p.topic.category === 'COMPETITION' && <Link className="button secondary" to={'/recruitments/new?sourcePost=' + id}>从讨论发起招募</Link>}<button ref={deleteTrigger} className="text-button danger" onClick={() => setConfirming(true)}><Trash2 size={16} />删除讨论</button></div>}
    {confirming && <section className="confirm-box" aria-label="确认删除讨论"><h2>删除这条讨论？</h2><p>删除后将从讨论板和原链接中移除。此操作无法在当前界面撤销。</p><div className="button-row"><button className="button secondary" disabled={deleting} onClick={() => setConfirming(false)}>先保留</button><button className="button danger-button" disabled={deleting} onClick={async () => { setDeleting(true); setError(''); try { await api('/posts/' + id, { method: 'DELETE', body: { revision: p.revision } }); await client.invalidateQueries({ queryKey: ['posts'] }); client.removeQueries({ queryKey: ['post', id] }); navigate('/discover?category=' + p.topic.category, { replace: true }); } catch (e) { setError(messageOf(e)); setDeleting(false); } }}>{deleting ? '删除中……' : '确认删除'}</button></div><FormError>{error}</FormError></section>}
    </article><p className="detail-footnote">讨论会真实保存。作者可从竞赛讨论发起关联招募；评论与图片后续接入。</p>
  </SwipePanel>;
}
