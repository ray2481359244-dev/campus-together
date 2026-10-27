import { moderationRouter } from './moderation.js';
import express from 'express';
import { communityRouter } from './community.js';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';
import cookieParser from 'cookie-parser';
import { loadSession, authRouter, profileRouter } from './auth.js';
import { notFound, errorHandler } from './http.js';
import { postsRouter } from './posts.js';
import { recruitmentsRouter } from './recruitments.js';
import { applicationsRouter } from './applications.js';
import { notificationsRouter } from './notifications.js';
import { aiRouter } from './ai.js';
import { matchingRouter } from './matching.js';
import { chatRouter } from './chat.js';
import { teamsRouter } from './teams.js';
import { expiryFallback } from './expiry.js';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

export const app = express();
app.disable('x-powered-by');
if(process.env.TRUST_PROXY === 'loopback')app.set('trust proxy','loopback');
app.use(helmet());
app.use((_req, res, next) => { res.locals.requestId = randomUUID(); res.setHeader('X-Request-Id', res.locals.requestId); next(); });
app.use((req, res, next) => req.path === '/api/v1/media' ? next() : express.json({ limit: '64kb' })(req, res, next));
app.use(cookieParser());
app.get('/api/v1/health', (_req, res) => res.json({ data: { status: 'ok', appMode: config.demo ? 'DEMO' : 'STANDARD', milestone: 'PREDEPLOY_CORE', ...(!config.production && process.env.CAMPUS_DEV_INSTANCE ? { devInstance: process.env.CAMPUS_DEV_INSTANCE } : {}) } }));
app.get('/api/v1/ready', async (_req, res) => {
  try { await db.$queryRaw`SELECT 1`; res.json({ data: { ready: true } }); }
  catch { res.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: '数据库尚未就绪，请稍后重试。' } }); }
});
app.use('/api/v1', loadSession);
app.use('/api/v1', expiryFallback);
app.get('/api/v1/schools', async (_req, res) => res.json({ data: await db.school.findMany({ where: { active: true }, select: { id: true, name: true, city: true, isDemo: true }, orderBy: { name: 'asc' } }) }));
app.use('/api/v1/auth', authRouter);
app.use('/api/v1', profileRouter);
app.use('/api/v1', moderationRouter);
app.use('/api/v1', communityRouter);
app.use('/api/v1', postsRouter);
app.use('/api/v1', applicationsRouter);
app.use('/api/v1', notificationsRouter);
app.use('/api/v1', teamsRouter);
app.use('/api/v1', chatRouter);
app.use('/api/v1', matchingRouter);
app.use('/api/v1', aiRouter);
app.use('/api/v1', recruitmentsRouter);
app.use('/api', notFound);
if (process.env.SERVE_WEB === '1') {
  const web = resolve('apps/web/dist');
  if (!existsSync(resolve(web, 'index.html'))) throw new Error('Web build missing. Run pnpm build first.');
  app.use(express.static(web));
  app.use((req, res, next) => { if (req.method === 'GET' && req.accepts('html')) res.sendFile('index.html', { root: web }); else next(); });
}
app.use(notFound);
app.use(errorHandler);
