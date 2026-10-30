import {test,expect} from '@playwright/test';
import {flows} from './flow-support';
import {recordFeedback,feedback} from './motion-support';

test('saved comments chat and notices arrive once as clouds; bell success animates and failures remain still',async({browser})=>{
  test.setTimeout(120000);
  const f=await flows(browser),[owner,reader,observer]=f.pages;
  try{
    const recruitment=await f.create('云朵消息动画与交互复核');await f.join(recruitment);
    const topic=(await(await owner.request.get('/api/v1/topics?category=OUTDOOR')).json()).data[0];
    const response=await f.post(0,'/posts',{requestKey:crypto.randomUUID(),topicId:topic.id,title:'一起把讨论变成一朵朵云',body:'这条真实测试讨论用于核对评论、消息通知与铃铛反馈，发送成功后才显示新内容。'});
    expect(response.status()).toBe(201);const post=(await response.json()).data;
    await owner.goto('/messages');await expect(owner.locator('#main-content h1')).toHaveText('有人回应，也有新的进展。');await expect(owner.getByText('正在读取通知……',{exact:true})).toBeHidden();await recordFeedback(owner);
    await reader.goto('/posts/'+post.id+'#conversation');await expect(reader.getByLabel('写一条评论',{exact:true})).toBeVisible();await recordFeedback(reader);
    await reader.getByLabel('写一条评论',{exact:true}).fill('第一朵评论云，已经真实保存。');await reader.getByRole('button',{name:'发布评论',exact:true}).click();
    const comment=reader.locator('.community-comment').filter({hasText:'第一朵评论云，已经真实保存。'});await expect(comment).toBeVisible();
    await expect.poll(async()=>(await feedback(reader)).filter(row=>row.kind.includes('community-comment')).length).toBe(1);
    await expect.poll(async()=>(await feedback(owner)).filter(row=>row.kind.includes('notification-card')).length,{timeout:12000}).toBe(1);
    await owner.getByRole('button',{name:'刷新通知',exact:true}).click();
    expect((await feedback(owner)).filter(row=>row.kind.includes('notification-card'))).toHaveLength(1);
    const summaryReady=owner.waitForResponse(response=>response.url().endsWith('/me/notifications/summary')&&response.ok());
    await owner.goto('/me');await summaryReady;await expect(owner.locator('#main-content h1')).toBeVisible();await recordFeedback(owner);

    const bell=reader.getByRole('button',{name:'关闭本帖提醒',exact:true});
    await bell.click();await expect(reader.getByRole('button',{name:'开启本帖提醒',exact:true})).toHaveAttribute('aria-pressed','true');
    expect((await feedback(reader)).some(row=>row.id==='bell:1'&&row.animations>=2)).toBe(true);
    await reader.route('**/api/v1/community/'+post.id+'/notifications',route=>route.request().method()==='PUT'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEST_BELL',message:'铃铛失败验证'}})}):route.continue());
    await reader.getByRole('button',{name:'开启本帖提醒',exact:true}).click();await expect(reader.getByRole('alert')).toContainText('铃铛失败验证');
    expect((await feedback(reader)).filter(row=>row.id.startsWith('bell:'))).toHaveLength(1);
    await reader.unrouteAll();
    await reader.getByRole('button',{name:'开启本帖提醒',exact:true}).click();await expect(reader.getByRole('button',{name:'关闭本帖提醒',exact:true})).toBeVisible();
    await reader.emulateMedia({reducedMotion:'reduce'});await reader.getByRole('button',{name:'关闭本帖提醒',exact:true}).click();
    await expect(reader.getByRole('button',{name:'开启本帖提醒',exact:true})).toBeVisible();
    expect((await feedback(reader)).filter(row=>row.id==='bell:3')[0]?.animations).toBe(0);
    await reader.emulateMedia({reducedMotion:'no-preference'});

    await reader.route('**/api/v1/community/'+post.id+'/comments',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'TEST_COMMENT',message:'评论失败验证'}})}));
    await reader.getByLabel('写一条评论',{exact:true}).fill('请求失败时，这朵云不应出现。');await reader.getByRole('button',{name:'发布评论',exact:true}).click();
    await expect(reader.getByRole('alert')).toContainText('评论失败验证');await expect(reader.getByLabel('写一条评论',{exact:true})).toHaveValue('请求失败时，这朵云不应出现。');
    expect((await feedback(reader)).filter(row=>row.kind.includes('community-comment'))).toHaveLength(1);
    await reader.unrouteAll();await reader.getByRole('button',{name:'核对并重试原评论',exact:true}).click();
    await expect(reader.locator('.community-comment').filter({hasText:'请求失败时，这朵云不应出现。'})).toHaveCount(1);
    await expect.poll(async()=>(await feedback(reader)).filter(row=>row.kind.includes('community-comment')).length).toBe(2);
    await expect.poll(async()=>(await feedback(owner)).filter(row=>row.kind.includes('notification-toast')).length,{timeout:12000}).toBe(1);
    await reader.getByRole('button',{name:'点赞 · 0',exact:true}).click();
    await expect.poll(async()=>(await feedback(owner)).filter(row=>row.kind.includes('notification-toast')).length,{timeout:12000}).toBe(2);
    await observer.goto('/posts/'+post.id);await observer.getByRole('button',{name:'点赞 · 1',exact:true}).click();
    await expect.poll(async()=>(await feedback(owner)).filter(row=>row.kind.includes('notification-toast')).length,{timeout:12000}).toBe(3);
    const updates=(await feedback(owner)).filter(row=>row.kind.includes('notification-toast')).slice(-2);
    expect(updates[0].id.split(':')[0]).toBe(updates[1].id.split(':')[0]);expect(updates[0].id).not.toBe(updates[1].id);

    await reader.goto('/teams/'+recruitment.team.id+'/chat');await expect(reader.getByLabel('已保存消息',{exact:true})).toBeVisible();await recordFeedback(reader);
    await owner.goto('/teams/'+recruitment.team.id+'/chat');await expect(owner.getByLabel('已保存消息',{exact:true})).toBeVisible();await recordFeedback(owner);
    await reader.getByLabel('消息内容',{exact:true}).fill('把想法发出去，像云朵轻轻落位。');await reader.getByRole('button',{name:'发送消息',exact:true}).click();
    await expect(reader.locator('.chat-own').filter({hasText:'把想法发出去，像云朵轻轻落位。'})).toHaveCount(1);
    await expect.poll(async()=>(await feedback(reader)).filter(row=>row.kind.includes('chat-own')).length).toBe(1);
    await expect.poll(async()=>(await feedback(owner)).filter(row=>row.kind.includes('chat-peer')).length,{timeout:10000}).toBe(1);
    await reader.getByRole('button',{name:'同步消息',exact:true}).click();expect((await feedback(reader)).filter(row=>row.kind.includes('chat-own'))).toHaveLength(1);
    await reader.screenshot({path:'.local/screenshots/cloud-chat-feedback.png'});
  }finally{await f.close();}
});
