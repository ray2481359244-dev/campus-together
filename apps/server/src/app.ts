import express from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { config } from './config.js';

export const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '64kb' }));
app.use((_req, res, next) => { res.setHeader('X-Request-Id', randomUUID()); next(); });
app.get('/api/v1/health', (_req, res) => res.json({ data: { status: 'ok', appMode: config.demo ? 'DEMO' : 'STANDARD', milestone: 'M0' } }));
app.get('/api/v1/ready', async (_req, res) => {
  try { await db.$queryRaw`SELECT 1`; res.json({ data: { ready: true } }); }
  catch { res.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: '数据库尚未就绪，请稍后重试。' } }); }
});
app.get('/api/v1/schools', async (_req, res) => res.json({ data: await db.school.findMany({ where: { active: true }, select: { id: true, name: true, city: true, isDemo: true }, orderBy: { name: 'asc' } }) }));
app.get('/api/v1/topics', async (_req, res) => res.json({ data: await db.topic.findMany({ where: { active: true }, orderBy: [{ category: 'asc' }, { name: 'asc' }] }) }));
