import express from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';
import cookieParser from 'cookie-parser';
import { loadSession, authRouter, profileRouter } from './auth.js';
import { notFound, errorHandler } from './http.js';
import { postsRouter } from './posts.js';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

export const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use((_req, res, next) => { res.locals.requestId = randomUUID(); res.setHeader('X-Request-Id', res.locals.requestId); next(); });
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());
app.get('/api/v1/health', (_req, res) => res.json({ data: { status: 'ok', appMode: config.demo ? 'DEMO' : 'STANDARD', milestone: 'W1_COMMUNITY_FOUNDATION', ...(!config.production && process.env.CAMPUS_DEV_INSTANCE ? { devInstance: process.env.CAMPUS_DEV_INSTANCE } : {}) } }));
app.get('/api/v1/ready', async (_req, res) => {
  try { await db.$queryRaw`SELECT 1`; res.json({ data: { ready: true } }); }
  catch { res.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: '数据库尚未就绪，请稍后重试。' } }); }
});
app.use('/api/v1', loadSession);
app.get('/api/v1/schools', async (_req, res) => res.json({ data: await db.school.findMany({ where: { active: true }, select: { id: true, name: true, city: true, isDemo: true }, orderBy: { name: 'asc' } }) }));
app.use('/api/v1/auth', authRouter);
app.use('/api/v1', profileRouter);
app.use('/api/v1', postsRouter);
app.use('/api', notFound);
if (process.env.SERVE_WEB === '1') {
  const web = resolve('apps/web/dist');
  if (!existsSync(resolve(web, 'index.html'))) throw new Error('Web build missing. Run pnpm build first.');
  app.use(express.static(web));
  app.use((req, res, next) => { if (req.method === 'GET' && req.accepts('html')) res.sendFile(resolve(web, 'index.html')); else next(); });
}
app.use(notFound);
app.use(errorHandler);
