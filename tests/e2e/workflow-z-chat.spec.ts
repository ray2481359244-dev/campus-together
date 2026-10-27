import { test, expect } from '@playwright/test';
import { flows } from './flow-support';
test('members chat, retry lost sends, recover offline gaps, redact messages and lose access after removal',async({browser})=>{
  test.setTimeout(120000); const f=await flows(browser),[a,b,c]=f.pages;
  try{
    const r=await f.create('多人群聊与撤权浏览器验收');await f.join(r);await f.join(r,2,false);
    await c.goto('/teams/'+r.team.id+'/chat');await expect(c.getByRole('alert')).toContainText('有效成员');
    await a.goto('/teams/'+r.team.id);await a.getByRole('link',{name:'进入队伍群聊 →',exact:true}).click();await b.goto('/teams/'+r.team.id+'/chat');
    await a.getByLabel('更新队伍公告',{exact:true}).fill('周二晚上线上碰头，先确认分工。');await a.getByRole('button',{name:'保存公告',exact:true}).click();await expect(b.getByRole('region',{name:'队伍群聊',exact:true})).toContainText('周二晚上线上碰头');
    const bodies:unknown[]=[];await b.route('**/api/v1/teams/'+r.team.id+'/chat/messages',async route=>{bodies.push(route.request().postDataJSON());if(bodies.length===1){const response=await route.fetch();expect(response.status()).toBe(200);await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEST_CHAT_LOST',message:'验证用发言回执丢失'}})});}else await route.continue();});
    await b.getByLabel('消息内容',{exact:true}).fill('我负责界面整理，先确认消息。');await b.getByRole('button',{name:'发送消息',exact:true}).click();await expect(b.getByRole('status')).toContainText('结果尚未确认');await b.getByRole('button',{name:'核对并重试消息',exact:true}).click();
    await expect(a.locator('.chat-message').filter({hasText:'我负责界面整理，先确认消息。'})).toHaveCount(1);expect(bodies).toHaveLength(2);expect(bodies[0]).toEqual(bodies[1]);
    await b.getByLabel('消息内容',{exact:true}).fill('这段尚未提交的文字要保留');await b.context().setOffline(true);
    await a.getByLabel('消息内容',{exact:true}).fill('离线期间我们先整理需求。');await a.getByRole('button',{name:'发送消息',exact:true}).click();await b.context().setOffline(false);await b.getByRole('button',{name:'同步消息',exact:true}).click();
    await expect(b.locator('.chat-message').filter({hasText:'离线期间我们先整理需求。'})).toHaveCount(1);await expect(b.getByLabel('消息内容',{exact:true})).toHaveValue('这段尚未提交的文字要保留');
    await b.locator('.chat-message').filter({hasText:'我负责界面整理，先确认消息。'}).getByRole('button',{name:'删除我的消息',exact:true}).click();await expect(a.locator('.chat-message').filter({hasText:'我负责界面整理，先确认消息。'})).toHaveCount(0);await expect(a.getByLabel('已保存消息',{exact:true})).toContainText('消息已删除');
    await a.getByRole('button',{name:'标为已读',exact:true}).click();await expect(a.getByRole('region',{name:'队伍群聊',exact:true})).toContainText('未读 0 条');
    for(const width of [390,1440]){await a.setViewportSize({width,height:1000});expect(await a.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width+1);await a.getByRole('region',{name:'队伍群聊',exact:true}).screenshot({path:`.local/screenshots/chat-${width}.png`});}
    const member=(await(await b.request.get('/api/v1/teams/'+r.team.id)).json()).data.myMembership;expect((await f.post(0,'/teams/'+r.team.id+'/members/'+member.id+'/remove',{revision:member.revision,reason:'本轮分工调整。'})).status()).toBe(200);
    await expect(b.getByRole('alert')).toContainText('有效成员');await expect(b.getByLabel('已保存消息',{exact:true})).toHaveCount(0);
    expect((await f.post(0,'/teams/'+r.team.id+'/actions',{kind:'CANCEL',revision:1,reason:'本轮验证完成。'})).status()).toBe(200);await expect(a.getByRole('region',{name:'队伍群聊',exact:true})).toContainText('群聊只读');await expect(a.getByRole('button',{name:'发送消息',exact:true})).toHaveCount(0);
  }finally{await b.context().setOffline(false);await f.close();}
});
