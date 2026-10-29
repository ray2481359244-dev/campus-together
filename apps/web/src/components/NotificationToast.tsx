import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bell, X } from 'lucide-react';
import type { NotificationDTO, NotificationSummaryDTO } from '@campus/contracts';

export function NotificationToast({summary,userId}:{summary?:NotificationSummaryDTO;userId?:string}) {
  const location=useLocation(),seen=useRef<string|null>(null);
  const [notice,setNotice]=useState<NotificationDTO|null>(null);
  useEffect(()=>{seen.current=null;setNotice(null);},[userId]);
  useEffect(()=>{
    if(!summary)return;
    const latest=summary.latest,version=latest?latest.id+latest.createdAt:'';
    if(seen.current!==null&&version!==seen.current&&latest&&!latest.readAt&&location.pathname!=='/messages')setNotice(latest);
    if(!summary.unreadCount||location.pathname==='/messages'||(notice?.id===latest?.id&&latest?.readAt))setNotice(null);
    seen.current=version;
  },[summary,location.pathname]);
  useEffect(()=>{if(!notice)return;const timer=window.setTimeout(()=>setNotice(null),8000);return()=>window.clearTimeout(timer);},[notice]);
  if(!userId||!notice)return null;
  return <aside className="notification-toast" role="status" aria-live="polite"><Bell size={21} aria-hidden="true" /><div><strong>{notice.postId?'帖子有了新互动':'你有一条新消息'}</strong><p>{notice.postTitle||notice.recruitmentTitle}</p><Link to="/messages" onClick={()=>setNotice(null)}>查看消息 →</Link></div><button className="toast-close" aria-label="关闭消息提示" onClick={()=>setNotice(null)}><X size={18} /></button></aside>;
}
