import 'dotenv/config';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Client } from 'pg';
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test') || testUrl === process.env.DATABASE_URL) throw new Error('Team recovery requires a separate _test database.');
const origin = 'http://127.0.0.1:3102', instance = 'chat-recovery-' + randomUUID(), database = new Client({ connectionString: testUrl });
let server, ownerId, result;
const recruitmentIds = [], owner = { cookie: '', csrf: '' }, member = { cookie: '', csrf: '' };
async function start() {
  const reservation = createServer();
  await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(3102, '127.0.0.1', resolve); });
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  server = spawn(process.execPath, ['apps/server/dist/index.js'], { windowsHide: true, stdio: 'ignore', env: { ...process.env, DATABASE_URL: testUrl, PORT: '3102', WEB_ORIGIN: origin, NODE_ENV: 'test', CAMPUS_DEV_INSTANCE: instance } });
  for (let i = 0; i < 60; i++) {
    if (server.exitCode !== null) throw new Error('Team recovery API exited early.');
    try { const health = await (await fetch(origin + '/api/v1/health', { signal: AbortSignal.timeout(700) })).json(); if (health.data?.devInstance === instance && (await fetch(origin + '/api/v1/ready', { signal: AbortSignal.timeout(700) })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Team recovery API startup timed out.');
}
async function stop() { if (server && server.exitCode === null && server.signalCode === null) { const exited = once(server, 'exit'); server.kill(); await exited; } }
async function api(session, path, method = 'GET', body, expected = 200) {
  const response = await fetch(origin + '/api/v1' + path, { method, signal: AbortSignal.timeout(12000), headers: { Origin: origin, ...(session.cookie ? { Cookie: session.cookie } : {}), ...(session.csrf ? { 'X-CSRF-Token': session.csrf } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const cookie = response.headers.get('set-cookie'); if (cookie) session.cookie = cookie.split(';')[0];
  const json = await response.json(); if (response.status !== expected) throw new Error(`Team recovery HTTP ${response.status} (${json.error?.code || 'unexpected status'})`);
  if (json.data?.csrfToken) session.csrf = json.data.csrfToken; return json.data;
}

await database.connect();
try{
 await start();await api(owner,'/auth/csrf');await api(member,'/auth/csrf');ownerId=(await api(owner,'/auth/login','POST',{email:'river@campus.invalid',password:'DemoCampus2026!'})).user.id;await api(member,'/auth/login','POST',{email:'lin@campus.invalid',password:'DemoCampus2026!'});
 const key=randomUUID(),at=h=>new Date(Date.now()+h*3600_000).toISOString(),topicId=(await api(owner,'/topics?category=COMPETITION'))[0].id;
 const r=await api(owner,'/recruitments','POST',{requestKey:randomUUID(),draft:{topicId,title:'群聊重启持久化验证',description:'在独立测试库验证聊天正文、序号、公告、已读与原请求重试在专用 API 重启后保留，结束清理本队。',competitionName:'测试作品赛',direction:'持久化验证',goal:'验证聊天恢复',collaboration:'本次明确确认协作时间',startAt:at(24),endAt:at(48),competitionDeadline:at(72),capacity:2,allowCrossSchool:true,slots:[{key,name:'协作',capacity:2}],captainSlotKey:key}},201);recruitmentIds.push(r.id);
 const p=await api(owner,'/recruitments/'+r.id+'/publish','POST',{revision:1},201),base='/teams/'+p.team.id+'/chat';
 const row=await api(member,'/teams/'+p.team.id+'/applications','POST',{requestKey:randomUUID(),slotId:p.team.slots[0].id,timeConfirmed:true,message:'本次聊天验证意向。'},201);await api(owner,'/applications/'+row.id+'/review','POST',{revision:1,decision:'APPROVE',reason:'欢迎协作。'});
 const input={clientMessageId:randomUUID(),body:'重启后仍然只保存一条。'},receipt=await api(member,base+'/messages','POST',input);
 await api(owner,base+'/announcement','POST',{revision:1,body:'本轮公告需要保留。'});const before=await api(owner,base);await api(owner,base+'/read','POST',{seq:before.highWater});
 for(let i=0;i<2;i++){await stop();await start();if(JSON.stringify(await api(member,base+'/messages','POST',input))!==JSON.stringify(receipt))throw new Error('Chat receipt changed');const after=await api(owner,base);if(after.highWater!==before.highWater||after.announcement!==before.announcement||after.unreadCount!==0||after.items.filter(m=>m.body===input.body).length!==1)throw new Error('Chat state lost or duplicated');}
 const membership=(await api(member,'/teams/'+p.team.id)).myMembership;await api(owner,'/teams/'+p.team.id+'/members/'+membership.id+'/remove','POST',{revision:membership.revision,reason:'验证结束。'});await api(member,base,'GET',undefined,404);
 result={passed:true,apiRestarts:2,messagesAndSequencesPersisted:true,originalSendDeduplicated:true,announcementAndReadStatePersisted:true,removedMemberDenied:true,databaseRestarted:false,checkedAt:new Date().toISOString()};
}finally{await stop();try{if(recruitmentIds.length&&ownerId)await database.query('DELETE FROM "Recruitment" WHERE "id"=ANY($1::uuid[]) AND "authorId"=$2',[recruitmentIds,ownerId]);}finally{await database.end();}}
mkdirSync('.local',{recursive:true});writeFileSync('.local/chat-recovery-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
