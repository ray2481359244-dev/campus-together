import 'dotenv/config';
import { Client } from 'pg';
import { test,expect } from '@playwright/test';
import { flows } from './flow-support';
test('手机举报和主题申请、管理员隐藏审批与封禁撤权',async({browser})=>{
  test.setTimeout(120000);const f=await flows(browser),url=process.env.TEST_DATABASE_URL;
  if(!url||!new URL(url).pathname.endsWith('_test')||url===process.env.DATABASE_URL)throw new Error('Separate test DB required');const database=new Client({connectionString:url});await database.connect();let failed=false; const originalSessions=(await database.query('SELECT "id" FROM "Session" WHERE "userId"=$1 AND "revokedAt" IS NULL',[f.sessions[1].user.id])).rows.map(r=>r.id);
  try {
    await f.create('管理功能浏览器验收窗口');const [owner,reader,admin]=f.pages;
    await database.query('UPDATE "User" SET "role"=\'ADMIN\' WHERE "id"=$1',[f.sessions[2].user.id]);
    const topics=(await(await owner.request.get('/api/v1/topics?category=COMPETITION')).json()).data;
    const p=await f.post(0,'/posts',{requestKey:crypto.randomUUID(),topicId:topics[0].id,title:'用于举报处理的浏览器真实讨论',body:'这是一条用于验证管理员处理流程的真实持久化讨论，不作为实际用户反馈。'});expect(p.status()).toBe(201);const id=(await p.json()).data.id;
    await reader.goto('/posts/'+id);await reader.locator('.report-control').first().locator('summary').click();await reader.getByLabel('举报原因',{exact:true}).fill('这是自动化验收测试内容，请核对并隐藏');await reader.getByRole('button',{name:'提交举报',exact:true}).click();await expect(reader.getByText(/已提交，将由管理员处理/)).toBeVisible();
    await reader.goto('/topic-requests');await reader.getByLabel('新主题名称',{exact:true}).fill('校园协作新主题验收');await reader.getByLabel('主题用途说明',{exact:true}).fill('用于验证主题申请审核与结果通知的浏览器流程');await reader.getByRole('button',{name:'提交主题申请',exact:true}).click();await expect(reader.getByText('主题申请已提交。',{exact:true})).toBeVisible();
    await admin.goto('/admin');await admin.getByLabel('处理原因',{exact:true}).fill('已核对自动化验收内容，按申请进行处理');await admin.getByRole('button',{name:'隐藏证据目标并结案',exact:true}).click();await expect(admin.getByRole('button',{name:'隐藏证据目标并结案',exact:true})).toHaveCount(0);await reader.goto('/posts/'+id);await expect(reader.getByRole('alert')).toContainText('不可见');
    await admin.getByRole('button',{name:'主题申请',exact:true}).click();await admin.getByRole('button',{name:'批准主题',exact:true}).click();await expect(admin.getByRole('button',{name:'批准主题',exact:true})).toHaveCount(0);await reader.goto('/topic-requests');await expect(reader.getByText(/已通过/)).toBeVisible();
    await admin.getByRole('button',{name:'用户',exact:true}).click();await admin.getByLabel('按昵称查找',{exact:true}).fill(f.sessions[1].user.nickname);await admin.getByRole('button',{name:'查找用户',exact:true}).click();await admin.getByRole('button',{name:'封禁账号',exact:true}).click();await reader.goto('/me');await expect(reader.getByRole('link',{name:'去登录',exact:true})).toBeVisible();
    await admin.screenshot({path:'.local/admin-mobile.png',fullPage:true});
  }catch(e){failed=true;throw e;}finally{await database.query('UPDATE "User" SET "role"=\'USER\',"status"=\'ACTIVE\' WHERE "id"=ANY($1::uuid[])',[f.sessions.map(s=>s.user.id)]);// Restore only the synthetic fixture sessions captured before this test; production unban keeps sessions revoked (covered by API tests).
    await database.query('UPDATE "Session" SET "revokedAt"=NULL WHERE "id"=ANY($1::uuid[]) AND "userId"=$2',[originalSessions,f.sessions[1].user.id]);await database.end();try{await f.close();}catch(e){if(!failed)throw e;}}
});
