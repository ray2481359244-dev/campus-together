import { test, expect } from '@playwright/test';

test('discussion drafts survive refetches and failures, and conflicts require explicit version recovery', async ({ page, context }) => {
  await page.goto('/register');
  await page.getByLabel('邮箱', { exact: true }).fill('editing-review@campus.invalid');
  await page.getByLabel('密码', { exact: true }).fill('EditingBrowser2026!');
  await page.getByLabel('昵称', { exact: true }).fill('讨论编辑体验');
  await page.getByRole('combobox', { name: '学校（自述）', exact: true }).selectOption({ label: '星原大学（虚构演示）' });
  await page.getByRole('button', { name: '创建账号，开始碰个头' }).click();
  await expect(page).toHaveURL(/\/discover/);
  await page.goto('/publish');
  await page.getByLabel('标题', { exact: true }).fill('需要在两个标签页编辑的讨论');
  await page.getByLabel('正文', { exact: true }).fill('最初保存在服务器上的内容，用于核对本地编辑与后续修改之间的区别。');
  await page.getByRole('button', { name: '发布讨论', exact: true }).click();
  await expect(page.locator('.post-detail h1')).toContainText('需要在两个标签页编辑的讨论');
  const url = page.url(), editor = url + '/edit';
  await page.getByRole('link', { name: '编辑讨论', exact: true }).click();
  const localTitle = '当前标签页尚未保存的想法不能丢失';
  await page.getByLabel('标题', { exact: true }).fill(localTitle);
  const other = await context.newPage();
  try {
    await other.goto(editor);
    await other.getByLabel('标题', { exact: true }).fill('另一个标签页已经保存的新标题');
    await other.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(other.locator('.post-detail h1')).toContainText('另一个标签页已经保存的新标题');
    // Advance query freshness deterministically, then exercise the real focus-refetch path.
    await page.bringToFront(); await page.clock.install(); await page.clock.fastForward(21_000);
    const refreshed = page.waitForResponse(r => r.url() === url.replace('/posts/', '/api/v1/posts/') && r.request().method() === 'GET');
    await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    expect((await refreshed).status()).toBe(200);
    await expect(page.getByLabel('标题', { exact: true })).toHaveValue(localTitle);
    await page.clock.resume();

    const rejected = page.waitForResponse(r => r.request().method() === 'PATCH' && r.url().includes('/api/v1/posts/'));
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    expect((await rejected).status()).toBe(409);
    await expect(page.getByLabel('标题', { exact: true })).toHaveValue(localTitle);
    await expect(page.getByRole('alert')).toContainText('已在其他页面更新');
    await page.getByRole('button', { name: '核对已保存版本', exact: true }).click();
    await expect(page.getByRole('region', { name: '服务器已保存的讨论' })).toContainText('另一个标签页已经保存的新标题');
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
      await page.screenshot({ path: `.local/screenshots/w105-version-review-${width}.png`, fullPage: true });
    }
    await page.getByRole('button', { name: '用此版本重新编辑', exact: true }).click();
    await page.getByRole('button', { name: '继续保留我的输入', exact: true }).click();
    await expect(page.getByLabel('标题', { exact: true })).toHaveValue(localTitle);
    await page.getByRole('button', { name: '用此版本重新编辑', exact: true }).click();
    await page.getByRole('button', { name: '确认载入已保存版本', exact: true }).click();
    await expect(page.getByLabel('标题', { exact: true })).toHaveValue('另一个标签页已经保存的新标题');
    await page.setViewportSize({ width: 390, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391);

    await page.getByLabel('标题', { exact: true }).fill('核对版本后由原标签页继续完善');
    await page.route('**/api/v1/posts/*', async route => {
      if (route.request().method() === 'PATCH') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_FAILURE', message: '验证用保存中断' } }) });
      else await route.continue();
    });
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('验证用保存中断');
    await expect(page.getByLabel('标题', { exact: true })).toHaveValue('核对版本后由原标签页继续完善');
    await page.unrouteAll({ behavior: 'wait' });
    await page.getByRole('button', { name: '保存修改', exact: true }).click();
    await expect(page.locator('.post-detail h1')).toContainText('核对版本后由原标签页继续完善');
    await other.reload(); await expect(other.locator('.post-detail h1')).toContainText('核对版本后由原标签页继续完善');

    await page.getByRole('link', { name: '编辑讨论', exact: true }).click();
    await page.getByLabel('正文', { exact: true }).fill('即使原讨论在另一页删除，这段尚未提交的本地文字也应保留供手动复制。');
    await other.getByRole('button', { name: '删除讨论', exact: true }).click();
    await other.getByRole('button', { name: '确认删除', exact: true }).click();
    await expect(other).toHaveURL(/\/discover/);
    await page.getByRole('button', { name: '核对已保存版本', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('不存在或已经不可见');
    await expect(page.getByLabel('正文', { exact: true })).toHaveValue('即使原讨论在另一页删除，这段尚未提交的本地文字也应保留供手动复制。');
    await page.setViewportSize({ width: 320, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
    await page.getByRole('link', { name: '发布', exact: true }).click();
    await expect(page.getByLabel('标题', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('正文', { exact: true })).toHaveValue('');
  } finally { await other.close(); }
});
