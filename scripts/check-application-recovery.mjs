import 'dotenv/config';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Client } from 'pg';

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test') || testUrl === process.env.DATABASE_URL) throw new Error('Application probe requires a separate _test database.');
const origin = 'http://127.0.0.1:3102', instance = 'application-recovery-' + randomUUID();
const database = new Client({ connectionString: testUrl });
let server, recruitmentId, ownerId, result;
const owner = { cookie: '', csrf: '' }, applicant = { cookie: '', csrf: '' };
async function start() {
  const reservation = createServer();
  await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(3102, '127.0.0.1', resolve); });
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  server = spawn(process.execPath, ['apps/server/dist/index.js'], { windowsHide: true, stdio: 'ignore', env: { ...process.env, DATABASE_URL: testUrl, PORT: '3102', WEB_ORIGIN: origin, NODE_ENV: 'test', CAMPUS_DEV_INSTANCE: instance } });
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error('Application probe API exited early.');
    try {
      const health = await (await fetch(origin + '/api/v1/health', { signal: AbortSignal.timeout(700) })).json();
      if (health.data?.devInstance === instance && (await fetch(origin + '/api/v1/ready', { signal: AbortSignal.timeout(700) })).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Application probe API startup timed out.');
}
async function stop() {
  if (server && server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; }
}
async function api(session, path, method = 'GET', body, expectedStatus = 200) {
  const response = await fetch(origin + '/api/v1' + path, { method, signal: AbortSignal.timeout(12000), headers: { Origin: origin, ...(session.cookie ? { Cookie: session.cookie } : {}), ...(session.csrf ? { 'X-CSRF-Token': session.csrf } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const updated = response.headers.get('set-cookie'); if (updated) session.cookie = updated.split(';')[0];
  const json = await response.json();
  if (response.status !== expectedStatus) throw new Error(`Application probe HTTP ${response.status} (${json.error?.code || 'unexpected status'})`);
  if (json.data?.csrfToken) session.csrf = json.data.csrfToken;
  return json;
}
await database.connect();
try {
  await start(); await api(owner, '/auth/csrf'); await api(applicant, '/auth/csrf');
  ownerId = (await api(owner, '/auth/login', 'POST', { email: 'river@campus.invalid', password: 'DemoCampus2026!' })).data.user.id;
  const applicantId = (await api(applicant, '/auth/login', 'POST', { email: 'lin@campus.invalid', password: 'DemoCampus2026!' })).data.user.id;
  const topicId = (await api(owner, '/topics?category=COMPETITION')).data[0].id, captain = randomUUID();
  const at = hours => new Date(Date.now() + hours * 3600_000).toISOString();
  const draft = { topicId, title: '申请与撤回重启保留检查队伍', description: '这是独立测试库中的真实发布，仅用于验证申请与撤回经过专用 API 重启后保留，检查结束回收。', competitionName: '测试作品赛', direction: '持久化验证', goal: '验证可恢复性', collaboration: '本次明确确认时间', startAt: at(24), endAt: at(48), competitionDeadline: at(72), capacity: 2, slots: [{ key: captain, name: '协作', capacity: 2 }], captainSlotKey: captain };
  recruitmentId = (await api(owner, '/recruitments', 'POST', { requestKey: randomUUID(), draft }, 201)).data.id;
  const teamId = (await api(owner, '/recruitments/' + recruitmentId + '/publish', 'POST', { revision: 1 }, 201)).data.team.id;
  const slotId = (await api(owner, '/recruitments/' + recruitmentId)).data.team.slots[0].id;
  const input = { requestKey: randomUUID(), slotId, message: '这是本次真实保存的申请意向。', timeConfirmed: true };
  const created = (await api(applicant, '/teams/' + teamId + '/applications', 'POST', input, 201)).data;
  await stop(); await start();
  const replay = (await api(applicant, '/teams/' + teamId + '/applications', 'POST', input)).data;
  const mine = (await api(applicant, '/me/applications?teamId=' + teamId)).data;
  if (replay.id !== created.id || replay.status !== 'PENDING' || mine.length !== 1 || mine[0].message !== input.message) throw new Error('Pending application did not survive restart.');
  await api(applicant, '/applications/' + created.id + '/withdraw', 'POST', { revision: created.revision });
  await stop(); await start();
  const withdrawn = (await api(applicant, '/me/applications?teamId=' + teamId)).data;
  const oldRequest = (await api(applicant, '/teams/' + teamId + '/applications', 'POST', input)).data;
  const originalWithdraw = (await api(applicant, '/applications/' + created.id + '/withdraw', 'POST', { revision: created.revision })).data;
  const session = (await api(applicant, '/auth/me')).data;
  const team = (await api(owner, '/recruitments/' + recruitmentId)).data.team;
  const count = (await database.query('SELECT count(*)::int AS count FROM "Application" WHERE "teamId"=$1', [teamId])).rows[0].count;
  if (withdrawn[0]?.status !== 'WITHDRAWN' || oldRequest.status !== 'WITHDRAWN' || originalWithdraw.status !== 'WITHDRAWN' || session.user?.id !== applicantId || count !== 1 || team.memberCount !== 1) throw new Error('Withdrawal, identity, or membership changed across restart.');
  result = { passed: true, apiRestarts: 2, pendingApplicationPersisted: true, withdrawalPersisted: true, originalRequestsNotResurrected: true, pendingNeverOccupiedSeat: true, sessionPersisted: true, databaseRestarted: false, checkedAt: new Date().toISOString() };
} finally {
  await stop();
  try { if (recruitmentId && ownerId) await database.query('DELETE FROM "Recruitment" WHERE "id"=$1 AND "authorId"=$2', [recruitmentId, ownerId]); }
  finally { await database.end(); }
}
mkdirSync('.local', { recursive: true }); writeFileSync('.local/application-recovery-check.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
