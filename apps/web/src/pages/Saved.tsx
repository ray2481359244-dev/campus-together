import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { SavedDTO } from '@campus/contracts';
import { api, messageOf } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Loading, ErrorState, LoginGate, PageTitle, FormError } from '../components/UI';
export function Saved() {
  const {user,loading}=useAuth();const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const saved=useInfiniteQuery({queryKey:['saved',user?.id],enabled:!!user,initialPageParam:'',queryFn:({pageParam,signal})=>api<SavedDTO[]>('/me/saved'+(pageParam?'?cursor='+pageParam:''),{signal}),getNextPageParam:last=>last.meta?.nextCursor||undefined});
  if(loading)return <Loading/>;if(!user)return <LoginGate next="/saved"/>;
  return <section><PageTitle title="留给下次的想法。" eyebrow="SAVED FOR LATER"/>{saved.isPending?<Loading/>:saved.isError?<ErrorState message={messageOf(saved.error)} retry={()=>void saved.refetch()}/>:<div className="draft-list">{saved.data.pages.flatMap(p=>p.data).map(r=><article className="draft-row" key={r.id}>{r.available?<Link to={r.postId?'/posts/'+r.postId:'/recruitments/'+r.recruitmentId}>{r.title}</Link>:<span>内容已不可用</span>}<button className="text-button" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await api('/favorites',{method:'PUT',body:{type:r.postId?'POST':'RECRUITMENT',id:r.postId||r.recruitmentId,active:false}});await saved.refetch();}catch(e){setError(messageOf(e));}finally{setBusy(false);}}}>取消收藏</button></article>)}{!saved.data.pages[0].data.length&&<p>还没有收藏。</p>}{saved.hasNextPage&&<button className="text-button" onClick={()=>void saved.fetchNextPage()}>更多收藏</button>}</div>}<FormError>{error}</FormError></section>;
}
