import { test, expect } from '@playwright/test';
import { flows } from './flow-support';

test('统一消息页连接队伍审批、评论私聊与讨论群', async ({ browser }) => {
  test.setTimeout(120_000);
  const f = await flows(browser), [captain, member, outsider] = f.pages;
  try {
    const r = await f.create('消息中心回归队伍');
    const item = (page: typeof captain) => page.locator('.message-row-link').filter({ hasText: r.title });
    await captain.goto('/messages');
    await expect(item(captain)).toContainText('发条消息约个时间');
    await f.join(r, 1, false);
    await captain.getByRole('link', { name: /^通知/ }).click();
    await captain.getByRole('button', { name: /待处理/ }).click();
    await captain.locator('.message-task').filter({ hasText: r.title }).click();
    await captain.getByRole('button', { name: '批准入队', exact: true }).click();
    await captain.getByRole('button', { name: '确认批准入队', exact: true }).click();
    await expect(captain.getByText('已批准入队，成员与岗位人数已更新，结果通知已保存。', { exact: true })).toBeVisible();
    await captain.getByRole('button', { name: '关闭资料面板', exact: true }).click();
    await captain.getByRole('button', { name: '返回通知', exact: true }).click();
    await expect(captain.getByText('暂无待处理事项。', { exact: true })).toBeVisible();
    await captain.getByRole('button', { name: '返回消息列表', exact: true }).click();

    await member.setViewportSize({ width: 320, height: 740 });
    await member.goto('/messages');
    await member.getByRole('button', { name: '我的队伍', exact: true }).click();
    await expect(item(member)).toBeVisible();
    await item(member).click();
    await expect(member.getByRole('region', { name: '队伍群聊', exact: true })).toBeVisible();
    await expect(member.getByRole('navigation', { name: '手机主导航' })).toBeHidden();
    const compose = member.getByLabel('消息内容', { exact: true });
    await compose.fill('手机上的队伍草稿');
    await member.getByRole('button', { name: '群资料', exact: true }).click();
    await expect(member.getByRole('region', { name: '队伍详情' })).toContainText('当前 2 / 3 人');
    await member.getByRole('button', { name: '关闭资料面板', exact: true }).click();
    await expect(compose).toHaveValue('手机上的队伍草稿');
    expect(await member.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await member.screenshot({ path: '.local/screenshots/messages-team-320.png' });
    await member.getByRole('button', { name: '返回消息列表', exact: true }).click();
    await expect(member.getByRole('button', { name: '我的队伍', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(item(member)).toContainText('草稿');

    await item(captain).click();
    await captain.getByLabel('消息内容', { exact: true }).fill('第一条保存后进入队伍摘要');
    await captain.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(item(member)).toContainText('1');
    await member.getByRole('button', { name: '更多操作 ' + r.title, exact: true }).click();
    await member.getByRole('button', { name: '消息免打扰', exact: true }).click();
    await expect(item(member).getByLabel('免打扰')).toBeVisible();
    await expect(member.locator('.mobile-nav .unread-badge')).toHaveCount(0);
    await item(member).click();
    await expect(compose).toHaveValue('手机上的队伍草稿');
    await expect(member.getByLabel('已保存消息')).toContainText('第一条保存后进入队伍摘要');
    await member.getByRole('button', { name: '查找聊天记录', exact: true }).click();
    await member.getByLabel('搜索本会话聊天记录').fill('保存后');
    await member.getByRole('button', { name: '搜索聊天记录', exact: true }).click();
    await member.getByRole('button', { name: /第一条保存后进入队伍摘要/ }).click();
    await expect(member.locator('.message-bubble-row.located')).toContainText('第一条保存后进入队伍摘要');

    const topic = (await (await captain.request.get('/api/v1/topics?category=OUTDOOR')).json()).data[0];
    const created = await f.post(0, '/posts', {
      requestKey: crypto.randomUUID(), topicId: topic.id, title: '消息验证与周末活动', body: '打算从这里发起活动讨论，欢迎有兴趣的同学留言。',
    });
    expect(created.status()).toBe(201);
    const post = (await created.json()).data;
    const comment = await f.post(1, '/community/' + post.id + '/comments', { requestKey: crypto.randomUUID(), body: '我周六有空，可以帮忙。' });
    expect(comment.status()).toBe(201);
    await captain.goto('/posts/' + post.id + '#conversation');
    await captain.locator('.community-comment').filter({ hasText: '我周六有空，可以帮忙。' }).getByRole('button', { name: '私聊', exact: true }).click();
    await captain.getByLabel('第一条消息').fill('想和你聊聊周六的活动');
    await captain.getByRole('button', { name: '发送联系请求', exact: true }).click();
    await expect(captain.getByText('等待对方接受联系。', { exact: true })).toBeVisible();
    await member.goto('/messages?view=notifications&tab=pending');
    await member.getByRole('link', { name: /想和你聊聊周六的活动/ }).click();
    await member.getByRole('button', { name: '接受联系', exact: true }).click();
    await expect(member.getByLabel('消息内容')).toBeVisible();
    await expect(captain.getByLabel('消息内容')).toBeVisible();
    await member.getByLabel('消息内容').fill('周六见，我来准备材料。');
    await member.getByRole('button', { name: '发送消息', exact: true }).click();
    await expect(captain.getByLabel('已保存消息')).toContainText('周六见，我来准备材料。');
    await expect(captain.locator('.message-row-link').filter({ hasText: f.sessions[1].user.nickname })).toBeVisible();
    await expect(item(captain)).toBeVisible();
    await captain.screenshot({ path: '.local/screenshots/messages-desktop-1440.png' });

    await captain.goto('/posts/' + post.id + '#conversation');
    await captain.getByRole('button', { name: '创建讨论群', exact: true }).click();
    await captain.getByLabel('群名', { exact: true }).fill('周末活动讨论群');
    await captain.getByRole('button', { name: '创建讨论群', exact: true }).click();
    await expect(captain.getByRole('link', { name: '打开讨论群', exact: true })).toBeVisible();
    await outsider.goto('/posts/' + post.id + '#conversation');
    await outsider.getByRole('button', { name: '进群聊聊', exact: true }).click();
    await outsider.getByRole('button', { name: '确认加入讨论群', exact: true }).click();
    await outsider.getByRole('link', { name: '打开讨论群', exact: true }).click();
    await expect(outsider.getByRole('region', { name: '讨论群聊', exact: true })).toBeVisible();
    await expect(outsider.getByLabel('消息内容')).toBeEnabled();
    await outsider.getByRole('button', { name: '返回消息列表', exact: true }).click();
    await expect(outsider.locator('.message-row-link').filter({ hasText: '周末活动讨论群' })).toBeVisible();
    await expect(item(outsider)).toHaveCount(0);
  } finally {
    await f.close();
  }
});
