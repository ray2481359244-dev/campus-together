import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, messageOf } from '../lib/api';
import { FormError } from './UI';

export function ContactPreferences({ userId }: { userId: string }) {
  const client = useQueryClient(), key = ['contact-preferences', userId];
  const state = useQuery({ queryKey: key, queryFn: ({ signal }) => api<{ allowRequests: boolean }>('/me/contact-preferences', { signal }), retry: false });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const value = state.data?.data.allowRequests;
  return <section className="paper contact-preferences">
    <h2>消息设置</h2>
    {state.isPending && <p role="status">正在读取消息设置…</p>}
    {state.isError && <button className="text-button" onClick={() => void state.refetch()}>重试读取设置</button>}
    {value !== undefined && <label className="checkbox-field"><input type="checkbox" checked={value} disabled={busy} onChange={async e => {
      const allowRequests = e.target.checked;
      setBusy(true); setError('');
      try { client.setQueryData(key, await api('/me/contact-preferences', { method: 'PUT', body: { allowRequests } })); }
      catch (e) { setError(messageOf(e)); }
      finally { setBusy(false); }
    }} />接收新联系人请求</label>}
    <FormError>{error}</FormError>
  </section>;
}
