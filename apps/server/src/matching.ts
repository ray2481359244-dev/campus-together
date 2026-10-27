import { Router } from 'express';
import { MatchingSchema, RecruitmentDraftSchema } from '@campus/contracts';
import type { MatchItemDTO } from '@campus/contracts';
import { db } from './db.js';
import { requireUser,csrfGuard,writeLimit } from './auth.js';
import { parse } from './http.js';
import { eligibility } from './applications.js';
import { databaseNow } from './time.js';
export function rankDimensions(input:{time:boolean|null;goal:string;requestedGoal:string;mode:string;requestedMode:string|null;skills:string[];requiredSkills:string[]}) {
  const normalize=(v:string)=>v.normalize('NFKC').trim().toLowerCase(),skills=new Set(input.skills.map(normalize));
  const dimensions=[{id:'TIME',label:'本次时间确认',weight:35,value:input.time===null?null:Number(input.time),applicable:true,reason:input.time===null?'尚未确认本次时间。':'按你对本次活动的明确确认。'},
    {id:'GOAL',label:'目标文字一致度',weight:25,value:input.requestedGoal?Number(normalize(input.goal)===normalize(input.requestedGoal)):null,applicable:!!input.goal,reason:input.requestedGoal?'仅精确对照目标文字，不推断语义兼容。':'尚未填写目标偏好。'},
    {id:'MODE',label:'协作形式偏好',weight:20,value:input.requestedMode===null?null:Number(input.mode===input.requestedMode),applicable:true,reason:input.requestedMode?'按明确的线上 / 线下偏好对照。':'没有指定协作形式偏好。'},
    {id:'SKILLS',label:'自述技能标签',weight:20,value:input.requiredSkills.length?input.requiredSkills.filter(s=>skills.has(normalize(s))).length/input.requiredSkills.length:null,applicable:input.requiredSkills.length>0,reason:input.requiredSkills.length?'标签命中比例，不代表能力认证。':'岗位不限额外技能，本维不计分。'}];
  const applicable=dimensions.filter(d=>d.applicable),known=applicable.filter(d=>d.value!==null),denominator=known.reduce((s,d)=>s+d.weight,0),total=applicable.reduce((s,d)=>s+d.weight,0);
  return{dimensions,score:denominator?Math.round(100*known.reduce((s,d)=>s+d.weight*d.value!,0)/denominator):null,completeness:total?Math.round(100*denominator/total):0};
}
export const matchingRouter=Router();
matchingRouter.post('/matching/recruitments',writeLimit,csrfGuard,async(req,res)=>{
  const user=requireUser(res),input=parse(MatchingSchema,req.body);res.setHeader('Cache-Control','no-store');
  const data=await db.$transaction(async tx=>{const now=await databaseNow(tx),profile=await tx.profile.findUniqueOrThrow({where:{userId:user.id}});
    const teams=await tx.team.findMany({where:{status:{in:['OPEN','FULL']},recruitmentClosedAt:null,recruitment:{publicationStatus:'PUBLISHED',joinDeadline:{gt:now},OR:[{schoolId:input.schoolId},{allowCrossSchool:true}]}},include:{recruitment:true,slots:{orderBy:{position:'asc'}},members:true},orderBy:[{createdAt:'desc'},{id:'desc'}],take:30});
    const items:MatchItemDTO[]=[];const order={PASS:0,UNKNOWN:1,FAIL:2};
    for(const team of teams){const draft=RecruitmentDraftSchema.parse(team.recruitment.payload),options:MatchItemDTO[]=[];for(const slot of team.slots){const time=input.confirmations[team.recruitmentId]??null,assessment=await eligibility(tx,team,user.id,{slotId:slot.id,timeConfirmed:time},now);options.push({startAt:draft.startAt,endAt:draft.endAt,weeklyHours:draft.weeklyHours,collaboration:draft.collaboration,recruitmentId:team.recruitmentId,teamId:team.id,title:team.recruitment.title,slotId:slot.id,slotName:slot.name,assessment,...rankDimensions({time,goal:draft.goal,requestedGoal:input.goal,mode:draft.mode,requestedMode:input.mode,skills:profile.skills,requiredSkills:slot.requiredSkills})});}options.sort((a,b)=>order[a.assessment.status]-order[b.assessment.status]||(b.score??-1)-(a.score??-1)||b.completeness-a.completeness);if(options[0])items.push(options[0]);}
    items.sort((a,b)=>order[a.assessment.status]-order[b.assessment.status]||(b.score??-1)-(a.score??-1)||b.completeness-a.completeness||a.recruitmentId.localeCompare(b.recruitmentId));return{mode:'RULES_ONLY' as const,scope:'当前浏览学校及接受跨校意向的最近 30 条招募，最多展示 20 条。',items:items.slice(0,20)};
  },{isolationLevel:'RepeatableRead',timeout:10000});res.json({data});
});
