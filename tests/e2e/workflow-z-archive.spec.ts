import 'dotenv/config';
import { Client } from 'pg';
import { test,expect } from '@playwright/test';
import { flows } from './flow-support';
test('terminal chat is read-only until its archive deadline, then both viewers hide all private content',async({browser})=>{
  test.setTimeout(120000);const f=await flows(browser),[a,b]=f.pages,url=process.env.TEST_DATABASE_URL;
  if(!url||!new URL(url).pathname.endsWith('_test')||url===process.env.DATABASE_URL)throw new Error('Separate test DB required');const database=new Client({connectionString:url});await database.connect();
  try{const r=await f.create('归档期限与隐藏浏览器验收');await f.join(r);expect((await f.post(1,'/teams/'+r.team.id+'/chat/messages',{clientMessageId:crypto.randomUUID(),body:'归档期限内的成员正文。'})).status()).toBe(200);expect((await f.post(0,'/teams/'+r.team.id+'/chat/announcement',{revision:1,body:'归档期限内的私有公告。'})).status()).toBe(200);expect((await f.post(0,'/teams/'+r.team.id+'/actions',{kind:'CANCEL',revision:1,reason:'本轮取消。'})).status()).toBe(200);
    for(const page of [a,b]){await page.goto('/teams/'+r.team.id+'/chat');await expect(page.getByRole('region',{name:'队伍群聊',exact:true})).toContainText('归档只读至');await expect(page.getByRole('button',{name:'发送消息',exact:true})).toHaveCount(0);await expect(page.getByLabel('已保存消息',{exact:true})).toContainText('归档期限内的成员正文。');}
    await database.query('UPDATE "Team" SET "archiveUntil"=clock_timestamp()-interval \'1 second\' WHERE "id"=$1',[r.team.id]);await a.reload();for(const page of [a,b]){await expect(page.getByRole('alert')).toContainText('归档期限已到');await expect(page.getByLabel('已保存消息',{exact:true})).toHaveCount(0);await expect(page.getByText('归档期限内的私有公告。',{exact:true})).toHaveCount(0);}
  }finally{await database.end();await f.close();}
});
