import { purgeOrphanImages } from './community.js';
import { beforeAll, beforeEach, afterAll, expect, test } from 'vitest';
import sharp from 'sharp';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { setup, reset, actors, tokens, write, read, ids, team } from './test-fixtures.js';
import { app } from './app.js';
import { db } from './db.js';
import { config } from './config.js';
beforeAll(setup); beforeEach(async()=>{await reset();await db.post.deleteMany();}); afterAll(()=>db.$disconnect());
const put=(who:number,path:string,body:object)=>actors[who].put('/api/v1'+path).set('Origin',config.origin).set('X-CSRF-Token',tokens[who]).send(body);
async function post(imageIds?:string[]) { const topic=await db.topic.findFirstOrThrow(); return (await write(0,'/posts',{requestKey:randomUUID(),topicId:topic.id,title:'社区图片互动的真实讨论',body:'测试图片、评论、点赞与收藏的权限和持久化。',...(imageIds?{imageIds}:{})}).expect(201)).body.data; }
async function image(who=0) {const bytes=await sharp({create:{width:40,height:30,channels:3,background:'#ffeecc'}}).jpeg().withMetadata({exif:{IFD0:{Artist:'private-test-metadata'}}}).toBuffer();const body={requestKey:randomUUID(),base64:bytes.toString('base64')};return {body,result:await write(who,'/media',body).expect(201)};}
test('上传重新编码、移除 EXIF，原请求幂等且未发布图片仅本人读取',async()=>{
  const {body,result}=await image(),id=result.body.data.id;
  expect((await write(0,'/media',body).expect(200)).body.data.id).toBe(id);
  await request(app).get('/api/v1/media/'+id).expect(404);await read(1,'/media/'+id).expect(404);
  const privateImage=await read(0,'/media/'+id).expect(200), metadata=await sharp(privateImage.body).metadata();
  expect(metadata.format).toBe('webp');expect(metadata.exif).toBeUndefined();
  const p=await post([id]); expect(p.images[0].id).toBe(id);await request(app).get('/api/v1/media/'+id).expect(200);
  await db.post.update({where:{id:p.id},data:{status:'HIDDEN'}});await read(0,'/media/'+id).expect(404);
});
test('拒绝 SVG、损坏格式、超尺寸及超大文件，上传键不能换内容',async()=>{
  for(const bytes of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),Buffer.from('not an image'),await sharp({create:{width:8001,height:1,channels:3,background:'#fff'}}).png().toBuffer()])await write(0,'/media',{requestKey:randomUUID(),base64:bytes.toString('base64')}).expect(422);
  await write(0,'/media',{requestKey:randomUUID(),base64:Buffer.alloc(5*1024*1024+1).toString('base64')}).expect(422);
  const {body}=await image();await write(0,'/media',{...body,base64:Buffer.from('different image').toString('base64')}).expect(409);
});
test('不可借用他人图片；附件失败整帖回滚且不能重复绑定其他帖子',async()=>{
  const {result}=await image(1),id=result.body.data.id,topic=await db.topic.findFirstOrThrow();
  await write(0,'/posts',{requestKey:randomUUID(),topicId:topic.id,title:'借用图片应当整体拒绝',body:'错误附件不能留下半个可见的帖子。',imageIds:[id]}).expect(422);
  expect(await db.post.count()).toBe(0);
  const mine=(await image()).result.body.data.id; await post([mine]);
  await write(0,'/posts',{requestKey:randomUUID(),topicId:topic.id,title:'重复绑定同一图片应当拒绝',body:'同一上传的图片不能同时被两个帖子绑定。',imageIds:[mine]}).expect(422);
  expect(await db.post.count()).toBe(1);
});
test('点赞与收藏按明确状态幂等；私人收藏不泄露隐藏标题',async()=>{
  const p=await post();await Promise.all([put(1,'/community/'+p.id+'/like',{active:true}).expect(200),put(1,'/community/'+p.id+'/like',{active:true}).expect(200)]);
  await put(1,'/favorites',{type:'POST',id:p.id,active:true}).expect(200);await put(1,'/favorites',{type:'POST',id:p.id,active:true}).expect(200);
  expect((await read(1,'/community/'+p.id)).body.data).toMatchObject({likes:1,liked:true,saved:true});expect((await read(2,'/community/'+p.id)).body.data).toMatchObject({liked:false,saved:false});
  expect((await read(2,'/me/saved')).body.data).toHaveLength(0);await db.post.update({where:{id:p.id},data:{status:'HIDDEN'}});
  const saved=(await read(1,'/me/saved')).body.data;expect(saved[0]).toMatchObject({available:false,title:'内容已不可用'});expect(JSON.stringify(saved)).not.toContain(p.title);
  await put(1,'/favorites',{type:'POST',id:p.id,active:false}).expect(200);expect((await read(1,'/me/saved')).body.data).toHaveLength(0);
});
test('评论并发重试、引用限定本帖、作者删除与重试不复活',async()=>{
  const p=await post(),body={requestKey:randomUUID(),body:'持久化评论的原始内容'};
  const pair=await Promise.all([write(1,'/community/'+p.id+'/comments',body).expect(201),write(1,'/community/'+p.id+'/comments',body).expect(201)]);expect(pair[0].body.data.id).toBe(pair[1].body.data.id);
  const id=pair[0].body.data.id;await write(1,'/community/'+p.id+'/comments',{...body,body:'不同内容'}).expect(409);
  const other=await post();await write(2,'/community/'+other.id+'/comments',{requestKey:randomUUID(),body:'跨帖引用不可以',replyId:id}).expect(422);
  await actors[0].delete('/api/v1/comments/'+id).set('Origin',config.origin).set('X-CSRF-Token',tokens[0]).expect(404);
  await actors[1].delete('/api/v1/comments/'+id).set('Origin',config.origin).set('X-CSRF-Token',tokens[1]).expect(200);
  await write(1,'/community/'+p.id+'/comments',body).expect(410);expect((await read(1,'/community/'+p.id)).body.data.comments).toHaveLength(0);
});
test('隐藏或删除后的讨论不允许新增互动，招募收藏来自真实公开内容',async()=>{
  const p=await post();await db.post.update({where:{id:p.id},data:{status:'DELETED'}});await read(1,'/community/'+p.id).expect(404);await write(1,'/community/'+p.id+'/comments',{requestKey:randomUUID(),body:'不应允许新增'}).expect(404);
  const r=await team();await put(1,'/favorites',{type:'RECRUITMENT',id:r.id,active:true}).expect(200);expect((await read(1,'/me/saved')).body.data[0].recruitmentId).toBe(r.id);
  await db.user.update({where:{id:ids[1]},data:{status:'SUSPENDED'}});await read(1,'/me/saved').expect(401);
});

test('24 小时未绑定图片清理不会删除已发布附件',async()=>{
 const first=(await image()).result.body.data.id, second=(await image()).result.body.data.id; await post([first]);
 await db.postImage.updateMany({where:{id:{in:[first,second]}},data:{createdAt:new Date(Date.now()-25*3600000)}});
 expect(await purgeOrphanImages()).toBe(1);expect(await db.postImage.findUnique({where:{id:first}})).not.toBeNull();expect(await purgeOrphanImages()).toBe(0);
});
