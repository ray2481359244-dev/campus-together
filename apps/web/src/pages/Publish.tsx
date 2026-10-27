import { ImagePicker } from '../components/ImagePicker';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams, useParams, Link } from 'react-router-dom';
import { PostContentSchema, categoryInfo } from '@campus/contracts';
import type { Category, TopicDTO, PostDTO, CreatePost, PostContent } from '@campus/contracts';
import { ArrowUpRight, Check } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api, ApiError, messageOf } from '../lib/api';
import { PageTitle, Loading, ErrorState, FormError, LoginGate } from '../components/UI';

export function Publish({ edit = false }: { edit?: boolean }) {
  const { user, loading, error: authError, reload } = useAuth(), { id } = useParams(), [params] = useSearchParams(), navigate = useNavigate(), client = useQueryClient();
  const [category, setCategory] = useState<Category>(['COMPETITION', 'GAME', 'STUDY', 'OUTDOOR'].includes(params.get('category') || '') ? params.get('category') as Category : 'COMPETITION');
  const [error, setError] = useState(''), [isDirtyAfterFailure, setIsDirtyAfterFailure] = useState(false);
  const [base, setBase] = useState<PostDTO | null>(null), [review, setReview] = useState<PostDTO | null>(null);
  const [checking, setChecking] = useState(false), [confirmLoad, setConfirmLoad] = useState(false), [blocked, setBlocked] = useState(false);
  const [pending, setPending] = useState<CreatePost | null>(null), [isSubmitting, setSubmitting] = useState(false);
  const [imageIds, setImageIds] = useState<string[]>([]), [uploading, setUploading] = useState(false);
  const saving = useRef(false);
  const post = useQuery({ queryKey: ['post', id], queryFn: ({ signal }) => api<PostDTO>('/posts/' + id, { signal }), enabled: edit && !!id, retry: false });
  const topics = useQuery({ queryKey: ['topics', category], queryFn: () => api<TopicDTO[]>('/topics?category=' + category) });
  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm({ resolver: zodResolver(PostContentSchema), defaultValues: { title: '', body: '', topicId: '' } });
  const selectedTopic = watch('topicId'), title = watch('title'), body = watch('body');
  // The editing base stays fixed until the author explicitly accepts a saved version.
  // Query refreshes may discover updates, but must never reset input or silently rebase writes.
  useEffect(() => {
    if (edit && post.data && post.data.data.id === id && base?.id !== id) {
      const p = post.data.data;
      setImageIds(p.images.map(i => i.id)); setBase(p); setCategory(p.topic.category); reset({ title: p.title, body: p.body, topicId: p.topic.id });
      setReview(null); setConfirmLoad(false); setBlocked(false); setError(''); setIsDirtyAfterFailure(false);
    }
  }, [post.data, edit, id, base?.id, reset]);
  useEffect(() => { if (!edit && topics.data && !topics.data.data.some(t => t.id === selectedTopic)) setValue('topicId', topics.data.data[0]?.id || ''); }, [topics.data, edit, selectedTopic, setValue]);
  if (loading) return <Loading />;
  if (authError) return <ErrorState message={authError.message} retry={() => void reload()} />;
  if (!user) return <LoginGate next={edit ? '/posts/' + id + '/edit' : '/publish'} />;
  if (edit && post.isError && base?.id !== id) return <ErrorState message={messageOf(post.error)} retry={() => void post.refetch()} />;
  if (edit && base?.id !== id) return <Loading label="正在读取讨论……" />;
  if (edit && post.data && !post.data.data.canEdit) return <ErrorState message="只有作者可以编辑这条讨论。" />;
  async function save(values: PostContent) {
    if (blocked || checking || uploading || saving.current) return;
    saving.current = true;
    setSubmitting(true); setError(''); setIsDirtyAfterFailure(false);
    const submission = edit ? null : pending ?? { ...values, ...(imageIds.length ? { imageIds } : {}), requestKey: crypto.randomUUID() };
    if (submission) setPending(submission);
    try {
      const r = await api<PostDTO>(edit ? '/posts/' + id : '/posts', { method: edit ? 'PATCH' : 'POST', body: edit ? { title: values.title, body: values.body, imageIds, revision: base!.revision } : submission });
      await client.invalidateQueries({ queryKey: ['posts'] }); client.setQueryData(['post', r.data.id], r);
      navigate('/posts/' + r.data.id, { replace: true, state: { justPublished: !edit } });
    } catch (e) {
      setError(messageOf(e)); setIsDirtyAfterFailure(true);
      if (e instanceof ApiError) {
        if (edit && ['REVISION_CONFLICT', 'NOT_FOUND'].includes(e.code)) { setBlocked(true); setReview(null); setConfirmLoad(false); }
        // These responses establish that no post exists for this request; allow correction.
        if (!edit && [400, 422].includes(e.status) && ['INVALID_INPUT', 'TOPIC_UNAVAILABLE', 'PROFILE_INCOMPLETE', 'IMAGE_UNAVAILABLE'].includes(e.code)) setPending(null);
        if (!edit && ['REQUEST_KEY_CONFLICT', 'POST_UNAVAILABLE'].includes(e.code)) setBlocked(true);
      }
    } finally { saving.current = false; setSubmitting(false); }
  }
  return <section className="form-page"><PageTitle title={edit ? '让想法更清楚一点。' : '你的想法，值得被看见。'} eyebrow={edit ? 'EDIT YOUR DISCUSSION.' : 'LET YOUR IDEA OUT.'} back={() => navigate(edit ? '/posts/' + id : '/discover')} />
    {!edit && <div className="publish-modes"><span className="current"><Check size={16} />发布讨论</span><Link to="/recruitments/new">发起招募<ArrowUpRight size={14} /></Link></div>}
    <form className="paper form-stack" onSubmit={pending ? event => { event.preventDefault(); void save(pending); } : handleSubmit(save)}>
      {edit && <section className="version-tools" aria-label="讨论版本核对"><p className="form-note">当前编辑基于版本 {base!.revision}。后台刷新不会覆盖输入；保存冲突时，请先核对已保存内容。</p>
        {post.data && post.data.data.revision !== base!.revision && <p role="status" className="form-note">已发现较新版本，你尚未保存的输入仍保留在下方。</p>}
        <button className="button secondary" type="button" disabled={checking || isSubmitting} onClick={async () => {
          setChecking(true); setError(''); setReview(null); setConfirmLoad(false);
          try { const result = await post.refetch(); if (result.isError) throw result.error; setReview(result.data!.data); }
          catch (e) { setError(messageOf(e)); setIsDirtyAfterFailure(true); }
          finally { setChecking(false); }
        }}>{checking ? '正在核对……' : '核对已保存版本'}</button>
        {post.isError && !error && <FormError>{messageOf(post.error)} 输入仍保留，可再次核对。</FormError>}
        {review && <section className="version-review" aria-label="服务器已保存的讨论"><h2>服务器已保存的讨论 · 版本 {review.revision}</h2><p className="form-note">{new Date(review.updatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）</p><h3>{review.title}</h3><div className="version-body" role="region" aria-label="已保存正文" tabIndex={0}>{review.body}</div>
          <button type="button" className="button secondary" disabled={isSubmitting} onClick={() => setConfirmLoad(true)}>用此版本重新编辑</button>
          {confirmLoad && <section className="confirm-box" aria-label="确认替换未保存内容"><h2>替换当前未保存内容？</h2><p>载入后，下方标题和正文将被替换。需要合并的文字请先手动复制保留；不会自动合并两个版本。</p><div className="button-row"><button type="button" className="button secondary" onClick={() => setConfirmLoad(false)}>继续保留我的输入</button><button type="button" className="button" onClick={() => {
            setBase(review); setCategory(review.topic.category); reset({ title: review.title, body: review.body, topicId: review.topic.id });
            setReview(null); setConfirmLoad(false); setBlocked(false); setError(''); setIsDirtyAfterFailure(false);
          }}>确认载入已保存版本</button></div></section>}
        </section>}
      </section>}
      <fieldset className="recruitment-fields" disabled={isSubmitting || !!pending}>
      <div className="form-row"><label>兴趣区域<select aria-label="兴趣区域" value={category} disabled={edit} onChange={e => setCategory(e.target.value as Category)}>{(['COMPETITION', 'STUDY', 'GAME', 'OUTDOOR'] as Category[]).map(c => <option value={c} key={c}>{categoryInfo[c].name}</option>)}</select></label><label>讨论主题<select aria-label="讨论主题" disabled={edit || topics.isPending} {...register('topicId')}><option value="" disabled>请选择主题</option>{edit && post.data && !topics.data?.data.some(t => t.id === post.data.data.topic.id) && <option value={post.data.data.topic.id}>{post.data.data.topic.name}</option>}{topics.data?.data.map(t => <option value={t.id} key={t.id}>{t.name}</option>)}</select></label></div>
      {topics.isError && <ErrorState message={messageOf(topics.error)} retry={() => void topics.refetch()} />}
      {errors.topicId && <FormError>请选择可用的讨论主题。</FormError>}
      <div className="form-field"><label htmlFor="post-title">标题</label><input id="post-title" aria-describedby="post-title-note" {...register('title')} maxLength={60} placeholder="用一句话，让大家知道你想聊什么" /><span id="post-title-note" className="field-note">5—60 个字 · {title?.length || 0}/60</span></div>{errors.title && <FormError>标题需要 5—60 个字。</FormError>}
      <div className="form-field"><label htmlFor="post-body">正文</label><textarea id="post-body" aria-describedby="post-body-note" {...register('body')} rows={8} maxLength={5000} placeholder="分享具体的问题、经历或想法。清晰一点，更容易遇到同频的人。" /><span id="post-body-note" className="field-note">10—5000 个字 · {body?.length || 0}/5000</span></div>{errors.body && <FormError>正文需要 10—5000 个字。</FormError>}
      <ImagePicker onBusyChange={setUploading} ids={imageIds} onChange={setImageIds} disabled={isSubmitting || !!pending} />
      <div className="publish-school">发布到：<strong>{edit ? post.data?.data.school.name : user.school.name}</strong><span>学校为本人自述。支持最多六张图片、评论、点赞与收藏。</span></div>
      </fieldset>
      <FormError>{error}</FormError>{isDirtyAfterFailure && <p className="form-note">输入已保留在当前页面。{edit ? '若版本冲突，请核对已保存版本后决定如何继续。' : pending ? blocked ? '无法继续核对，请返回讨论板确认现状。' : '发布结果尚未确认，内容暂时锁定；点击“核对并完成发布”可安全重试同一次提交，成功后可编辑。' : '请修正提示的问题后再次发布。'}关闭或刷新页面前请自行保留内容。</p>}
      {pending && blocked && <Link className="button secondary" to="/discover">返回讨论板</Link>}
      <button type="submit" className="button wide" disabled={isSubmitting || uploading || checking || (!pending && topics.isError) || blocked}>{isSubmitting ? '正在保存……' : edit ? '保存修改' : pending ? '核对并完成发布' : '发布讨论'}<ArrowUpRight size={19} /></button>
    </form>
  </section>;
}
