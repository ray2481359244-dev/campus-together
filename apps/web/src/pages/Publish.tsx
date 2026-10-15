import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams, useParams, Link } from 'react-router-dom';
import { CreatePostSchema, categoryInfo } from '@campus/contracts';
import type { Category, TopicDTO, PostDTO } from '@campus/contracts';
import { ArrowUpRight, Check } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { api, messageOf } from '../lib/api';
import { PageTitle, Loading, ErrorState, FormError, LoginGate } from '../components/UI';

export function Publish({ edit = false }: { edit?: boolean }) {
  const { user, loading } = useAuth(), { id } = useParams(), [params] = useSearchParams(), navigate = useNavigate(), client = useQueryClient();
  const [category, setCategory] = useState<Category>(['COMPETITION', 'GAME', 'STUDY', 'OUTDOOR'].includes(params.get('category') || '') ? params.get('category') as Category : 'COMPETITION');
  const [error, setError] = useState(''), [isDirtyAfterFailure, setIsDirtyAfterFailure] = useState(false);
  const post = useQuery({ queryKey: ['post', id], queryFn: () => api<PostDTO>('/posts/' + id), enabled: edit && !!id });
  const topics = useQuery({ queryKey: ['topics', category], queryFn: () => api<TopicDTO[]>('/topics?category=' + category) });
  const { register, handleSubmit, reset, setValue, watch, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(CreatePostSchema), defaultValues: { title: '', body: '', topicId: '' } });
  const selectedTopic = watch('topicId'), title = watch('title'), body = watch('body');
  useEffect(() => { if (edit && post.data) { setCategory(post.data.data.topic.category); reset({ title: post.data.data.title, body: post.data.data.body, topicId: post.data.data.topic.id }); } }, [post.data, edit, reset]);
  useEffect(() => { if (!edit && topics.data && !topics.data.data.some(t => t.id === selectedTopic)) setValue('topicId', topics.data.data[0]?.id || ''); }, [topics.data, edit, selectedTopic, setValue]);
  if (loading) return <Loading />;
  if (!user) return <LoginGate next={edit ? '/posts/' + id + '/edit' : '/publish'} />;
  if (edit && post.isPending) return <Loading label="正在读取讨论……" />;
  if (edit && post.isError) return <ErrorState message={messageOf(post.error)} retry={() => void post.refetch()} />;
  if (edit && post.data && !post.data.data.canEdit) return <ErrorState message="只有作者可以编辑这条讨论。" />;
  return <section className="form-page"><PageTitle title={edit ? '让想法更清楚一点。' : '你的想法，值得被看见。'} eyebrow={edit ? 'EDIT YOUR DISCUSSION.' : 'LET YOUR IDEA OUT.'} back={() => navigate(edit ? '/posts/' + id : '/discover')} />
    {!edit && <div className="publish-modes"><span className="current"><Check size={16} />发布讨论</span><Link to="/recruitments">招募功能 · 下一阶段<ArrowUpRight size={14} /></Link></div>}
    <form className="paper form-stack" onSubmit={handleSubmit(async values => {
      setError(''); setIsDirtyAfterFailure(false);
      try {
        const r = await api<PostDTO>(edit ? '/posts/' + id : '/posts', { method: edit ? 'PATCH' : 'POST', body: edit ? { title: values.title, body: values.body, revision: post.data!.data.revision } : values });
        await client.invalidateQueries({ queryKey: ['posts'] }); client.setQueryData(['post', r.data.id], r);
        navigate('/posts/' + r.data.id, { replace: true, state: { justPublished: !edit } });
      } catch (e) { setError(messageOf(e)); setIsDirtyAfterFailure(true); }
    })}>
      <div className="form-row"><label>兴趣区域<select value={category} disabled={edit} onChange={e => setCategory(e.target.value as Category)}>{(['COMPETITION', 'STUDY', 'GAME', 'OUTDOOR'] as Category[]).map(c => <option value={c} key={c}>{categoryInfo[c].name}</option>)}</select></label><label>讨论主题<select disabled={edit || topics.isPending} {...register('topicId')}><option value="" disabled>请选择主题</option>{edit && post.data && !topics.data?.data.some(t => t.id === post.data.data.topic.id) && <option value={post.data.data.topic.id}>{post.data.data.topic.name}</option>}{topics.data?.data.map(t => <option value={t.id} key={t.id}>{t.name}</option>)}</select></label></div>
      {topics.isError && <ErrorState message={messageOf(topics.error)} retry={() => void topics.refetch()} />}
      {errors.topicId && <FormError>请选择可用的讨论主题。</FormError>}
      <div className="form-field"><label htmlFor="post-title">标题</label><input id="post-title" aria-describedby="post-title-note" {...register('title')} maxLength={60} placeholder="用一句话，让大家知道你想聊什么" /><span id="post-title-note" className="field-note">5—60 个字 · {title?.length || 0}/60</span></div>{errors.title && <FormError>标题需要 5—60 个字。</FormError>}
      <div className="form-field"><label htmlFor="post-body">正文</label><textarea id="post-body" aria-describedby="post-body-note" {...register('body')} rows={8} maxLength={5000} placeholder="分享具体的问题、经历或想法。清晰一点，更容易遇到同频的人。" /><span id="post-body-note" className="field-note">10—5000 个字 · {body?.length || 0}/5000</span></div>{errors.body && <FormError>正文需要 10—5000 个字。</FormError>}
      <div className="publish-school">发布到：<strong>{edit ? post.data?.data.school.name : user.school.name}</strong><span>学校为本人自述。当前版本支持文字讨论，图片和互动后续补齐。</span></div>
      <FormError>{error}</FormError>{isDirtyAfterFailure && <p className="form-note">输入已保留在当前页面，请确认网络后重试。关闭页面前请自行保留未提交内容。</p>}
      <button type="submit" className="button wide" disabled={isSubmitting || topics.isError}>{isSubmitting ? '正在保存……' : edit ? '保存修改' : '发布讨论'}<ArrowUpRight size={19} /></button>
    </form>
  </section>;
}
