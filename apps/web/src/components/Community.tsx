import { ReportButton } from './ReportButton';
import {StudentAvatar} from './visual/StudentArtwork';
import { useEffect, useRef, useState } from 'react';
import type {ReactNode} from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Bell, BellOff, Bookmark, ThumbsUp } from 'lucide-react';
import type { CommunityDTO } from '@campus/contracts';
import { useAuth } from '../lib/auth';
import { api, ApiError, messageOf } from '../lib/api';
import { Loading, ErrorState, FormError, SectionLink } from './UI';
export function SaveRecruitment({id}:{id:string}) {
  const {user}=useAuth();const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  if(!user)return null;
  return <div><button className="button secondary" disabled={busy} onClick={async()=>{setBusy(true);try{await api('/favorites',{method:'PUT',body:{type:'RECRUITMENT',id,active:true}});setNotice('已收藏，可在我的收藏中取消。');}catch(e){setNotice(messageOf(e));}finally{setBusy(false);}}}>收藏招募</button>{notice && <p role="status">{notice}</p>}</div>;
}
export type CommunityParts={feedback:ReactNode;discussion:ReactNode;commentCount:number};
export function Community({postId,render}:{postId:string;render?:(parts:CommunityParts)=>ReactNode}) {
  const {user}=useAuth(),client=useQueryClient(),[params,setParams]=useSearchParams(),target=params.get('comment');
  const [body,setBody]=useState(''),[replyId,setReplyId]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState(''),[burst,setBurst]=useState(0),[savedBurst,setSavedBurst]=useState(0);
  const pending=useRef<{requestKey:string;body:string;replyId:string|null}|null>(null),writing=useRef(false),located=useRef('');
  const key=['community',postId,user?.id,target];
  const result=useInfiniteQuery({queryKey:key,initialPageParam:'',queryFn:({pageParam,signal})=>api<CommunityDTO>('/community/'+postId+(pageParam?'?cursor='+pageParam:target?'?commentId='+encodeURIComponent(target):''),{signal}),getNextPageParam:last=>last.data.nextCursor||undefined,retry:false,refetchInterval:5000});
  useEffect(()=>{
    if(!target||!result.data||located.current===target)return;
    const node=document.getElementById('comment-'+target);
    if(node){node.scrollIntoView({block:'center',behavior:'instant'});node.focus({preventScroll:true});located.current=target;}
  },[target,result.data]);
  async function refresh() {
    await Promise.all([client.invalidateQueries({queryKey:['community',postId]}),client.invalidateQueries({queryKey:['posts']}),client.invalidateQueries({queryKey:['notifications']}),client.invalidateQueries({queryKey:['notification-summary']})]);
  }
  async function act(path:string,method:string,data?:unknown,done?:()=>void) {
    if(writing.current)return;writing.current=true;setBusy(true);setError('');
    try{
      const saved=await api<{active:boolean;likes:number}>(path,{method,body:data});
      if(path.endsWith('/like'))client.setQueryData(key,(cache:typeof result.data)=>cache?{...cache,pages:cache.pages.map(page=>({...page,data:{...page.data,liked:saved.data.active,likes:saved.data.likes}}))}:cache);
      if(path==='/favorites')client.setQueryData(key,(cache:typeof result.data)=>cache?{...cache,pages:cache.pages.map(page=>({...page,data:{...page.data,saved:saved.data.active}}))}:cache);
      done?.();await refresh();
    }catch(e){setError(messageOf(e));}finally{writing.current=false;setBusy(false);}
  }
  if(result.isPending){const state=<Loading label="正在读取讨论互动……"/>;return render?render({feedback:state,discussion:state,commentCount:0}):state;}
  if(result.isError&&!result.data){const state=<ErrorState message={messageOf(result.error)} retry={()=>void result.refetch()}/>;return render?render({feedback:state,discussion:state,commentCount:0}):state;}
  const first=result.data!.pages[0].data,comments=result.data!.pages.flatMap(p=>p.data.comments),reply=comments.find(c=>c.id===replyId);
  const feedback=<>
    <div className="community-actions"><div className="button-row">
      <button className={'button like-button'+(first.liked?' is-liked':'')} aria-pressed={first.liked} disabled={!user||busy} onClick={()=>void act('/community/'+postId+'/like','PUT',{active:!first.liked},()=>{if(!first.liked)setBurst(n=>n+1);setStatus(first.liked?'已取消点赞':'点赞成功');})}>
        <ThumbsUp size={19} aria-hidden="true" /><span>{first.liked?'取消点赞':'点赞'} · {first.likes}</span>{burst>0&&<span key={burst} className="like-burst" aria-hidden="true"><ThumbsUp size={38} strokeWidth={2.5} /></span>}
      </button>
      <button className={'button save-button'+(first.saved?' is-saved':'')} aria-pressed={first.saved} disabled={!user||busy} onClick={()=>void act('/favorites','PUT',{type:'POST',id:postId,active:!first.saved},()=>{if(!first.saved)setSavedBurst(n=>n+1);setStatus(first.saved?'已取消收藏':'已收藏，可在“我的收藏”中查看。');})}><Bookmark size={17} aria-hidden="true" /><span>{first.saved?'取消收藏':'收藏讨论'}</span>{first.saved&&savedBurst>0&&<span key={savedBurst} className="save-burst" aria-hidden="true"><Bookmark size={36} strokeWidth={2.4} /></span>}</button>
      <Link className="text-button" to="/saved">我的收藏</Link>
    </div>{user&&<button className={'text-button post-mute'+(first.notificationsMuted?' is-muted':'')} disabled={busy} aria-pressed={first.notificationsMuted} onClick={()=>void act('/community/'+postId+'/notifications','PUT',{muted:!first.notificationsMuted},()=>setStatus(first.notificationsMuted?'已开启本帖提醒':'已关闭本帖提醒，其他帖子的消息照常接收。'))}>{first.notificationsMuted?<BellOff size={17} />:<Bell size={17} />}{first.notificationsMuted?'开启本帖提醒':'关闭本帖提醒'}</button>}</div>
    <p className="interaction-status" role="status">{status}</p><FormError>{error}</FormError></>;
  const discussion=<section className="community-comments" id="conversation" aria-label="讨论互动">
    <div className="conversation-heading"><div><span className="eyebrow">LET’S TALK.</span><h2>一起聊聊</h2></div>{user&&<SectionLink className="text-button" target="write-comment">写评论 ↓</SectionLink>}</div>
    {first.notificationsMuted&&<p className="muted-notice"><BellOff size={15} aria-hidden="true" />本帖已免打扰，新的评论、回复和点赞将不再提醒。</p>}
    {target&&<p className="form-note">正在查看消息对应的评论。<button className="text-button" onClick={()=>{located.current='';setParams(next=>{next.delete('comment');return next;},{replace:true});}}>查看全部评论</button></p>}
    {!user&&<p><Link to={'/login?next=/posts/'+postId}>登录后参与评论</Link></p>}
    {comments.map(c=><article id={'comment-'+c.id} tabIndex={-1} key={c.id} className={'community-comment'+(target===c.id?' targeted-comment':'')}><div className="comment-byline"><StudentAvatar seed={c.id}/><strong>{c.nickname}</strong><time className="metadata">{new Date(c.createdAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'})}</time></div>{c.replyId&&<blockquote className="comment-quote">{c.reply?`回复 ${c.reply.nickname}：${c.reply.body}`:'原评论已不可用'}</blockquote>}<p>{c.body}</p><div className="comment-actions">{user&&<button className="text-button" disabled={busy||!!pending.current} onClick={()=>{setReplyId(c.id);document.getElementById('comment-body')?.focus();}}>回复此评论</button>}{c.canDelete&&<button className="text-button danger" disabled={busy} onClick={()=>void act('/comments/'+c.id,'DELETE')}>删除我的评论</button>}<ReportButton type="COMMENT" id={c.id} /></div></article>)}
    {!first.comments.length&&<p className="comment-empty">还没有评论，来聊聊你的想法。</p>}
    {result.hasNextPage&&<button className="text-button" disabled={result.isFetchingNextPage} onClick={()=>void result.fetchNextPage()}>更多评论</button>}
    {user&&<form className="form-stack comment-composer" id="write-comment" onSubmit={async e=>{
      e.preventDefault();if(writing.current||!body.trim())return;writing.current=true;setBusy(true);setError('');pending.current??={requestKey:crypto.randomUUID(),body:body.trim(),replyId};
      try{await api('/community/'+postId+'/comments',{method:'POST',body:pending.current});pending.current=null;setBody('');setReplyId(null);setStatus('评论已发布');await refresh();}
      catch(e){setError(messageOf(e));if(e instanceof ApiError&&[400,404,410,422].includes(e.status))pending.current=null;}
      finally{writing.current=false;setBusy(false);}
    }}>{replyId&&<p className="reply-selection">正在回复 {reply?.nickname||'这条评论'} <button type="button" className="text-button" disabled={!!pending.current} onClick={()=>setReplyId(null)}>取消回复</button></p>}<label htmlFor="comment-body">写一条评论<textarea id="comment-body" aria-label="写一条评论" placeholder="说说你的想法，让话题继续。" value={body} maxLength={1000} rows={3} disabled={busy||!!pending.current} onChange={e=>setBody(e.target.value)} /></label><div className="comment-submit"><span className="field-note">{body.length}/1000</span><button className="button" disabled={busy||!body.trim()}>{pending.current?'核对并重试原评论':'发布评论'}</button></div></form>}
    {result.isError&&<ErrorState message={messageOf(result.error)} retry={()=>void result.refetch()} />}
  </section>;
  return render?render({feedback,discussion,commentCount:comments.length}):<>{feedback}{discussion}</>;
}
