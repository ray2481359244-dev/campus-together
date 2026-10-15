import express from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';
import cookieParser from 'cookie-parser';
import { loadSession, authRouter, profileRouter } from './auth.js';
import { notFound, errorHandler } from './http.js';
import { postsRouter } from './posts.js';

export const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use((_req, res, next) => { res.locals.requestId = randomUUID(); res.setHeader('X-Request-Id', res.locals.requestId); next(); });
app.use(express.json({ limit: '64kb' }));
app.use(cookieParser());
app.use(loadSession);
app.get('/api/v1/health', (_req, res) => res.json({ data: { status: 'ok', appMode: config.demo ? 'DEMO' : 'STANDARD', milestone: 'M0' } }));
app.get('/api/v1/ready', async (_req, res) => {
  try { await db.$queryRaw`SELECT 1`; res.json({ data: { ready: true } }); }
  catch { res.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: '数据库尚未就绪，请稍后重试。' } }); }
});
app.get('/api/v1/schools', async (_req, res) => res.json({ data: await db.school.findMany({ where: { active: true }, select: { id: true, name: true, city: true, isDemo: true }, orderBy: { name: 'asc' } }) }));
app.use('/api/v1/auth', authRouter);
app.use('/api/v1', profileRouter);
app.use('/api/v1', postsRouter);
app.use(notFound);
app.use(errorHandler);
