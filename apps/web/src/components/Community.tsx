import { ReportButton } from './ReportButton';
import { useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { CommunityDTO } from '@campus/contracts';
import { useAuth } from '../lib/auth';
import { api, ApiError, messageOf } from '../lib/api';
import { Loading, ErrorState, FormError } from './UI';
export function SaveRecruitment({id}:{id:string}) {
  const {user}=useAuth();const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  if(!user)return null;
  return <div><button className="button secondary" disabled={busy} onClick={async()=>{setBusy(true);try{await api('/favorites',{method:'PUT',body:{type:'RECRUITMENT',id,active:true}});setNotice('已收藏，可在我的收藏中取消。');}catch(e){setNotice(messageOf(e));}finally{setBusy(false);}}}>收藏招募</button><p role="status">{notice}</p></div>;
}
export function Community({postId}:{postId:string}) {
  const {user}=useAuth(),client=useQueryClient();
  const [body,setBody]=useState(''),[replyId,setReplyId]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const pending=useRef<{requestKey:string;body:string;replyId:string|null}|null>(null);
  const key=['community',postId,user?.id];
  const result=useInfiniteQuery({queryKey:key,initialPageParam:'',queryFn:({pageParam,signal})=>api<CommunityDTO>('/community/'+postId+(pageParam?'?cursor='+pageParam:''),{signal}),getNextPageParam:last=>last.data.nextCursor||undefined,retry:false});
  async function act(path:string,method:string,data?:unknown) {if(busy)return;setBusy(true);setError('');try{await api(path,{method,body:data});await client.invalidateQueries({queryKey:key});await client.invalidateQueries({queryKey:['posts']});}catch(e){setError(messageOf(e));}finally{setBusy(false);}}
  if(result.isPending)return <Loading />;if(result.isError)return <ErrorState message={messageOf(result.error)} retry={()=>void result.refetch()} />;
  const first=result.data.pages[0].data;
  return <section className="community-comments" aria-label="讨论互动"><div className="button-row"><button className="button secondary" disabled={!user||busy} onClick={()=>void act('/community/'+postId+'/like','PUT',{active:!first.liked})}>{first.liked?'取消点赞':'点赞'} · {first.likes}</button><button className="button secondary" disabled={!user||busy} onClick={()=>void act('/favorites','PUT',{type:'POST',id:postId,active:!first.saved})}>{first.saved?'取消收藏':'收藏讨论'}</button><Link className="text-button" to="/saved">我的收藏</Link></div><h2>一起聊聊</h2>{!user&&<p><Link to={'/login?next=/posts/'+postId}>登录后参与评论</Link></p>}{result.data.pages.flatMap(p=>p.data.comments).map(c=><article key={c.id} className="community-comment"><strong>{c.nickname}</strong><span className="metadata"> · {new Date(c.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}</span>{c.replyId&&<p className="field-note">{c.reply ? `回复 ${c.reply.nickname}：${c.reply.body}` : '原评论已不可用'}</p>}<p>{c.body}</p><ReportButton type="COMMENT" id={c.id} />{user&&<button className="text-button" disabled={busy||!!pending.current} onClick={()=>setReplyId(c.id)}>回复此评论</button>}{c.canDelete&&<button className="text-button danger" disabled={busy} onClick={()=>void act('/comments/'+c.id,'DELETE')}>删除我的评论</button>}</article>)}{!first.comments.length&&<p className="form-note">还没有评论，来聊聊你的想法。</p>}{result.hasNextPage&&<button className="text-button" disabled={result.isFetchingNextPage} onClick={()=>void result.fetchNextPage()}>更多评论</button>}{user&&<form className="form-stack" onSubmit={async e=>{e.preventDefault();if(busy||!body.trim())return;setBusy(true);setError('');pending.current??={requestKey:crypto.randomUUID(),body:body.trim(),replyId};try{await api('/community/'+postId+'/comments',{method:'POST',body:pending.current});pending.current=null;setBody('');setReplyId(null);await client.invalidateQueries({queryKey:key});await client.invalidateQueries({queryKey:['posts']});}catch(e){setError(messageOf(e));if(e instanceof ApiError&&[400,404,410,422].includes(e.status))pending.current=null;}finally{setBusy(false);}}}>{replyId&&<p>已选择回复评论 <button type="button" className="text-button" disabled={!!pending.current} onClick={()=>setReplyId(null)}>取消回复</button></p>}<label>写一条评论<textarea aria-label="写一条评论" value={body} maxLength={1000} rows={3} disabled={busy||!!pending.current} onChange={e=>setBody(e.target.value)} /></label><button className="button secondary" disabled={busy||!body.trim()}>{pending.current?'核对并重试原评论':'发布评论'}</button></form>}<FormError>{error}</FormError></section>;
}
