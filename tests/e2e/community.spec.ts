import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const school = '星原大学（虚构演示）';
const baseURL = 'http://127.0.0.1:3101';
async function register(page: Page, email: string, nickname: string) {
  await page.goto('/register');
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill('BrowserTest2026!');
  await page.getByLabel('昵称', { exact: true }).fill(nickname);
  await page.getByRole('combobox', { name: '学校（自述）', exact: true }).selectOption({ label: school });
  await page.getByRole('button', { name: '创建账号，开始碰个头' }).click();
  await expect(page).toHaveURL(/\/discover/);
  await expect(page.locator('.account-link')).toContainText(nickname);
}
async function noOverflow(page: Page) {
  const d = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
  expect(d.scroll).toBeLessThanOrEqual(d.width + 1);
}

test('two independent accounts publish, read, edit, save profiles and revoke sessions', async ({ browser }) => {
  const ca = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true });
  const cb = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  const a = await ca.newPage(), b = await cb.newPage(), runtimeErrors: string[] = [];
  a.on('pageerror', e => runtimeErrors.push(e.message)); b.on('pageerror', e => runtimeErrors.push(e.message));
  try {
    await register(a, 'e2e-a@campus.invalid', '浏览器甲');
    await register(b, 'e2e-b@campus.invalid', '浏览器乙');
    await a.goto('/publish?category=COMPETITION');
    await a.getByLabel('标题', { exact: true }).fill('两个账号共同验证的校园讨论');
    await a.getByLabel('正文', { exact: true }).fill('这条内容由浏览器甲真实发布，浏览器乙应该可以读取，但不能修改。');
    await a.getByRole('button', { name: '发布讨论', exact: true }).click();
    await expect(a.getByRole('heading', { name: '两个账号共同验证的校园讨论', exact: true })).toBeVisible();
    const url = a.url(), id = url.split('/').at(-1)!;
    await b.goto(url);
    await expect(b.getByRole('heading', { name: '两个账号共同验证的校园讨论' })).toBeVisible();
    await expect(b.getByRole('link', { name: '编辑讨论' })).toHaveCount(0);
    const forbidden = await b.evaluate(async id => {
      const me = (await (await fetch('/api/v1/auth/me')).json()).data;
      const r = await fetch('/api/v1/posts/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrfToken }, body: JSON.stringify({ title: '不应被旁观者修改的标题', body: '这是一段不应当生效的正文内容。', revision: 1 }) });
      return r.status;
    }, id);
    expect(forbidden).toBe(403);
    await a.reload();
    await expect(a.getByRole('link', { name: '编辑讨论' })).toBeVisible();
    await a.getByRole('link', { name: '编辑讨论' }).click();
    await a.getByLabel('标题', { exact: true }).fill('作者更新后的校园讨论标题');
    await a.getByRole('button', { name: '保存修改' }).click();
    await expect(a.getByRole('heading', { name: '作者更新后的校园讨论标题' })).toBeVisible();
    await b.reload();
    await expect(b.getByRole('heading', { name: '作者更新后的校园讨论标题' })).toBeVisible();
    await a.goto('/me');
    await a.getByLabel('一句话介绍自己').fill('喜欢把校园里的想法做成能用的东西。');
    await a.getByLabel('自述技能').fill('前端开发');
    await a.getByLabel('自述技能').pressSequentially(',');
    await expect(a.getByLabel('自述技能')).toHaveValue('前端开发,');
    await a.getByLabel('自述技能').pressSequentially('photo');
    await a.getByRole('button', { name: '竞赛组队', exact: true }).click();
    await a.getByRole('button', { name: '保存资料', exact: true }).click();
    await expect(a.getByRole('status')).toContainText('资料已保存');
    await a.reload();
    await expect(a.getByLabel('一句话介绍自己')).toHaveValue('喜欢把校园里的想法做成能用的东西。');
    await expect(a.getByLabel('自述技能')).toHaveValue('前端开发，photo');
    await noOverflow(a); await a.screenshot({ path: '.local/screenshots/e2e-profile-390.png', fullPage: true });
    await a.getByRole('button', { name: '退出登录', exact: true }).click();
    await expect(a.getByRole('heading', { name: '先碰个头，再开始' })).toBeVisible();
    await b.reload(); await expect(b.locator('.account-link')).toContainText('浏览器乙');
    await a.goto('/login');
    await a.getByLabel('邮箱', { exact: true }).fill('e2e-a@campus.invalid');
    await a.getByLabel('密码', { exact: true }).fill('wrong-password');
    await a.getByRole('button', { name: '登录', exact: true }).click();
    await expect(a.getByRole('alert')).toContainText('邮箱或密码不正确');
    await a.getByLabel('密码', { exact: true }).fill('BrowserTest2026!');
    await a.getByRole('button', { name: '登录', exact: true }).click();
    await expect(a.locator('.account-link')).toContainText('浏览器甲');
    expect(runtimeErrors).toEqual([]);
  } finally { await ca.close(); await cb.close(); }
});

test('four zones, real empty/error/loading states and responsive layouts', async ({ page }) => {
  await page.goto('/discover');
  await expect(page.locator('.post-card')).not.toHaveCount(0);
  for (const [category, title] of [['GAME', '新手第一次参加桌游'], ['STUDY', '复习高数时'], ['COMPETITION', '第一次做校园项目'], ['OUTDOOR', '校园里的光影']] as const) {
    await page.getByRole('button', { name: '进入' + ({ GAME: '游戏开黑', STUDY: '学习搭子', COMPETITION: '竞赛组队', OUTDOOR: '周末户外' }[category]) }).click();
    await expect(page.locator('.post-list')).toContainText(title);
  }
  await page.getByRole('textbox', { name: '搜索讨论', exact: true }).fill('不存在的讨论关键词E2E');
  await page.getByRole('button', { name: '搜索讨论', exact: true }).click();
  await expect(page.getByRole('heading', { name: '没有找到相关讨论' })).toBeVisible();
  await page.goto('/discover');
  await page.route('**/api/v1/posts?*', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_UNAVAILABLE', message: '测试服务中断' } }) }));
  await page.reload(); await expect(page.getByRole('alert')).toContainText('测试服务中断');
  await page.unroute('**/api/v1/posts?*'); await page.getByRole('button', { name: '重新加载' }).click();
  await expect(page.locator('.post-card')).not.toHaveCount(0);
  let release: (() => void) | undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/posts?*', async route => { await gate; await route.continue(); });
  await page.reload(); await expect(page.getByRole('status')).toContainText('正在读取校园讨论');
  release!(); await expect(page.locator('.post-card')).not.toHaveCount(0); await page.unrouteAll({ behavior: 'wait' });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 }); await noOverflow(page);
    await page.screenshot({ path: `.local/screenshots/e2e-discover-${width}.png`, fullPage: true });
  }
  await page.getByLabel('浏览学校', { exact: true }).selectOption({ label: '青禾学院（虚构演示）' });
  await expect(page.getByRole('heading', { name: '这里的第一条讨论，等你来写' })).toBeVisible();
});

test('real touch drags, cancellation, swipe-back and reduced-motion remain usable', async ({ browser }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  try {
    await page.goto('/discover');
    await expect(page.locator('.post-card')).not.toHaveCount(0);
    const cdp = await context.newCDPSession(page);
    const touch = (type: string, x?: number, y?: number) => cdp.send('Input.dispatchTouchEvent', { type: type as 'touchStart', touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x: x!, y: y!, id: 1 }] });
    let box = (await page.getByTestId('interest-COMPETITION').boundingBox())!;
    let x = box.x + box.width / 2, y = box.y + box.height / 2;
    await touch('touchStart', x, y); await touch('touchMove', x + 20, y); await touch('touchMove', x + 45, y + 8);
    await page.waitForFunction(() => Math.abs(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('[data-testid="interest-COMPETITION"]')!).transform).m41) > 15);
    await touch('touchEnd');
    await page.waitForFunction(() => Math.abs(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('[data-testid="interest-COMPETITION"]')!).transform).m41) < .5);
    expect(new URL(page.url()).search).toBe('');
    await touch('touchStart', x, y); await touch('touchMove', x + 28, y); await touch('touchCancel');
    await page.waitForFunction(() => Math.abs(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('[data-testid="interest-COMPETITION"]')!).transform).m41) < .5);
    await page.locator('.post-card').first().click();
    await expect(page.getByTestId('swipe-panel')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    box = (await page.getByTestId('swipe-panel').boundingBox())!; x = box.x + 8; y = box.y + 180;
    await touch('touchStart', x, y); await touch('touchMove', x + 18, y); await touch('touchEnd');
    await page.waitForFunction(() => Math.abs(new DOMMatrixReadOnly(getComputedStyle(document.querySelector('[data-testid="swipe-panel"]')!).transform).m41) < .5);
    await expect(page).toHaveURL(/\/posts\//);
    await touch('touchStart', x, y); await touch('touchMove', x + 45, y); await touch('touchMove', x + 130, y);
    await page.waitForFunction(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('[data-testid="swipe-panel"]')!).transform).m41 > 100);
    await page.screenshot({ path: '.local/screenshots/e2e-back-gesture.png' });
    await touch('touchEnd'); await expect(page).toHaveURL(/\/discover/);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(400);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.post-card').first().click(); await expect(page.getByTestId('swipe-panel')).toBeVisible();
    await page.getByRole('button', { name: '返回讨论板' }).click(); await expect(page).toHaveURL(/\/discover/);
    await noOverflow(page);
  } finally { await context.close(); }
});

for (const width of [390, 1440]) {
  test(`category changes retain layout and indicator through slow and interrupted requests at ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 1000 } });
    const page = await context.newPage();
    let release: (() => void) | undefined;
    try {
      await page.goto('/discover');
      await expect(page.locator('.post-card')).not.toHaveCount(0);
      const previousTitle = await page.locator('.post-card h3').first().textContent();
      await page.evaluate(() => {
        (window as unknown as Record<string, unknown>).switchIndicator = document.querySelector('.tab-indicator');
        window.scrollTo({ top: document.querySelector('#discussion-board')!.getBoundingClientRect().top + scrollY - 20, behavior: 'instant' });
      });
      const top = await page.evaluate(() => scrollY);
      const gate = new Promise<void>(done => { release = done; });
      await page.route('**/api/v1/posts?*', async route => {
        if (new URL(route.request().url()).searchParams.get('category') === 'STUDY') await gate;
        await route.continue().catch(() => { /* A rapid subsequent selection can abort this request. */ });
      });
      await page.locator('.category-tabs button').nth(1).click();
      await expect(page.locator('.post-results')).toHaveAttribute('data-updating', 'true');
      await expect(page.locator('.post-list')).toContainText(previousTitle!);
      await expect(page.locator('.loading-mark')).toHaveCount(0);
      await expect(page.locator('.post-results')).toHaveAttribute('inert', '');
      await expect.poll(() => page.evaluate(() => {
        const bar = document.querySelector('.tab-indicator')!.getBoundingClientRect();
        const button = document.querySelectorAll('.category-tabs button')[1].getBoundingClientRect();
        return Math.abs(bar.left - button.left);
      })).toBeLessThan(1);
      expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).switchIndicator === document.querySelector('.tab-indicator'))).toBe(true);
      expect(Math.abs(await page.evaluate(() => scrollY) - top)).toBeLessThan(2);
      expect(await page.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.tab-indicator')!).transform).m42)).toBe(0);
      expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(1);
      await page.screenshot({ path: `.local/screenshots/d2-switch-pending-${width}.png`, fullPage: true });
      await page.locator('.category-tabs button').nth(2).click();
      await expect(page.locator('.post-list')).toContainText('新手第一次参加桌游');
      release!(); await page.unrouteAll({ behavior: 'wait' });
      await expect(page.locator('.post-list')).toContainText('新手第一次参加桌游');
      await expect(page.locator('.category-tabs button').nth(2)).toHaveAttribute('aria-pressed', 'true');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.locator('.category-tabs button').nth(3).click();
      await expect(page.locator('.post-list')).toContainText('校园里的光影');
      expect(await page.evaluate(() => new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.tab-indicator')!).transform).m42)).toBe(0);
      await noOverflow(page);
    } finally { release?.(); await context.close(); }
  });
}
