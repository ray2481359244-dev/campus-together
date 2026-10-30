import { test, expect } from '@playwright/test';

test('the real account flow reaches full-screen panels, four cloud boards and interruptible transitions', async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.cover-brand-title')).toBeVisible();
  await page.goto('/discover?panel=interests');
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.goto('/register');
  await page.getByLabel('邮箱', { exact: true }).fill('cloud-ui@campus.invalid');
  await page.getByLabel('密码', { exact: true }).fill('CloudBrowser2026!');
  await page.getByLabel('昵称', { exact: true }).fill('想法云体验');
  await page.getByRole('combobox', { name: '学校（自述）', exact: true }).selectOption({ label: '星原大学（虚构演示）' });
  await page.getByRole('button', { name: '创建账号，开始碰个头' }).click();
  await expect(page.locator('.welcome-layout')).toBeVisible();
  await page.getByRole('link', { name: '去碰个想法', exact: true }).click();
  const clouds = page.locator('.ct-cloud');
  await expect(clouds).toHaveCount(4);
  for (const [category, text] of [['COMPETITION', '第一次做校园项目'], ['STUDY', '复习高数时'], ['GAME', '新手第一次参加桌游'], ['OUTDOOR', '校园里的光影']]) {
    const cloud = page.locator('.ct-cloud-' + category.toLowerCase());
    await cloud.focus(); await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp('category=' + category));
    await expect(page.locator('.post-list')).toContainText(text);
    await expect(page.locator('.ct-expanding-cloud')).toHaveCount(0);
    await expect(page.locator('.ct-thought-table')).toHaveCount(0);
    await page.getByRole('link', { name: '回到想法圆桌' }).click();
    await expect(cloud).toBeFocused();
  }
  // Interrupt with another panel before the cloud covers the content.
  await clouds.first().click();
  await page.getByRole('navigation', { name: '发现页板块' }).getByRole('link', { name: '开始碰头' }).click();
  await page.waitForTimeout(950);
  await expect(page.locator('.welcome-layout')).toBeVisible();
  await expect(page.locator('.ct-expanding-cloud')).toHaveCount(0);
  await expect(page.locator('.discover-panel')).toHaveCount(1);
  await page.goto('/discover?panel=interests');
  await clouds.first().click();
  await page.getByRole('navigation', { name: '桌面主导航' }).getByRole('link', { name: '招募', exact: true }).click();
  await page.waitForTimeout(950);
  await expect(page).toHaveURL(/\/recruitments$/);
  await expect(page.locator('.ct-expanding-cloud')).toHaveCount(0);
  await page.context().storageState({ path: '.local/e2e-cloud-ui.json' });
  expect(errors).toEqual([]);
});

test('cloud pages and real forms fit mobile tablet and desktop, preserve board focus and honor motion preferences', async ({ browser }) => {
  test.setTimeout(120000);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:3101', storageState: '.local/e2e-cloud-ui.json' });
  const page = await context.newPage(), errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
      for (const route of ['/discover', '/discover?panel=interests', '/discover?category=COMPETITION', '/recruitments', '/publish', '/messages', '/me', '/saved']) {
        await page.goto(route);
        await expect(page.locator('#main-content h1').first()).toBeVisible();
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
        expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(width < 768 ? 845 : 901);
        if (route === '/discover?panel=interests') {
          for (const cloud of await page.locator('.ct-cloud').all()) {
            const box = (await cloud.boundingBox())!;
            expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
            await expect(cloud).toBeInViewport();
          }
        }
        if ([390, 1440].includes(width)) {
          if(route.startsWith('/discover'))await expect.poll(() => page.locator('.discover-panel').evaluate(node => Number(getComputedStyle(node).opacity))).toBe(1);
          await expect.poll(() => page.locator('.route-base').evaluate(node => Number(getComputedStyle(node).opacity))).toBe(1);
          await page.evaluate(()=>document.fonts.ready);
          const name=route.startsWith('/discover')?(route.includes('interests')?'table':route.includes('category')?'board':'welcome'):route.slice(1);
          await page.screenshot({ path: `.local/screenshots/cloud-${name}-${width}.png` });
        }
      }
    }
    await page.goto('/discover?panel=discussion&category=COMPETITION');
    const zones = page.locator('.category-tabs button');
    await zones.first().focus(); await page.keyboard.press('ArrowRight');
    await expect(zones.nth(1)).toBeFocused();
    await expect(page.locator('.post-list')).toContainText('复习高数时');
    await page.keyboard.press('Home');
    await expect(page.locator('.post-list')).toContainText('第一次做校园项目');
    const search = page.getByRole('textbox', { name: '搜索讨论', exact: true });
    await search.fill('不存在的想法云测试'); await search.press('Enter');
    await expect(page.getByRole('heading', { name: '没有找到相关讨论' })).toBeVisible();
    await page.goBack(); await expect(search).toHaveValue('');
    await page.setViewportSize({width:390,height:667});
    const card = page.locator('.post-card').first();
    await card.evaluate(node=>node.scrollIntoView({block:'end',behavior:'instant'}));
    await card.focus(); const href = await card.getAttribute('href');
    const top = await page.locator('[data-page-scroll]').evaluate(node => node.scrollTop);
    expect(top).toBeGreaterThan(0);
    await page.keyboard.press('Enter');
    await expect(page.locator('.post-detail h1')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator(`.post-card[href="${href}"]`)).toBeFocused();
    await expect.poll(() => page.locator('[data-page-scroll]').evaluate(node => node.scrollTop)).toBe(top);
    await page.getByRole('button', { name: '动效开启', exact: true }).click();
    await page.getByRole('link', { name: '回到想法圆桌' }).click();
    await page.locator('.ct-cloud-study').click();
    await expect(page).toHaveURL(/category=STUDY/);
    await expect(page.locator('.ct-expanding-cloud')).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveClass(/motion-off/);
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
