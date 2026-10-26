import 'dotenv/config';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Client } from 'pg';
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test') || testUrl === process.env.DATABASE_URL) throw new Error('Team recovery requires a separate _test database.');
const origin = 'http://127.0.0.1:3102', instance = 'team-recovery-' + randomUUID(), database = new Client({ connectionString: testUrl });
let server, ownerId, result;
const recruitmentIds = [], owner = { cookie: '', csrf: '' }, member = { cookie: '', csrf: '' };
async function start() {
  const reservation = createServer();
  await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(3102, '127.0.0.1', resolve); });
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  server = spawn(process.execPath, ['apps/server/dist/index.js'], { windowsHide: true, stdio: 'ignore', env: { ...process.env, DATABASE_URL: testUrl, PORT: '3102', WEB_ORIGIN: origin, NODE_ENV: 'test', CAMPUS_DEV_INSTANCE: instance } });
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error('Team recovery API exited early.');
    try { const health = await (await fetch(origin + '/api/v1/health', { signal: AbortSignal.timeout(700) })).json(); if (health.data?.devInstance === instance && (await fetch(origin + '/api/v1/ready', { signal: AbortSignal.timeout(700) })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Team recovery API startup timed out.');
}
async function stop() { if (server && server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; } }
async function api(session, path, method = 'GET', body, expected = 200) {
  const response = await fetch(origin + '/api/v1' + path, { method, signal: AbortSignal.timeout(12000), headers: { Origin: origin, ...(session.cookie ? { Cookie: session.cookie } : {}), ...(session.csrf ? { 'X-CSRF-Token': session.csrf } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const cookie = response.headers.get('set-cookie'); if (cookie) session.cookie = cookie.split(';')[0];
  const json = await response.json(); if (response.status !== expected) throw new Error(`Team recovery HTTP ${response.status} (${json.error?.code || 'unexpected status'})`);
  if (json.data?.csrfToken) session.csrf = json.data.csrfToken; return json.data;
}
await database.connect();
try {
  await start(); await api(owner, '/auth/csrf'); await api(member, '/auth/csrf');
  ownerId = (await api(owner, '/auth/login', 'POST', { email: 'river@campus.invalid', password: 'DemoCampus2026!' })).user.id;
  const memberId = (await api(member, '/auth/login', 'POST', { email: 'lin@campus.invalid', password: 'DemoCampus2026!' })).user.id;
  const topicId = (await api(owner, '/topics?category=COMPETITION'))[0].id, at = hours => new Date(Date.now() + hours * 3600_000).toISOString(), cases = [];
  for (const kind of ['LEFT', 'REMOVED', 'CLOSED']) {
    const key = randomUUID(), draft = { topicId, title: '成员管理重启保留验证' + kind, description: '此队伍仅在独立测试库验证退出、移除、关闭招募及本人通知经专用 API 重启后保留，结束后回收。', competitionName: '测试作品赛', direction: '持久化验证', goal: '验证成员管理可恢复性', collaboration: '本次明确确认协作时间', startAt: at(24), endAt: at(48), competitionDeadline: at(72), capacity: 2, allowCrossSchool: true, slots: [{ key, name: '协作', capacity: 2 }], captainSlotKey: key };
    const r = await api(owner, '/recruitments', 'POST', { requestKey: randomUUID(), draft }, 201); recruitmentIds.push(r.id);
    const published = await api(owner, '/recruitments/' + r.id + '/publish', 'POST', { revision: 1 }, 201), teamId = published.team.id;
    const input = { requestKey: randomUUID(), slotId: published.team.slots[0].id, timeConfirmed: true, message: '本次成员管理持久化验证意向。' };
    const application = await api(member, '/teams/' + teamId + '/applications', 'POST', input, 201);
    let path, body, actor;
    if (kind !== 'CLOSED') {
      await api(owner, '/applications/' + application.id + '/review', 'POST', { revision: 1, decision: 'APPROVE', reason: '欢迎协作。' });
      const membership = (await api(member, '/teams/' + teamId)).myMembership;
      path = '/teams/' + teamId + (kind === 'LEFT' ? '/leave' : '/members/' + membership.id + '/remove');
      body = { revision: membership.revision, ...(kind === 'REMOVED' ? { reason: '持久化验证的移除原因。' } : {}) }; actor = kind === 'LEFT' ? member : owner;
    } else { path = '/teams/' + teamId + '/close-recruitment'; body = { revision: published.revision, reason: '持久化验证的关闭说明。' }; actor = owner; }
    const receipt = await api(actor, path, 'POST', body);
    cases.push({ kind, teamId, applicationId: application.id, input, path, body, actor, receipt });
  }
  const left = (await api(member, '/me/notifications')).items.find(note => note.kind === 'MEMBER_LEFT' && cases.some(item => item.teamId === note.teamId));
  if (!left) throw new Error('Membership notification missing.');
  const readAt = (await api(member, '/me/notifications/' + left.id + '/read', 'POST', {})).readAt;
  for (let restart = 0; restart < 2; restart++) {
    await stop(); await start();
    for (const item of cases) {
      const replay = await api(item.actor, item.path, 'POST', item.body);
      if (JSON.stringify(replay) !== JSON.stringify(item.receipt)) throw new Error('Original membership/closure receipt changed.');
      await api(member, '/teams/' + item.teamId, 'GET', undefined, 404);
      const current = (await api(member, '/me/applications?teamId=' + item.teamId))[0];
      const oldCreate = await api(member, '/teams/' + item.teamId + '/applications', 'POST', item.input);
      const detail = await api(owner, '/teams/' + item.teamId);
      if (detail.memberCount !== 1 || oldCreate.id !== item.applicationId) throw new Error('Counts or original application changed.');
      const publicTeam = (await api(owner, '/recruitments/' + detail.recruitmentId)).team;
      if (publicTeam.memberCount !== 1 || publicTeam.slots[0].occupied !== 1) throw new Error('Public seat counts did not remain released.');
      if (item.kind === 'CLOSED') { if (current.status !== 'EXPIRED' || detail.acceptingStatus !== 'CLOSED' || !detail.closedAt) throw new Error('Closed recruitment reopened.'); }
      else { if (current.membership?.status !== item.kind || oldCreate.membership?.status !== item.kind) throw new Error('Inactive membership changed.'); const oldReview = await api(owner, '/applications/' + item.applicationId + '/review', 'POST', { revision: 1, decision: 'APPROVE', reason: '欢迎协作。' }); if (oldReview.membership?.status !== item.kind) throw new Error('Old approval resurrected a member.'); }
    }
    const own = (await api(member, '/me/teams')).items;
    if (own.some(team => cases.some(item => item.teamId === team.id))) throw new Error('Former member retained effective team entry.');
    const notifications = (await api(member, '/me/notifications')).items.filter(note => cases.some(item => item.teamId === note.teamId));
    for (const kind of ['MEMBER_LEFT', 'MEMBER_REMOVED', 'RECRUITMENT_CLOSED']) if (notifications.filter(note => note.kind === kind).length !== 1) throw new Error('Result notification duplicated or lost.');
    if ((await api(member, '/me/notifications/' + left.id + '/read', 'POST', {})).readAt !== readAt || (await api(member, '/auth/me')).user?.id !== memberId) throw new Error('Read state or session changed.');
  }
  result = { passed: true, apiRestarts: 2, leaveAndRemovalPersisted: true, privateAccessRevoked: true, countsAndSlotsReleased: true, closedRecruitmentAndExpiryPersisted: true, oldOperationsNotResurrected: true, notificationsAndReadStatePersisted: true, sessionPersisted: true, databaseRestarted: false, checkedAt: new Date().toISOString() };
} finally { await stop(); try { if (recruitmentIds.length && ownerId) await database.query('DELETE FROM "Recruitment" WHERE "id" = ANY($1::uuid[]) AND "authorId"=$2', [recruitmentIds, ownerId]); } finally { await database.end(); } }
mkdirSync('.local', { recursive: true }); writeFileSync('.local/team-recovery-check.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
