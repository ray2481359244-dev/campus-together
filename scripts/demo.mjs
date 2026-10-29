import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { once } from 'node:events';
import { Client } from 'pg';
import { demoEnvironment, inspectDemo, ensureDemoDatabase } from './demo-core.mjs';

let child;
function run(args, env, cwd = process.cwd()) {
  const result = spawnSync(process.execPath, args, { env, cwd, stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error('DEMO_STEP_FAILED');
}
async function stop() {
  if (child && child.exitCode === null && child.signalCode === null) {
    const ended = once(child, 'exit'); child.kill('SIGTERM'); await ended;
  }
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
process.on('message', message => { if (message?.type === 'campus-demo-stop') void stop(); });
try {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('DEMO_REQUIRES_NODE_24');
  const statusOnly = process.argv.includes('--status'), fresh = process.argv.includes('--new-scene');
  if (!statusOnly) run(['scripts/setup.mjs'], process.env);
  const input = { ...parseEnv(readFileSync('.env', 'utf8')), ...process.env };
  const plan = demoEnvironment(input), state = await inspectDemo(plan);
  if (statusOnly) { console.log(JSON.stringify({ state, url: plan.origin, database: plan.database })); if (!['RUNNING', 'STOPPED'].includes(state)) process.exitCode = 1; }
  else {
    const require = createRequire(import.meta.url), tsx = require.resolve('tsx/cli');
    if (fresh && state === 'RUNNING') {
      run([tsx, 'scripts/demo-data.ts', '--new-scene'], plan.env);
    } else if (state === 'RUNNING') console.log('本项目演示版已经就绪：' + plan.origin + '（保留当前演示记录）。');
    else {
      if (state !== 'STOPPED') throw new Error('DEMO_PORT_UNAVAILABLE_NO_PROCESS_WAS_STOPPED');
      try { await ensureDemoDatabase(plan, connectionString => new Client({ connectionString, connectionTimeoutMillis: 3000 })); }
      catch (error) {
        if (error.code !== 'ECONNREFUSED') throw error;
        // Start only this checkout's local helper; keep the shared PostgreSQL running on exit.
        const bootstrap = new URL(plan.env.DATABASE_URL); bootstrap.pathname = '/postgres';
        run([tsx, 'scripts/local-db.ts', '--once'], { ...plan.env, DATABASE_URL: bootstrap.href });
        await ensureDemoDatabase(plan, connectionString => new Client({ connectionString, connectionTimeoutMillis: 3000 }));
      }
      run([resolve('node_modules/prisma/build/index.js'), 'generate', '--config', 'prisma7.config.ts'], plan.env);
      run([resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--config', 'prisma7.config.ts'], plan.env);
      run([tsx, 'prisma/seed.ts'], plan.env);
      run([resolve('apps/web/node_modules/vite/bin/vite.js'), 'build'], { ...plan.env, NODE_ENV: 'production' }, resolve('apps/web'));
      if (!existsSync('apps/web/dist/index.html')) throw new Error('DEMO_WEB_BUILD_MISSING');
      run(['scripts/build.mjs'], plan.env);
      child = spawn(process.execPath, ['scripts/serve.mjs'], { env: plan.env, stdio: 'inherit', windowsHide: true });
      for (let i = 0; i < 80; i++) {
        if (child.exitCode !== null) throw new Error('DEMO_SERVICE_EXITED');
        if (await inspectDemo(plan) === 'RUNNING') break;
        await new Promise(done => setTimeout(done, 100));
      }
      if (await inspectDemo(plan) !== 'RUNNING') throw new Error('DEMO_NOT_READY');
      run([tsx, 'scripts/demo-data.ts', ...(fresh ? ['--new-scene'] : [])], plan.env);
      console.log('\n参赛本地演示已就绪：' + plan.origin + '/discover');
      console.log('独立演示库：' + plan.database + '；AI 为规则模式。账号与流程见 docs/competition/LOCAL_DEMO.md。');
      console.log('请保持此终端运行；Ctrl+C 仅停止本次演示网页，数据库与数据保留。');
      const [code] = await once(child, 'exit'); if (code) process.exitCode = 1;
    }
  }
} catch (error) {
  console.error('演示启动未完成：' + (/^[A-Z0-9_]+$/.test(error.message) ? error.message : error.code || error.name));
  console.error('请核对 Node 24、已安装依赖、本地数据库权限和演示端口；不会重置数据或结束其他服务。');
  process.exitCode = 1;
} finally { await stop(); if (process.connected) process.disconnect(); }
