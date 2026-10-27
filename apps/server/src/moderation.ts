import { manageTeam } from './teams.js';
import { Router } from 'express';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CategorySchema, IdSchema } from '@campus/contracts';
import type { Prisma } from './generated/prisma/client.js';
import { db } from './db.js';
import { requireUser, csrfGuard, writeLimit } from './auth.js';
import { activeUser } from './community.js';
import { notify } from './notices.js';
import { ApiError, parse } from './http.js';
import { terminal } from './archive.js';
import { databaseNow } from './time.js';
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalize=(name:string)=>name.normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
const reason=z.string().trim().min(5).max(500), key=z.uuid(), version=z.number().int().positive();
const mutation=z.object({requestKey:key,reason});
async function admin(tx:Prisma.TransactionClient,id:string) {await activeUser(tx,id);if(!await tx.user.findFirst({where:{id,role:'ADMIN'}}))throw new ApiError(403,'ADMIN_REQUIRED','只有管理员可以处理。');}
async function audited(tx:Prisma.TransactionClient,adminId:string,targetType:string,targetId:string,action:string,input:{requestKey:string;reason:string},run:()=>Promise<Prisma.InputJsonValue>) {
  const requestHash=digest({targetType,targetId,action,input}),where={adminId_requestKey:{adminId,requestKey:input.requestKey}};
  const prior=await tx.moderationAction.findUnique({where});if(prior){if(prior.requestHash!==requestHash)throw new ApiError(409,'REQUEST_KEY_CONFLICT','管理请求内容不同。');return prior.result;}
  const result=await run();await tx.moderationAction.create({data:{adminId,targetType,targetId,action,requestKey:input.requestKey,reason:input.reason,requestHash,result}});return result;
}
async function topicLock(tx:Prisma.TransactionClient,category:string,name:string) {await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${category+':'+name},0))`;}
async function existingTopic(tx:Prisma.TransactionClient,category:z.infer<typeof CategorySchema>,name:string) {return await tx.topic.findFirst({where:{category,normalizedName:name},select:{id:true,name:true}})||await tx.topicAlias.findFirst({where:{category,normalizedName:name},select:{topic:{select:{id:true,name:true}}}}).then(r=>r?.topic);}
async function content(tx:Prisma.TransactionClient,type:string,id:string,revision:number,hidden:boolean) {
  if(type==='POST') {
    const row=await tx.post.findFirst({where:{id,status:{not:'DELETED'}}});if(!row)throw new ApiError(404,'NOT_FOUND','讨论已不可操作。');
    if(row.revision!==revision)throw new ApiError(409,'CONTENT_CHANGED','讨论已更新，请核对当前内容再处理。');
    await tx.post.update({where:{id},data:{status:hidden?'HIDDEN':'PUBLISHED',revision:{increment:1}}});
  } else if(type==='COMMENT') {
    const row=await tx.comment.findFirst({where:{id,status:{not:'DELETED'}}});if(!row)throw new ApiError(404,'NOT_FOUND','评论已不可操作。');
    if(row.revision!==revision)throw new ApiError(409,'CONTENT_CHANGED','评论已更新，请核对当前内容。');
    await tx.comment.update({where:{id},data:{status:hidden?'HIDDEN':'PUBLISHED',revision:{increment:1}}});
  } else {
    const row=await tx.recruitment.findFirst({where:{id,publicationStatus:'PUBLISHED'}});if(!row)throw new ApiError(404,'NOT_FOUND','招募不可操作。');
    if(row.revision!==revision)throw new ApiError(409,'CONTENT_CHANGED','招募已更新，请核对当前内容。');
    await tx.recruitment.update({where:{id},data:{hiddenAt:hidden?new Date():null,revision:{increment:1}}});
  }
  return {id,hidden,revision:revision+1};
}
async function lockContent(tx:Prisma.TransactionClient,type:string,id:string) {
  if(type==='POST')await tx.$queryRaw`SELECT "id" FROM "Post" WHERE "id"=${id}::uuid FOR UPDATE`;
  else if(type==='COMMENT')await tx.$queryRaw`SELECT "id" FROM "Comment" WHERE "id"=${id}::uuid FOR UPDATE`;
  else await tx.$queryRaw`SELECT "id" FROM "Recruitment" WHERE "id"=${id}::uuid FOR UPDATE`;
}
export const moderationRouter=Router();
moderationRouter.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
moderationRouter.post('/reports',writeLimit,csrfGuard,async(req,res)=>{
  const user=requireUser(res),input=parse(mutation.extend({targetType:z.enum(['POST','COMMENT','RECRUITMENT','CHAT_MESSAGE','USER']),targetId:z.uuid()}).strict(),req.body),requestHash=digest(input);
  const result=await db.$transaction(async tx=>{
    await activeUser(tx,user.id);const where={reporterId_requestKey:{reporterId:user.id,requestKey:input.requestKey}},known=await tx.report.findUnique({where,select:{id:true,requestHash:true}});
    if(known){if(known.requestHash!==requestHash)throw new ApiError(409,'REQUEST_KEY_CONFLICT','举报请求内容不同。');return {id:known.id};}
    if(await tx.report.count({where:{reporterId:user.id,createdAt:{gte:new Date(Date.now()-86400000)}}})>=10)throw new ApiError(429,'REPORT_LIMIT','每人每天最多提交十次举报。');
    let evidence:Prisma.InputJsonValue|undefined;
    if(input.targetType==='POST'){const r=await tx.post.findFirst({where:{id:input.targetId,status:'PUBLISHED'},select:{title:true,body:true,revision:true}});if(r)evidence=r;}
    if(input.targetType==='COMMENT'){const r=await tx.comment.findFirst({where:{id:input.targetId,status:'PUBLISHED',post:{status:'PUBLISHED'}},select:{body:true,revision:true}});if(r)evidence=r;}
    if(input.targetType==='RECRUITMENT'){const r=await tx.recruitment.findFirst({where:{id:input.targetId,publicationStatus:'PUBLISHED',hiddenAt:null},select:{title:true,description:true,revision:true}});if(r)evidence=r;}
    if(input.targetType==='USER'){const r=await tx.profile.findFirst({where:{userId:input.targetId,user:{status:'ACTIVE'}},select:{nickname:true,bio:true}});if(r)evidence=r;}
    if(input.targetType==='CHAT_MESSAGE') {
      const identity=await tx.chatMessage.findUnique({where:{id:input.targetId},select:{teamId:true}});
      if(identity){const t=await tx.team.findUniqueOrThrow({where:{id:identity.teamId},select:{recruitmentId:true}});await tx.$queryRaw`SELECT "id" FROM "Recruitment" WHERE "id"=${t.recruitmentId}::uuid FOR UPDATE`;await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id"=${identity.teamId}::uuid FOR UPDATE`;
        const team=await tx.team.findUniqueOrThrow({where:{id:identity.teamId},include:{chatSpace:true}}),now=await databaseNow(tx);
        if(await tx.teamMember.findFirst({where:{teamId:identity.teamId,userId:user.id,status:'ACTIVE'}})&&!team.chatSpace?.purgedAt&&(!terminal(team.status)||!!team.archiveUntil&&team.archiveUntil>now)){
          const m=await tx.chatMessage.findFirst({where:{id:input.targetId,kind:'TEXT',deletedAt:null}});if(m?.body)evidence={body:m.body,nickname:m.nickname,seq:m.seq,createdAt:m.createdAt.toISOString()};
        }
      }
    }
    if(!evidence)throw new ApiError(404,'NOT_FOUND','目标不存在或当前无权提交此内容的证据。');
    return tx.report.create({data:{reporterId:user.id,...input,requestHash,evidence},select:{id:true}});
  });res.status(201).json({data:result});
});
moderationRouter.get('/me/reports',async(_req,res)=>{const user=requireUser(res);res.json({data:await db.report.findMany({where:{reporterId:user.id},select:{id:true,targetType:true,status:true,reason:true,resolution:true,createdAt:true},orderBy:[{createdAt:'desc'},{id:'desc'}],take:50})});});
moderationRouter.post('/topic-requests',writeLimit,csrfGuard,async(req,res)=>{
  const user=requireUser(res),input=parse(z.object({requestKey:key,category:CategorySchema,name:z.string().trim().min(2).max(40),description:z.string().trim().min(5).max(300)}).strict(),req.body),normalizedName=normalize(input.name),requestHash=digest(input);
  const result=await db.$transaction(async tx=>{
    await activeUser(tx,user.id);const known=await tx.topicRequest.findUnique({where:{userId_requestKey:{userId:user.id,requestKey:input.requestKey}}});if(known){if(known.requestHash!==requestHash)throw new ApiError(409,'REQUEST_KEY_CONFLICT','原申请内容不同。');return {id:known.id};}
    if(normalizedName.length>80)throw new ApiError(400,'INVALID_INPUT','主题规范名称过长。');
    await topicLock(tx,input.category,normalizedName);const existing=await existingTopic(tx,input.category,normalizedName);
    if(existing)throw new ApiError(409,'TOPIC_EXISTS','已有主题「'+existing.name+'」，请直接选择。');
    if(await tx.topicRequest.findFirst({where:{category:input.category,normalizedName,status:'PENDING'}}))throw new ApiError(409,'TOPIC_PENDING','此主题已有人申请，正在等待审核。');
    if(await tx.topicRequest.count({where:{userId:user.id,status:'PENDING'}})>=5)throw new ApiError(429,'TOPIC_REQUEST_LIMIT','每人最多五个待审核主题。');
    return tx.topicRequest.create({data:{userId:user.id,...input,normalizedName,requestHash},select:{id:true}});
  });res.status(201).json({data:result});
});
moderationRouter.get('/me/topic-requests',async(_req,res)=>{const user=requireUser(res);res.json({data:await db.topicRequest.findMany({where:{userId:user.id},select:{id:true,category:true,name:true,description:true,status:true,reason:true,topicId:true,createdAt:true},orderBy:[{createdAt:'desc'},{id:'desc'}],take:50})});});
moderationRouter.use('/admin',(_req,res,next)=>{const user=requireUser(res);if(user.role!=='ADMIN')throw new ApiError(403,'ADMIN_REQUIRED','仅管理员可访问。');next();});
moderationRouter.get('/admin/:collection',async(req,res)=>{
  const input=parse(z.object({cursor:z.uuid().optional(),q:z.string().trim().max(60).optional()}).strict(),req.query),collection=parse(z.enum(['reports','topics','users','posts','comments','recruitments','audit','topic-settings']),req.params.collection),user=requireUser(res);
  const pagination={take:51,orderBy:{id:'desc' as const},...(input.cursor?{cursor:{id:input.cursor},skip:1}:{})};
  let rows:({id:string}&object)[]=[];
  if(collection==='reports'){
    rows=await db.$transaction(async tx=>{await admin(tx,user.id);const rows=await tx.report.findMany({...pagination,select:{id:true,targetType:true,targetId:true,reason:true,evidence:true,status:true,revision:true,createdAt:true,resolution:true}});for(const row of rows.filter(r=>r.targetType==='CHAT_MESSAGE'))await tx.moderationAction.create({data:{adminId:user.id,requestKey:randomUUID(),requestHash:digest(row.id),action:'VIEW_REPORTED_EVIDENCE',targetType:'REPORT',targetId:row.id,reason:'查看成员主动提交的举报证据',result:{reportId:row.id}}});return rows;});
  } else if(collection==='topics')rows=await db.topicRequest.findMany({...pagination,select:{id:true,category:true,name:true,description:true,status:true,revision:true,reason:true,topicId:true}});
  else if(collection==='topic-settings')rows=await db.topic.findMany({...pagination,select:{id:true,name:true,category:true,active:true}});
  else if(collection==='users')rows=await db.user.findMany({...pagination,where:input.q?{profile:{nickname:{contains:input.q,mode:'insensitive'}}}:{},select:{id:true,status:true,role:true,profile:{select:{nickname:true}}}});
  else if(collection==='posts')rows=await db.post.findMany({...pagination,where:{status:{not:'DELETED'}},select:{id:true,title:true,body:true,status:true,revision:true}});
  else if(collection==='comments')rows=await db.comment.findMany({...pagination,where:{status:{not:'DELETED'}},select:{id:true,body:true,status:true,revision:true}});
  else if(collection==='recruitments')rows=await db.recruitment.findMany({...pagination,where:{publicationStatus:'PUBLISHED'},select:{id:true,title:true,description:true,hiddenAt:true,revision:true,team:{select:{id:true,status:true,revision:true}}}});
  else rows=await db.moderationAction.findMany({...pagination,select:{id:true,adminId:true,action:true,targetType:true,targetId:true,reason:true,result:true,createdAt:true}});
  res.json({data:rows.slice(0,50),meta:{nextCursor:rows.length>50?rows[49].id:null}});
});
moderationRouter.post('/admin/content/:type/:id',writeLimit,csrfGuard,async(req,res)=>{
  const user=requireUser(res),id=parse(IdSchema,req.params.id),type=parse(z.enum(['POST','COMMENT','RECRUITMENT']),req.params.type),input=parse(mutation.extend({revision:version,hidden:z.boolean()}).strict(),req.body);
  const result=await db.$transaction(async tx=>{await admin(tx,user.id);return audited(tx,user.id,type,id,'CONTENT_VISIBILITY',input,async()=>{await lockContent(tx,type,id);return content(tx,type,id,input.revision,input.hidden);});});res.json({data:result});
});
moderationRouter.post('/admin/reports/:id/resolve',writeLimit,csrfGuard,async(req,res)=>{
  const user=requireUser(res),id=parse(IdSchema,req.params.id),input=parse(mutation.extend({revision:version,outcome:z.enum(['RESOLVED','DISMISSED','HIDE'])}).strict(),req.body);
  const result=await db.$transaction(async tx=>{await admin(tx,user.id);return audited(tx,user.id,'REPORT',id,'REPORT_RESOLVE',input,async()=>{
    await tx.$queryRaw`SELECT "id" FROM "Report" WHERE "id"=${id}::uuid FOR UPDATE`;const row=await tx.report.findUnique({where:{id}});
    if(!row)throw new ApiError(404,'NOT_FOUND','举报不存在。');if(row.status!=='PENDING'||row.revision!==input.revision)throw new ApiError(409,'REPORT_CHANGED','举报已处理，请刷新。');
    if(input.outcome==='HIDE'){
      if(['POST','COMMENT','RECRUITMENT'].includes(row.targetType)){await lockContent(tx,row.targetType,row.targetId);const evidence=row.evidence as {revision:number};await content(tx,row.targetType,row.targetId,evidence.revision,true);}
      else if(row.targetType==='CHAT_MESSAGE'){
        const msg=await tx.chatMessage.findUnique({where:{id:row.targetId},select:{id:true,teamId:true,deletedAt:true}});
        if(msg&&!msg.deletedAt){const identity=await tx.team.findUniqueOrThrow({where:{id:msg.teamId},select:{recruitmentId:true}});await tx.$queryRaw`SELECT "id" FROM "Recruitment" WHERE "id"=${identity.recruitmentId}::uuid FOR UPDATE`;await tx.$queryRaw`SELECT "id" FROM "Team" WHERE "id"=${msg.teamId}::uuid FOR UPDATE`;await tx.chatMessage.update({where:{id:msg.id},data:{body:null,deletedAt:new Date()}});const space=await tx.chatSpace.update({where:{teamId:msg.teamId},data:{lastSeq:{increment:1}}});await tx.chatMessage.create({data:{teamId:msg.teamId,seq:space.lastSeq,kind:'SYSTEM',nickname:'队伍动态',body:'一条消息已由管理员依据举报隐藏。',redactsMessageId:msg.id}});}
      } else throw new ApiError(422,'INVALID_ACTION','账号举报请在账号管理中处理。');
    }
    const status=input.outcome==='DISMISSED'?'DISMISSED':'RESOLVED';await tx.report.update({where:{id},data:{status,resolution:input.reason,handledAt:new Date(),revision:{increment:1}}});await notify(tx,{recipientId:row.reporterId,sourceKey:'report:'+id,kind:'REPORT_RESOLVED',title:'举报处理结果',reason:input.reason});return {id,status};
  });});res.json({data:result});
});
moderationRouter.post('/admin/topic-requests/:id/review',writeLimit,csrfGuard,async(req,res)=>{
  const user=requireUser(res),id=parse(IdSchema,req.params.id),input=parse(mutation.extend({revision:version,approved:z.boolean()}).strict(),req.body);
  const result=await db.$transaction(async tx=>{await admin(tx,user.id);return audited(tx,user.id,'TOPIC_REQUEST',id,'TOPIC_REVIEW',input,async()=>{
    await tx.$queryRaw`SELECT "id" FROM "TopicRequest" WHERE "id"=${id}::uuid FOR UPDATE`;const row=await tx.topicRequest.findUnique({where:{id}});if(!row)throw new ApiError(404,'NOT_FOUND','主题申请不存在。');if(row.status!=='PENDING'||row.revision!==input.revision)throw new ApiError(409,'TOPIC_REQUEST_CHANGED','申请已处理。');
    let topicId:string|null=null;if(input.approved){await topicLock(tx,row.category,row.normalizedName);const prior=await existingTopic(tx,row.category,row.normalizedName);topicId=prior?.id || (await tx.topic.create({data:{category:row.category,name:row.name,normalizedName:row.normalizedName,description:row.description}})).id;}
    const status=input.approved?'APPROVED':'REJECTED';await tx.topicRequest.update({where:{id},data:{status,topicId,reason:input.reason,revision:{increment:1}}});await notify(tx,{recipientId:row.userId,sourceKey:'topic:'+id,kind:input.approved?'TOPIC_APPROVED':'TOPIC_REJECTED',title:row.name,reason:input.reason});return {id,status,topicId};
  });});res.json({data:result});
});
moderationRouter.post('/admin/topics/:id/settings',writeLimit,csrfGuard,async(req,res)=>{
  const user=requireUser(res),id=parse(IdSchema,req.params.id),input=parse(mutation.extend({active:z.boolean().optional(),alias:z.string().trim().min(2).max(40).optional()}).refine(v=>v.active!==undefined||!!v.alias).strict(),req.body);
  const result=await db.$transaction(async tx=>{await admin(tx,user.id);return audited(tx,user.id,'TOPIC',id,'TOPIC_SETTINGS',input,async()=>{
    await tx.$queryRaw`SELECT "id" FROM "Topic" WHERE "id"=${id}::uuid FOR UPDATE`;const row=await tx.topic.findUnique({where:{id}});if(!row)throw new ApiError(404,'NOT_FOUND','主题不存在。');
    if(input.alias){const name=normalize(input.alias);if(name.length>80)throw new ApiError(400,'INVALID_INPUT','主题别名过长。');await topicLock(tx,row.category,name);const found=await existingTopic(tx,row.category,name);if(found&&found.id!==id)throw new ApiError(409,'TOPIC_EXISTS','此名称或别名已存在。');if(!found)await tx.topicAlias.create({data:{topicId:id,category:row.category,normalizedName:name}});}
    if(input.active!==undefined)await tx.topic.update({where:{id},data:{active:input.active}});return {id,active:input.active??row.active};
  });});res.json({data:result});
});
moderationRouter.post('/admin/users/:id/status',writeLimit,csrfGuard,async(req,res)=>{
  const user=requireUser(res),id=parse(IdSchema,req.params.id),input=parse(mutation.extend({status:z.enum(['ACTIVE','SUSPENDED'])}).strict(),req.body);
  const result=await db.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('admin-status',0))`;for(const uid of [...new Set([user.id,id])].sort())await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${uid}::uuid FOR NO KEY UPDATE`;await admin(tx,user.id);
    return audited(tx,user.id,'USER',id,'USER_STATUS',input,async()=>{
      const target=await tx.user.findUnique({where:{id},select:{role:true,status:true}});if(!target||target.status==='DELETED')throw new ApiError(404,'NOT_FOUND','账号不可操作。');if(id===user.id)throw new ApiError(409,'SELF_MODERATION','不能在后台封禁自己。');
      if(input.status==='SUSPENDED'&&target.role==='ADMIN'&&target.status==='ACTIVE'&&await tx.user.count({where:{role:'ADMIN',status:'ACTIVE'}})<=1)throw new ApiError(409,'LAST_ADMIN','不能封禁最后一个有效管理员。');
      await tx.user.update({where:{id},data:{status:input.status}});if(input.status==='SUSPENDED')await tx.session.updateMany({where:{userId:id,revokedAt:null},data:{revokedAt:new Date()}});return {id,status:input.status};
    });
  });res.json({data:result});
});

moderationRouter.post('/admin/teams/:id/cancel',writeLimit,csrfGuard,async(req,res)=>{
 const user=requireUser(res),id=parse(IdSchema,req.params.id),input=parse(z.object({revision:version,reason}).strict(),req.body);
 res.json({data:await manageTeam(id,user.id,{kind:'CANCEL',...input},true)});
});
