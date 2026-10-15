import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const url = process.env.TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test') || url === process.env.DATABASE_URL) throw new Error('Refusing to migrate anything except the separate _test database.');
const result = spawnSync(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--config', 'prisma7.config.ts'], { stdio: 'inherit', windowsHide: true, env: { ...process.env, DATABASE_URL: url } });
if (result.status !== 0) process.exit(result.status || 1);
