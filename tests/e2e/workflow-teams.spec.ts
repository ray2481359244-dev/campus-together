import { test, expect, type Page, type APIResponse } from '@playwright/test';
import { existsSync } from 'node:fs';
import { RecruitmentDraftSchema } from '../../packages/contracts/src/recruitments';

const baseURL = 'http://127.0.0.1:3101';
async function register(page: Page, label: string) {
  await page.goto('/register'); await page.getByLabel('邮箱', { exact: true }).fill(`team-browser-${label}@campus.invalid`);
  await page.getByLabel('密码', { exact: true }).fill('TeamBrowser2026!'); await page.getByLabel('昵称', { exact: true }).fill('成员体验' + label);
  await page.getByRole('combobox', { name: '学校（自述）', exact: true }).selectOption({ label: '星原大学（虚构演示）' });
  await page.getByRole('button', { name: '创建账号，开始碰个头', exact: true }).click(); await expect(page).toHaveURL(/\/discover/);
}
async function respectWindow(response: APIResponse) {
  const limit = response.headers()['ratelimit'] || '', remaining = limit.match(/\br=(\d+)/), reset = limit.match(/\bt=(\d+)/);
  expect(remaining).not.toBeNull(); expect(reset).not.toBeNull();
  if (response.status() === 429 || Number(remaining![1]) < 30) { expect(Number(reset![1])).toBeLessThanOrEqual(60); await new Promise(resolve => setTimeout(resolve, (Number(reset![1]) + 1) * 1000)); }
}
test('members safely leave and are removed, then a captain closes recruitment without disbanding the team', async ({ browser }) => {
  // Covers one real shared-IP rate-limit window; the individual assertions retain 8 seconds.
  test.setTimeout(120000);
  const context = (name: string, width: number) => browser.newContext({ baseURL, viewport: { width, height: 1000 }, ...(existsSync(`.local/e2e-application-${name}.json`) ? { storageState: `.local/e2e-application-${name}.json` } : {}) });
  const owner = await context('owner', 1440), participant = await context('participant', 390), observer = await context('observer', 320);
  const a = await owner.newPage(), b = await participant.newPage(), c = await observer.newPage(), errors: string[] = [];
  let primaryFailure: unknown;
  for (const page of [a, b, c]) page.on('pageerror', error => errors.push(error.message));
  try {
    for (const [page, label] of [[a, 'owner'], [b, 'participant'], [c, 'observer']] as const) {
      if (!(await (await page.request.get('/api/v1/auth/me')).json()).data.user) await register(page, label); else await page.goto('/discover');
    }
    const session = async (page: Page) => (await (await page.request.get('/api/v1/auth/me')).json()).data;
    const ma = await session(a), mb = await session(b), mc = await session(c);
    expect(new Set([ma.user.id, mb.user.id, mc.user.id]).size).toBe(3);
    const headers = (me: typeof ma) => ({ Origin: baseURL, 'X-CSRF-Token': me.csrfToken, 'X-Session-User': me.user.id });
    const topicId = (await (await a.request.get('/api/v1/topics?category=COMPETITION')).json()).data[0].id;
    let first = true;
    async function createTeam(title: string) {
      const key = crypto.randomUUID(), at = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString();
      const draft = RecruitmentDraftSchema.parse({ topicId, title, description: '通过三个独立账号验证成员管理，明确协作时间和岗位，核对退出、移除及关闭招募的真实结果。', competitionName: '校园协作赛', direction: '校园应用', goal: '完成作品', collaboration: '周二周四晚间协作', startAt: at(24), endAt: at(48), joinDeadline: at(12), competitionDeadline: at(72), capacity: 3, slots: [{ key, name: '统筹', capacity: 1 }, { key: crypto.randomUUID(), name: '协作', capacity: 2 }], captainSlotKey: key });
      const data = { requestKey: crypto.randomUUID(), draft };
      let created = await a.request.post('/api/v1/recruitments', { headers: headers(ma), data });
      if (created.status() === 429) { await respectWindow(created); created = await a.request.post('/api/v1/recruitments', { headers: headers(ma), data }); }
      expect(created.status()).toBe(201); if (first) { first = false; await respectWindow(created); }
      const id = (await created.json()).data.id;
      const published = await a.request.post('/api/v1/recruitments/' + id + '/publish', { headers: headers(ma), data: { revision: 1 } }); expect(published.status()).toBe(201);
      return (await published.json()).data;
    }
    async function apply(page: Page, r: Awaited<ReturnType<typeof createTeam>>) {
      await page.goto('/recruitments/' + r.id); await page.getByLabel('申请岗位', { exact: true }).selectOption(r.team.slots[1].id);
      await page.getByLabel('本次时间确认', { exact: true }).selectOption('yes'); await page.getByLabel('申请说明', { exact: true }).fill('这是本次成员管理验收的真实申请。');
      await page.getByRole('button', { name: '核对申请条件', exact: true }).click(); await expect(page.getByRole('heading', { name: '核对结果：通过', exact: true })).toBeVisible();
      await page.getByRole('button', { name: '提交岗位申请', exact: true }).click(); await expect(page.getByLabel('已保存申请', { exact: true })).toContainText('申请状态：待审核');
      return (await (await page.request.get('/api/v1/me/applications?teamId=' + r.team.id)).json()).data[0];
    }
    const r = await createTeam('成员退出与移除浏览器验收');
    for (const page of [b, c]) { const row = await apply(page, r); expect((await page.request.get('/api/v1/teams/' + r.team.id)).status()).toBe(404); expect((await a.request.post('/api/v1/applications/' + row.id + '/review', { headers: headers(ma), data: { revision: row.revision, decision: 'APPROVE', reason: '欢迎参与成员管理验收。' } })).status()).toBe(200); }
    await b.goto('/me'); await b.getByRole('link', { name: '我的队伍 →', exact: true }).click();
    const mine = b.getByRole('region', { name: '我的队伍', exact: true });
    await mine.getByRole('link').filter({ hasText: r.title }).click();
    const detailB = b.getByRole('region', { name: '队伍详情', exact: true });
    await expect(detailB.getByRole('heading', { name: '当前 3 / 3 人', exact: true })).toBeVisible();
    await expect(detailB.getByRole('button', { name: '关闭招募', exact: true })).toHaveCount(0);
    await expect(detailB.getByRole('button', { name: '移除成员', exact: true })).toHaveCount(0);
    await c.goto('/teams/' + r.team.id); await expect(c.getByRole('region', { name: '队伍详情', exact: true })).toContainText(ma.user.nickname);
    await a.goto('/recruitments/' + r.id); await a.getByRole('link', { name: '查看队伍与成员管理 →', exact: true }).click();
    const detailA = a.getByRole('region', { name: '队伍详情', exact: true });
    await expect(detailA.getByRole('button', { name: '退出队伍', exact: true })).toHaveCount(0);
    for (const width of [320, 390, 768, 1440]) { await a.setViewportSize({ width, height: 1000 }); expect(await a.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1); await detailA.screenshot({ path: `.local/screenshots/i003-team-${width}.png` }); }
    const leaveBodies: unknown[] = [];
    await b.route('**/api/v1/teams/' + r.team.id + '/leave', async route => {
      leaveBodies.push(route.request().postDataJSON());
      if (leaveBodies.length === 1) { const response = await route.fetch(); expect(response.status()).toBe(200); await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_LEAVE_LOST', message: '验证用退出响应丢失' } }) }); }
      else if (leaveBodies.length === 2) await route.fulfill({ status: 400, contentType: 'text/html', body: 'Gateway unavailable' });
      else await route.continue();
    });
    await detailB.getByRole('button', { name: '退出队伍', exact: true }).click();
    const confirmB = b.getByRole('form', { name: '确认队伍操作', exact: true });
    await confirmB.getByRole('button', { name: '确认退出队伍', exact: true }).click(); await expect(confirmB.getByRole('alert')).toContainText('验证用退出响应丢失');
    await confirmB.getByRole('button', { name: '核对并重试操作', exact: true }).click(); await expect(confirmB.getByRole('alert')).toContainText('服务暂时不可用');
    await confirmB.getByRole('button', { name: '核对并重试操作', exact: true }).click(); await expect(b).toHaveURL(/\/teams$/); await expect(mine).toContainText('已退出队伍');
    expect(leaveBodies).toHaveLength(3); expect(leaveBodies[0]).toEqual(leaveBodies[1]); expect(leaveBodies[1]).toEqual(leaveBodies[2]);
    await expect(mine.getByRole('link').filter({ hasText: r.title })).toHaveCount(0);
    await b.goto('/teams/' + r.team.id); await expect(b.getByRole('alert')).toContainText('不是有效成员'); await expect(b.getByRole('region', { name: '队伍详情', exact: true })).toHaveCount(0);
    await a.getByRole('button', { name: '刷新并核对队伍', exact: true }).click(); await expect(detailA.getByRole('heading', { name: '当前 2 / 3 人', exact: true })).toBeVisible();
    const memberC = detailA.getByRole('article', { name: '队伍成员：' + mc.user.nickname, exact: true });
    await memberC.getByRole('button', { name: '移除成员', exact: true }).click(); const confirmA = a.getByRole('form', { name: '确认队伍操作', exact: true });
    await expect(confirmA.getByRole('button', { name: '确认移除成员', exact: true })).toBeDisabled(); await confirmA.getByLabel('移除原因', { exact: true }).fill('本轮分工调整，请在其他队伍继续协作。');
    await a.route('**/api/v1/teams/' + r.team.id + '/members/*/remove', async route => { const response = await route.fetch(); expect(response.status()).toBe(200); await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_REMOVE_LOST', message: '验证用移除响应丢失' } }) }); }, { times: 1 });
    await confirmA.getByRole('button', { name: '确认移除成员', exact: true }).click(); await expect(confirmA.getByRole('alert')).toContainText('验证用移除响应丢失'); await expect(confirmA.getByLabel('移除原因', { exact: true })).toBeDisabled();
    await confirmA.getByRole('button', { name: '核对并重试操作', exact: true }).click(); await expect(detailA.getByRole('status')).toContainText('成员已移除'); await expect(detailA.getByRole('heading', { name: '当前 1 / 3 人', exact: true })).toBeVisible();
    await c.getByRole('button', { name: '刷新并核对队伍', exact: true }).click(); await expect(c).toHaveURL(/\/teams$/); await expect(c.getByRole('region', { name: '我的队伍', exact: true })).toContainText('队内内容已收起');
    await c.goto('/messages'); const removed = c.locator('.notification-card').filter({ hasText: r.title }).filter({ hasText: '你已被移出这支队伍。' });
    await expect(removed).toContainText('本轮分工调整'); await removed.getByRole('button', { name: '标为已读', exact: true }).click(); await expect(removed).toContainText('已读');
    const next = await createTeam('关闭招募与申请失效浏览器验收'); await apply(b, next); await apply(c, next);
    await a.goto('/teams/' + next.team.id); await a.getByRole('button', { name: '关闭招募', exact: true }).click();
    await confirmA.getByLabel('关闭说明', { exact: true }).fill('本轮先暂停招人，现有队伍继续保留。');
    const closeBodies: unknown[] = [];
    await a.route('**/api/v1/teams/' + next.team.id + '/close-recruitment', async route => { closeBodies.push(route.request().postDataJSON()); if (closeBodies.length === 1) { const response = await route.fetch(); expect(response.status()).toBe(200); await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_CLOSE_LOST', message: '验证用关闭响应丢失' } }) }); } else await route.continue(); });
    await confirmA.getByRole('button', { name: '确认关闭招募', exact: true }).click(); await expect(confirmA.getByRole('alert')).toContainText('验证用关闭响应丢失'); await expect(confirmA.getByLabel('关闭说明', { exact: true })).toBeDisabled();
    await confirmA.getByRole('button', { name: '核对并重试操作', exact: true }).click(); await expect(a.getByRole('region', { name: '队伍详情', exact: true })).toContainText('现有队伍和成员继续保留');
    expect(closeBodies).toHaveLength(2); expect(closeBodies[0]).toEqual(closeBodies[1]); await expect(a.getByRole('button', { name: '关闭招募', exact: true })).toHaveCount(0);
    await a.reload(); await expect(a.getByRole('region', { name: '队伍详情', exact: true })).toContainText('招募已关闭');
    for (const page of [b, c]) { await page.getByRole('button', { name: '刷新并核对申请', exact: true }).click(); await expect(page.getByLabel('已保存申请', { exact: true })).toContainText('申请状态：已失效'); await expect(page.getByRole('button', { name: '提交岗位申请', exact: true })).toBeDisabled(); expect((await page.request.get('/api/v1/teams/' + next.team.id)).status()).toBe(404); await page.goto('/messages'); await expect(page.locator('.notification-card').filter({ hasText: next.title })).toContainText('招募已关闭，本次待审申请已失效。'); }
    await b.goto('/recruitments/' + r.id); await expect(b.getByLabel('已保存申请', { exact: true })).toContainText('当前已退出队伍'); await expect(b.getByRole('link', { name: '进入我的队伍 →', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  } catch (error) { primaryFailure = error; throw error; }
  finally {
    const cleanupErrors: unknown[] = [];
    for (const page of [a, b, c]) { try { await page.unrouteAll({ behavior: 'wait' }); } catch (error) { cleanupErrors.push(error); } }
    for (const context of [owner, participant, observer]) { try { await context.close(); } catch (error) { cleanupErrors.push(error); } }
    if (cleanupErrors.length && !primaryFailure) throw new AggregateError(cleanupErrors, 'Browser cleanup failed');
  }
});
