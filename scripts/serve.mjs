import { productionChecks } from './production-config.mjs';
import 'dotenv/config';
if (process.env.NODE_ENV === 'production') { const failed=productionChecks(process.env).filter(c=>!c.pass); if(failed.length)throw new Error('Production configuration failed: '+failed.map(c=>c.code).join(', ')); }
process.env.SERVE_WEB = '1';
process.env.WEB_ORIGIN = process.env.SERVE_ORIGIN || `http://127.0.0.1:${process.env.PORT || 3001}`;
if (process.env.NODE_ENV === 'production' && !process.env.WEB_ORIGIN.startsWith('https://')) throw new Error('Production requires an explicit HTTPS SERVE_ORIGIN.');
await import('../apps/server/dist/index.js');
