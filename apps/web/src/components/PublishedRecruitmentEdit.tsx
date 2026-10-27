import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RecruitmentDTO } from '@campus/contracts';
import { useAuth } from '../lib/auth';
import { api, messageOf } from '../lib/api';
import { FormError } from './UI';
export function PublishedRecruitmentEdit({ value: r }: { value: RecruitmentDTO }) {
  const { user } = useAuth(), client = useQueryClient();
  const [text, setText] = useState({ title: r.title, description: r.description, revision: r.revision }), [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState(false);
  if (user?.id !== r.author.id || r.publicationStatus !== 'PUBLISHED') return null;
  return <details><summary>修改标题与补充说明</summary><form className="form-stack" onSubmit={async e => { e.preventDefault(); if(busy) return; setBusy(true); setError(''); setDone(false); try { const result = await api<RecruitmentDTO>('/recruitments/' + r.id + '/text', { method: 'PATCH', body: text }); setText({ title: result.data.title, description: result.data.description, revision: result.data.revision }); await client.invalidateQueries({ queryKey: ['recruitment', r.id] }); await client.invalidateQueries({ queryKey: ['recruitments'] }); setDone(true); } catch(e) { setError(messageOf(e)); } finally { setBusy(false); } }}><p className="form-note">已发布的时间、岗位、名额和准入条件固定。说明不能代替已发布条件；需要改变条件请取消原队伍后新建。</p><label>修改招募标题<input value={text.title} minLength={5} maxLength={60} onChange={e => setText(t => ({...t,title:e.target.value}))} /></label><label>补充招募说明<textarea value={text.description} minLength={20} maxLength={3000} onChange={e => setText(t => ({...t,description:e.target.value}))} /></label><FormError>{error}</FormError>{done && <p role="status">修改已保存。</p>}<button className="button secondary" disabled={busy || text.revision !== r.revision}>保存说明修改</button></form></details>;
}
