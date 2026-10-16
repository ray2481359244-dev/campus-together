import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

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
    await a.getByRole('button', { name: '保存私有草稿', exact: true }).click();
    await expect(a).toHaveURL(/\/recruitments\/[a-f0-9-]+\/edit$/);
    const editUrl = a.url(), id = editUrl.split('/').at(-2)!;
    await a.reload(); await expect(a.getByLabel('招募标题', { exact: true })).toHaveValue(title);
    await b.goto('/recruitments/' + id);
    await expect(b.getByRole('alert')).toContainText('尚未公开');
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

test('failed draft writes preserve input, can retry, and saved drafts can be deleted', async ({ page }) => {
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
  const id = page.url().split('/').at(-2)!;
  await page.goto('/recruitments');
  await page.getByText('我的私有草稿', { exact: false }).click();
  const row = page.locator('.draft-row').filter({ hasText: '失败后输入仍保留的私有草稿' });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: '删除草稿', exact: true }).click();
  await page.getByRole('button', { name: '先保留', exact: true }).click();
  await row.getByRole('button', { name: '删除草稿', exact: true }).click();
  await page.getByRole('button', { name: '确认删除草稿', exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.goto('/recruitments/' + id);
  await expect(page.getByRole('alert')).toContainText('不存在或尚未公开');
});
