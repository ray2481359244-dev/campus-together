import { app } from './app.js';
import { config } from './config.js';
import { db } from './db.js';
import { startExpiryWorker } from './expiry.js';

const server = app.listen(config.port, '127.0.0.1', () => console.log(`API listening on http://127.0.0.1:${config.port}`));
const stopExpiry = startExpiryWorker();
const close = () => server.close(() => { void stopExpiry().then(() => db.$disconnect()).finally(() => process.exit(0)); });
process.on('SIGINT', close); process.on('SIGTERM', close);
