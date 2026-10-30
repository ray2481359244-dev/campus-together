import { test, expect, type Page, type APIResponse } from '@playwright/test';
import { existsSync } from 'node:fs';
import { RecruitmentDraftSchema } from '../../packages/contracts/src/recruitments';

const baseURL = 'http://127.0.0.1:3101';
async function register(page: Page, label: string) {
  await page.goto('/register');
  await page.getByLabel('邮箱', { exact: true }).fill(`review-browser-${label}@campus.invalid`);
  await page.getByLabel('密码', { exact: true }).fill('ReviewBrowser2026!');
  await page.getByLabel('昵称', { exact: true }).fill('审核体验' + label);
  await page.getByRole('combobox', { name: '学校（自述）', exact: true }).selectOption({ label: '星原大学（虚构演示）' });
  await page.getByRole('button', { name: '创建账号，开始碰个头', exact: true }).click();
  await expect(page).toHaveURL(/\/discover/);
}
async function respectWindow(response: APIResponse, budget: number) {
  const header = response.headers()['ratelimit'] || '', remaining = header.match(/\br=(\d+)/), reset = header.match(/\bt=(\d+)/);
  expect(remaining).not.toBeNull(); expect(reset).not.toBeNull();
  if (response.status() === 429 || Number(remaining![1]) < budget) {
    expect(Number(reset![1])).toBeLessThanOrEqual(60);
    await new Promise(resolve => setTimeout(resolve, (Number(reset![1]) + 1) * 1000));
  }
}
test('three accounts review, recover an uncertain approval, join once and read private persisted result notices', async ({ browser }) => {
  // Includes a possible real 60-second shared-IP write window; assertion timeouts stay unchanged.
  test.setTimeout(120000);
  const context = async (name: string, width: number) => browser.newContext({ baseURL, viewport: { width, height: 1000 }, ...(existsSync(`.local/e2e-application-${name}.json`) ? { storageState: `.local/e2e-application-${name}.json` } : {}) });
  const owner = await context('owner', 1440), participant = await context('participant', 390), outsider = await context('observer', 320);
  const a = await owner.newPage(), b = await participant.newPage(), c = await outsider.newPage(), errors: string[] = [];
  for (const page of [a, b, c]) page.on('pageerror', error => errors.push(error.message));
  try {
    for (const [page, label] of [[a, 'owner'], [b, 'participant'], [c, 'observer']] as const) {
      const me = (await (await page.request.get('/api/v1/auth/me')).json()).data;
      if (!me.user) await register(page, label);
      else await page.goto('/discover');
    }
    const me = async (page: Page) => (await (await page.request.get('/api/v1/auth/me')).json()).data;
    const ma = await me(a), mb = await me(b), mc = await me(c);
    expect(new Set([ma.user.id, mb.user.id, mc.user.id]).size).toBe(3);
    const headers = (session: typeof ma) => ({ Origin: baseURL, 'X-CSRF-Token': session.csrfToken, 'X-Session-User': session.user.id });
    const topicId = (await (await a.request.get('/api/v1/topics?category=COMPETITION')).json()).data[0].id;
    const captain = crypto.randomUUID(), at = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString();
    const draft = RecruitmentDraftSchema.parse({ topicId, title: '队长审核与结果通知浏览器验收', description: '通过真实的提交、批准和拒绝验证竞赛组队流程，明确岗位和协作时间，并保存各自的审核结果。', competitionName: '校园协作赛', direction: '应用开发', goal: '完成作品', collaboration: '周二周四晚间协作', startAt: at(24), endAt: at(48), joinDeadline: at(12), competitionDeadline: at(72), capacity: 2, slots: [{ key: captain, name: '统筹', capacity: 1 }, { key: crypto.randomUUID(), name: '界面开发', capacity: 1, requiredSkills: ['React'] }], captainSlotKey: captain });
    const create = { requestKey: crypto.randomUUID(), draft };
    let created = await a.request.post('/api/v1/recruitments', { headers: headers(ma), data: create });
    if (created.status() === 429) { await respectWindow(created, 20); created = await a.request.post('/api/v1/recruitments', { headers: headers(ma), data: create }); }
    expect(created.status()).toBe(201); await respectWindow(created, 20);
    const id = (await created.json()).data.id;
    const published = await a.request.post('/api/v1/recruitments/' + id + '/publish', { headers: headers(ma), data: { revision: 1 } });
    expect(published.status()).toBe(201);
    const r = (await published.json()).data, path = '/recruitments/' + id;
    for (const [page, session, message] of [[b, mb, '乙的私有申请说明：希望负责界面。'], [c, mc, '丙的私有申请说明：愿意协作。']] as const) {
      const profile = { nickname: session.user.nickname, schoolId: session.user.school.id, bio: '', grade: '', skills: ['React'], interests: [] };
      expect((await page.request.patch('/api/v1/me/profile', { headers: headers(session), data: profile })).status()).toBe(200);
      await page.goto(path);
      await page.getByLabel('申请岗位', { exact: true }).selectOption(r.team.slots[1].id);
      await page.getByLabel('本次时间确认', { exact: true }).selectOption('yes');
      await page.getByLabel('申请说明', { exact: true }).fill(message);
      await page.getByRole('button', { name: '核对申请条件', exact: true }).click();
      await expect(page.getByRole('heading', { name: '核对结果：通过', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '提交岗位申请', exact: true }).click();
      await expect(page.getByLabel('已保存申请', { exact: true })).toContainText('申请状态：待审核');
    }
    const rowB = (await (await b.request.get('/api/v1/me/applications?teamId=' + r.team.id)).json()).data[0];
    expect((await c.request.get('/api/v1/teams/' + r.team.id + '/applications')).status()).toBe(404);
    expect((await c.request.post('/api/v1/applications/' + rowB.id + '/review', { headers: headers(mc), data: { revision: 1, decision: 'APPROVE' } })).status()).toBe(404);
    await expect(c.getByRole('region', { name: '队长申请管理', exact: true })).toHaveCount(0);
    await expect(c.getByLabel('已保存申请', { exact: true })).not.toContainText('乙的私有申请说明');
    await a.route('**/api/v1/teams/' + r.team.id + '/applications?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_REVIEW_LIST', message: '验证用队长列表读取失败' } }) }), { times: 1 });
    await a.goto('/recruitments');
    const mine = a.getByRole('region', { name: '我发起的招募', exact: true });
    await mine.locator('summary').click(); await mine.getByRole('link').filter({ hasText: draft.title }).click();
    await expect(a.getByRole('alert')).toContainText('验证用队长列表读取失败');
    await a.getByRole('button', { name: '重新加载', exact: true }).click();
    const panel = a.getByRole('region', { name: '队长申请管理', exact: true });
    const bCard = panel.getByRole('article', { name: '岗位申请：' + mb.user.nickname, exact: true });
    const cCard = panel.getByRole('article', { name: '岗位申请：' + mc.user.nickname, exact: true });
    await expect(bCard).toContainText('乙的私有申请说明');
    await bCard.locator('summary').click(); await expect(bCard).toContainText('资料中的自述技能覆盖该岗位标签');
    for (const width of [320, 390, 1440]) {
      await a.setViewportSize({ width, height: 1000 });
      expect(await a.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
      await panel.screenshot({ path: `.local/screenshots/i002-captain-${width}.png` });
    }
    await bCard.getByRole('button', { name: '批准入队', exact: true }).click();
    const confirm = panel.getByRole('form', { name: '确认审核申请', exact: true });
    await confirm.getByLabel('审核说明', { exact: true }).fill('欢迎加入，请一起承担界面开发。');
    const bodies: unknown[] = [];
    await a.route('**/api/v1/applications/' + rowB.id + '/review', async route => {
      bodies.push(route.request().postDataJSON());
      if (bodies.length === 1) { const response = await route.fetch(); expect(response.status()).toBe(200); await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_REVIEW_LOST', message: '验证用批准响应丢失' } }) }); }
      else if (bodies.length === 2) await route.fulfill({ status: 400, contentType: 'text/html', body: 'Gateway unavailable' });
      else await route.continue();
    });
    await confirm.getByRole('button', { name: '确认批准入队', exact: true }).click();
    await expect(confirm.getByRole('alert')).toContainText('验证用批准响应丢失');
    await expect(confirm.getByLabel('审核说明', { exact: true })).toBeDisabled();
    await expect(confirm.getByLabel('审核说明', { exact: true })).toHaveValue('欢迎加入，请一起承担界面开发。');
    await confirm.getByRole('button', { name: '核对并重试审核', exact: true }).click();
    await expect(confirm.getByRole('alert')).toContainText('服务暂时不可用');
    await confirm.getByRole('button', { name: '核对并重试审核', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('已批准入队');
    expect(bodies).toHaveLength(3); expect(bodies[0]).toEqual(bodies[1]); expect(bodies[1]).toEqual(bodies[2]);
    await a.unrouteAll({ behavior: 'wait' });
    await expect(a.getByText('当前 2 / 2 人，总人数包含队长。每位成员只占一个岗位。', { exact: true })).toBeVisible();
    await cCard.getByRole('button', { name: '拒绝申请', exact: true }).click();
    await confirm.getByLabel('审核说明', { exact: true }).fill('本轮名额已满，感谢你的申请。');
    await confirm.getByRole('button', { name: '确认拒绝申请', exact: true }).click();
    await expect(panel.getByRole('status')).toContainText('已拒绝申请');
    await panel.getByRole('button', { name: '全部申请', exact: true }).click();
    await expect(bCard).toContainText('已批准'); await expect(cCard).toContainText('已拒绝');
    await b.getByRole('button', { name: '刷新并核对申请', exact: true }).click();
    await expect(b.getByRole('status').filter({hasText:'已入队 · 当前有效成员'})).toContainText('已入队 · 当前有效成员');
    await expect(b.getByLabel('已保存申请', { exact: true })).toContainText('欢迎加入，请一起承担界面开发。');
    await expect(b.getByRole('button', { name: '撤回申请', exact: true })).toHaveCount(0);
    await expect(b.getByText('当前 2 / 2 人，总人数包含队长。每位成员只占一个岗位。', { exact: true })).toBeVisible();
    await b.reload(); await expect(b.getByRole('status').filter({hasText:'已入队 · 当前有效成员'})).toContainText('已入队 · 当前有效成员');
    await c.reload(); await expect(c.getByLabel('已保存申请', { exact: true })).toContainText('申请状态：已拒绝');
    await expect(c.getByLabel('已保存申请', { exact: true })).toContainText('本轮名额已满');
    await expect(c.getByRole('button', { name: '提交岗位申请', exact: true })).toBeDisabled();
    await b.getByRole('link', { name: '查看结果通知 →', exact: true }).click();
    const inbox = b.getByRole('region', { name: '站内通知', exact: true });
    await expect(inbox).toContainText('申请已通过，已加入队伍。');
    await expect(inbox).toContainText('未读 1');
    for (const width of [320, 390, 1440]) {
      await b.setViewportSize({ width, height: 1000 });
      expect(await b.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
      await inbox.screenshot({ path: `.local/screenshots/i002-notifications-${width}.png` });
    }
    const notification = (await (await b.request.get('/api/v1/me/notifications')).json()).data.items[0];
    expect((await c.request.post('/api/v1/me/notifications/' + notification.id + '/read', { headers: headers(mc), data: {} })).status()).toBe(404);
    await b.route('**/api/v1/me/notifications/' + notification.id + '/read', async route => { const response = await route.fetch(); expect(response.status()).toBe(200); await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_READ_LOST', message: '验证用已读响应丢失' } }) }); }, { times: 1 });
    await inbox.getByRole('button', { name: '标为已读', exact: true }).click();
    await expect(inbox.getByRole('alert')).toContainText('验证用已读响应丢失');
    await inbox.getByRole('button', { name: '标为已读', exact: true }).click();
    await expect(inbox).toContainText('未读 0');
    await b.reload(); await expect(inbox).toContainText('未读 0');
    await inbox.getByRole('link', { name: '查看招募与申请 →', exact: true }).click();
    await expect(b.getByRole('status').filter({hasText:'已入队 · 当前有效成员'})).toContainText('已入队 · 当前有效成员');
    await c.goto('/messages'); await expect(c.getByRole('region', { name: '站内通知', exact: true })).toContainText('本次岗位申请未通过。');
    await expect(c.getByRole('region', { name: '站内通知', exact: true })).not.toContainText('欢迎加入，请一起承担界面开发。');
    expect(errors).toEqual([]);
  } finally { await owner.close(); await participant.close(); await outsider.close(); }
});
