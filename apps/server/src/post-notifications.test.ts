import {beforeAll,beforeEach,afterAll,expect,test} from 'vitest';
import {randomUUID} from 'node:crypto';
import request from 'supertest';
import {setup,reset,actors,tokens,write,read,ids} from './test-fixtures.js';
import {db} from './db.js';
import {app} from './app.js';
import {config} from './config.js';

beforeAll(setup);
beforeEach(async()=>{await reset();await db.post.deleteMany();});
afterAll(()=>db.$disconnect());
const put=(who:number,path:string,body:object)=>actors[who].put('/api/v1'+path).set('Origin',config.origin).set('X-CSRF-Token',tokens[who]).send(body);
async function post(){const topic=await db.topic.findFirstOrThrow();return (await write(0,'/posts',{requestKey:randomUUID(),topicId:topic.id,title:'帖子通知与免打扰验收',body:'没有加入任何队伍的读者也能通过评论和回复收到站内消息。'}).expect(201)).body.data;}
async function comment(postId:string,who=1,replyId?:string){return (await write(who,'/community/'+postId+'/comments',{requestKey:randomUUID(),body:'你好，这是本帖的新评论。',...(replyId?{replyId}:{})}).expect(201)).body.data;}

test('独立于队伍通知作者和被回复人；同人去重、自操作静默、评论重试不重复提醒',async()=>{
  const p=await post(),input={requestKey:randomUUID(),body:'没有入队也要收到评论提醒。'};
  const [a,b]=await Promise.all([write(1,'/community/'+p.id+'/comments',input).expect(201),write(1,'/community/'+p.id+'/comments',input).expect(201)]);
  expect(a.body.data.id).toBe(b.body.data.id);
  expect((await read(0,'/me/notifications/summary')).body.data).toMatchObject({unreadCount:1,latest:{kind:'POST_COMMENT',postId:p.id,commentId:a.body.data.id}});
  expect((await read(1,'/me/notifications')).body.data.items).toHaveLength(0);
  const reply=await comment(p.id,2,a.body.data.id);
  expect((await read(1,'/me/notifications')).body.data.items).toMatchObject([{kind:'POST_REPLY',commentId:reply.id}]);
  expect((await read(0,'/me/notifications')).body.data.items).toHaveLength(2);
  const own=await comment(p.id,0),toOwner=await comment(p.id,1,own.id);
  expect((await read(0,'/me/notifications')).body.data.items.filter((n:{commentId:string})=>n.commentId===toOwner.id)).toMatchObject([{kind:'POST_REPLY'}]);
  const notification=(await read(1,'/me/notifications')).body.data.items[0];
  await write(2,'/me/notifications/'+notification.id+'/read',{}).expect(404);
  await write(1,'/me/notifications/'+notification.id+'/read',{}).expect(200);
  expect((await read(1,'/me/notifications/summary')).body.data.unreadCount).toBe(0);
  await request(app).get('/api/v1/me/notifications/summary').expect(401);
});

test('单帖免打扰持久化且按账号隔离；不影响其他帖子或被回复人，恢复不补发历史',async()=>{
  const p=await post(),other=await post(),root=await comment(p.id);
  await put(0,'/community/'+p.id+'/notifications',{muted:true}).expect(200);
  expect((await read(0,'/community/'+p.id)).body.data.notificationsMuted).toBe(true);
  expect((await read(1,'/community/'+p.id)).body.data.notificationsMuted).toBe(false);
  expect((await read(0,'/me/notifications/summary')).body.data.unreadCount).toBe(0);
  await comment(p.id,2,root.id);await put(1,'/community/'+p.id+'/like',{active:true}).expect(200);
  expect((await read(0,'/me/notifications')).body.data.items).toHaveLength(1);
  expect((await read(1,'/me/notifications/summary')).body.data.unreadCount).toBe(1);
  await comment(other.id);
  expect((await read(0,'/me/notifications/summary')).body.data.unreadCount).toBe(1);
  await put(0,'/community/'+p.id+'/notifications',{muted:false}).expect(200);
  expect((await read(0,'/community/'+p.id)).body.data.notificationsMuted).toBe(false);
  expect((await read(0,'/me/notifications')).body.data.items).toHaveLength(2);
  await comment(p.id);
  expect((await read(0,'/me/notifications/summary')).body.data.unreadCount).toBe(2);
});

test('点赞按帖合并并返回当前总数；幂等重试不恢复未读，取消最后一个赞移除提醒',async()=>{
  const p=await post(),path='/community/'+p.id+'/like';
  await put(1,path,{active:true}).expect(200);
  const first=(await read(0,'/me/notifications')).body.data.items[0];expect(first).toMatchObject({kind:'POST_LIKED',likes:1});
  await write(0,'/me/notifications/'+first.id+'/read',{}).expect(200);
  await put(1,path,{active:true}).expect(200);
  expect((await read(0,'/me/notifications/summary')).body.data.unreadCount).toBe(0);
  await put(2,path,{active:true}).expect(200);
  const page=(await read(0,'/me/notifications')).body.data;expect(page.items).toHaveLength(1);expect(page.items[0]).toMatchObject({id:first.id,likes:2,readAt:null});
  await put(1,path,{active:false}).expect(200);expect((await read(0,'/me/notifications')).body.data.items[0].likes).toBe(1);
  await put(2,path,{active:false}).expect(200);expect((await read(0,'/me/notifications')).body.data.items).toHaveLength(0);
  await put(0,path,{active:true}).expect(200);expect((await read(0,'/me/notifications')).body.data.items).toHaveLength(0);
});

test('隐藏帖子和评论不能通过消息或摘要泄露正文；评论定位跨越第一页',async()=>{
  const p=await post(),root=await comment(p.id);
  await db.comment.update({where:{id:root.id},data:{status:'HIDDEN'}});
  let note=(await read(0,'/me/notifications')).body.data.items[0];expect(note.commentId).toBeNull();expect(note.reason).not.toContain('你好');
  await db.comment.createMany({data:Array.from({length:25},(_,i)=>({id:randomUUID(),postId:p.id,authorId:ids[1],requestKey:randomUUID(),requestHash:'0'.repeat(64),body:'定位评论 '+i,createdAt:new Date(Date.now()+i*10)}))});
  const target=await db.comment.findFirstOrThrow({where:{postId:p.id,status:'PUBLISHED'},orderBy:{createdAt:'desc'}});
  expect((await read(0,'/community/'+p.id)).body.data.comments.map((c:{id:string})=>c.id)).not.toContain(target.id);
  expect((await read(0,'/community/'+p.id+'?commentId='+target.id)).body.data.comments[0].id).toBe(target.id);
  await db.post.update({where:{id:p.id},data:{status:'HIDDEN'}});
  note=(await read(0,'/me/notifications/summary')).body.data.latest;
  expect(note).toMatchObject({postAvailable:false,postTitle:'讨论已不可用',commentId:null});expect(JSON.stringify(note)).not.toContain(p.title);
});

test('消息保存失败时评论和点赞整体回滚，原操作可重试',async()=>{
  const p=await post(),input={requestKey:randomUUID(),body:'通知与评论必须一起保存。'};
  await db.$executeRawUnsafe(`CREATE FUNCTION post_notice_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test notification failure'; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER post_notice_failure BEFORE INSERT ON "Notification" FOR EACH ROW EXECUTE FUNCTION post_notice_failure()`);
  try{
    await write(1,'/community/'+p.id+'/comments',input).expect(503);
    await put(1,'/community/'+p.id+'/like',{active:true}).expect(503);
    expect(await db.comment.count()).toBe(0);expect(await db.postReaction.count()).toBe(0);expect(await db.notice.count({where:{postId:p.id}})).toBe(0);
  }finally{await db.$executeRawUnsafe('DROP TRIGGER post_notice_failure ON "Notification"');await db.$executeRawUnsafe('DROP FUNCTION post_notice_failure()');}
  await write(1,'/community/'+p.id+'/comments',input).expect(201);
  expect((await read(0,'/me/notifications')).body.data.items).toHaveLength(1);
});
