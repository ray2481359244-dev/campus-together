import type { ErrorRequestHandler, RequestHandler } from 'express';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: Record<string, string[]>) { super(message); }
}
export function parse<T>(schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: { issues: { path: PropertyKey[]; message: string }[] } } }, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  const fields: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.map(String).join('.') || '_form';
    (fields[key] ||= []).push(issue.message);
  }
  throw new ApiError(400, 'INVALID_INPUT', '请检查填写内容。', fields);
}
export const notFound: RequestHandler = (_req, _res, next) => next(new ApiError(404, 'NOT_FOUND', '该内容不存在或不可见。'));
export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  const requestId = String(res.locals.requestId ?? 'unknown');
  if (error instanceof ApiError) { res.status(error.status).json({ error: { code: error.code, message: error.message, fields: error.fields }, requestId }); return; }
  if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') {
    res.status(409).json({ error: { code: 'ALREADY_EXISTS', message: '该记录已存在，请检查后重试。' }, requestId }); return;
  }
  if (error instanceof SyntaxError || (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large')) {
    res.status(400).json({ error: { code: 'INVALID_INPUT', message: '请求格式无效或内容过长。' }, requestId }); return;
  }
  // Never log request bodies, cookies, credentials or Prisma connection details.
  console.error(JSON.stringify({ requestId, error: error instanceof Error ? error.name : 'UnknownError' }));
  res.status(503).json({ error: { code: 'SERVICE_UNAVAILABLE', message: '服务暂时不可用，请稍后重试。' }, requestId });
};
