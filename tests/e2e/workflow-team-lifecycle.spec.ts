import { test, expect, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { RecruitmentDraftSchema } from '../../packages/contracts/src/recruitments';

test('captain transfer survives lost responses, new captain starts and completes, and cancellation preserves read-only teams', async ({ browser }) => {
  test.setTimeout(120000); // Includes at most one real shared-IP write-window reset.
  const baseURL = 'http://127.0.0.1:3101';
  const context = (name: string, width: number) => browser.newContext({ baseURL, viewport: { width, height: 1000 }, ...(existsSync(`.local/e2e-application-${name}.json`) ? { storageState: `.local/e2e-application-${name}.json` } : {}) });
  const owner = await context('owner', 1440), participant = await context('participant', 390), observer = await context('observer', 320);
  const a = await owner.newPage(), b = await participant.newPage(), c = await observer.newPage(), errors: string[] = [];
  let primaryFailure: unknown;
  for (const page of [a, b, c]) page.on('pageerror', error => errors.push(error.message));
  try {
    for (const [page, name] of [[a, 'owner'], [b, 'participant'], [c, 'observer']] as const) {
      if (!(await (await page.request.get('/api/v1/auth/me')).json()).data.user) {
        await page.goto('/register'); await page.getByLabel('邮箱', { exact: true }).fill(`lifecycle-${name}@campus.invalid`);
        await page.getByLabel('密码', { exact: true }).fill('LifecycleBrowser2026!'); await page.getByLabel('昵称', { exact: true }).fill('活动体验' + name);
        await page.getByRole('combobox', { name: '学校（自述）', exact: true }).selectOption({ label: '星原大学（虚构演示）' });
        await page.getByRole('button', { name: '创建账号，开始碰个头', exact: true }).click(); await expect(page).toHaveURL(/\/discover/);
      }
    }
    const me = async (page: Page) => (await (await page.request.get('/api/v1/auth/me')).json()).data;
    const ma = await me(a), mb = await me(b), mc = await me(c);
    expect(new Set([ma.user.id, mb.user.id, mc.user.id]).size).toBe(3);
    const headers = (session: typeof ma) => ({ Origin: baseURL, 'X-CSRF-Token': session.csrfToken, 'X-Session-User': session.user.id });
    const topicId = (await (await a.request.get('/api/v1/topics?category=COMPETITION')).json()).data[0].id;
    let first = true;
    async function createTeam(title: string) {
      const key = crypto.randomUUID(), at = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
      const draft = RecruitmentDraftSchema.parse({ topicId, title, description: '通过独立账号验证队长交接、活动状态与通知，保留明确时间和岗位，所有内容仅用于自动化验收。', competitionName: '校园协作赛', direction: '校园应用', goal: '完成作品', collaboration: '周二周四晚间协作', startAt: at(24), endAt: at(48), joinDeadline: at(12), competitionDeadline: at(72), capacity: 3, slots: [{ key, name: '统筹', capacity: 1 }, { key: crypto.randomUUID(), name: '协作', capacity: 2 }], captainSlotKey: key });
      const data = { requestKey: crypto.randomUUID(), draft };
      let response = await a.request.post('/api/v1/recruitments', { headers: headers(ma), data });
      const limit = response.headers()['ratelimit'] || '', remaining = limit.match(/\br=(\d+)/), reset = limit.match(/\bt=(\d+)/);
      expect(remaining).not.toBeNull(); expect(reset).not.toBeNull();
      if (first && (response.status() === 429 || Number(remaining![1]) < 24)) {
        expect(Number(reset![1])).toBeLessThanOrEqual(60); await new Promise(resolve => setTimeout(resolve, (Number(reset![1]) + 1) * 1000));
        if (response.status() === 429) response = await a.request.post('/api/v1/recruitments', { headers: headers(ma), data });
      }
      first = false; expect(response.status()).toBe(201);
      const id = (await response.json()).data.id, published = await a.request.post('/api/v1/recruitments/' + id + '/publish', { headers: headers(ma), data: { revision: 1 } });
      expect(published.status()).toBe(201); return (await published.json()).data;
    }
    async function apply(page: Page, session: typeof ma, r: Awaited<ReturnType<typeof createTeam>>) {
      const response = await page.request.post('/api/v1/teams/' + r.team.id + '/applications', { headers: headers(session), data: { requestKey: crypto.randomUUID(), slotId: r.team.slots[1].id, timeConfirmed: true, message: '本次活动管理验收申请。' } });
      expect(response.status()).toBe(201); return (await response.json()).data;
    }
    const r = await createTeam('队长交接与活动完成浏览器验收'), joined = await apply(b, mb, r), pending = await apply(c, mc, r);
    expect((await a.request.post('/api/v1/applications/' + joined.id + '/review', { headers: headers(ma), data: { revision: 1, decision: 'APPROVE', reason: '欢迎协作。' } })).status()).toBe(200);
    await a.goto('/teams/' + r.team.id); await b.goto('/teams/' + r.team.id);
    const detailA = a.getByRole('region', { name: '队伍详情', exact: true }), detailB = b.getByRole('region', { name: '队伍详情', exact: true });
    const formA = a.getByRole('form', { name: '确认队伍操作', exact: true }), formB = b.getByRole('form', { name: '确认队伍操作', exact: true });
    await detailA.getByRole('article', { name: '队伍成员：' + mb.user.nickname, exact: true }).getByRole('button', { name: '转交队长', exact: true }).click();
    await expect(formA).toContainText('双方岗位不变'); await formA.getByLabel('操作说明', { exact: true }).fill('交由协作成员接任本轮负责人。');
    const bodies: unknown[] = [];
    await a.route('**/api/v1/teams/' + r.team.id + '/actions', async route => {
      bodies.push(route.request().postDataJSON());
      if (bodies.length === 1) { const response = await route.fetch(); expect(response.status()).toBe(200); await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_TRANSFER_LOST', message: '验证用转交响应丢失' } }) }); }
      else if (bodies.length === 2) await route.fulfill({ status: 400, contentType: 'text/html', body: 'Gateway unavailable' });
      else await route.continue();
    });
    await formA.getByRole('button', { name: '确认转交队长', exact: true }).click(); await expect(formA.getByRole('alert')).toContainText('验证用转交响应丢失'); await expect(formA.getByLabel('操作说明', { exact: true })).toBeDisabled();
    await formA.getByRole('button', { name: '核对并重试操作', exact: true }).click(); await expect(formA.getByRole('alert')).toContainText('服务暂时不可用');
    await formA.getByRole('button', { name: '核对并重试操作', exact: true }).click(); await expect(detailA).toContainText('我的身份：成员 · 岗位：统筹');
    expect(bodies).toHaveLength(3); expect(bodies[0]).toEqual(bodies[1]); expect(bodies[1]).toEqual(bodies[2]);
    await expect(detailA.getByRole('button', { name: '开始活动', exact: true })).toHaveCount(0);
    expect((await a.request.get('/api/v1/teams/' + r.team.id + '/applications')).status()).toBe(404);
    await detailB.getByRole('button', { name: '刷新并核对队伍', exact: true }).click(); await expect(detailB).toContainText('我的身份：队长 · 岗位：协作');
    expect((await b.request.get('/api/v1/teams/' + r.team.id + '/applications')).status()).toBe(200);
    await detailB.getByRole('button', { name: '开始活动', exact: true }).click(); await expect(formB.getByRole('button', { name: '确认开始活动', exact: true })).toBeDisabled();
    await formB.getByLabel('操作说明', { exact: true }).fill('两名成员确认开始本次活动。'); await formB.getByRole('button', { name: '确认开始活动', exact: true }).click();
    await expect(detailB).toContainText('活动进行中'); await expect(detailB.getByRole('button', { name: '关闭招募', exact: true })).toHaveCount(0);
    expect((await (await c.request.get('/api/v1/me/applications?teamId=' + r.team.id)).json()).data[0]).toMatchObject({ id: pending.id, status: 'EXPIRED' });
    await c.goto('/messages'); await expect(c.locator('.notification-card').filter({ hasText: r.title })).toContainText('本次待审申请已失效');
    await detailB.getByRole('button', { name: '结束活动', exact: true }).click(); await formB.getByLabel('操作说明', { exact: true }).fill('本轮任务已完成，保留队伍记录。');
    await b.route('**/api/v1/teams/' + r.team.id + '/actions', async route => { const response = await route.fetch(); expect(response.status()).toBe(200); await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_COMPLETE_LOST', message: '验证用结束响应丢失' } }) }); }, { times: 1 });
    await formB.getByRole('button', { name: '确认结束活动', exact: true }).click(); await expect(formB.getByRole('alert')).toContainText('验证用结束响应丢失');
    await formB.getByRole('button', { name: '核对并重试操作', exact: true }).click(); await expect(detailB).toContainText('活动已结束 · 队伍信息只读');
    for (const page of [a, b]) {
      await page.reload(); const detail = page.getByRole('region', { name: '队伍详情', exact: true }); await expect(detail).toContainText('活动已结束 · 队伍信息只读');
      for (const name of ['转交队长', '退出队伍', '移除成员', '开始活动', '结束活动', '取消活动', '关闭招募']) await expect(detail.getByRole('button', { name, exact: true })).toHaveCount(0);
    }
    for (const width of [320, 390, 768, 1440]) { await b.setViewportSize({ width, height: 1000 }); expect(await b.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1); await detailB.screenshot({ path: `.local/screenshots/i004-completed-${width}.png` }); }
    await b.goto('/messages'); const completion = b.locator('.notification-card').filter({ hasText: r.title }).filter({ hasText: '活动已结束' });
    await completion.getByRole('button', { name: '标为已读', exact: true }).click(); await expect(completion).toContainText('已读');
    const next = await createTeam('活动取消浏览器验收'); await apply(b, mb, next); await a.goto('/teams/' + next.team.id);
    await detailA.getByRole('button', { name: '取消活动', exact: true }).click(); await formA.getByLabel('操作说明', { exact: true }).fill('安排有变，本轮取消，之后重新发起。'); await formA.getByRole('button', { name: '确认取消活动', exact: true }).click();
    await expect(detailA).toContainText('活动已取消 · 队伍信息只读'); await a.reload(); await expect(detailA).toContainText('活动已取消 · 队伍信息只读');
    await b.goto('/messages'); await expect(b.locator('.notification-card').filter({ hasText: next.title })).toContainText('本次待审申请已失效');
    expect(errors).toEqual([]);
  } catch (error) { primaryFailure = error; throw error; }
  finally {
    const cleanupErrors: unknown[] = [];
    for (const page of [a, b, c]) { try { await page.unrouteAll({ behavior: 'wait' }); } catch (error) { cleanupErrors.push(error); } }
    for (const context of [owner, participant, observer]) { try { await context.close(); } catch (error) { cleanupErrors.push(error); } }
    if (cleanupErrors.length && !primaryFailure) throw new AggregateError(cleanupErrors, 'Browser cleanup failed');
  }
});
