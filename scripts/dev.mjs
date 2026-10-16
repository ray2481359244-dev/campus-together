import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import 'dotenv/config';
import { workspaceId } from './doctor.mjs';
const require = createRequire(import.meta.url);
const tsx = require.resolve('tsx/cli');
const vite = resolve('apps/web/node_modules/vite/bin/vite.js');
const children = [
  spawn(process.execPath, [tsx, 'watch', '--env-file=.env', 'apps/server/src/index.ts'], { stdio: 'inherit', windowsHide: true, env: { ...process.env, CAMPUS_DEV_INSTANCE: workspaceId(process.cwd()) } }),
  spawn(process.execPath, [vite, '--host', '127.0.0.1'], { cwd: resolve('apps/web'), stdio: 'inherit', windowsHide: true, env: { ...process.env, CAMPUS_API_PORT: process.env.PORT || '3001' } }),
];
let stopping = false;
const stop = () => {
  if (stopping) return; stopping = true;
  children.forEach(child => {
    if (child.exitCode !== null || !child.pid) return;
    if (process.platform === 'win32') spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    else child.kill('SIGTERM');
  });
};
process.on('SIGINT', stop); process.on('SIGTERM', stop);
children.forEach(child => child.on('exit', code => { if (code) { stop(); process.exitCode = code; } }));
console.log('\n预览请保持此终端运行。浏览器打开 http://127.0.0.1:5173/ ；Ctrl+C 停止网页和 API。');
