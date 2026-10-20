import 'dotenv/config';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test') || testUrl === process.env.DATABASE_URL) throw new Error('Recovery probe uses only a separate _test database.');
const origin = 'http://127.0.0.1:3102', instance = 'recruitment-recovery-' + randomUUID();
let server, cookie = '', csrf = '';
async function start() {
  const reservation = createServer();
  await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(3102, '127.0.0.1', resolve); });
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  server = spawn(process.execPath, ['apps/server/dist/index.js'], { windowsHide: true, stdio: 'ignore', env: { ...process.env, DATABASE_URL: testUrl, PORT: '3102', WEB_ORIGIN: origin, NODE_ENV: 'test', CAMPUS_DEV_INSTANCE: instance } });
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error('Recovery probe API exited early.');
    try {
      const health = await (await fetch(origin + '/api/v1/health', { signal: AbortSignal.timeout(700) })).json();
      if (health.data?.devInstance === instance && (await fetch(origin + '/api/v1/ready', { signal: AbortSignal.timeout(700) })).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Recovery probe API startup timed out.');
}
async function stop() {
  if (server && server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; }
}
async function api(path, method = 'GET', body, expectedStatus = 200) {
  const response = await fetch(origin + '/api/v1' + path, { method, signal: AbortSignal.timeout(12000), headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const updated = response.headers.get('set-cookie'); if (updated) cookie = updated.split(';')[0];
  const json = await response.json();
  if (response.status !== expectedStatus) throw new Error(`Recovery probe HTTP ${response.status} (${json.error?.code || 'unexpected status'})`);
  if (json.data?.csrfToken) csrf = json.data.csrfToken;
  return json;
}
try {
  await start(); await api('/auth/csrf');
  const logged = (await api('/auth/login', 'POST', { email: 'river@campus.invalid', password: 'DemoCampus2026!' })).data;
  const topic = (await api('/topics?category=COMPETITION')).data[0], slot = randomUUID();
  const draft = { topicId: topic.id, title: 'API重启后的创建结果核对', capacity: 2, slots: [{ key: slot, name: '协作伙伴', capacity: 2 }], captainSlotKey: slot };
  const input = { requestKey: randomUUID(), draft }, deletedInput = { requestKey: randomUUID(), draft: { ...draft, title: 'API重启后不能重建的已删除草稿' } };
  const created = (await api('/recruitments', 'POST', input, 201)).data;
  const deleted = (await api('/recruitments', 'POST', deletedInput, 201)).data;
  await api('/recruitments/' + deleted.id, 'DELETE', { revision: deleted.revision });
  await stop(); await start();
  const replay = (await api('/recruitments', 'POST', input)).data;
  const rejected = await api('/recruitments', 'POST', deletedInput, 410);
  const session = (await api('/auth/me')).data, own = (await api('/me/recruitments')).data;
  if (replay.id !== created.id || replay.revision !== 1 || rejected.error?.code !== 'DRAFT_DELETED' || session.user?.id !== logged.user.id || own.some(row => row.id === deleted.id)) throw new Error('Creation identity, deletion marker, or session did not survive API restart.');
  await api('/recruitments/' + created.id, 'DELETE', { revision: 1 });
  const result = { passed: true, apiRestart: true, creationIdentityPersisted: true, deletedCreationNotRecreated: true, sessionPersisted: true, databaseRestarted: false, checkedAt: new Date().toISOString() };
  mkdirSync('.local', { recursive: true }); writeFileSync('.local/recruitment-recovery-check.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { await stop(); }
