import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function register(page: Page, suffix: string) {
  await page.goto('/register');
  await page.getByLabel('邮箱', { exact: true }).fill(suffix + '@campus.invalid');
  await page.getByLabel('密码', { exact: true }).fill('SessionBrowser2026!');
  await page.getByLabel('昵称', { exact: true }).fill(suffix);
  await page.getByRole('combobox', { name: '学校（自述）', exact: true }).selectOption({ label: '星原大学（虚构演示）' });
  await page.getByRole('button', { name: '创建账号，开始碰个头' }).click();
  await expect(page).toHaveURL(/\/discover/);
}

test('a stale tab cannot submit an old form as the account signed in from another tab', async ({ context, page }) => {
  await register(page, 'session-first');
  await page.goto('/publish');
  await page.getByLabel('标题', { exact: true }).fill('原账号的未提交讨论不能写到新账号');
  await page.getByLabel('正文', { exact: true }).fill('这份内容只属于原来的账号；另一个标签页切换账号后必须停止提交。');
  const other = await context.newPage();
  await register(other, 'session-second');
  await expect(page.getByRole('heading', { name: '登录状态已变化' })).toBeVisible();
  await expect(page.getByRole('button', { name: '发布讨论', exact: true })).toHaveCount(0);
  await other.goto('/discover?panel=discussion');
  await expect(other.locator('.post-list')).not.toContainText('原账号的未提交讨论不能写到新账号');
  await page.getByRole('button', { name: '重新加载并确认账号', exact: true }).click();
  await expect(page.locator('.account-link')).toContainText('session-second');
  await expect(page.getByLabel('标题', { exact: true })).toHaveValue('');
});

test('without cross-tab notifications a stale write is still stopped by server identity checks', async ({ context, page }) => {
  await context.addInitScript(() => { Object.defineProperty(window, 'BroadcastChannel', { value: undefined, configurable: true }); });
  await register(page, 'fallback-first');
  await page.goto('/publish');
  await page.getByLabel('标题', { exact: true }).fill('旧标签页的内容不能由另一个账号发布');
  await page.getByLabel('正文', { exact: true }).fill('关闭跨页通知后也需要服务端拒绝旧的账号身份，不能自动换成新账号提交。');
  const other = await context.newPage();
  await register(other, 'fallback-second');
  const rejected = page.waitForResponse(r => r.url().endsWith('/api/v1/posts') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '发布讨论', exact: true }).click();
  expect((await rejected).status()).toBe(409);
  await expect(page.getByRole('heading', { name: '登录状态已变化' })).toBeVisible();
  await other.goto('/discover?panel=discussion');
  await expect(other.locator('.post-list')).not.toContainText('旧标签页的内容不能由另一个账号发布');
});

test('logout invalidates another tab immediately while an independent context remains signed in', async ({ browser, context, page }) => {
  await register(page, 'logout-owner');
  const other = await context.newPage(); await other.goto('/me');
  await expect(other.getByRole('heading', { name: '你好，同频的你。' })).toBeVisible();
  const independent = await browser.newContext({ baseURL: 'http://127.0.0.1:3101' });
  try {
    const separate = await independent.newPage(); await register(separate, 'logout-independent');
    await page.goto('/me'); await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(other.getByRole('heading', { name: '登录状态已变化' })).toBeVisible();
    await expect(other.getByLabel('一句话介绍自己')).toHaveCount(0);
    await separate.reload(); await expect(separate.locator('.account-link')).toContainText('logout-independent');
    await other.setViewportSize({ width: 320, height: 800 });
    expect(await other.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
    await other.screenshot({ path: '.local/screenshots/d3-session-gate-320.png', fullPage: true });
  } finally { await independent.close(); }
});

test('profile failure preserves input and same-account CSRF renewal retries safely', async ({ page }) => {
  await register(page, 'profile-retry'); await page.goto('/me');
  await page.getByLabel('一句话介绍自己').fill('保存失败后继续保留这段输入，再按同一账号安全重试。');
  let writes = 0;
  const identities: string[] = [];
  await page.route('**/api/v1/me/profile', async route => {
    if (route.request().method() !== 'PATCH') { await route.continue(); return; }
    writes++; identities.push(route.request().headers()['x-session-user']);
    if (writes <= 2) await route.fulfill({ status: writes === 1 ? 503 : 403, contentType: 'application/json', body: JSON.stringify({ error: { code: writes === 1 ? 'TEST_STORAGE_FAILURE' : 'CSRF_INVALID', message: '验证用保存失败，请重试。' } }) });
    else await route.continue();
  });
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('验证用保存失败');
  await expect(page.getByLabel('一句话介绍自己')).toHaveValue('保存失败后继续保留这段输入，再按同一账号安全重试。');
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('资料已保存');
  expect(writes).toBe(3); expect(new Set(identities).size).toBe(1); expect(identities[0]).toMatch(/^[a-f0-9-]{36}$/);
  await page.reload(); await expect(page.getByLabel('一句话介绍自己')).toHaveValue('保存失败后继续保留这段输入，再按同一账号安全重试。');
});

test('an unavailable login-state request is recoverable and is not presented as logged out', async ({ page }) => {
  await page.route('**/api/v1/auth/me', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_AUTH_FAILURE', message: '暂时无法确认登录状态。' } }) }));
  await page.goto('/publish');
  await expect(page.getByRole('alert')).toContainText('暂时无法确认登录状态');
  await expect(page.getByRole('heading', { name: '欢迎回来，继续一起做。' })).toHaveCount(0);
  await page.unrouteAll({ behavior: 'wait' });
  await page.getByRole('button', { name: '重新加载', exact: true }).click();
  await expect(page.getByRole('heading', { name: '欢迎回来，继续一起做。' })).toBeVisible();
});

test('a lost session stops a pending profile write and keeps saved server data separate', async ({ page, context }) => {
  await register(page, 'expiry-browser'); await page.goto('/me');
  await page.getByLabel('一句话介绍自己').fill('会话失效后不应保存这段内容。');
  await context.clearCookies();
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await expect(page.getByRole('heading', { name: '登录已过期' })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存资料', exact: true })).toHaveCount(0);
});

test('an earlier failed request cannot overwrite the state after a deliberate logout', async ({ page }) => {
  await register(page, 'late-response'); await page.goto('/me');
  await page.getByLabel('一句话介绍自己').fill('等待中的旧资料请求。');
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  await page.route('**/api/v1/me/profile', async route => {
    if (route.request().method() !== 'PATCH') { await route.continue(); return; }
    entered(); await held;
    await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'AUTH_REQUIRED', message: '旧请求的过期会话。' } }) });
  });
  try {
    await page.getByRole('button', { name: '保存资料', exact: true }).click(); await started;
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '欢迎回来，继续一起做。' })).toBeVisible();
    const finished = page.waitForResponse(r => r.url().endsWith('/api/v1/me/profile') && r.status() === 401);
    release(); await (await finished).finished();
    await expect(page.getByRole('heading', { name: '欢迎回来，继续一起做。' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '登录已过期' })).toHaveCount(0);
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
});

test('a successful earlier profile response cannot restore the user after logout', async ({ page }) => {
  await register(page, 'late-success'); await page.goto('/me');
  await page.getByLabel('一句话介绍自己').fill('服务端已保存，但成功响应尚未交付。');
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const committed = new Promise<void>(resolve => { entered = resolve; });
  await page.route('**/api/v1/me/profile', async route => {
    if (route.request().method() !== 'PATCH') { await route.continue(); return; }
    const stored = await route.fetch(); expect(stored.status()).toBe(200);
    entered(); await held; await route.fulfill({ response: stored });
  });
  try {
    await page.getByRole('button', { name: '保存资料', exact: true }).click(); await committed;
    await page.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(page.getByRole('heading', { name: '欢迎回来，继续一起做。' })).toBeVisible();
    const delivered = page.waitForResponse(r => r.url().endsWith('/api/v1/me/profile') && r.status() === 200);
    release(); await (await delivered).finished();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(page.locator('.account-link')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '欢迎回来，继续一起做。' })).toBeVisible();
    const me = await page.request.get('/api/v1/auth/me'); expect((await me.json()).data.user).toBeNull();
  } finally { release(); await page.unrouteAll({ behavior: 'wait' }); }
});
