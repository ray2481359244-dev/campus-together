import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { signInReader } from './ui-support';

async function register(page: Page, email: string, nickname: string, password: string) {
  await page.goto('/register');
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByLabel('昵称', { exact: true }).fill(nickname);
  await page.getByRole('combobox', { name: '学校（自述）', exact: true }).selectOption({ label: '星原大学（虚构演示）' });
}

test('loopback demo uses the same six-character limit for registration and subsequent login', async ({ page }) => {
  const address = 'demo-six-character@campus.invalid', password = ' 林a2猫!';
  await register(page, address, '六字符同学', 'ab123');
  await expect(page.getByText('至少 6 个字符，可以使用更长的密码。')).toBeVisible();
  const submit = page.getByRole('button', { name: '创建账号，开始碰个头' });
  await submit.click();
  await expect(page.getByRole('alert')).toContainText('密码至少 6 个字符');
  await page.getByLabel('密码', { exact: true }).fill(password);
  await submit.click();
  await expect(page).toHaveURL(/\/discover/);
  await page.goto('/me');
  await page.getByText('账号与消息设置', { exact: true }).click();
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await page.getByLabel('邮箱', { exact: true }).fill(address);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.locator('.account-link')).toContainText('六字符同学');
});

test('a post author opens a social profile without losing the draft, and album visibility is reflected for a visitor', async ({ page, browser }) => {
  await signInReader(page);
  const ownerSession = (await (await page.request.get('/api/v1/auth/me')).json()).data;
  const visitor = await browser.newContext({ baseURL: 'http://127.0.0.1:3101', viewport: { width: 320, height: 870 } });
  try {
    const guest = await visitor.newPage();
    await register(guest, 'album-visitor@campus.invalid', '相册访客', 'HelloAlbum99');
    await guest.getByRole('button', { name: '创建账号，开始碰个头' }).click();
    await expect(guest).toHaveURL(/\/discover/);
    const topics = (await (await page.request.get('/api/v1/topics?category=GAME')).json()).data;
    const post = await page.request.post('/api/v1/posts', {
      headers: { Origin: 'http://127.0.0.1:3101', 'X-CSRF-Token': ownerSession.csrfToken, 'X-Session-User': ownerSession.user.id },
      data: { requestKey: crypto.randomUUID(), topicId: topics[0].id, title: '周末想一起拍校园照片', body: '周末约同学一起拍校园照片，也欢迎刚入门的新同学。' },
    });
    expect(post.ok()).toBe(true);
    const postId = (await post.json()).data.id;
    await page.goto('/me');
    await page.getByRole('button', { name: '改昵称' }).click();
    await page.getByLabel('新昵称').fill('会拍照的同学');
    await page.getByRole('button', { name: '保存昵称' }).click();
    await expect(page.getByRole('heading', { name: '会拍照的同学', exact: true })).toBeVisible();
    await expect(page.locator('.account-link')).toContainText('会拍照的同学');
    await page.getByRole('button', { name: '添加照片' }).click();
    const pixels = await page.evaluate(() => {
      const image = document.createElement('canvas');
      image.width = 480; image.height = 320;
      const context = image.getContext('2d')!;
      context.fillStyle = '#b390cc'; context.fillRect(0, 0, 480, 320);
      context.fillStyle = '#e4eb99'; context.beginPath(); context.arc(315, 125, 65, 0, 2 * Math.PI); context.fill();
      return image.toDataURL('image/png').split(',')[1];
    });
    await page.getByLabel('选一张照片').setInputFiles({ name: '校园瞬间.png', mimeType: 'image/png', buffer: Buffer.from(pixels, 'base64') });
    await expect.poll(() => page.getByAltText('待上传照片预览').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(480);
    await expect(page.getByLabel('这张照片谁能看')).toHaveValue('PRIVATE');
    const upload = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/v1/me/album'));
    await page.getByRole('button', { name: '上传照片' }).click();
    expect((await upload).status()).toBe(201);
    await expect(page.getByRole('button', { name: '查看第 1 张照片' })).toBeVisible();
    await page.screenshot({ path: '.local/screenshots/profile-album-desktop.png' });
    await guest.goto('/posts/' + postId + '#conversation');
    await guest.getByLabel('写一条评论').fill('这是准备继续写完的草稿。');
    await guest.getByRole('link', { name: '01 帖子正文', exact: true }).click();
    await guest.getByRole('link', { name: '查看 会拍照的同学 的主页' }).click();
    await expect(guest.getByRole('heading', { name: '会拍照的同学', exact: true })).toBeVisible();
    await expect(guest.getByText('暂无可看的照片。')).toBeVisible();
    await expect(guest.getByText(ownerSession.user.email, { exact: true })).toHaveCount(0);
    await expect(guest.getByRole('button', { name: '私聊', exact: true })).toBeVisible();
    await guest.getByRole('button', { name: '私聊', exact: true }).click();
    await expect(guest.getByLabel('附上这篇帖子')).toBeChecked();
    await guest.getByLabel('第一条消息').fill('想和你一起去拍照。');
    await guest.getByRole('button', { name: '发送联系请求' }).click();
    await expect(guest.getByText('等待对方接受联系。')).toBeVisible();
    await guest.getByRole('button', { name: '返回个人主页', exact: true }).click();
    await expect(guest.getByRole('heading', { name: '会拍照的同学', exact: true })).toBeVisible();
    await page.getByLabel('第 1 张照片的可见范围').selectOption('CAMPUS');
    await expect(page.getByText('可见范围已更新。')).toBeVisible();
    await guest.reload();
    await guest.getByRole('button', { name: '查看第 1 张照片' }).click();
    const viewer = guest.getByRole('dialog', { name: '查看相册照片' });
    const image = viewer.getByRole('img', { name: '第 1 张相册照片' });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect(await guest.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
    await guest.screenshot({ path: '.local/screenshots/profile-album-mobile.png' });
    await guest.getByRole('button', { name: '关闭照片' }).click();
    // Use another visit to verify going back to the mounted post keeps the draft.
    await guest.goto('/posts/' + postId + '#post-content');
    await guest.getByRole('link', { name: '02 评论互动', exact: true }).click();
    await guest.getByLabel('写一条评论').fill('切换个人主页后也要保留。');
    await guest.getByRole('link', { name: '01 帖子正文', exact: true }).click();
    await guest.getByRole('link', { name: '查看 会拍照的同学 的主页' }).click();
    await guest.getByRole('button', { name: '返回上一页', exact: true }).click();
    await guest.getByRole('link', { name: '02 评论互动', exact: true }).click();
    await expect(guest.getByLabel('写一条评论')).toHaveValue('切换个人主页后也要保留。');
  } finally { await visitor.close(); }
});

test('uploads a square avatar, shows it to a signed-in visitor and restores the illustration', async ({ page, browser }) => {
  const guestContext = await browser.newContext({ baseURL: 'http://127.0.0.1:3101', viewport: { width: 320, height: 870 } });
  try {
    await register(page, 'avatar-owner@campus.invalid', '换头像的同学', 'CampusAvatar99');
    await page.getByRole('button', { name: '创建账号，开始碰个头' }).click();
    await expect(page).toHaveURL(/\/discover/);
    const { user } = (await (await page.request.get('/api/v1/auth/me')).json()).data;
    const guest = await guestContext.newPage();
    await signInReader(guest);
    await page.goto('/me');
    const edit = page.getByRole('button', { name: '更换头像' });
    await expect(edit.locator('.student-avatar svg')).toBeVisible();
    await page.screenshot({ path: '.local/screenshots/profile-default-avatar.png' });
    await edit.click();
    const file = page.getByLabel('头像照片文件');
    await expect(page.getByRole('button', { name: '选择头像照片' })).toBeFocused();
    await file.setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('invalid') });
    await expect(page.getByRole('alert')).toContainText('3 MB');
    const pixels = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 480; canvas.height = 320;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#a583bf'; ctx.fillRect(0, 0, 480, 320);
      ctx.fillStyle = '#dde8a5'; ctx.fillRect(120, 70, 240, 180);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.setViewportSize({ width: 320, height: 870 });
    await file.setInputFiles({ name: '新头像.png', mimeType: 'image/png', buffer: Buffer.from(pixels, 'base64') });
    await expect(page.getByAltText('新头像预览')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
    await page.screenshot({ path: '.local/screenshots/profile-avatar-preview-mobile.png' });
    await page.getByRole('button', { name: '保存头像' }).click();
    await expect(edit).toBeFocused();
    await expect(page.getByText('头像已更新。', { exact: true })).toBeVisible();
    await expect.poll(() => edit.locator('img').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBe(320);
    const url = (await edit.locator('img').getAttribute('src'))!;
    await expect(page.locator('.account-link img')).toHaveAttribute('src', url);
    await guest.goto('/profiles/' + user.id);
    await expect(guest.locator('.profile-identity img')).toHaveAttribute('src', url);
    await expect(guest.getByRole('button', { name: '更换头像' })).toHaveCount(0);
    await page.reload();
    await expect(edit.locator('img')).toHaveAttribute('src', url);
    await edit.click();
    await page.getByRole('button', { name: '恢复默认头像', exact: true }).click();
    await page.getByRole('button', { name: '确认恢复默认头像', exact: true }).click();
    await expect(page.getByText('已恢复默认头像。', { exact: true })).toBeVisible();
    expect((await guest.request.get(url)).status()).toBe(404);
    await guest.reload();
    await expect(guest.locator('.profile-identity .student-avatar svg')).toBeVisible();
  } finally { await guestContext.close(); }
});
