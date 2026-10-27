import 'dotenv/config';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Client } from 'pg';
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test') || testUrl === process.env.DATABASE_URL) throw new Error('Team recovery requires a separate _test database.');
const origin = 'http://127.0.0.1:3102', instance = 'expiry-recovery-' + randomUUID(), database = new Client({ connectionString: testUrl });
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
try {
  await start(); await api(owner, '/auth/csrf'); await api(member, '/auth/csrf');
  ownerId = (await api(owner, '/auth/login', 'POST', { email: 'river@campus.invalid', password: 'DemoCampus2026!' })).user.id;
  await api(member, '/auth/login', 'POST', { email: 'lin@campus.invalid', password: 'DemoCampus2026!' });
  const topicId = (await api(owner, '/topics?category=COMPETITION'))[0].id, key=randomUUID(), at=h=>new Date(Date.now()+h*3600_000).toISOString();
  const draft={topicId,title:'到期重启补偿验证',description:'在独立测试库验证服务停止期间到期、启动补偿、结果通知与重复扫描去重，完成后清理本队。',competitionName:'测试作品赛',direction:'持久化验证',goal:'验证到期补偿',collaboration:'本次明确确认协作时间',startAt:at(24),endAt:at(48),competitionDeadline:at(72),capacity:2,allowCrossSchool:true,slots:[{key,name:'协作',capacity:2}],captainSlotKey:key};
  const r=await api(owner,'/recruitments','POST',{requestKey:randomUUID(),draft},201); recruitmentIds.push(r.id);
  const p=await api(owner,'/recruitments/'+r.id+'/publish','POST',{revision:1},201), teamId=p.team.id;
  await api(member,'/teams/'+teamId+'/applications','POST',{requestKey:randomUUID(),slotId:p.team.slots[0].id,timeConfirmed:true,message:'补偿测试意向。'},201);
  await stop(); await database.query('UPDATE "Recruitment" SET "joinDeadline"=clock_timestamp()-interval \'1 second\' WHERE "id"=$1',[r.id]);
  let noticeId, readAt;
  for(let restart=0;restart<2;restart++) {
    await start();
    for(let i=0;i<50;i++){const row=(await database.query('SELECT "status" FROM "Team" WHERE "id"=$1',[teamId])).rows[0];if(row.status==='EXPIRED')break;await new Promise(r=>setTimeout(r,100));}
    if((await database.query('SELECT "status" FROM "Team" WHERE "id"=$1',[teamId])).rows[0].status!=='EXPIRED')throw new Error('Startup did not persist expiry');
    const team=await api(owner,'/teams/'+teamId); if(team.status!=='EXPIRED'||team.canStart||team.canCancel)throw new Error('Expired team editable');
    const notes=(await api(member,'/me/notifications')).items.filter(n=>n.teamId===teamId); if(notes.length!==1||notes[0].kind!=='APPLICATION_EXPIRED')throw new Error('Expiry notice lost or duplicated');
    if(!noticeId){noticeId=notes[0].id;readAt=(await api(member,'/me/notifications/'+noticeId+'/read','POST',{})).readAt;} else if(notes[0].id!==noticeId||notes[0].readAt!==readAt)throw new Error('Read state changed');
    if((await database.query('SELECT count(*)::int AS n FROM "TeamAction" WHERE "teamId"=$1 AND "kind"=\'EXPIRE\'',[teamId])).rows[0].n!==1)throw new Error('Expiry duplicated');
    await stop();
  }
  result={passed:true,apiStartsAfterMissedDeadline:2,startupPersistedExpiry:true,notificationsAndReadStatePersisted:true,noDuplicateExpiry:true,databaseRestarted:false,checkedAt:new Date().toISOString()};
} finally {await stop();try{if(recruitmentIds.length&&ownerId)await database.query('DELETE FROM "Recruitment" WHERE "id"=ANY($1::uuid[]) AND "authorId"=$2',[recruitmentIds,ownerId]);}finally{await database.end();}}
mkdirSync('.local',{recursive:true});writeFileSync('.local/expiry-recovery-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
