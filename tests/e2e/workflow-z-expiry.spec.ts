import 'dotenv/config';
import { Client } from 'pg';
import { test, expect } from '@playwright/test';
import { flows } from './flow-support';
test('deadline fallback persists expiry and notifies members and pending applicants', async ({ browser }) => {
  test.setTimeout(120000);
  const f = await flows(browser), [a, b, c] = f.pages;
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_test') || url === process.env.DATABASE_URL) throw new Error('Separate test DB required');
  const database = new Client({ connectionString: url }); await database.connect();
  try {
    const r = await f.create('到期自动处理浏览器验收'); await f.join(r); await f.join(r, 2, false);
    await database.query('UPDATE "Recruitment" SET "joinDeadline"=clock_timestamp()-interval \'1 second\' WHERE "id"=$1', [r.id]);
    await a.goto('/teams/' + r.team.id); await expect(a.getByRole('region', { name: '队伍详情', exact: true })).toContainText('已截止，未开始 · 队伍信息只读');
    await expect(a.getByRole('button', { name: '开始活动', exact: true })).toHaveCount(0);
    await b.goto('/messages'); await expect(b.locator('.notification-card').filter({ hasText: r.title }).filter({ hasText: '队伍已自动到期' })).toHaveCount(1);
    await c.goto('/messages'); await expect(c.locator('.notification-card').filter({ hasText: r.title })).toContainText('待审申请已失效');
    await a.reload(); expect((await database.query('SELECT count(*)::int AS n FROM "TeamAction" WHERE "teamId"=$1 AND "kind"=\'EXPIRE\'', [r.team.id])).rows[0].n).toBe(1);
  } finally { await database.end(); await f.close(); }
});
