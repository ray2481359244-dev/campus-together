import { beforeAll, beforeEach, afterAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { setup, reset, write, read, ids, team, join, apply, actors, tokens } from './test-fixtures.js';
import { db } from './db.js';
import { config } from './config.js';
beforeAll(setup);beforeEach(async()=>{await reset();await db.notice.deleteMany();await db.moderationAction.deleteMany();await db.report.deleteMany();await db.topicRequest.deleteMany();await db.post.deleteMany();await db.user.update({where:{id:ids[2]},data:{role:'ADMIN'}});});afterAll(()=>db.$disconnect());
const operation=(extra:object={})=>({requestKey:randomUUID(),reason:'根据实际反馈进行内容管理',...extra});
async function post(){return (await write(0,'/posts',{requestKey:randomUUID(),topicId:(await db.topic.findFirstOrThrow()).id,title:'用于验证管理流程的讨论',body:'这条讨论用来验证举报、管理员处理与隐藏后的读取权限。'}).expect(201)).body.data;}
test('普通账号与匿名无后台权限，管理员不因此获得私人队伍或聊天',async()=>{
 await read(0,'/admin/reports').expect(403);const r=await team();await read(2,'/teams/'+r.team.id).expect(404);await read(2,'/teams/'+r.team.id+'/chat').expect(404);
 const users=(await read(2,'/admin/users')).body;expect(JSON.stringify(users)).not.toMatch(/email|passwordHash|tokenHash|csrfHash/);
});
test('举报同键幂等、处理通知和隐藏同事务，恢复不能重放旧隐藏',async()=>{
 const p=await post(),body=operation({targetType:'POST',targetId:p.id});const first=(await write(1,'/reports',body).expect(201)).body.data;expect((await write(1,'/reports',body).expect(201)).body.data.id).toBe(first.id);
 await write(1,'/reports',{...body,reason:'相同请求键但不同举报理由'}).expect(409);
 const decide=operation({revision:1,outcome:'HIDE'});await write(2,'/admin/reports/'+first.id+'/resolve',decide).expect(200);await read(1,'/posts/'+p.id).expect(404);
 expect((await read(1,'/me/notifications')).body.data.items.some((n:{kind:string})=>n.kind==='REPORT_RESOLVED')).toBe(true);
 await write(2,'/admin/content/POST/'+p.id,operation({revision:p.revision+1,hidden:false})).expect(200);await read(1,'/posts/'+p.id).expect(200);
 await write(2,'/admin/reports/'+first.id+'/resolve',decide).expect(200);await read(1,'/posts/'+p.id).expect(200);expect(await db.moderationAction.count()).toBe(2);
});
test('已编辑内容的旧举报不能直接隐藏新版本',async()=>{
 const p=await post(),r=(await write(1,'/reports',operation({targetType:'POST',targetId:p.id})).expect(201)).body.data;
 await actors[0].patch('/api/v1/posts/'+p.id).set('Origin',config.origin).set('X-CSRF-Token',tokens[0]).send({revision:1,title:p.title,body:'原来的内容已由作者修改，必须查看当前的内容再决定是否隐藏。'}).expect(200);
 await write(2,'/admin/reports/'+r.id+'/resolve',operation({revision:1,outcome:'HIDE'})).expect(409);expect((await db.report.findUniqueOrThrow({where:{id:r.id}})).status).toBe('PENDING');expect(await db.moderationAction.count()).toBe(0);
});
test('主题规范化去重、审核结果、别名与停用后的历史保留',async()=>{
 const body={requestKey:randomUUID(),category:'GAME',name:'Test Club',description:'新建主题便于讨论游戏协作方式'};const requested=(await write(0,'/topic-requests',body).expect(201)).body.data;
 await write(1,'/topic-requests',{...body,requestKey:randomUUID(),name:'Ｔｅｓｔ　Ｃｌｕｂ'}).expect(409);
 const decision=operation({revision:1,approved:true}),result=(await write(2,'/admin/topic-requests/'+requested.id+'/review',decision).expect(200)).body.data;
 await write(2,'/admin/topic-requests/'+requested.id+'/review',decision).expect(200);expect(await db.topic.count({where:{id:result.topicId}})).toBe(1);
 await write(2,'/admin/topics/'+result.topicId+'/settings',operation({alias:'游戏小组'})).expect(200);
 await write(1,'/topic-requests',{...body,requestKey:randomUUID(),name:'游戏小组'}).expect(409);
 const published=(await write(0,'/posts',{requestKey:randomUUID(),topicId:result.topicId,title:'停用前发布的真实讨论',body:'主题停用之后历史讨论仍应能够正常读取。'}).expect(201)).body.data;
 await write(2,'/admin/topics/'+result.topicId+'/settings',operation({active:false})).expect(200);await read(0,'/posts/'+published.id).expect(200);
 await write(0,'/posts',{requestKey:randomUUID(),topicId:result.topicId,title:'停用主题不允许新发布',body:'停用主题后的新内容不应当发布成功。'}).expect(422);
 expect((await read(0,'/me/notifications')).body.data.items.some((n:{kind:string})=>n.kind==='TOPIC_APPROVED')).toBe(true);
});
test('群聊举报只接受有效成员主动提交的单条可见证据并审计访问',async()=>{
 const r=await team();await join(r);const msg=(await write(0,'/teams/'+r.team.id+'/chat/messages',{clientMessageId:randomUUID(),body:'只允许提交这条消息，不允许读取整队聊天。'}).expect(200)).body.data;
 await write(2,'/reports',operation({targetType:'CHAT_MESSAGE',targetId:msg.id})).expect(404);
 const reported=(await write(1,'/reports',operation({targetType:'CHAT_MESSAGE',targetId:msg.id})).expect(201)).body.data;
 const reports=(await read(2,'/admin/reports').expect(200)).body.data;expect(reports[0].evidence.body).toContain('只允许提交这条消息');expect(await db.moderationAction.count({where:{action:'VIEW_REPORTED_EVIDENCE'}})).toBe(1);
 await write(2,'/admin/reports/'+reported.id+'/resolve',operation({revision:1,outcome:'HIDE'})).expect(200);
 expect((await db.chatMessage.findUniqueOrThrow({where:{id:msg.id}})).body).toBeNull();expect(await db.chatMessage.count({where:{redactsMessageId:msg.id}})).toBe(1);
 await read(2,'/teams/'+r.team.id+'/chat').expect(404);
});
test('封禁撤销旧会话和登录，解封不能恢复旧会话，不能自封',async()=>{
 await write(2,'/admin/users/'+ids[2]+'/status',operation({status:'SUSPENDED'})).expect(409);
 await write(2,'/admin/users/'+ids[1]+'/status',operation({status:'SUSPENDED'})).expect(200);await read(1,'/me/profile').expect(401);
 const csrf=(await actors[1].get('/api/v1/auth/csrf')).body.data.csrfToken;await actors[1].post('/api/v1/auth/login').set('Origin',config.origin).set('X-CSRF-Token',csrf).send({email:'flow-1@campus.invalid',password:'FlowFixtures2026!'}).expect(401);
 await write(2,'/admin/users/'+ids[1]+'/status',operation({status:'ACTIVE'})).expect(200);await read(1,'/me/profile').expect(401);
 const auth=await actors[1].post('/api/v1/auth/login').set('Origin',config.origin).set('X-CSRF-Token',csrf).send({email:'flow-1@campus.invalid',password:'FlowFixtures2026!'}).expect(200);tokens[1]=auth.body.data.csrfToken;
});
test('新申请提醒只创建一次且属于当前队长，隐藏招募阻止新入队',async()=>{
 const r=await team(),a=await apply(r);expect(await db.notice.count({where:{recipientId:ids[0],kind:'APPLICATION_SUBMITTED'}})).toBe(1);
 expect((await read(1,'/me/notifications')).body.data.items).toHaveLength(0);await write(2,'/admin/content/RECRUITMENT/'+r.id,operation({revision:r.revision,hidden:true})).expect(200);await read(1,'/recruitments/'+r.id).expect(404);await write(0,'/applications/'+a.id+'/review',{revision:1,decision:'APPROVE'}).expect(422);
});
test('管理员取消走原生命周期事务并通知，仍不授予队内读取权限',async()=>{
 const r=await team();await join(r);const body={revision:1,reason:'活动存在问题，经核对取消本次活动'};
 await write(2,'/admin/teams/'+r.team.id+'/cancel',body).expect(200);await write(2,'/admin/teams/'+r.team.id+'/cancel',body).expect(200);expect((await db.team.findUniqueOrThrow({where:{id:r.team.id}})).status).toBe('CANCELLED');expect(await db.moderationAction.count({where:{action:'TEAM_CANCEL'}})).toBe(1);await read(2,'/teams/'+r.team.id+'/chat').expect(404);
});
test('审计保存失败时隐藏与结案整体回滚',async()=>{
 const p=await post(),r=(await write(1,'/reports',operation({targetType:'POST',targetId:p.id})).expect(201)).body.data;
 await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION test_moderation_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'verification'; END $$`);await db.$executeRawUnsafe(`CREATE TRIGGER test_moderation_failure BEFORE INSERT ON "ModerationAction" FOR EACH ROW EXECUTE FUNCTION test_moderation_failure()`);
 try{await write(2,'/admin/reports/'+r.id+'/resolve',operation({revision:1,outcome:'HIDE'})).expect(503);expect((await db.post.findUniqueOrThrow({where:{id:p.id}})).status).toBe('PUBLISHED');expect((await db.report.findUniqueOrThrow({where:{id:r.id}})).status).toBe('PENDING');expect(await db.notice.count({where:{kind:'REPORT_RESOLVED'}})).toBe(0);}finally{await db.$executeRawUnsafe('DROP TRIGGER test_moderation_failure ON "ModerationAction"');await db.$executeRawUnsafe('DROP FUNCTION test_moderation_failure()');}
});
