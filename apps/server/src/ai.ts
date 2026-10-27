import { Router } from 'express';
import { createHash } from 'node:crypto';
import { AiDraftInputSchema,AiExplainInputSchema,DraftFieldsSchema,IdSchema } from '@campus/contracts';
import type { Prisma } from './generated/prisma/client.js';
import { db } from './db.js';
import { requireUser,csrfGuard,writeLimit } from './auth.js';
import { parse,ApiError } from './http.js';
import { databaseNow } from './time.js';
import { eligibility } from './applications.js';
import { aiSettings,callModel,SelectionSchema,validateDraft } from './ai-adapter.js';
type ObjectData=Record<string,unknown>;
const json=(v:unknown)=>v as Prisma.InputJsonValue;
async function execute(userId:string,key:string,operation:'DRAFT'|'EXPLAIN',input:unknown,fallback:ObjectData,produce:()=>Promise<ObjectData>){
  const hash=createHash('sha256').update(JSON.stringify({operation,input})).digest('hex'),settings=aiSettings();
  const reservation=await db.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(270008)`;
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id"=${userId}::uuid FOR NO KEY UPDATE`;
    if(!await tx.user.findFirst({where:{id:userId,status:'ACTIVE'}}))throw new ApiError(401,'AUTH_REQUIRED','当前账号不可操作。');
    const prior=await tx.aiRequest.findUnique({where:{userId_requestKey:{userId,requestKey:key}}});
    if(prior){if(prior.requestHash!==hash)throw new ApiError(409,'REQUEST_KEY_CONFLICT','原辅助请求的内容不同，请先核对原结果。');return{record:prior,created:false};}
    const now=await databaseNow(tx),day=new Date(new Date(now.getTime()+8*3600_000).toISOString().slice(0,10)+'T00:00:00+08:00');
    const limit=operation==='DRAFT'?10:20;
    if(await tx.aiRequest.count({where:{userId,operation,createdAt:{gte:day}}})>=limit)throw new ApiError(429,'AI_DAILY_LIMIT','今天的辅助次数已用完，普通表单与条件查看仍可使用。');
    const budget=Number(process.env.AI_DAILY_LIVE_LIMIT||100),allow=settings.live&&Number.isInteger(budget)&&budget>0&&await tx.aiRequest.count({where:{attempted:true,createdAt:{gte:day}}})<budget;
    const base={...fallback,mode:'RULES_ONLY',reason:allow?'模型响应未完成，使用原文和条件规则。':'当前使用条件规则，未进行真实模型调用。'};
    return{record:await tx.aiRequest.create({data:{userId,requestKey:key,operation,requestHash:hash,attempted:allow,fallback:json(base),result:allow?undefined:json(base),createdAt:now}}),created:true};
  },{maxWait:5000,timeout:10000});
  const record=reservation.record;
  const wrap=(result:unknown)=>({...result as ObjectData,id:record.id,createdAt:record.createdAt.toISOString()});
  if(record.result)return wrap(record.result);
  if(!reservation.created){const now=await db.$transaction(tx=>databaseNow(tx));if(now.getTime()-record.createdAt.getTime()<15000)throw new ApiError(409,'AI_IN_PROGRESS','原请求仍在处理中，请稍后使用同一请求核对。');}
  let result:unknown=record.fallback;
  if(reservation.created){try{result={...await produce(),mode:'LIVE',reason:'模型已根据原文或条件依据整理，请核对后使用。'};}catch{result={...record.fallback as ObjectData,reason:'模型暂不可用或结果未通过核对，已回到原文和条件规则。'};}}
  const final=await db.$transaction(async tx=>{await tx.$queryRaw`SELECT "id" FROM "AiRequest" WHERE "id"=${record.id}::uuid FOR UPDATE`;const current=await tx.aiRequest.findUniqueOrThrow({where:{id:record.id}});if(current.result)return current.result;return(await tx.aiRequest.update({where:{id:record.id},data:{result:json(result)}})).result;});return wrap(final);
}
export const aiRouter=Router();
aiRouter.use('/ai',(_req,res,next)=>{requireUser(res);res.setHeader('Cache-Control','no-store');next();});
aiRouter.get('/ai/status',(_req,res)=>res.json({data:{mode:aiSettings().live?'LIVE':'RULES_ONLY',draftDailyLimit:10,explanationDailyLimit:20}}));
aiRouter.post('/ai/recruitment-draft',writeLimit,csrfGuard,async(req,res)=>{
  const user=requireUser(res),{requestKey,text,consent}=parse(AiDraftInputSchema,req.body);
  const fallback={fields:[{field:'description',value:text,sourceExcerpt:text}],missingQuestions:['请确认比赛名称、项目方向和目标。','请在表单亲自填写并核对具体日期、人数、岗位与投入。']};
  res.json({data:await execute(user.id,requestKey,'DRAFT',{text,consent},fallback,async()=>validateDraft(text,await callModel(DraftFieldsSchema,'Extract recruitment text into the six permitted text fields. Each value MUST be an exact substring of sourceExcerpt, and each sourceExcerpt MUST be an exact substring of the original text. Never infer dates, capacity, budget, skills or commitments. Leave unknown fields out and ask missingQuestions. Current Beijing time: '+new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai'}),{text}))) });
});
aiRouter.post('/ai/recruitments/:id/explanation',writeLimit,csrfGuard,async(req,res)=>{
  const user=requireUser(res),id=parse(IdSchema,req.params.id),{requestKey,slotId,timeConfirmed,consent}=parse(AiExplainInputSchema,req.body);
  const assessment=await db.$transaction(async tx=>{const team=await tx.team.findFirst({where:{recruitmentId:id,recruitment:{publicationStatus:'PUBLISHED'}},include:{recruitment:true,slots:{orderBy:{position:'asc'}},members:true}});if(!team)throw new ApiError(404,'NOT_FOUND','招募不存在。');return eligibility(tx,team,user.id,{slotId,timeConfirmed},await databaseNow(tx));},{isolationLevel:'RepeatableRead'});
  const sentences=assessment.checks.map(c=>({evidenceId:c.code,text:c.reason}));
  res.json({data:await execute(user.id,requestKey,'EXPLAIN',{id,slotId,timeConfirmed,consent},{assessment,sentences},async()=>{const selected=SelectionSchema.parse(await callModel(SelectionSchema,'Select relevant evidenceIds to help the user understand this recruitment. Do not create IDs, scores, facts or decisions. Prioritize FAIL and UNKNOWN.',{status:assessment.status,evidence:sentences}));if(selected.evidenceIds.some(id=>!sentences.some(s=>s.evidenceId===id)))throw new Error('AI_UNKNOWN_EVIDENCE');const ids=[...new Set([...assessment.checks.filter(c=>c.status!=='PASS').map(c=>c.code),...selected.evidenceIds])];return{assessment,sentences:ids.map(id=>sentences.find(s=>s.evidenceId===id)!)};})});
});
