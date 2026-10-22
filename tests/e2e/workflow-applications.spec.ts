import { test, expect, type Page } from '@playwright/test';
import { RecruitmentDraftSchema } from '../../packages/contracts/src/recruitments';
import type { RecruitmentDTO } from '../../packages/contracts/src/recruitments';
import { existsSync, readFileSync } from 'node:fs';

async function register(page: Page, label: string) {
  await page.goto('/register');
  await page.getByLabel('邮箱', { exact: true }).fill(`application-browser-${label}@campus.invalid`);
  await page.getByLabel('密码', { exact: true }).fill('ApplicationBrowser2026!');
  await page.getByLabel('昵称', { exact: true }).fill('申请体验' + label);
  await page.getByRole('combobox', { name: '学校（自述）', exact: true }).selectOption({ label: '星原大学（虚构演示）' });
  await page.getByRole('button', { name: '创建账号，开始碰个头', exact: true }).click();
  await expect(page).toHaveURL(/\/discover/);
}
test('applicants check evidence, recover uncertain submissions, find saved intent and safely withdraw without joining', async ({ browser }) => {
  const reused = ['owner', 'participant', 'recruitment'].every(name => existsSync(`.local/e2e-application-${name}.json`));
  const owner = await browser.newContext({ baseURL: 'http://127.0.0.1:3101', ...(reused ? { storageState: '.local/e2e-application-owner.json' } : {}) });
  const participant = await browser.newContext({ baseURL: 'http://127.0.0.1:3101', viewport: { width: 390, height: 1000 }, ...(reused ? { storageState: '.local/e2e-application-participant.json' } : {}) });
  const a = await owner.newPage(), b = await participant.newPage();
  const runtimeErrors: string[] = []; b.on('pageerror', e => runtimeErrors.push(e.message));
  try {
    let r: RecruitmentDTO;
    if (reused) {
      r = JSON.parse(readFileSync('.local/e2e-application-recruitment.json', 'utf8'));
      await a.goto('/discover');
      expect((await (await a.request.get('/api/v1/auth/me')).json()).data.user.id).toBe(r.author.id);
      expect((await (await b.request.get('/api/v1/auth/me')).json()).data.user.id).not.toBe(r.author.id);
    } else {
    await register(a, 'owner'); await register(b, 'participant');
    const csrf = (await (await a.request.get('/api/v1/auth/csrf')).json()).data.csrfToken;
    const topics = (await (await a.request.get('/api/v1/topics?category=COMPETITION')).json()).data;
    const captain = crypto.randomUUID(), at = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString();
    const draft = RecruitmentDraftSchema.parse({ topicId: topics[0].id, title: '岗位申请浏览器实际验收队伍', description: '希望一起完成有实际用途的校园作品，明确岗位和协作时间，尊重彼此的课业安排并定期交流。', competitionName: '校园创新赛', direction: '校园协作', goal: '完成作品', collaboration: '周二周四晚间协作', startAt: at(24), endAt: at(48), joinDeadline: at(12), competitionDeadline: at(72), slots: [{ key: captain, name: '统筹', capacity: 1 }, { key: crypto.randomUUID(), name: '界面开发', capacity: 2, requiredSkills: ['React'] }], captainSlotKey: captain });
    const headers = { Origin: 'http://127.0.0.1:3101', 'X-CSRF-Token': csrf };
    const created = await a.request.post('/api/v1/recruitments', { headers, data: { requestKey: crypto.randomUUID(), draft } });
    expect(created.status()).toBe(201);
    const id = (await created.json()).data.id;
    const published = await a.request.post('/api/v1/recruitments/' + id + '/publish', { headers, data: { revision: 1 } });
    expect(published.status()).toBe(201);
    r = (await published.json()).data;
    }
    const id = r.id, path = '/recruitments/' + id;
    if (!r.team) throw new Error('Published fixture has no team');
    await b.route('**/api/v1/me/applications?teamId=' + r.team.id, route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_READ_FAILURE', message: '验证用申请读取失败' } }) }), { times: 1 });
    await b.goto(path);
    await expect(b.getByRole('alert')).toContainText('验证用申请读取失败');
    await expect(b.getByLabel('申请岗位', { exact: true })).toHaveCount(0);
    await b.getByRole('button', { name: '重新加载', exact: true }).click();
    const panel = b.getByRole('region', { name: '我的岗位申请', exact: true });
    await b.getByLabel('申请岗位', { exact: true }).selectOption(r.team.slots[1].id);
    await b.getByLabel('本次时间确认', { exact: true }).selectOption('yes');
    await b.getByLabel('申请说明', { exact: true }).fill('我希望负责界面实现，这段本次意向需要保留。');
    await b.getByRole('button', { name: '核对申请条件', exact: true }).click();
    await expect(panel.getByRole('heading', { name: '核对结果：待补充', exact: true })).toBeVisible();
    await expect(panel).toContainText('资料尚未声明：React');
    await expect(b.getByRole('button', { name: '提交岗位申请', exact: true })).toBeDisabled();
    await b.getByRole('link', { name: '补充我的真实资料 →', exact: true }).click();
    await b.getByLabel('自述技能', { exact: true }).fill(r.team.slots[1].requiredSkills.join('，'));
    await b.getByRole('button', { name: '保存资料', exact: true }).click();
    await expect(b.getByRole('status')).toContainText('资料已保存');
    await b.goto(path);
    await b.getByLabel('申请岗位', { exact: true }).selectOption(r.team.slots[1].id);
    await b.getByLabel('本次时间确认', { exact: true }).selectOption('yes');
    const originalMessage = '我希望负责界面实现，这段本次意向需要保留。';
    await b.getByLabel('申请说明', { exact: true }).fill(originalMessage);
    const checked = b.waitForResponse(response => response.url().endsWith('/api/v1/recruitments/' + id + '/eligibility') && response.request().method() === 'POST');
    await b.getByRole('button', { name: '核对申请条件', exact: true }).click();
    await expect(panel.getByRole('heading', { name: '核对结果：通过', exact: true })).toBeVisible();
    if (reused) {
      // Respect the real shared-IP write window; do not raise or disable production limits.
      const limit = (await checked).headers()['ratelimit'] || '';
      const remaining = limit.match(/\br=(\d+)/), reset = limit.match(/\bt=(\d+)/);
      expect(remaining).not.toBeNull(); expect(reset).not.toBeNull();
      if (Number(remaining![1]) < 5) {
        expect(Number(reset![1])).toBeLessThan(25);
        await new Promise(resolve => setTimeout(resolve, (Number(reset![1]) + 1) * 1000));
      }
    } else await checked;
    await panel.getByRole('heading', { name: '申请这个岗位。', exact: true }).click();
    for (const width of [320, 390, 1440]) {
      await b.setViewportSize({ width, height: 1000 });
      expect(await b.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
      await panel.screenshot({ path: `.local/screenshots/i001-conditions-${width}.png` });
    }
    const bodies: unknown[] = [];
    await b.route('**/api/v1/teams/' + r.team.id + '/applications', async route => {
      bodies.push(route.request().postDataJSON());
      if (bodies.length === 1) {
        const response = await route.fetch(); expect(response.status()).toBe(201);
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_LOST_RESPONSE', message: '验证用提交响应丢失' } }) });
      } else if (bodies.length === 2) await route.fulfill({ status: 400, contentType: 'text/html', body: 'Gateway unavailable' });
      else await route.continue();
    });
    await b.getByRole('button', { name: '提交岗位申请', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('验证用提交响应丢失');
    await expect(b.getByLabel('申请说明', { exact: true })).toHaveValue(originalMessage);
    await expect(b.getByLabel('申请说明', { exact: true })).toBeDisabled();
    await b.getByRole('button', { name: '核对并重试申请', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('服务暂时不可用');
    await b.getByRole('button', { name: '核对并重试申请', exact: true }).click();
    await expect(panel.getByLabel('已保存申请', { exact: true })).toContainText('申请状态：待审核');
    expect(bodies).toHaveLength(3); expect(bodies[0]).toEqual(bodies[1]); expect(bodies[1]).toEqual(bodies[2]);
    await b.unrouteAll({ behavior: 'wait' });
    await b.reload(); await expect(panel.getByLabel('已保存申请', { exact: true })).toContainText(originalMessage);
    await expect(b.getByText('当前 1 / 3 人，总人数包含队长。每位成员只占一个岗位。', { exact: true })).toBeVisible();
    await b.goto('/recruitments');
    const mine = b.getByRole('region', { name: '我的岗位申请列表', exact: true });
    await mine.locator('summary').click(); await expect(mine).toContainText(r.title); await expect(mine).toContainText('待审核');
    await mine.getByRole('link').filter({ hasText: r.title }).click();
    await b.route('**/api/v1/applications/*/withdraw', async route => {
      const response = await route.fetch(); expect(response.status()).toBe(200);
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'TEST_WITHDRAW_RESPONSE', message: '验证用撤回响应丢失' } }) });
    }, { times: 1 });
    await b.getByRole('button', { name: '撤回申请', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('验证用撤回响应丢失');
    await b.getByRole('button', { name: '重试撤回申请', exact: true }).click();
    await expect(panel.getByLabel('已保存申请', { exact: true })).toContainText('申请状态：已撤回');
    await expect(panel).toContainText('撤回 / 拒绝后需等待 10 分钟');
    await expect(b.getByRole('button', { name: '提交岗位申请', exact: true })).toBeDisabled();
    await b.reload(); await expect(panel.getByLabel('已保存申请', { exact: true })).toContainText('申请状态：已撤回');
    expect(runtimeErrors).toEqual([]);
  } finally { await owner.close(); await participant.close(); }
});
