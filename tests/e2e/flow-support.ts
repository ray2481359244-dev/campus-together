import { expect, type Browser, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { RecruitmentDraftSchema } from '../../packages/contracts/src/recruitments';
export async function flows(browser: Browser) {
  const baseURL = 'http://127.0.0.1:3101', contexts = [], pages: Page[] = [], errors: string[] = [];
  for (const name of ['owner', 'participant', 'observer']) {
    const context = await browser.newContext({ baseURL, viewport: { width: name === 'owner' ? 1440 : 390, height: 1000 }, ...(existsSync(`.local/e2e-application-${name}.json`) ? { storageState: `.local/e2e-application-${name}.json` } : {}) }); contexts.push(context);
    const page = await context.newPage(); pages.push(page); page.on('pageerror', e => errors.push(e.message));
    if (!(await (await page.request.get('/api/v1/auth/me')).json()).data.user) {
      await page.goto('/register'); await page.getByLabel('邮箱', { exact: true }).fill(`flow-${name}@campus.invalid`); await page.getByLabel('密码', { exact: true }).fill('StageFlow2026!'); await page.getByLabel('昵称', { exact: true }).fill('阶段体验' + name);
      await page.getByRole('combobox', { name: '学校（自述）', exact: true }).selectOption({ label: '星原大学（虚构演示）' }); await page.getByRole('button', { name: '创建账号，开始碰个头', exact: true }).click(); await expect(page).toHaveURL(/\/discover/);
    }
  }
  const sessions = await Promise.all(pages.map(async p => (await (await p.request.get('/api/v1/auth/me')).json()).data));
  const post = (who: number, path: string, data: object) => pages[who].request.post('/api/v1' + path, { headers: { Origin: baseURL, 'X-CSRF-Token': sessions[who].csrfToken, 'X-Session-User': sessions[who].user.id }, data });
  const topicId = (await (await pages[0].request.get('/api/v1/topics?category=COMPETITION')).json()).data[0].id;
  let first = true;
  async function create(title: string) {
    const key = crypto.randomUUID(), at = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
    const draft = RecruitmentDraftSchema.parse({ topicId, title, description: '验证到期、群聊、归档与匹配功能的真实协作流程；内容仅用于本次自动化测试。', competitionName: '校园协作赛', direction: '校园应用', goal: '完成作品', collaboration: '周二周四晚间协作', startAt: at(24), endAt: at(48), joinDeadline: at(12), competitionDeadline: at(72), capacity: 3, slots: [{ key, name: '统筹', capacity: 1 }, { key: crypto.randomUUID(), name: '协作', capacity: 2 }], captainSlotKey: key });
    const body = { requestKey: crypto.randomUUID(), draft }; let response = await post(0, '/recruitments', body);
    if (first) { first = false; const limit = response.headers()['ratelimit'] || '', r = limit.match(/\br=(\d+)/), t = limit.match(/\bt=(\d+)/); expect(r).not.toBeNull(); expect(t).not.toBeNull(); if (response.status() === 429 || Number(r![1]) < 30) { expect(Number(t![1])).toBeLessThanOrEqual(60); await new Promise(resolve => setTimeout(resolve, (Number(t![1]) + 1) * 1000)); if (response.status() === 429) response = await post(0, '/recruitments', body); } }
    expect(response.status()).toBe(201); const id = (await response.json()).data.id;
    const published = await post(0, '/recruitments/' + id + '/publish', { revision: 1 }); expect(published.status()).toBe(201); return (await published.json()).data;
  }
  async function join(r: Awaited<ReturnType<typeof create>>, who = 1, approve = true) { const submitted = await post(who, '/teams/' + r.team.id + '/applications', { requestKey: crypto.randomUUID(), slotId: r.team.slots[1].id, timeConfirmed: true, message: '已确认本次协作安排。' }); expect(submitted.status()).toBe(201); const row = (await submitted.json()).data; if (approve) expect((await post(0, '/applications/' + row.id + '/review', { revision: 1, decision: 'APPROVE', reason: '欢迎协作。' })).status()).toBe(200); return row; }
  async function close() { for (const p of pages) await p.unrouteAll({ behavior: 'wait' }); for (const c of contexts) await c.close(); expect(errors).toEqual([]); }
  return { pages, post, create, join, sessions, close };
}
