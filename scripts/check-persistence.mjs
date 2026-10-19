import 'dotenv/config';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test') || testUrl === process.env.DATABASE_URL) throw new Error('Persistence probe writes only to a separate _test database.');
if (!['127.0.0.1', 'localhost'].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error('This probe may restart only the project-owned local database.');
const require = createRequire(import.meta.url), tsx = require.resolve('tsx/cli');
const origin = 'http://127.0.0.1:3102';
let server, cookie = '', csrf = '';
async function start() {
  server = spawn(process.execPath, ['apps/server/dist/index.js'], { windowsHide: true, stdio: 'ignore', env: { ...process.env, DATABASE_URL: testUrl, WEB_ORIGIN: origin, PORT: '3102', NODE_ENV: 'test' } });
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('Persistence probe API exited early.');
    try { if ((await fetch(origin + '/api/v1/ready')).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Probe API startup timed out');
}
async function stop() { if (server && server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; } }
async function api(path, method = 'GET', body) {
  const r = await fetch(origin + '/api/v1' + path, { method, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const updated = r.headers.get('set-cookie'); if (updated) cookie = updated.split(';')[0];
  const json = await r.json(); if (!r.ok) throw new Error(`Probe request failed ${r.status} ${json.error?.code}`);
  if (json.data?.csrfToken) csrf = json.data.csrfToken;
  return json.data;
}
try {
  await start(); await api('/auth/csrf');
  const logged = await api('/auth/login', 'POST', { email: 'river@campus.invalid', password: 'DemoCampus2026!' });
  const topic = (await api('/topics?category=COMPETITION'))[0];
  const input = { requestKey: randomUUID(), topicId: topic.id, title: '重启持久化验证讨论', body: '这条内容由测试脚本通过真实 HTTP 接口创建，用于验证服务和数据库重启后仍然可读。' };
  const post = await api('/posts', 'POST', input);
  await stop();
  for (const args of [['scripts/local-db.ts', '--stop'], ['scripts/local-db.ts', '--once']]) {
    const r = spawnSync(process.execPath, [tsx, ...args], { stdio: 'inherit', windowsHide: true });
    if (r.status !== 0) throw new Error('Project local database restart failed');
  }
  await start();
  const read = await api('/posts/' + post.id), session = await api('/auth/me'), retried = await api('/posts', 'POST', input);
  const listed = await api('/posts?' + new URLSearchParams({ schoolId: post.school.id, q: input.title, limit: '50' }));
  if (read.body !== post.body || read.title !== post.title || session.user?.id !== logged.user.id || retried.id !== post.id || listed.filter(p => p.id === post.id).length !== 1) throw new Error('Post, session, or retry identity did not survive restart');
  const result = { passed: true, postPersisted: true, sessionPersisted: true, creationRetryPersisted: true, checkedAt: new Date().toISOString(), postId: post.id };
  mkdirSync('.local', { recursive: true }); writeFileSync('.local/persistence-check.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await stop(); }
