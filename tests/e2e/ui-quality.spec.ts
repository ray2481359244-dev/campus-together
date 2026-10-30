import {signInReader} from './ui-support';
import { test, expect } from '@playwright/test';

test('keyboard users can skip navigation, switch zones and return to the original discussion card', async ({ page }) => {
  await signInReader(page); await page.goto('/discover?panel=discussion');
  await expect(page.locator('.post-card')).not.toHaveCount(0);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: '跳到主要内容', exact: true })).toBeFocused();
  await page.keyboard.press('Enter'); await expect(page.locator('#main-content')).toBeFocused();
  const zones = page.locator('.category-tabs button');
  await zones.first().focus(); await page.keyboard.press('ArrowRight');
  await expect(zones.nth(1)).toBeFocused(); await expect(zones.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.post-list')).toContainText('复习高数时');
  await page.keyboard.press('End'); await expect(zones.nth(3)).toBeFocused();
  await expect(page.locator('.post-list')).toContainText('校园里的光影');
  await page.keyboard.press('Home'); await expect(zones.first()).toBeFocused();
  await expect(page.locator('.post-list')).toContainText('第一次做校园项目');
  const card = page.locator('.post-card').first(), href = await card.getAttribute('href');
  await card.focus(); const top = await page.evaluate(() => scrollY);
  await page.keyboard.press('Enter');
  await expect(page.locator('.post-detail h1')).toBeFocused();
  await page.keyboard.press('Escape'); await expect(page).toHaveURL(/\/discover/);
  await expect(page.locator('.post-card[href="' + href + '"]')).toBeFocused();
  await expect.poll(async () => Math.abs((await page.evaluate(() => scrollY)) - top)).toBeLessThan(3);
});

test('submitted searches stay consistent through back and forward navigation', async ({ page }) => {
  await signInReader(page); await page.goto('/discover?panel=discussion');
  await expect(page.locator('.post-card')).not.toHaveCount(0);
  const search = page.getByRole('textbox', { name: '搜索讨论', exact: true });
  await search.fill('第一次'); await search.press('Enter');
  await expect(page).toHaveURL(/q=/);
  await search.fill('没有这条讨论'); await search.press('Enter');
  await expect(page.getByRole('heading', { name: '没有找到相关讨论' })).toBeVisible();
  await page.goBack(); await expect(search).toHaveValue('第一次');
  await page.goForward(); await expect(search).toHaveValue('没有这条讨论');
  await page.getByRole('button', { name: '清除讨论搜索', exact: true }).click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue(''); await expect(page).not.toHaveURL(/q=/);
  await expect(page.locator('.post-list')).toContainText('第一次做校园项目');
});

test('current mobile text and key controls meet the accepted readable baseline', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await signInReader(page); await page.goto('/discover?panel=discussion'); await expect(page.locator('.post-card')).not.toHaveCount(0);
  for (const selector of ['.metadata', '.post-excerpt', '.demo-banner', '.mobile-nav-item']) {
    for (const size of await page.locator(selector).evaluateAll(nodes => nodes.map(n => parseFloat(getComputedStyle(n).fontSize)))) expect(size).toBeGreaterThanOrEqual(12);
  }
  for (const locator of [page.getByRole('combobox', { name: '浏览学校', exact: true }), page.getByRole('textbox', { name: '搜索讨论', exact: true }), page.locator('.search-form button'), page.getByRole('button', { name: '动效开启', exact: true })]) {
    const box = (await locator.boundingBox())!; expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.getByRole('textbox', { name: '搜索讨论', exact: true }).evaluate(n => parseFloat(getComputedStyle(n).fontSize))).toBeGreaterThanOrEqual(16);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
});

test('long persisted content reflows across mobile tablet and desktop and Escape cancels deletion first', async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('邮箱', { exact: true }).fill('ui-long-content@campus.invalid');
  await page.getByLabel('密码', { exact: true }).fill('ReadableBrowser2026!');
  await page.getByLabel('昵称', { exact: true }).fill('W'.repeat(20));
  await page.getByRole('combobox', { name: '学校（自述）', exact: true }).selectOption({ label: '星原大学（虚构演示）' });
  await page.getByRole('button', { name: '创建账号，开始碰个头' }).click();
  await expect(page).toHaveURL(/\/discover/);
  const id = await page.evaluate(async () => {
    const me = (await (await fetch('/api/v1/auth/me')).json()).data;
    const topics = (await (await fetch('/api/v1/topics?category=COMPETITION')).json()).data;
    const created = await fetch('/api/v1/posts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': me.csrfToken, 'X-Session-User': me.user.id }, body: JSON.stringify({ requestKey: crypto.randomUUID(), topicId: topics[0].id, title: 'W'.repeat(60), body: 'LongContent'.repeat(60) }) });
    if (created.status !== 201) throw new Error('Fixture publication failed');
    return (await created.json()).data.id as string;
  });
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of ['/discover?panel=discussion', '/recruitments', '/publish', '/me', '/recruitments/new', '/posts/' + id]) {
      await page.goto(route);
      await expect(page.locator('#main-content h1').first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}px ${route}`).toBeLessThanOrEqual(width + 1);
      if (route.startsWith('/discover')) {
        await expect(page.locator('.post-list')).toContainText('W'.repeat(60));
        await page.screenshot({ path: `.local/screenshots/w104-home-${width}.png`, fullPage: true });
      }
      if (route === '/posts/' + id && [390, 1440].includes(width)) {
        await expect.poll(() => page.getByTestId('swipe-panel').evaluate(n => Number(getComputedStyle(n).opacity))).toBeGreaterThanOrEqual(.99);
        await expect.poll(() => page.getByTestId('swipe-panel').evaluate(n => Math.abs(new DOMMatrixReadOnly(getComputedStyle(n).transform).m42))).toBeLessThan(.5);
        await page.screenshot({ path: `.local/screenshots/w104-detail-${width}.png`, fullPage: true });
      }
    }
  }
  await page.getByRole('button', { name: '删除讨论', exact: true }).click();
  await expect(page.getByRole('heading', { name: '删除这条讨论？' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: '删除这条讨论？' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '删除讨论', exact: true })).toBeFocused();
  await expect(page).toHaveURL(new RegExp('/posts/' + id + '$'));
  expect((await page.request.get('/api/v1/posts/' + id)).status()).toBe(200);
});
