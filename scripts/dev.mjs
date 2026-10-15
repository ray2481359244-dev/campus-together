import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const tsx = require.resolve('tsx/cli');
const vite = resolve('apps/web/node_modules/vite/bin/vite.js');
const children = [
  spawn(process.execPath, [tsx, 'watch', '--env-file=.env', 'apps/server/src/index.ts'], { stdio: 'inherit', windowsHide: true }),
  spawn(process.execPath, [vite, '--host', '127.0.0.1'], { cwd: resolve('apps/web'), stdio: 'inherit', windowsHide: true }),
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
