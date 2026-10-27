import { productionChecks } from '../../../scripts/production-config.mjs';
if(process.env.NODE_ENV === 'production') { const failed=productionChecks(process.env).filter(c=>!c.pass); if(failed.length)throw new Error('Production configuration failed: '+failed.map(c=>c.code).join(', ')); }
export const config = {
  port: Number(process.env.PORT || 3001),
  databaseUrl: process.env.DATABASE_URL,
  origin: process.env.NODE_ENV === 'production' ? process.env.SERVE_ORIGIN! : process.env.WEB_ORIGIN || 'http://127.0.0.1:5173',
  production: process.env.NODE_ENV === 'production',
  demo: process.env.APP_MODE === 'DEMO',
  csrfSecret: process.env.CSRF_SECRET,
};
if (!config.databaseUrl) throw new Error('DATABASE_URL is missing. Run pnpm setup and start PostgreSQL.');
if (!['DEMO', 'STANDARD'].includes(process.env.APP_MODE || 'STANDARD')) throw new Error('Invalid APP_MODE');
if (!config.csrfSecret || config.csrfSecret.length < 32) throw new Error('CSRF_SECRET is missing or too short. Run pnpm setup.');
