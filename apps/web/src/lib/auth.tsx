import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { MeDTO } from '@campus/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { api, setCsrfToken, setSessionUserId } from './api';

type AuthValue = { user: MeDTO | null; loading: boolean; error: Error | null; reload: () => Promise<void>; accept: (user: MeDTO, token?: string) => void; logout: () => Promise<void> };
const AuthContext = createContext<AuthValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient(), [user, setUser] = useState<MeDTO | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState<Error | null>(null);
  const [gate, setGate] = useState<'changed' | 'expired' | null>(null);
  const revision = useRef(0), channel = useRef<BroadcastChannel | null>(null);
  function notify() { channel.current?.postMessage({ type: 'identity-change' }); }
  function forget(reason: 'changed' | 'expired') {
    revision.current++;
    setUser(null); setCsrfToken(null); setSessionUserId(undefined); setLoading(false); setGate(reason);
    void client.cancelQueries(); client.clear();
  }
  async function reload() {
    const current = ++revision.current;
    setLoading(true); setError(null);
    try {
      const r = await api<{ user: MeDTO | null; csrfToken: string | null }>('/auth/me');
      if (current !== revision.current) return;
      setUser(r.data.user); setSessionUserId(r.data.user?.id ?? null); setCsrfToken(r.data.csrfToken);
    } catch (e) { if (current === revision.current) setError(e instanceof Error ? e : new Error('无法读取登录状态')); }
    finally { if (current === revision.current) setLoading(false); }
  }
  useEffect(() => {
    void reload();
    const changed = () => forget('changed');
    const expired = () => { forget('expired'); notify(); };
    window.addEventListener('campus:session-expired', expired);
    window.addEventListener('campus:session-changed', changed);
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const c = new BroadcastChannel('campus-auth'); channel.current = c;
        c.onmessage = event => { if (event.data?.type === 'identity-change') changed(); };
      } catch { channel.current = null; } // Browser policy may disable this optional notification path.
    }
    return () => {
      revision.current++;
      window.removeEventListener('campus:session-expired', expired);
      window.removeEventListener('campus:session-changed', changed);
      channel.current?.close(); channel.current = null;
    };
  }, []);
  function accept(next: MeDTO, token?: string) {
    revision.current++; client.clear(); setUser(next); setSessionUserId(next.id);
    if (token) { setCsrfToken(token); notify(); }
    setError(null); setLoading(false);
  }
  async function logout() {
    await api('/auth/logout', { method: 'POST', body: {} });
    revision.current++; setCsrfToken(null); setSessionUserId(null); setUser(null); client.clear(); notify();
  }
  return <AuthContext value={{ user, loading, error, reload, accept, logout }}>{gate
    ? <main className="session-gate"><section className="paper form-stack" aria-label="登录状态恢复"><p className="eyebrow">PLEASE CONFIRM YOUR ACCOUNT.</p><h1>{gate === 'changed' ? '登录状态已变化' : '登录已过期'}</h1><p>{gate === 'changed' ? '另一个标签页可能已退出或切换账号。本页已停止操作，请先确认当前账号。' : '会话已失效，本页已停止操作。请重新加载并登录后继续。'}</p><p className="form-note">原账号的缓存与未提交表单已清除，不会自动转移到另一个账号。已保存的草稿和已发布内容仍在原账号中。</p><button className="button" onClick={() => window.location.reload()}>重新加载并确认账号</button></section></main>
    : children}</AuthContext>;
}
export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('AuthProvider missing'); return value; }
