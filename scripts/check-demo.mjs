import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { Client } from 'pg';
import { captureDatabase } from './backup-core.mjs';
import { demoEnvironment } from './demo-core.mjs';

// This rehearsal creates a new owned demo DB and retains it; it never resets any DB.
const database = 'campus_demo_check_' + randomUUID().replaceAll('-', '').slice(0, 12);
const socket = createServer(); await new Promise(done => socket.listen(0, '127.0.0.1', done));
const port = socket.address().port; await new Promise(done => socket.close(done));
const input = { ...process.env, DEMO_DATABASE_NAME: database, DEMO_PORT: String(port) };
const plan = demoEnvironment(input), readyFile = resolve('.local/demo', plan.instance, 'ready.json');
const before = await captureDatabase(process.env.DATABASE_URL);
let child, browser, output = '', result;
const errors = [];
async function start(args = []) {
  output = '';
  child = spawn(process.execPath, ['scripts/demo.mjs', ...args], { env: input, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.on('data', bytes => { output = (output + bytes.toString()).slice(-60000); });
  child.stderr.on('data', bytes => { output = (output + bytes.toString()).slice(-60000); });
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Demo launcher exited before ready: ' + output.slice(-1500));
    if (output.includes('参赛本地演示已就绪') && existsSync(readyFile)) return;
    await new Promise(done => setTimeout(done, 200));
  }
  throw new Error('Demo startup timed out');
}
async function stop() {
  if (child && child.exitCode === null && child.signalCode === null) {
    const ended = once(child, 'exit'); child.send({ type: 'campus-demo-stop' }); await ended;
  }
}
async function command(args) {
  const run = spawn(process.execPath, ['scripts/demo.mjs', ...args], { env: input, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = ''; run.stdout.on('data', b => { text += b.toString(); }); run.stderr.on('data', b => { text += b.toString(); });
  const [code] = await once(run, 'exit'); assert.equal(code, 0, text.slice(-1200)); return text;
}
try {
  await start();
  const original = JSON.parse(readFileSync(readyFile, 'utf8'));
  assert.equal(original.recruitments.length, 4);
  assert.equal(original.realModelInvoked, false);
  assert.match(await command([]), /已经就绪/);
  browser = await chromium.launch(process.platform === 'win32' ? { channel: 'msedge' } : {});
  const contexts = [], pages = [];
  for (const [index, name] of ['river', 'lin', 'mei', 'admin'].entries()) {
    const context = await browser.newContext({ baseURL: plan.origin, viewport: { width: index === 1 || index === 3 ? 390 : 1440, height: 1000 } }); contexts.push(context);
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message)); pages.push(page);
    await page.goto('/login'); await page.getByLabel('邮箱', { exact: true }).fill(name + '@campus.invalid');
    await page.getByLabel('密码', { exact: true }).fill('DemoCampus2026!');
    await page.getByRole('button', { name: '登录', exact: true }).click(); await expect(page).toHaveURL(/\/discover/);
  }
  const [captain, participant, observer, admin] = pages;
  const competition = original.recruitments.find(r => r.category === 'COMPETITION');
  const study = original.recruitments.find(r => r.category === 'STUDY');
  const recruitment = (await (await captain.request.get('/api/v1/recruitments/' + competition.id)).json()).data;
  for (const row of original.recruitments) assert.equal((await captain.request.get('/api/v1/recruitments/' + row.id)).status(), 200);
  await participant.goto('/recruitments/' + competition.id);
  await participant.getByLabel('申请岗位', { exact: true }).selectOption(recruitment.team.slots.find(s => s.name === '前端开发').id);
  await participant.getByLabel('本次时间确认', { exact: true }).selectOption('yes');
  await participant.getByRole('button', { name: '核对申请条件', exact: true }).click();
  await expect(participant.getByRole('heading', { name: '核对结果：通过', exact: true })).toBeVisible();
  await participant.getByRole('button', { name: '提交岗位申请', exact: true }).click();
  await expect(participant.getByLabel('已保存申请', { exact: true })).toContainText('待审核');
  await captain.goto('/recruitments/' + competition.id);
  await captain.getByRole('button', { name: '批准入队', exact: true }).click();
  await captain.getByLabel('审核说明', { exact: true }).fill('本地参赛演练，确认前端分工。');
  await captain.getByRole('button', { name: '确认批准入队', exact: true }).click();
  await expect(captain.getByRole('status')).toContainText('已批准入队');
  await observer.goto('/teams/' + competition.teamId + '/chat');
  await expect(observer.getByRole('alert')).toContainText('有效成员');
  await admin.goto('/teams/' + competition.teamId + '/chat');
  await expect(admin.getByRole('alert')).toContainText('有效成员');
  await admin.goto('/admin'); await expect(admin.getByRole('button', { name: '审计记录', exact: true })).toBeVisible();
  await participant.goto('/teams/' + competition.teamId + '/chat');
  await captain.goto('/teams/' + competition.teamId + '/chat');
  const message = '本地演示确认分工，重启后继续保留。';
  await participant.getByLabel('消息内容', { exact: true }).fill(message);
  await participant.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(captain.getByLabel('已保存消息', { exact: true })).toContainText(message);
  await participant.goto('/recruitments/' + study.id);
  const studyDTO = (await (await participant.request.get('/api/v1/recruitments/' + study.id)).json()).data;
  await participant.getByLabel('申请岗位', { exact: true }).selectOption(studyDTO.team.slots[0].id);
  await participant.getByLabel('本次时间确认', { exact: true }).selectOption('yes');
  await participant.getByRole('button', { name: '核对申请条件', exact: true }).click();
  await participant.getByRole('button', { name: '确认直接加入', exact: true }).click();
  await expect(participant.getByText(/已入队 · 当前有效成员/)).toBeVisible();
  await captain.goto('/teams/' + competition.teamId);
  for (const action of ['开始', '结束']) {
    await captain.getByRole('button', { name: action + '活动', exact: true }).click();
    await captain.getByLabel('操作说明', { exact: true }).fill('本地参赛演练，确认本次活动状态。');
    await captain.getByRole('button', { name: '确认' + action + '活动', exact: true }).click();
    await expect(captain.getByRole('status')).toContainText(action + '活动已保存');
  }
  await participant.goto('/teams/' + competition.teamId + '/chat');
  await expect(participant.getByRole('region', { name: '队伍群聊', exact: true })).toContainText('群聊只读');
  await expect(participant.getByRole('button', { name: '发送消息', exact: true })).toHaveCount(0);
  for (const page of [captain, participant, admin]) assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  mkdirSync('.local/screenshots', { recursive: true });
  await participant.screenshot({ path: '.local/screenshots/local-demo-mobile.png', fullPage: true });
  await captain.screenshot({ path: '.local/screenshots/local-demo-desktop.png', fullPage: true });
  const databaseClient = new Client({ connectionString: plan.env.DATABASE_URL }); await databaseClient.connect();
  try {
    // An operator's edits must survive startup; only this rehearsal's owned fake user is changed.
    await databaseClient.query('UPDATE "Profile" SET "bio"=$1 WHERE "userId"=(SELECT "id" FROM "User" WHERE "email"=$2)', ['演练后保留的自述', 'lin@campus.invalid']);
    const hashes = async () => (await captureDatabase(plan.env.DATABASE_URL)).tables.map(t => ({ name: t.name, hash: t.hash }));
    const snapshot = await hashes();
    await stop(); await start(); assert.deepEqual(await hashes(), snapshot, 'Restart must not change existing data or refresh dates');
    await participant.reload(); await expect(participant.getByLabel('已保存消息', { exact: true })).toContainText(message);
    await expect(participant.getByRole('region', { name: '队伍群聊', exact: true })).toContainText('群聊只读');
    assert.equal(JSON.parse(readFileSync(readyFile, 'utf8')).sceneId, original.sceneId);
    await command(['--new-scene']); const renewed = JSON.parse(readFileSync(readyFile, 'utf8'));
    assert.notEqual(renewed.sceneId, original.sceneId);
    assert.ok(renewed.recruitments.every(r => r.status === 'OPEN' && Date.parse(r.joinDeadline) > Date.now()));
    assert.equal((await databaseClient.query('SELECT "status" FROM "Team" WHERE "id"=$1', [competition.teamId])).rows[0].status, 'COMPLETED');
    assert.equal((await databaseClient.query('SELECT "bio" FROM "Profile" WHERE "userId"=(SELECT "id" FROM "User" WHERE "email"=$1)', ['lin@campus.invalid'])).rows[0].bio, '演练后保留的自述');
    assert.equal((await databaseClient.query('SELECT count(*)::int AS count FROM "Recruitment"')).rows[0].count, 8);
    await stop(); await start(['--new-scene']);
    assert.notEqual(JSON.parse(readFileSync(readyFile, 'utf8')).sceneId, renewed.sceneId);
    assert.equal((await databaseClient.query('SELECT count(*)::int AS count FROM "Recruitment"')).rows[0].count, 12);
    assert.equal((await databaseClient.query('SELECT "status" FROM "Team" WHERE "id"=$1', [competition.teamId])).rows[0].status, 'COMPLETED');
  } finally { await databaseClient.end(); }
  for (const context of contexts) await context.close(); assert.deepEqual(errors, []);
  const after = await captureDatabase(process.env.DATABASE_URL);
  assert.deepEqual(after.tables.map(t => ({ name: t.name, hash: t.hash })), before.tables.map(t => ({ name: t.name, hash: t.hash })));
  result = { passed: true, isolatedDatabase: database, fictionalAccounts: 4, fourScenesVisible: true, applicationReviewAndChat: true, directJoin: true, outsiderAndAdminChatDenied: true, completedReadOnly: true, launcherRestartPreservedAllTables: true, newSceneKeptHistory: true, newSceneCanStartStoppedService: true, mainTablesUnchanged: before.tables.length, viewportWidths: [390, 1440], realModelInvoked: false, checkedAt: new Date().toISOString() };
} finally { if (browser) await browser.close(); await stop(); }
writeFileSync('.local/demo-check.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
