import type { Request, RequestHandler, Response } from 'express';
import { Router } from 'express';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { RegisterSchema, LoginSchema, ProfileSchema, IdSchema } from '@campus/contracts';
import { db } from './db.js';
import { config } from './config.js';
import { ApiError, parse } from './http.js';
import { hashPassword, verifyPassword } from './password.js';
import { userInclude, publicProfile, privateProfile } from './dto.js';
import type { AuthUser } from './dto.js';
import type { Prisma } from './generated/prisma/client.js';

const COOKIE = 'campus_session';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const csrfFor = (value: string) => createHmac('sha256', config.csrfSecret!).update(value).digest('base64url');
type LoadedSession = { id: string; userId: string | null; csrfHash: string; rawToken: string; user: AuthUser | null };
declare global { namespace Express { interface Locals { session?: LoadedSession; requestId: string } } }
const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, secure: config.production, path: '/' };
const limit = (max: number, windowMs: number) => rateLimit({ windowMs, limit: max, standardHeaders: 'draft-8', legacyHeaders: false, handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: '操作太频繁，请稍后再试。' }, requestId: res.locals.requestId }) });
export const authLimit = limit(20, 15 * 60_000);
const anonymousLimit = limit(90, 15 * 60_000);
export const writeLimit = limit(40, 60_000);
const dummyHash = hashPassword('dummy-password-never-a-user');

export const loadSession: RequestHandler = async (req, res, next) => {
  const token = req.cookies?.[COOKIE];
  if (typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)) {
    const session = await db.session.findUnique({ where: { tokenHash: digest(token) }, include: { user: { include: userInclude } } });
    if (session && !session.revokedAt && session.expiresAt > new Date()) {
      if (!session.user || session.user.status === 'ACTIVE') res.locals.session = { id: session.id, userId: session.userId, csrfHash: session.csrfHash, rawToken: token, user: session.user };
      else { await db.session.updateMany({ where: { userId: session.userId, revokedAt: null }, data: { revokedAt: new Date() } }); res.clearCookie(COOKIE, cookieOptions); }
    }
  }
  // A browser tab may retain UI/CSRF state after another tab replaces the shared cookie.
  const expected = req.get('x-session-user');
  if (expected !== undefined && expected !== (res.locals.session?.userId ?? 'anonymous')) {
    res.setHeader('Cache-Control', 'no-store');
    if (!res.locals.session?.userId && expected !== 'anonymous') throw new ApiError(401, 'AUTH_REQUIRED', '登录已过期，请重新登录后继续。');
    throw new ApiError(409, 'SESSION_CHANGED', '登录状态已变化，请重新加载并确认账号后再操作。');
  }
  next();
};
export function requireUser(res: Response): AuthUser {
  const user = res.locals.session?.user;
  if (!user) throw new ApiError(401, 'AUTH_REQUIRED', '请先登录，再继续操作。');
  return user;
}
export const csrfGuard: RequestHandler = (req, res, next) => {
  if (req.get('origin') !== config.origin) throw new ApiError(403, 'ORIGIN_REJECTED', '请求来源不受信任，请从应用页面重试。');
  const session = res.locals.session, token = req.get('x-csrf-token');
  if (!session || !token || token.length > 100 || !timingSafeEqual(Buffer.from(digest(token), 'hex'), Buffer.from(session.csrfHash, 'hex'))) throw new ApiError(403, 'CSRF_INVALID', '操作凭证已过期，请刷新后重试。');
  next();
};
async function saveSession(tx: Prisma.TransactionClient, previousId: string | undefined, userId: string | null) {
  const token = randomBytes(32).toString('base64url'), csrfToken = csrfFor(token), ttl = userId ? 7 * 86400_000 : 15 * 60_000;
  if (previousId) {
    const claimed = await tx.session.updateMany({ where: { id: previousId, revokedAt: null, expiresAt: { gt: new Date() } }, data: { revokedAt: new Date() } });
    if (claimed.count !== 1) throw new ApiError(409, 'SESSION_CHANGED', '登录状态已变化，请重新加载并确认账号后再操作。');
  }
  await tx.session.create({ data: { tokenHash: digest(token), csrfHash: digest(csrfToken), userId, expiresAt: new Date(Date.now() + ttl) } });
  return { token, csrfToken, ttl };
}
function sendSession(res: Response, session: Awaited<ReturnType<typeof saveSession>>) {
  // Never set a cookie before the transaction has successfully committed.
  res.cookie(COOKIE, session.token, { ...cookieOptions, maxAge: session.ttl });
  return session.csrfToken;
}
async function newSession(res: Response, userId: string | null) {
  const session = await db.$transaction(tx => saveSession(tx, res.locals.session?.id, userId));
  return sendSession(res, session);
}
export const authRouter = Router();
authRouter.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
authRouter.get('/csrf', anonymousLimit, async (req, res) => {
  if (req.get('origin') && req.get('origin') !== config.origin) throw new ApiError(403, 'ORIGIN_REJECTED', '请求来源不受信任。');
  const session = res.locals.session;
  const csrfToken = session ? csrfFor(session.rawToken) : await newSession(res, null);
  res.json({ data: { csrfToken } });
});
authRouter.get('/me', (_req, res) => res.json({ data: { user: res.locals.session?.user ? privateProfile(res.locals.session.user) : null, csrfToken: res.locals.session ? csrfFor(res.locals.session.rawToken) : null } }));
authRouter.post('/register', authLimit, csrfGuard, async (req, res) => {
  const input = parse(RegisterSchema, req.body);
  const passwordHash = await hashPassword(input.password);
  const result = await db.$transaction(async tx => {
    if (!await tx.school.findFirst({ where: { id: input.schoolId, active: true } })) throw new ApiError(400, 'INVALID_SCHOOL', '请选择可用的学校。');
    const user = await tx.user.create({ data: { email: input.email, passwordHash, profile: { create: { nickname: input.nickname, schoolId: input.schoolId } } }, include: userInclude });
    const session = await saveSession(tx, res.locals.session?.id, user.id);
    return { user, session };
  });
  res.status(201).json({ data: { user: privateProfile(result.user), csrfToken: sendSession(res, result.session) } });
});
authRouter.post('/login', authLimit, csrfGuard, async (req, res) => {
  const input = parse(LoginSchema, req.body);
  const user = await db.user.findUnique({ where: { email: input.email }, include: userInclude });
  const valid = await verifyPassword(user?.passwordHash ?? await dummyHash, input.password);
  if (!user || !valid || user.status !== 'ACTIVE') throw new ApiError(401, 'INVALID_CREDENTIALS', '邮箱或密码不正确，或账号不可用。');
  const csrfToken = await newSession(res, user.id);
  res.json({ data: { user: privateProfile(user), csrfToken } });
});
authRouter.post('/logout', csrfGuard, async (_req, res) => {
  if (res.locals.session) {
    const revoked = await db.session.updateMany({ where: { id: res.locals.session.id, revokedAt: null, expiresAt: { gt: new Date() } }, data: { revokedAt: new Date() } });
    if (revoked.count !== 1) throw new ApiError(409, 'SESSION_CHANGED', '登录状态已变化，请重新加载并确认账号后再操作。');
  }
  res.clearCookie(COOKIE, cookieOptions);
  res.json({ data: { loggedOut: true } });
});
export const profileRouter = Router();
profileRouter.get('/me/profile', (_req, res) => { res.setHeader('Cache-Control', 'no-store'); res.json({ data: privateProfile(requireUser(res)) }); });
profileRouter.patch('/me/profile', writeLimit, csrfGuard, async (req, res) => {
  const user = requireUser(res), input = parse(ProfileSchema, req.body);
  const updated = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id}::uuid FOR NO KEY UPDATE`;
    if (!await tx.user.findFirst({ where: { id: user.id, status: 'ACTIVE' } })) throw new ApiError(401, 'AUTH_REQUIRED', '当前账号不可修改资料，请重新登录。');
    if (!await tx.school.findFirst({ where: { id: input.schoolId, active: true } })) throw new ApiError(400, 'INVALID_SCHOOL', '请选择可用的学校。');
    await tx.profile.update({ where: { userId: user.id }, data: input });
    return tx.user.findUniqueOrThrow({ where: { id: user.id }, include: userInclude });
  });
  res.json({ data: privateProfile(updated) });
});
profileRouter.get('/profiles/:userId', async (req, res) => {
  const id = parse(IdSchema, req.params.userId);
  const user = await db.user.findFirst({ where: { id, status: 'ACTIVE' }, include: userInclude });
  if (!user) throw new ApiError(404, 'NOT_FOUND', '该用户不存在。');
  res.json({ data: publicProfile(user) });
});
