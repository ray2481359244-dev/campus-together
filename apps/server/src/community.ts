import express, { Router } from 'express';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { IdSchema } from '@campus/contracts';
import type { Prisma } from './generated/prisma/client.js';
import { db } from './db.js';
import { requireUser, csrfGuard, writeLimit } from './auth.js';
import { parse, ApiError } from './http.js';
import { notify } from './notices.js';

const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export async function activeUser(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${id}::uuid FOR NO KEY UPDATE`;
  if (!await tx.user.findFirst({ where: { id, status: 'ACTIVE' } })) throw new ApiError(401,'AUTH_REQUIRED','账号不可用，请重新登录。');
}
async function visiblePost(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT "id" FROM "Post" WHERE "id"=${id}::uuid FOR UPDATE`;
  const post = await tx.post.findFirst({ where: { id, status: 'PUBLISHED' } });
  if (!post) throw new ApiError(404,'NOT_FOUND','讨论不存在或已不可见。');
  return post;
}
export async function attachImages(tx: Prisma.TransactionClient, postId: string, authorId: string, ids: string[]) {
  for (const id of [...ids].sort()) await tx.$queryRaw`SELECT "id" FROM "PostImage" WHERE "id"=${id}::uuid FOR UPDATE`;
  const rows = await tx.postImage.findMany({ where: { id: { in: ids }, authorId, OR: [{ postId: null }, { postId }] }, select: { id: true } });
  if (rows.length !== ids.length) throw new ApiError(422,'IMAGE_UNAVAILABLE','图片不存在、已被其他讨论使用或不属于你。');
  await tx.postImage.updateMany({ where: { postId, id: { notIn: ids } }, data: { postId: null } });
  for (const [position,id] of ids.entries()) await tx.postImage.update({ where: { id }, data: { postId, position } });
}
export const communityRouter = Router();
communityRouter.use((_req,res,next) => { res.setHeader('Cache-Control','no-store'); next(); });
communityRouter.post('/media', (_req,res,next) => { requireUser(res); next(); }, writeLimit, csrfGuard, express.json({ limit: '7mb' }), async (req,res) => {
  const user=requireUser(res), input=parse(z.object({ requestKey: z.uuid(), base64: z.string().max(6990508).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict(),req.body);
  const bytes=Buffer.from(input.base64,'base64');
  if(!bytes.length || bytes.length>5*1024*1024 || bytes.toString('base64')!==input.base64) throw new ApiError(422,'INVALID_IMAGE','每张图片最多 5MB，且必须为有效图片。');
  const requestHash=hash(bytes);
  const known=await db.postImage.findUnique({ where: { authorId_requestKey: { authorId:user.id,requestKey:input.requestKey } }, select:{id:true,width:true,height:true,requestHash:true} });
  if(known) { if(known.requestHash!==requestHash) throw new ApiError(409,'REQUEST_KEY_CONFLICT','同一上传请求内容不同。'); res.json({data:{id:known.id,width:known.width,height:known.height}}); return; }
  let output: Awaited<ReturnType<ReturnType<typeof sharp>['metadata']>>, encoded: Buffer;
  try {
    const image=sharp(bytes,{limitInputPixels:16000000,failOn:'warning'}), meta=await image.metadata();
    if(!['jpeg','png','webp'].includes(meta.format || '') || !meta.width || !meta.height || meta.width>8000 || meta.height>8000 || (meta.pages || 1)>1) throw new Error('format');
    encoded=await image.rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).webp({quality:82}).toBuffer();
    output=await sharp(encoded).metadata();
  } catch { throw new ApiError(422,'INVALID_IMAGE','仅支持静态 JPEG、PNG、WebP，最多 1600 万像素，长宽各不超过 8000。'); }
  const result=await db.$transaction(async tx => {
    await activeUser(tx,user.id);
    const prior=await tx.postImage.findUnique({where:{authorId_requestKey:{authorId:user.id,requestKey:input.requestKey}},select:{id:true,width:true,height:true,requestHash:true}});
    if(prior) { if(prior.requestHash!==requestHash) throw new ApiError(409,'REQUEST_KEY_CONFLICT','同一上传请求内容不同。'); return {id:prior.id,width:prior.width,height:prior.height}; }
    if(await tx.postImage.count({where:{authorId:user.id,createdAt:{gte:new Date(Date.now()-86400000)}}})>=30) throw new ApiError(429,'UPLOAD_LIMIT','每人每天最多上传 30 张图片。');
    return tx.postImage.create({data:{authorId:user.id,requestKey:input.requestKey,requestHash,bytes:new Uint8Array(encoded),width:output.width!,height:output.height!},select:{id:true,width:true,height:true}});
  });
  res.status(201).json({data:result});
});
communityRouter.get('/media/:id',async(req,res)=>{
  const id=parse(IdSchema,req.params.id), row=await db.postImage.findFirst({where:{id,OR:[{post:{status:'PUBLISHED'}},{authorId:res.locals.session?.userId || '00000000-0000-4000-8000-000000000000',postId:null}]}});
  if(!row) throw new ApiError(404,'NOT_FOUND','图片不可用。');
  res.type('image/webp').setHeader('Content-Disposition','inline'); res.send(Buffer.from(row.bytes));
});
communityRouter.get('/community/:id',async(req,res)=>{
  const postId=parse(IdSchema,req.params.id), query=parse(z.object({cursor:z.uuid().optional(),commentId:z.uuid().optional()}).strict(),req.query), userId=res.locals.session?.userId;
  const result=await db.$transaction(async tx=>{
    await visiblePost(tx,postId);
    const cursor=query.cursor ? await tx.comment.findFirst({where:{id:query.cursor,postId,status:'PUBLISHED'}}) : null;
    if(query.cursor&&!cursor) throw new ApiError(400,'INVALID_CURSOR','评论位置失效，请重新加载。');
    const target = !cursor && query.commentId ? await tx.comment.findFirst({where:{id:query.commentId,postId,status:'PUBLISHED'}}) : null;
    const rows=await tx.comment.findMany({where:{postId,status:'PUBLISHED',...(cursor?{OR:[{createdAt:{gt:cursor.createdAt}},{createdAt:cursor.createdAt,id:{gt:cursor.id}}]}:target?{OR:[{createdAt:{gt:target.createdAt}},{createdAt:target.createdAt,id:{gte:target.id}}]}:{})},include:{author:{select:{profile:{select:{nickname:true}}}}},orderBy:[{createdAt:'asc'},{id:'asc'}],take:21});
    const replies=await tx.comment.findMany({where:{id:{in:rows.map(c=>c.replyId).filter((id):id is string=>!!id)},postId,status:'PUBLISHED'},select:{id:true,body:true,author:{select:{profile:{select:{nickname:true}}}}}});
    return {notificationsMuted:!!userId&&!!await tx.postMute.findUnique({where:{userId_postId:{userId,postId}}}),likes:await tx.postReaction.count({where:{postId}}),liked:!!userId&&!!await tx.postReaction.findUnique({where:{userId_postId:{userId,postId}}}),saved:!!userId&&!!await tx.favorite.findUnique({where:{userId_postId:{userId,postId}}}),comments:rows.slice(0,20).map(c=>({id:c.id,body:c.body,replyId:c.replyId,reply:c.replyId ? (()=>{const original=replies.find(r=>r.id===c.replyId);return original ? { body: original.body.slice(0,120), nickname: original.author.profile?.nickname || '校园用户' } : null;})() : null,nickname:c.author.profile?.nickname || '校园用户',canDelete:c.authorId===userId,createdAt:c.createdAt.toISOString()})),nextCursor:rows.length>20?rows[19].id:null};
  }); res.json({data:result});
});
communityRouter.post('/community/:id/comments',writeLimit,csrfGuard,async(req,res)=>{
  const user=requireUser(res), postId=parse(IdSchema,req.params.id), input=parse(z.object({requestKey:z.uuid(),body:z.string().trim().min(1).max(1000),replyId:z.uuid().nullable().default(null)}).strict(),req.body), requestHash=hash(JSON.stringify({postId,body:input.body,replyId:input.replyId}));
  const result=await db.$transaction(async tx=>{
    await activeUser(tx,user.id); const post = await visiblePost(tx,postId);
    const known=await tx.comment.findUnique({where:{authorId_requestKey:{authorId:user.id,requestKey:input.requestKey}}});
    if(known) { if(known.requestHash!==requestHash) throw new ApiError(409,'REQUEST_KEY_CONFLICT','同一评论请求内容不同。'); if(known.status!=='PUBLISHED') throw new ApiError(410,'COMMENT_UNAVAILABLE','评论已不可见，不能重发。'); return {id:known.id}; }
    const reply = input.replyId ? await tx.comment.findFirst({where:{id:input.replyId,postId,status:'PUBLISHED'}}) : null;
    if(input.replyId&&!reply) throw new ApiError(422,'INVALID_REPLY','引用的评论不可用或不属于此讨论。');
    const comment = await tx.comment.create({data:{postId,authorId:user.id,...input,requestHash},select:{id:true}});
    const nickname = (await tx.profile.findUnique({where:{userId:user.id}}))?.nickname || '校园用户';
    for (const recipientId of new Set([post.authorId, ...(reply ? [reply.authorId] : [])])) {
      if (recipientId === user.id || await tx.postMute.findUnique({where:{userId_postId:{userId:recipientId,postId}}})) continue;
      const isReply = reply?.authorId === recipientId;
      await notify(tx,{recipientId,sourceKey:'post-comment:'+comment.id,kind:isReply?'POST_REPLY':'POST_COMMENT',title:post.title,reason:nickname+(isReply?' 回复了你的评论。':' 评论了你的讨论。'),postId,commentId:comment.id});
    }
    return comment;
  });res.status(201).json({data:result});
});
communityRouter.delete('/comments/:id',writeLimit,csrfGuard,async(req,res)=>{
  const user=requireUser(res),id=parse(IdSchema,req.params.id);
  await db.$transaction(async tx=>{await activeUser(tx,user.id); const row=await tx.comment.findFirst({where:{id,authorId:user.id}}); if(!row) throw new ApiError(404,'NOT_FOUND','评论不可操作。'); await tx.comment.updateMany({where:{id,authorId:user.id,status:'PUBLISHED'},data:{status:'DELETED',body:'',revision:{increment:1}}});}); res.json({data:{deleted:true}});
});
communityRouter.put('/community/:id/like',writeLimit,csrfGuard,async(req,res)=>{
  const user=requireUser(res),postId=parse(IdSchema,req.params.id),input=parse(z.object({active:z.boolean()}).strict(),req.body);
  const result = await db.$transaction(async tx=>{
    await activeUser(tx,user.id); const post = await visiblePost(tx,postId);
    const sourceKey = 'post-like:'+postId;
    if(input.active) {
      const created = await tx.postReaction.createMany({data:[{userId:user.id,postId}],skipDuplicates:true});
      if(created.count && post.authorId !== user.id && !await tx.postMute.findUnique({where:{userId_postId:{userId:post.authorId,postId}}})) {
        await notify(tx,{recipientId:post.authorId,sourceKey,kind:'POST_LIKED',title:post.title,reason:'你的讨论收到了新的点赞。',postId});
        // Group likes by post; only a new reaction can renew the unread reminder.
        await tx.notification.updateMany({where:{recipientId:post.authorId,notice:{sourceKey}},data:{readAt:null,createdAt:new Date()}});
      }
    } else {
      await tx.postReaction.deleteMany({where:{userId:user.id,postId}});
      if(!await tx.postReaction.count({where:{postId}})) await tx.notice.deleteMany({where:{recipientId:post.authorId,sourceKey}});
    }
    return {active:input.active,likes:await tx.postReaction.count({where:{postId}})};
  });res.json({data:result});
});
communityRouter.put('/community/:id/notifications',writeLimit,csrfGuard,async(req,res)=>{
  const user=requireUser(res),postId=parse(IdSchema,req.params.id),input=parse(z.object({muted:z.boolean()}).strict(),req.body);
  await db.$transaction(async tx=>{
    await activeUser(tx,user.id); await visiblePost(tx,postId);
    if(input.muted) {
      await tx.postMute.upsert({where:{userId_postId:{userId:user.id,postId}},create:{userId:user.id,postId},update:{}});
      await tx.notification.updateMany({where:{recipientId:user.id,readAt:null,notice:{postId}},data:{readAt:new Date()}});
    } else await tx.postMute.deleteMany({where:{userId:user.id,postId}});
  });res.json({data:{notificationsMuted:input.muted}});
});
communityRouter.put('/favorites',writeLimit,csrfGuard,async(req,res)=>{
  const user=requireUser(res),input=parse(z.object({type:z.enum(['POST','RECRUITMENT']),id:z.uuid(),active:z.boolean()}).strict(),req.body), field=input.type==='POST'?'postId':'recruitmentId';
  await db.$transaction(async tx=>{await activeUser(tx,user.id); if(input.active){if(input.type==='POST') await visiblePost(tx,input.id);else if(!await tx.recruitment.findFirst({where:{id:input.id,publicationStatus:'PUBLISHED',hiddenAt:null}})) throw new ApiError(404,'NOT_FOUND','招募不可见。');await tx.favorite.createMany({data:[{userId:user.id,[field]:input.id}],skipDuplicates:true});}else await tx.favorite.deleteMany({where:{userId:user.id,[field]:input.id}});});res.json({data:{active:input.active}});
});
communityRouter.get('/me/saved',async(req,res)=>{
  const user=requireUser(res),query=parse(z.object({cursor:z.uuid().optional()}).strict(),req.query);
  if(query.cursor && !await db.favorite.findFirst({where:{id:query.cursor,userId:user.id}})) throw new ApiError(400,'INVALID_CURSOR','收藏位置失效，请重新加载。');
  const rows=await db.favorite.findMany({where:{userId:user.id},include:{post:{select:{title:true,status:true}},recruitment:{select:{title:true,publicationStatus:true,hiddenAt:true}}},orderBy:[{createdAt:'desc'},{id:'desc'}],take:51,...(query.cursor?{cursor:{id:query.cursor},skip:1}:{})});
  const data=rows.slice(0,50).map(r=>{const available=r.post?.status==='PUBLISHED'||r.recruitment?.publicationStatus==='PUBLISHED'&&!r.recruitment.hiddenAt;return {id:r.id,postId:r.postId,recruitmentId:r.recruitmentId,available,title:available?r.post?.title||r.recruitment?.title:'内容已不可用'};});res.json({data,meta:{nextCursor:rows.length>50?data.at(-1)!.id:null}});
});

export async function purgeOrphanImages() {
  return db.$executeRaw`DELETE FROM "PostImage" WHERE "postId" IS NULL AND "id" IN (SELECT "id" FROM "PostImage" WHERE "postId" IS NULL AND "createdAt" < clock_timestamp() - interval '24 hours' ORDER BY "createdAt" LIMIT 100)`;
}
