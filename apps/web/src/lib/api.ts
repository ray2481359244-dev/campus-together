import type { ApiResponse, ApiErrorBody } from '@campus/contracts';

export class ApiError extends Error {
  constructor(message: string, public status: number, public code: string, public fields?: Record<string, string[]>) { super(message); }
}
let csrfToken: string | null = null;
let sessionContext: { userId: string | null | undefined; revision: number } = { userId: undefined, revision: 0 };
export const setCsrfToken = (token: string | null) => { csrfToken = token; };
export const setSessionUserId = (id: string | null | undefined) => { sessionContext = { userId: id, revision: sessionContext.revision + 1 }; };
export async function api<T>(path: string, options: { method?: string; body?: unknown; signal?: AbortSignal } = {}, retryCsrf = true, expected = sessionContext): Promise<ApiResponse<T>> {
  const method = options.method || 'GET';
  const accountBound = method !== 'GET' || path === '/auth/csrf' || path.startsWith('/me/') || /^\/recruitments\/[a-f0-9-]+(?:$|\?)/i.test(path);
  if (method !== 'GET' && !csrfToken) csrfToken = (await api<{ csrfToken: string }>('/auth/csrf', {}, false, expected)).data.csrfToken;
  let response: Response;
  try {
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(12000)]) : AbortSignal.timeout(12000);
    response = await fetch('/api/v1' + path, { method, credentials: 'same-origin', signal,
      headers: { ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(method === 'GET' ? {} : { 'X-CSRF-Token': csrfToken! }), ...(!accountBound || expected.userId === undefined ? {} : { 'X-Session-User': expected.userId ?? 'anonymous' }) },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch { throw new ApiError('连接中断或请求超时，请检查网络后重试。填写内容仍会保留。', 0, 'NETWORK_ERROR'); }
  let result: ApiResponse<T> | ApiErrorBody;
  try { result = await response.json(); } catch { throw new ApiError('服务暂时不可用，请稍后重试。', response.status, 'SERVICE_UNAVAILABLE'); }
  // A successful earlier response must not restore a user after logout/re-login either.
  if (accountBound && expected !== sessionContext) throw new ApiError('登录状态已更新，旧请求的结果未应用到当前页面。请重新确认已保存内容。', 409, 'STALE_SESSION_RESPONSE');
  if (!response.ok) {
    const error = (result as ApiErrorBody).error;
    const stillCurrent = expected === sessionContext;
    if (error?.code === 'SESSION_CHANGED' && stillCurrent) window.dispatchEvent(new Event('campus:session-changed'));
    if (error?.code === 'CSRF_INVALID' && retryCsrf && method !== 'GET' && stillCurrent) { csrfToken = null; return api<T>(path, options, false, expected); }
    if (response.status === 401 && error?.code !== 'INVALID_CREDENTIALS' && stillCurrent) window.dispatchEvent(new Event('campus:session-expired'));
    throw new ApiError(error?.message || '操作失败，请稍后重试。', response.status, error?.code || 'UNKNOWN_ERROR', error?.fields);
  }
  return result as ApiResponse<T>;
}
export const messageOf = (e: unknown) => e instanceof Error ? e.message : '操作失败，请稍后重试。';
