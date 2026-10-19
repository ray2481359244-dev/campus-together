import { test, expect } from '@playwright/test';

test('a committed discussion with a lost response can be retried without creating a duplicate', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('邮箱', { exact: true }).fill('publishing-retry@campus.invalid');
  await page.getByLabel('密码', { exact: true }).fill('PublishingBrowser2026!');
  await page.getByLabel('昵称', { exact: true }).fill('讨论发布体验');
  await page.getByRole('combobox', { name: '学校（自述）', exact: true }).selectOption({ label: '星原大学（虚构演示）' });
  await page.getByRole('button', { name: '创建账号，开始碰个头' }).click();
  await expect(page).toHaveURL(/\/discover/);
  await page.goto('/publish');
  const title = '响应丢失后只应保存一次的讨论', body = '服务器真实保存这段内容后，测试主动丢弃成功响应，再通过页面核对同一次发布。';
  await page.getByLabel('标题', { exact: true }).fill(title);
  await page.getByLabel('正文', { exact: true }).fill(body);
  const attempts: { requestKey?: string; topicId: string; title: string; body: string }[] = [];
  let savedId = '';
  await page.route('**/api/v1/posts', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    attempts.push(route.request().postDataJSON());
    if (attempts.length === 1) {
      const saved = await route.fetch();
      expect(saved.status()).toBe(201);
      savedId = (await saved.json()).data.id;
      await route.abort('failed');
    } else if (attempts.length === 2) {
      // A gateway's non-JSON 400 cannot establish whether the earlier request committed.
      await route.fulfill({ status: 400, contentType: 'text/plain', body: 'Test gateway response' });
    } else await route.continue();
  });
  await page.getByRole('button', { name: '发布讨论', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('连接中断');
  await expect(page.getByLabel('正文', { exact: true })).toHaveValue(body);
  await expect(page.getByLabel('标题', { exact: true })).toBeDisabled();
  await expect(page.getByLabel('兴趣区域', { exact: true })).toBeDisabled();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
    await page.screenshot({ path: `.local/screenshots/w105-publish-retry-${width}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: /^(发布讨论|核对并完成发布)$/ }).click();
  await expect(page.getByRole('alert')).toContainText('服务暂时不可用');
  await expect(page.getByLabel('标题', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '核对并完成发布', exact: true }).click();
  await expect(page.locator('.post-detail h1')).toContainText(title);
  const listed = await page.evaluate(async q => {
    const me = (await (await fetch('/api/v1/auth/me')).json()).data;
    return (await (await fetch('/api/v1/posts?' + new URLSearchParams({ schoolId: me.user.school.id, q }))).json()).data;
  }, title);
  expect(listed).toHaveLength(1);
  await expect(page).toHaveURL(new RegExp('/posts/' + savedId + '$'));
  expect(attempts).toHaveLength(3);
  for (const attempt of attempts.slice(1)) expect(attempt).toEqual(attempts[0]);
  expect(attempts[0].requestKey).toMatch(/^[0-9a-f-]{36}$/i);
  await page.unrouteAll({ behavior: 'wait' });

  await test.step('a failure before saving retries the same frozen content', async () => {
    await page.goto('/publish');
    const title = '请求尚未落库也能安全重试的讨论';
    await page.getByLabel('标题', { exact: true }).fill(title);
    await page.getByLabel('正文', { exact: true }).fill('本次先模拟服务在保存前不可用，再核对同一次提交并完成真实发布。');
    const attempts: unknown[] = [];
    await page.route('**/api/v1/posts', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      attempts.push(route.request().postDataJSON());
      if (attempts.length === 1) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_UNAVAILABLE', message: '测试用保存前服务中断' } }) });
      else await route.continue();
  });
  await page.getByRole('button', { name: '发布讨论', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('测试用保存前服务中断');
  await expect(page.getByLabel('标题', { exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '核对并完成发布', exact: true }).click();
  await expect(page.locator('.post-detail h1')).toContainText(title);
  expect(attempts).toHaveLength(2); expect(attempts[1]).toEqual(attempts[0]);
  await page.unrouteAll({ behavior: 'wait' });
  });

  await test.step('a definitive topic rejection allows correcting unsaved input', async () => {
    await page.goto('/publish');
    await page.getByLabel('标题', { exact: true }).fill('主题校验失败后应允许修改输入');
    await page.getByLabel('正文', { exact: true }).fill('这次由真实服务端校验不存在的主题，明确未保存后继续修正并发布。');
    await page.route('**/api/v1/posts', async route => {
      if (route.request().method() === 'POST') await route.continue({ postData: JSON.stringify({ ...route.request().postDataJSON(), topicId: '00000000-0000-4000-8000-000000000099' }) });
      else await route.continue();
  });
  await page.getByRole('button', { name: '发布讨论', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('主题已停用或不存在');
  await expect(page.getByLabel('标题', { exact: true })).toBeEnabled();
  await page.getByLabel('标题', { exact: true }).fill('修正主题后可以正常发布的讨论');
  await page.unrouteAll({ behavior: 'wait' });
  await page.getByRole('button', { name: '发布讨论', exact: true }).click();
  await expect(page.locator('.post-detail h1')).toContainText('修正主题后可以正常发布的讨论');
  });
});
