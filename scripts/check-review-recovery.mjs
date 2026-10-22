import 'dotenv/config';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Client } from 'pg';

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test') || testUrl === process.env.DATABASE_URL) throw new Error('Review probe requires a separate _test database.');
const origin = 'http://127.0.0.1:3102', instance = 'review-recovery-' + randomUUID(), database = new Client({ connectionString: testUrl });
let server, ownerId, result;
const recruitmentIds = [], owner = { cookie: '', csrf: '' }, applicant = { cookie: '', csrf: '' };
async function start() {
  const reservation = createServer();
  await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(3102, '127.0.0.1', resolve); });
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  server = spawn(process.execPath, ['apps/server/dist/index.js'], { windowsHide: true, stdio: 'ignore', env: { ...process.env, DATABASE_URL: testUrl, PORT: '3102', WEB_ORIGIN: origin, NODE_ENV: 'test', CAMPUS_DEV_INSTANCE: instance } });
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error('Review probe API exited early.');
    try {
      const health = await (await fetch(origin + '/api/v1/health', { signal: AbortSignal.timeout(700) })).json();
      if (health.data?.devInstance === instance && (await fetch(origin + '/api/v1/ready', { signal: AbortSignal.timeout(700) })).ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Review probe API startup timed out.');
}
async function stop() { if (server && server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; } }
async function api(session, path, method = 'GET', body, expectedStatus = 200) {
  const response = await fetch(origin + '/api/v1' + path, { method, signal: AbortSignal.timeout(12000), headers: { Origin: origin, ...(session.cookie ? { Cookie: session.cookie } : {}), ...(session.csrf ? { 'X-CSRF-Token': session.csrf } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const updated = response.headers.get('set-cookie'); if (updated) session.cookie = updated.split(';')[0];
  const json = await response.json();
  if (response.status !== expectedStatus) throw new Error(`Review probe HTTP ${response.status} (${json.error?.code || 'unexpected status'})`);
  if (json.data?.csrfToken) session.csrf = json.data.csrfToken;
  return json.data;
}
await database.connect();
try {
  await start(); await api(owner, '/auth/csrf'); await api(applicant, '/auth/csrf');
  ownerId = (await api(owner, '/auth/login', 'POST', { email: 'river@campus.invalid', password: 'DemoCampus2026!' })).user.id;
  const applicantId = (await api(applicant, '/auth/login', 'POST', { email: 'lin@campus.invalid', password: 'DemoCampus2026!' })).user.id;
  const topicId = (await api(owner, '/topics?category=COMPETITION'))[0].id, at = hours => new Date(Date.now() + hours * 3600_000).toISOString();
  const cases = [];
  for (const decision of ['APPROVE', 'REJECT']) {
    const captain = randomUUID();
    const draft = { topicId, title: '审核结果重启保留验证' + decision, description: '本队伍仅在独立测试库中验证审核、成员与通知经过专用 API 重启后保持一致，结束后回收。', competitionName: '测试作品赛', direction: '持久化验证', goal: '验证审核可恢复性', collaboration: '本次明确确认所列时间', startAt: at(24), endAt: at(48), competitionDeadline: at(72), capacity: 2, allowCrossSchool: true, slots: [{ key: captain, name: '协作', capacity: 2 }], captainSlotKey: captain };
    const r = await api(owner, '/recruitments', 'POST', { requestKey: randomUUID(), draft }, 201); recruitmentIds.push(r.id);
    const team = (await api(owner, '/recruitments/' + r.id + '/publish', 'POST', { revision: 1 }, 201)).team;
    const submitted = await api(applicant, '/teams/' + team.id + '/applications', 'POST', { requestKey: randomUUID(), slotId: team.slots[0].id, message: '本次申请通过真实接口保存。', timeConfirmed: true }, 201);
    const input = { revision: submitted.revision, decision, reason: '重启保留的审核说明' + decision };
    await api(owner, '/applications/' + submitted.id + '/review', 'POST', input);
    cases.push({ recruitmentId: r.id, teamId: team.id, applicationId: submitted.id, input });
  }
  const approvedNotice = (await api(applicant, '/me/notifications')).items.find(n => n.applicationId === cases[0].applicationId);
  if (!approvedNotice) throw new Error('Approval notification missing.');
  const readAt = (await api(applicant, '/me/notifications/' + approvedNotice.id + '/read', 'POST', {})).readAt;
  for (let restart = 0; restart < 2; restart++) {
    await stop(); await start();
    for (const item of cases) {
      const replay = await api(owner, '/applications/' + item.applicationId + '/review', 'POST', item.input);
      const mine = (await api(applicant, '/me/applications?teamId=' + item.teamId))[0];
      const captain = (await api(owner, '/teams/' + item.teamId + '/applications?status=ALL')).items;
      const team = (await api(owner, '/recruitments/' + item.recruitmentId)).team;
      const approved = item.input.decision === 'APPROVE', status = approved ? 'APPROVED' : 'REJECTED';
      if (replay.status !== status || mine.status !== status || mine.review?.reason !== item.input.reason || captain.length !== 1 || team.memberCount !== (approved ? 2 : 1) || (approved && mine.membership?.status !== 'ACTIVE') || (!approved && mine.membership !== null)) throw new Error('Review or membership changed across restart.');
      const counts = (await database.query('SELECT (SELECT count(*)::int FROM "ApplicationReview" WHERE "applicationId"=$1) AS reviews, (SELECT count(*)::int FROM "Notification" n JOIN "ApplicationReview" r ON r."id"=n."reviewId" WHERE r."applicationId"=$1) AS notifications', [item.applicationId])).rows[0];
      if (counts.reviews !== 1 || counts.notifications !== 1) throw new Error('Review replay duplicated results.');
    }
    const notices = (await api(applicant, '/me/notifications')).items;
    if (notices.filter(n => cases.some(item => item.applicationId === n.applicationId)).length !== 2 || notices.find(n => n.id === approvedNotice.id)?.readAt !== readAt) throw new Error('Notifications or read state did not persist.');
    if ((await api(applicant, '/me/notifications/' + approvedNotice.id + '/read', 'POST', {})).readAt !== readAt || (await api(applicant, '/auth/me')).user?.id !== applicantId) throw new Error('Read replay or session changed.');
  }
  result = { passed: true, apiRestarts: 2, approvalAndRejectionPersisted: true, membershipAndCountsConsistent: true, originalReviewRetryNotDuplicated: true, notificationsAndReadStatePersisted: true, sessionPersisted: true, databaseRestarted: false, checkedAt: new Date().toISOString() };
} finally {
  await stop();
  try { if (recruitmentIds.length && ownerId) await database.query('DELETE FROM "Recruitment" WHERE "id" = ANY($1::uuid[]) AND "authorId"=$2', [recruitmentIds, ownerId]); }
  finally { await database.end(); }
}
mkdirSync('.local', { recursive: true }); writeFileSync('.local/review-recovery-check.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
