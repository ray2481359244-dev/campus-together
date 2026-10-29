import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { NotificationSummaryDTO, NotificationsPageDTO } from '@campus/contracts';
import { api } from './api';

export function useNotificationSummary(userId?: string) {
  return useQuery({queryKey:['notification-summary',userId],enabled:!!userId,retry:false,refetchInterval:5000,
    queryFn:({signal})=>api<NotificationSummaryDTO>('/me/notifications/summary',{signal})});
}
export function useNotifications(userId?: string) {
  const client=useQueryClient();
  const result=useInfiniteQuery({queryKey:['notifications',userId],enabled:!!userId,initialPageParam:'',retry:false,staleTime:0,refetchInterval:5000,
    queryFn:({pageParam,signal})=>api<NotificationsPageDTO>('/me/notifications'+(pageParam?'?cursor='+pageParam:''),{signal}),
    getNextPageParam:last=>last.data.nextCursor||undefined});
  useEffect(()=>{
    if(!userId||!result.data)return;
    const page=result.data.pages[0].data;
    client.setQueryData(['notification-summary',userId],{data:{unreadCount:page.unreadCount,latest:page.items[0]||null}});
  },[client,userId,result.data]);
  return result;
}
