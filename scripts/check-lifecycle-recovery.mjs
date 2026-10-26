import 'dotenv/config';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Client } from 'pg';
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test') || testUrl === process.env.DATABASE_URL) throw new Error('Lifecycle recovery requires a separate _test database.');
const origin = 'http://127.0.0.1:3102', instance = 'lifecycle-recovery-' + randomUUID(), database = new Client({ connectionString: testUrl });
let server, ownerId, observerId, result;
const recruitmentIds = [], owner = { cookie: '', csrf: '' }, member = { cookie: '', csrf: '' }, observer = { cookie: '', csrf: '' };
async function start() {
  const reservation = createServer();
  await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(3102, '127.0.0.1', resolve); });
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  server = spawn(process.execPath, ['apps/server/dist/index.js'], { windowsHide: true, stdio: 'ignore', env: { ...process.env, DATABASE_URL: testUrl, PORT: '3102', WEB_ORIGIN: origin, NODE_ENV: 'test', CAMPUS_DEV_INSTANCE: instance } });
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error('Lifecycle recovery API exited early.');
    try { const health = await (await fetch(origin + '/api/v1/health', { signal: AbortSignal.timeout(700) })).json(); if (health.data?.devInstance === instance && (await fetch(origin + '/api/v1/ready', { signal: AbortSignal.timeout(700) })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Lifecycle recovery API startup timed out.');
}
async function stop() { if (server && server.exitCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; } }
async function api(session, path, method = 'GET', body, expected = 200) {
  const response = await fetch(origin + '/api/v1' + path, { method, signal: AbortSignal.timeout(12000), headers: { Origin: origin, ...(session.cookie ? { Cookie: session.cookie } : {}), ...(session.csrf ? { 'X-CSRF-Token': session.csrf } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const cookie = response.headers.get('set-cookie'); if (cookie) session.cookie = cookie.split(';')[0];
  const json = await response.json(); if (response.status !== expected) throw new Error(`Lifecycle recovery HTTP ${response.status} (${json.error?.code || 'unexpected status'})`);
  if (json.data?.csrfToken) session.csrf = json.data.csrfToken; return json.data;
}
await database.connect();
try {
  await start();
  for (const session of [owner, member, observer]) await api(session, '/auth/csrf');
  const ma = await api(owner, '/auth/login', 'POST', { email: 'river@campus.invalid', password: 'DemoCampus2026!' }); ownerId = ma.user.id;
  const memberId = (await api(member, '/auth/login', 'POST', { email: 'lin@campus.invalid', password: 'DemoCampus2026!' })).user.id;
  const schoolId = (await database.query('SELECT "schoolId" FROM "Profile" WHERE "userId"=$1', [ownerId])).rows[0].schoolId;
  observerId = (await api(observer, '/auth/register', 'POST', { email: `lifecycle-recovery-${randomUUID()}@campus.invalid`, password: 'LifecycleRecovery2026!', nickname: '持久化验证申请者', schoolId }, 201)).user.id;
  const topicId = (await api(owner, '/topics?category=COMPETITION'))[0].id, at = h => new Date(Date.now() + h * 3600_000).toISOString(), cases = [];
  for (const kind of ['TRANSFER', 'COMPLETE', 'CANCEL']) {
    const key = randomUUID(), draft = { topicId, title: '活动状态重启保留验证' + kind, description: '此队伍仅在独立测试库验证队长转交、活动状态与本人通知经专用 API 重启后保留，结束后回收。', competitionName: '测试作品赛', direction: '持久化验证', goal: '验证活动可恢复性', collaboration: '本次明确确认协作时间', startAt: at(24), endAt: at(48), competitionDeadline: at(72), capacity: 3, allowCrossSchool: true, slots: [{ key, name: '统筹', capacity: 1 }, { key: randomUUID(), name: '协作', capacity: 2 }], captainSlotKey: key };
    const r = await api(owner, '/recruitments', 'POST', { requestKey: randomUUID(), draft }, 201); recruitmentIds.push(r.id);
    const published = await api(owner, '/recruitments/' + r.id + '/publish', 'POST', { revision: 1 }, 201), teamId = published.team.id;
    const application = await api(member, '/teams/' + teamId + '/applications', 'POST', { requestKey: randomUUID(), slotId: published.team.slots[1].id, timeConfirmed: true, message: '本次活动状态持久化验证意向。' }, 201);
    await api(owner, '/applications/' + application.id + '/review', 'POST', { revision: 1, decision: 'APPROVE', reason: '欢迎协作。' });
    const membership = (await api(member, '/teams/' + teamId)).myMembership;
    let body, pending, startReceipt;
    if (kind === 'TRANSFER') body = { kind, revision: 1, targetMemberId: membership.id, targetRevision: membership.revision, reason: '交由现有成员负责。' };
    else {
      pending = await api(observer, '/teams/' + teamId + '/applications', 'POST', { requestKey: randomUUID(), slotId: published.team.slots[1].id, timeConfirmed: true, message: '验证活动状态导致的待审失效。' }, 201);
      if (kind === 'COMPLETE') startReceipt = await api(owner, '/teams/' + teamId + '/actions', 'POST', { kind: 'START', revision: 1, reason: '确认开始活动。' });
      body = { kind, revision: kind === 'COMPLETE' ? 2 : 1, reason: '本次活动状态的持久化验证说明。' };
    }
    const receipt = await api(owner, '/teams/' + teamId + '/actions', 'POST', body);
    cases.push({ kind, teamId, body, receipt, pending, startReceipt, membership });
  }
  const notesBefore = (await api(member, '/me/notifications')).items.filter(n => cases.some(item => item.teamId === n.teamId));
  const note = notesBefore.find(n => n.kind === 'TEAM_COMPLETED'); if (!note) throw new Error('Completion notice missing');
  const readAt = (await api(member, '/me/notifications/' + note.id + '/read', 'POST', {})).readAt;
  for (let restart = 0; restart < 2; restart++) {
    await stop(); await start();
    for (const item of cases) {
      if (JSON.stringify(await api(owner, '/teams/' + item.teamId + '/actions', 'POST', item.body)) !== JSON.stringify(item.receipt)) throw new Error('Original action receipt changed');
      const current = await api(member, '/teams/' + item.teamId);
      if (current.memberCount !== 2 || current.revision !== item.receipt.revision || current.status !== item.receipt.status) throw new Error('Activity status or membership changed');
      if (item.kind === 'TRANSFER') {
        if (current.captainUserId !== memberId || current.myMembership.role !== 'CAPTAIN' || current.myMembership.slotName !== item.membership.slotName) throw new Error('Captain or slot changed');
        await api(owner, '/teams/' + item.teamId + '/applications', 'GET', undefined, 404);
        await api(owner, '/teams/' + item.teamId + '/actions', 'POST', { kind: 'CANCEL', revision: current.revision, reason: '原队长不得管理。' }, 404);
        await api(member, '/teams/' + item.teamId + '/applications');
      } else {
        if (current.canLeave || current.canStart || current.canCancel || current.members.some(m => m.canTransfer || m.canRemove)) throw new Error('Terminal team editable');
        if (!current[item.kind === 'COMPLETE' ? 'completedAt' : 'cancelledAt'] || current.acceptingStatus !== 'CLOSED') throw new Error('Terminal timestamp or recruitment changed');
        if (item.startReceipt && current.startedAt !== item.startReceipt.changedAt) throw new Error('Start time changed');
        const pending = (await api(observer, '/me/applications?teamId=' + item.teamId))[0]; if (pending.id !== item.pending.id || pending.status !== 'EXPIRED') throw new Error('Pending expiry lost');
        await api(observer, '/teams/' + item.teamId, 'GET', undefined, 404);
        await api(owner, '/teams/' + item.teamId + '/actions', 'POST', { kind: 'START', revision: 1, reason: '确认开始活动。' }, 409);
      }
    }
    const notes = (await api(member, '/me/notifications')).items.filter(n => cases.some(item => item.teamId === n.teamId));
    if (notes.length !== notesBefore.length || new Set(notes.map(n => n.id)).size !== notesBefore.length) throw new Error('Notices duplicated or lost');
    if ((await api(member, '/me/notifications/' + note.id + '/read', 'POST', {})).readAt !== readAt || (await api(member, '/auth/me')).user?.id !== memberId) throw new Error('Read state or session changed');
    const expired = (await api(observer, '/me/notifications')).items.filter(n => cases.some(item => item.teamId === n.teamId));
    if (expired.length !== 2 || expired.some(n => n.kind !== 'APPLICATION_EXPIRED')) throw new Error('Expiry notices changed');
  }
  result = { passed: true, apiRestarts: 2, captainAndSlotsPersisted: true, formerCaptainAuthorityRevoked: true, activityStatesAndTimesPersisted: true, terminalTeamsReadOnly: true, pendingExpiryPersisted: true, oldOperationsNotReapplied: true, notificationsAndReadStatePersisted: true, sessionPersisted: true, databaseRestarted: false, checkedAt: new Date().toISOString() };
} finally {
  await stop();
  try {
    if (recruitmentIds.length && ownerId) await database.query('DELETE FROM "Recruitment" WHERE "id" = ANY($1::uuid[]) AND "authorId"=$2', [recruitmentIds, ownerId]);
    if (observerId) await database.query('DELETE FROM "User" WHERE "id"=$1', [observerId]);
  } finally { await database.end(); }
}
mkdirSync('.local', { recursive: true }); writeFileSync('.local/lifecycle-recovery-check.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
