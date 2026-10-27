import { beforeAll, beforeEach, afterAll, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { RecruitmentDraftSchema } from '@campus/contracts';
import { db } from './db.js';
import { setup, reset, write, read, ids } from './test-fixtures.js';
beforeAll(setup); beforeEach(reset); afterAll(() => db.$disconnect());
async function scene(category: 'GAME'|'STUDY'|'OUTDOOR', joinMode: 'AUTO'|'APPROVAL' = 'AUTO') {
  const topic = await db.topic.upsert({ where: { category_normalizedName: { category, normalizedName: category } }, create: { category, name: category, normalizedName: category }, update: {} });
  const key=randomUUID(), at=(h:number)=>new Date(Date.now()+h*3600000).toISOString();
  const draft=RecruitmentDraftSchema.parse({ category, joinMode, topicId:topic.id, title:'四区真实招募流程验证', description:'验证不同场景的条件检查和直接加入，确保实际名额与成员权限始终一致。', goal:'一起参与', collaboration:'周六下午', startAt:at(24),endAt:at(26),capacity:2,slots:[{key,name:'成员',capacity:2}],captainSlotKey:key,
    ...(category==='GAME'?{game:{server:'华东',platform:'PC',playMode:'休闲'}}:category==='STUDY'?{study:{subject:'高数复习',level:'基础自述',method:'DISCUSS',methodRequired:true,frequency:'本周六一次'}}:{outdoor:{activity:'城市摄影',region:'校园周边',budget:50,distance:'两小时',intensity:'LOW',experience:'能步行两小时',equipment:'饮用水'}}) });
  const created=(await write(0,'/recruitments',{requestKey:randomUUID(),draft}).expect(201)).body.data;
  return (await write(0,'/recruitments/'+created.id+'/publish',{revision:1}).expect(201)).body.data;
}
function input(r:any, answers:object) {return { requestKey:randomUUID(),slotId:r.team.slots[0].id,timeConfirmed:true,message:'已核对条件',answers };}
test('游戏服务器与平台不能绕过，直接加入的重试不复活退出成员',async()=>{
  const r=await scene('GAME');
  await write(1,'/teams/'+r.team.id+'/applications',input(r,{server:'华北',platform:'PC'})).expect(422);
  await write(1,'/teams/'+r.team.id+'/applications',input(r,{})).expect(422);
  const body=input(r,{server:'华东',platform:'PC'}), first=(await write(1,'/teams/'+r.team.id+'/applications',body).expect(201)).body.data;
  expect(first.status).toBe('APPROVED'); expect(first.membership.status).toBe('ACTIVE');
  expect((await write(1,'/teams/'+r.team.id+'/applications',body).expect(200)).body.data.id).toBe(first.id);
  expect(await db.teamMember.count({where:{teamId:r.team.id,status:'ACTIVE'}})).toBe(2);
  await read(1,'/teams/'+r.team.id+'/chat').expect(200);
  const member=await db.teamMember.findUniqueOrThrow({where:{teamId_userId:{teamId:r.team.id,userId:ids[1]}}});
  await write(1,'/teams/'+r.team.id+'/leave',{revision:member.revision}).expect(200);
  expect((await write(1,'/teams/'+r.team.id+'/applications',body).expect(200)).body.data.membership.status).toBe('LEFT');
  await read(1,'/teams/'+r.team.id+'/chat').expect(404);
});
test('学习方式硬条件和最后名额并发检查',async()=>{
  const r=await scene('STUDY');
  await write(1,'/teams/'+r.team.id+'/applications',input(r,{studyMethod:'SELF'})).expect(422);
  const results=await Promise.all([1,2].map(i=>write(i,'/teams/'+r.team.id+'/applications',input(r,{studyMethod:'DISCUSS'}))));
  expect(results.map(r=>r.status).sort()).toEqual([201,422]);
  expect(await db.teamMember.count({where:{teamId:r.team.id,status:'ACTIVE'}})).toBe(2);
  expect((await db.team.findUniqueOrThrow({where:{id:r.team.id}})).status).toBe('FULL');
});
test('户外要求必须显式确认，审核时重新使用原条件声明',async()=>{
  const r=await scene('OUTDOOR','APPROVAL');
  await write(1,'/teams/'+r.team.id+'/applications',input(r,{experienceConfirmed:true})).expect(422);
  const a=(await write(1,'/teams/'+r.team.id+'/applications',input(r,{experienceConfirmed:true,equipmentConfirmed:true})).expect(201)).body.data;
  expect(a.status).toBe('PENDING'); await read(1,'/teams/'+r.team.id+'/chat').expect(404);
  await write(0,'/applications/'+a.id+'/review',{revision:1,decision:'APPROVE'}).expect(200);
  await read(1,'/teams/'+r.team.id+'/chat').expect(200);
});
test('主题区域校验和发布后说明版本保护',async()=>{
  const r=await scene('GAME'), draft={...r.draft,category:'STUDY'};
  await write(0,'/recruitments',{requestKey:randomUUID(),draft}).expect(422);
  const patch=(who:number,revision:number)=>read(who,'/auth/me').then(async session=>{
    const {actors}=await import('./test-fixtures.js');return actors[who].patch('/api/v1/recruitments/'+r.id+'/text').set('Origin',(await import('./config.js')).config.origin).set('X-CSRF-Token',session.body.data.csrfToken).send({revision,title:'已更新的游戏组队标题',description:r.description}); });
  expect((await patch(1,r.revision)).status).toBe(404); expect((await patch(0,r.revision)).status).toBe(200); expect((await patch(0,r.revision)).status).toBe(409);
});
test('不同学校只在显式筛选跨校时出现；读者可关联可见讨论',async()=>{
  const r=await scene('STUDY'), other=await db.school.create({data:{name:'跨校筛选验证',city:'测试'}});
  expect((await read(1,'/recruitments?schoolId='+other.id+'&category=STUDY').expect(200)).body.data).toHaveLength(0);
  await db.recruitment.update({where:{id:r.id},data:{allowCrossSchool:true}});
  expect((await read(1,'/recruitments?schoolId='+other.id+'&category=STUDY&includeCrossSchool=true').expect(200)).body.data.map((v:any)=>v.id)).toContain(r.id);
  const post=(await write(1,'/posts',{requestKey:randomUUID(),topicId:r.draft.topicId,title:'讨论关联的学习计划',body:'希望寻找同学一起复习高等数学内容。'}).expect(201)).body.data;
  const created=(await write(0,'/recruitments',{requestKey:randomUUID(),draft:{...r.draft,sourcePostId:post.id}}).expect(201)).body.data;
  await write(0,'/recruitments/'+created.id+'/publish',{revision:1}).expect(201);
  expect((await read(1,'/post-recruitments/'+post.id).expect(200)).body.data[0].author.id).toBe(ids[0]);
});
