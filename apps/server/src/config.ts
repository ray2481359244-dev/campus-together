export const config = {
  port: Number(process.env.PORT || 3001),
  databaseUrl: process.env.DATABASE_URL,
  origin: process.env.WEB_ORIGIN || 'http://127.0.0.1:5173',
  production: process.env.NODE_ENV === 'production',
  demo: process.env.APP_MODE === 'DEMO',
};
if (!config.databaseUrl) throw new Error('DATABASE_URL is missing. Run pnpm setup and start PostgreSQL.');
if (!['DEMO', 'STANDARD'].includes(process.env.APP_MODE || 'STANDARD')) throw new Error('Invalid APP_MODE');
