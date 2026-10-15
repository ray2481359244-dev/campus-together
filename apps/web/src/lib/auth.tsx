import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { MeDTO } from '@campus/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { api, setCsrfToken } from './api';

type AuthValue = { user: MeDTO | null; loading: boolean; error: Error | null; reload: () => Promise<void>; accept: (user: MeDTO, token?: string) => void; logout: () => Promise<void> };
const AuthContext = createContext<AuthValue | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient(), [user, setUser] = useState<MeDTO | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState<Error | null>(null);
  async function reload() {
    setLoading(true); setError(null);
    try { const r = await api<{ user: MeDTO | null; csrfToken: string | null }>('/auth/me'); setUser(r.data.user); setCsrfToken(r.data.csrfToken); }
    catch (e) { setError(e instanceof Error ? e : new Error('无法读取登录状态')); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    void reload();
    const expired = () => { setUser(null); setCsrfToken(null); client.clear(); };
    window.addEventListener('campus:session-expired', expired);
    return () => window.removeEventListener('campus:session-expired', expired);
  }, []);
  function accept(next: MeDTO, token?: string) { client.clear(); setUser(next); if (token) setCsrfToken(token); setError(null); }
  async function logout() { await api('/auth/logout', { method: 'POST', body: {} }); setCsrfToken(null); setUser(null); client.clear(); }
  return <AuthContext value={{ user, loading, error, reload, accept, logout }}>{children}</AuthContext>;
}
export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error('AuthProvider missing'); return value; }
