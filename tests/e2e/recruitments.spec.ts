import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { RecruitmentDTO } from '@campus/contracts';

async function register(page: Page, email: string, nickname: string) {
  await page.goto('/register');
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill('RecruitmentBrowser2026!');
  await page.getByLabel('昵称', { exact: true }).fill(nickname);
  await page.getByRole('combobox', { name: '学校（自述）', exact: true }).selectOption({ label: '星原大学（虚构演示）' });
  await page.getByRole('button', { name: '创建账号，开始碰个头' }).click();
  await expect(page).toHaveURL(/\/discover/);
}
const localTime = (hours: number) => new Date(Date.now() + (hours + 8) * 3600_000).toISOString().slice(0, 16);
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(await page.evaluate(() => innerWidth + 1)); }

test('an author converts a discussion, resumes a draft and safely retries a committed publication', async ({ browser }) => {
  const owner = await browser.newContext({ baseURL: 'http://127.0.0.1:3101', viewport: { width: 390, height: 1000 } });
  const observer = await browser.newContext({ baseURL: 'http://127.0.0.1:3101', viewport: { width: 1440, height: 1000 } });
  const a = await owner.newPage(), b = await observer.newPage(), errors: string[] = [];
  a.on('pageerror', e => errors.push(e.message)); b.on('pageerror', e => errors.push(e.message));
  const title = '一起做校园应用的竞赛队伍';
  try {
    await register(a, 'recruitment-owner@campus.invalid', '招募队长');
    await register(b, 'recruitment-viewer@campus.invalid', '招募旁观');
    await a.goto('/publish?category=COMPETITION');
    await a.getByLabel('标题', { exact: true }).fill(title);
    await a.getByLabel('正文', { exact: true }).fill('希望一起完成真实可用的校园应用，尊重各自时间，明确岗位分工并定期沟通。');
    await a.getByRole('button', { name: '发布讨论', exact: true }).click();
    await expect(a.getByRole('heading', { name: title, exact: true })).toBeVisible();
    const sourceUrl = a.url();
    await a.getByRole('link', { name: '从讨论发起招募', exact: true }).click();
    await expect(a.getByLabel('招募标题', { exact: true })).toHaveValue(title);
    let releaseSource!: () => void;
    const sourceGate = new Promise<void>(resolve => { releaseSource = resolve; });
    await a.route('**/api/v1/posts/' + new URL(sourceUrl).pathname.split('/').at(-1), async route => {
      await sourceGate;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_SOURCE_FAILURE', message: '验证用来源讨论读取失败' } }) });
    });
    await a.reload();
    await expect(a.getByRole('status')).toContainText('正在读取招募草稿');
    releaseSource();
    await expect(a.getByRole('alert')).toContainText('验证用来源讨论读取失败');
    await a.unrouteAll({ behavior: 'wait' });
    await a.getByRole('button', { name: '重新加载', exact: true }).click();
    await expect(a.getByLabel('招募标题', { exact: true })).toHaveValue(title);
    await a.getByRole('button', { name: '保存私有草稿', exact: true }).click();
    await expect(a).toHaveURL(/\/recruitments\/[a-f0-9-]+\/edit$/);
    const editUrl = a.url(), id = editUrl.split('/').at(-2)!;
    await a.reload(); await expect(a.getByLabel('招募标题', { exact: true })).toHaveValue(title);
    await b.goto('/recruitments/' + id);
    await expect(b.getByRole('alert')).toContainText('尚未公开');
    await b.goto('/recruitments/' + id + '/edit');
    await expect(b.getByRole('alert')).toContainText('尚未公开');
    await expect(b.getByLabel('招募标题', { exact: true })).toHaveCount(0);
    await b.goto('/recruitments');
    await expect(b.locator('.recruitment-grid')).toHaveCount(0);
    await a.getByLabel('比赛名称', { exact: true }).fill('校园应用创新赛');
    await a.getByLabel('项目方向', { exact: true }).fill('校园兴趣社区与协作');
    await a.getByLabel('本次目标', { exact: true }).fill('完成可以演示的作品');
    await a.getByLabel('协作时段说明', { exact: true }).fill('周二和周四 19:00—21:00，按北京时间协作。');
    await a.getByLabel('协作开始时间', { exact: true }).fill(localTime(24));
    await a.getByLabel('协作结束时间', { exact: true }).fill(localTime(48));
    await a.getByLabel('招募截止时间（可选）', { exact: true }).fill(localTime(12));
    await a.getByLabel('比赛截止时间', { exact: true }).fill(localTime(72));
    await a.getByLabel('岗位 2 所需技能', { exact: true }).fill('React');
    await a.getByLabel('岗位 2 所需技能', { exact: true }).pressSequentially(',');
    await expect(a.getByLabel('岗位 2 所需技能', { exact: true })).toHaveValue('React,');
    await a.getByLabel('岗位 2 所需技能', { exact: true }).pressSequentially('design');
    await a.getByLabel('队伍总人数（含队长）', { exact: true }).fill('4');
    await a.getByRole('button', { name: '预览并发布', exact: true }).click();
    await expect(a.getByRole('alert')).toContainText('岗位人数之和必须等于总人数');
    await a.getByLabel('队伍总人数（含队长）', { exact: true }).fill('3');
    await a.setViewportSize({ width: 320, height: 1000 }); await noOverflow(a);
    await a.screenshot({ path: '.local/screenshots/recruitment-form-320.png', fullPage: true });
    await a.setViewportSize({ width: 390, height: 1000 });
    await a.getByRole('button', { name: '预览并发布', exact: true }).click();
    await expect(a.getByRole('heading', { name: '确认这份招募。' })).toBeVisible();
    const staleEditor = await owner.newPage();
    await staleEditor.goto(editUrl);
    await staleEditor.getByLabel('招募标题', { exact: true }).fill('另一标签页发布后仍保留的未提交草稿');
    await staleEditor.clock.install(); await staleEditor.clock.fastForward(21_000);
    await a.bringToFront();
    // The database commits normally; only delivery of the success response is lost.
    await a.route('**/api/v1/recruitments/' + id + '/publish', async route => {
      const committed = await route.fetch();
      expect(committed.status()).toBe(201);
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_LOST_RESPONSE', message: '验证用响应丢失，请重试。' } }) });
    }, { times: 1 });
    await a.getByRole('button', { name: '确认发布招募', exact: true }).click();
    await expect(a.getByRole('alert')).toContainText('验证用响应丢失');
    await expect(a.getByRole('heading', { name: '确认这份招募。' })).toBeVisible();
    await a.getByRole('button', { name: '确认发布招募', exact: true }).click();
    await expect(a).toHaveURL(new RegExp('/recruitments/' + id + '$'));
    const publishedRead = staleEditor.waitForResponse(r => r.url().endsWith('/api/v1/recruitments/' + id) && r.request().method() === 'GET');
    await staleEditor.bringToFront();
    await staleEditor.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    expect((await publishedRead).status()).toBe(200);
    await expect(staleEditor.getByLabel('招募标题', { exact: true })).toHaveValue('另一标签页发布后仍保留的未提交草稿');
    await expect(staleEditor.getByRole('button', { name: '保存私有草稿', exact: true })).toBeDisabled();
    await expect(staleEditor.getByRole('link', { name: '查看已发布招募', exact: true })).toHaveAttribute('href', '/recruitments/' + id);
    await staleEditor.close(); await a.bringToFront();
    await expect(a.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(a.getByText('当前 1 / 3 人，总人数包含队长。每位成员只占一个岗位。', { exact: true })).toBeVisible();
    await expect(a.locator('.slot-summary').first()).toContainText('1 / 1 已占');
    await expect(a.getByRole('link', { name: '查看来源讨论', exact: true })).toHaveAttribute('href', new URL(sourceUrl).pathname);
    await a.reload(); await expect(a.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await a.screenshot({ path: '.local/screenshots/recruitment-detail-390.png', fullPage: true });
    await b.goto(a.url()); await expect(b.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(b.getByRole('link', { name: /继续编辑/ })).toHaveCount(0);
    await expect(b.getByRole('button', { name: /加入|申请|群聊/ })).toHaveCount(0);
    await noOverflow(b); await b.screenshot({ path: '.local/screenshots/recruitment-detail-1440.png', fullPage: true });
    await b.goto('/recruitments');
    await expect(b.locator('.recruitment-grid')).toContainText(title);
    await b.getByLabel('浏览学校', { exact: true }).selectOption({ label: '青禾学院（虚构演示）' });
    await expect(b.getByRole('heading', { name: '第一支队伍，等你发起' })).toBeVisible();
    await a.goto(sourceUrl);
    await a.getByRole('button', { name: '删除讨论', exact: true }).click();
    await a.getByRole('button', { name: '确认删除', exact: true }).click();
    await b.goto('/recruitments/' + id);
    await expect(b.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(b.getByText('来源讨论已不可用；这份已发布招募仍独立保留。', { exact: true })).toBeVisible();
    await expect(b.getByRole('link', { name: '查看来源讨论', exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await owner.close(); await observer.close(); }
});

test('failed draft writes preserve input, can retry, and saved drafts can be deleted', async ({ page, context }) => {
  await register(page, 'draft-retry@campus.invalid', '草稿体验');
  await page.goto('/recruitments/new');
  await page.getByLabel('招募标题', { exact: true }).fill('失败后输入仍保留的私有草稿');
  await page.route('**/api/v1/recruitments', async route => {
    if (route.request().method() === 'POST') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_STORAGE_FAILURE', message: '验证用存储中断，请重试。' } }) });
    else await route.continue();
  });
  await page.getByRole('button', { name: '保存私有草稿', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('验证用存储中断');
  await expect(page.getByLabel('招募标题', { exact: true })).toHaveValue('失败后输入仍保留的私有草稿');
  await page.unrouteAll({ behavior: 'wait' });
  await page.getByRole('button', { name: '保存私有草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/recruitments\/[a-f0-9-]+\/edit$/);
  const editUrl = page.url(), id = editUrl.split('/').at(-2)!;
  const localTitle = '后台读取失败时仍须保留的草稿标题';
  await expect(page.getByLabel('招募标题', { exact: true })).toHaveValue('失败后输入仍保留的私有草稿');
  await page.getByLabel('招募标题', { exact: true }).fill(localTitle);
  const other = await context.newPage();
  await other.goto(editUrl);
  await other.getByLabel('招募标题', { exact: true }).fill('另一个标签页已经保存的草稿标题');
  await other.getByRole('button', { name: '保存私有草稿', exact: true }).click();
  await expect(other.getByRole('status')).toContainText('草稿已保存到数据库');
  await other.close(); await page.bringToFront();
  await page.route('**/api/v1/recruitments/' + id, async route => {
    if (route.request().method() === 'GET') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_READ_FAILURE', message: '验证用草稿读取中断' } }) });
    else await route.continue();
  });
  await page.clock.install(); await page.clock.fastForward(21_000);
  const background = page.waitForResponse(r => r.url().endsWith('/api/v1/recruitments/' + id) && r.request().method() === 'GET');
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  expect((await background).status()).toBe(503);
  await expect(page.getByRole('alert')).toContainText('验证用草稿读取中断');
  await expect(page.getByLabel('招募标题', { exact: true })).toHaveValue(localTitle);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 }); await noOverflow(page);
    await page.getByLabel('招募标题', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.local/screenshots/w106-draft-recovery-${width}.png` });
  }
  await page.clock.resume();
  await page.unrouteAll({ behavior: 'wait' });
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('招募标题', { exact: true })).toHaveValue(localTitle);
  await expect(page.getByRole('status').filter({ hasText: '草稿已在其他页面更新' })).toBeVisible();
  const conflict = page.waitForResponse(r => r.url().endsWith('/api/v1/recruitments/' + id) && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: '保存私有草稿', exact: true }).click();
  expect((await conflict).status()).toBe(409);
  await expect(page.getByRole('alert')).toContainText('草稿已有更新');
  await expect(page.getByLabel('招募标题', { exact: true })).toHaveValue(localTitle);
  // Explicit full reload follows manually retaining the local title; no automatic merge/rebase.
  await page.reload();
  await expect(page.getByLabel('招募标题', { exact: true })).toHaveValue('另一个标签页已经保存的草稿标题');
  await page.getByLabel('招募标题', { exact: true }).fill(localTitle);
  await page.getByRole('button', { name: '保存私有草稿', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('草稿已保存到数据库');
  await page.route('**/api/v1/recruitments/' + id, async route => {
    if (route.request().method() === 'GET') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_READ_FAILURE', message: '验证用首次读取失败' } }) });
    else await route.continue();
  });
  await page.goto(editUrl);
  await expect(page.getByRole('alert')).toContainText('验证用首次读取失败');
  await page.unrouteAll({ behavior: 'wait' });
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.getByLabel('招募标题', { exact: true })).toHaveValue(localTitle);
  const pending = await context.newPage();
  await pending.goto(editUrl);
  await pending.getByLabel('招募标题', { exact: true }).fill('原草稿删除后仍保留在本页的文字');
  // Preserve the browser's existing virtual offset when installing on another tab.
  const pendingTime = await pending.evaluate(() => Date.now());
  await pending.clock.install({ time: pendingTime }); await pending.clock.fastForward(21_000);
  expect(await pending.evaluate(() => Date.now())).toBeGreaterThanOrEqual(pendingTime + 21_000);
  await page.bringToFront();
  await page.goto('/recruitments');
  await page.getByText('我的私有草稿', { exact: false }).click();
  const row = page.locator('.draft-row').filter({ hasText: localTitle });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: '删除草稿', exact: true }).click();
  await page.getByRole('button', { name: '先保留', exact: true }).click();
  await row.getByRole('button', { name: '删除草稿', exact: true }).click();
  await page.getByRole('button', { name: '确认删除草稿', exact: true }).click();
  await expect(row).toHaveCount(0);
  const removed = pending.waitForResponse(r => r.url().endsWith('/api/v1/recruitments/' + id) && r.request().method() === 'GET');
  await pending.bringToFront();
  await pending.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  expect((await removed).status()).toBe(404);
  await expect(pending.getByLabel('招募标题', { exact: true })).toHaveValue('原草稿删除后仍保留在本页的文字');
  await expect(pending.getByLabel('招募标题', { exact: true })).toBeDisabled();
  await expect(pending.getByRole('button', { name: '保存私有草稿', exact: true })).toBeDisabled();
  await expect(pending.getByRole('status').filter({ hasText: '已停止保存和发布' })).toBeVisible();
  await pending.close();
  await page.goto('/recruitments/' + id);
  await expect(page.getByRole('alert')).toContainText('不存在或尚未公开');

  await page.goto('/recruitments/new');
  await page.getByLabel('招募标题', { exact: true }).fill('创建响应丢失前的招募草稿');
  let originalId = '';
  const creationAttempts: unknown[] = [];
  await page.route('**/api/v1/recruitments', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    creationAttempts.push(route.request().postDataJSON());
    if (creationAttempts.length === 2) return route.fulfill({ status: 400, contentType: 'text/plain', body: 'Test gateway interruption' });
    if (creationAttempts.length > 2) return route.continue();
    const committed = await route.fetch();
    expect(committed.status()).toBe(201); originalId = (await committed.json()).data.id;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_LOST_CREATE_RESPONSE', message: '验证用草稿创建响应丢失' } }) });
  });
  await page.getByRole('button', { name: '保存私有草稿', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('验证用草稿创建响应丢失');
  await expect(page.getByLabel('招募标题', { exact: true })).toBeEnabled();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 }); await noOverflow(page);
    await page.getByLabel('招募标题', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.local/screenshots/day6-create-recovery-${width}.png` });
  }
  await page.getByLabel('招募标题', { exact: true }).fill('创建响应丢失后继续修改的招募草稿');
  await page.getByRole('button', { name: '保存私有草稿', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('服务暂时不可用');
  await expect(page.getByLabel('招募标题', { exact: true })).toHaveValue('创建响应丢失后继续修改的招募草稿');
  await page.getByRole('button', { name: '保存私有草稿', exact: true }).click();
  await expect(page).toHaveURL(/\/recruitments\/[a-f0-9-]+\/edit$/);
  const own = (await (await page.request.get('/api/v1/me/recruitments')).json()).data;
  expect(own.filter((r: { title: string }) => r.title.startsWith('创建响应丢失'))).toHaveLength(1);
  await expect(page).toHaveURL(new RegExp('/recruitments/' + originalId + '/edit$'));
  await expect(page.getByLabel('招募标题', { exact: true })).toHaveValue('创建响应丢失后继续修改的招募草稿');
  expect(creationAttempts).toHaveLength(3);
  for (const attempt of creationAttempts.slice(1)) expect(attempt).toEqual(creationAttempts[0]);
  await page.unrouteAll({ behavior: 'wait' });

  for (const action of ['deleted', 'edited'] as const) {
    await page.goto('/recruitments/new');
    await page.getByLabel('招募标题', { exact: true }).fill('需要核对创建结果的草稿 ' + action);
    let recovered!: RecruitmentDTO;
    await page.route('**/api/v1/recruitments', async route => {
      const committed = await route.fetch();
      expect(committed.status()).toBe(201); recovered = (await committed.json()).data;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_LOST_CREATE_RESPONSE', message: '验证用草稿创建响应丢失' } }) });
    }, { times: 1 });
    await page.getByRole('button', { name: '保存私有草稿', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('验证用草稿创建响应丢失');
    const me = (await (await page.request.get('/api/v1/auth/me')).json()).data;
    const headers = { Origin: new URL(page.url()).origin, 'X-CSRF-Token': me.csrfToken };
    if (action === 'deleted') expect((await page.request.delete('/api/v1/recruitments/' + recovered.id, { headers, data: { revision: 1 } })).status()).toBe(200);
    else expect((await page.request.patch('/api/v1/recruitments/' + recovered.id, { headers, data: { revision: 1, draft: { ...recovered.draft, title: '另一页面已保存的内容不能被恢复覆盖' } } })).status()).toBe(200);
    const local = '这段未保存的输入应继续保留 ' + action;
    await page.getByLabel('招募标题', { exact: true }).fill(local);
    await page.getByRole('button', { name: '保存私有草稿', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(action === 'deleted' ? '草稿已删除' : '已在其他页面更新或发布');
    await expect(page.getByLabel('招募标题', { exact: true })).toHaveValue(local);
    await expect(page.getByRole('button', { name: '保存私有草稿', exact: true })).toBeDisabled();
    if (action === 'deleted') expect((await page.request.get('/api/v1/recruitments/' + recovered.id)).status()).toBe(404);
    else {
      const stored = (await (await page.request.get('/api/v1/recruitments/' + recovered.id)).json()).data;
      expect(stored.title).toBe('另一页面已保存的内容不能被恢复覆盖'); expect(stored.revision).toBe(2);
      await expect(page.getByRole('link', { name: '在新标签页核对已保存内容', exact: true })).toHaveAttribute('target', '_blank');
    }
  }
});
