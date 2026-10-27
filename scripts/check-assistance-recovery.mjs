import 'dotenv/config';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Client } from 'pg';
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test') || testUrl === process.env.DATABASE_URL) throw new Error('Team recovery requires a separate _test database.');
const origin = 'http://127.0.0.1:3102', instance = 'assistance-recovery-' + randomUUID(), database = new Client({ connectionString: testUrl });
let server, ownerId, result;
const recruitmentIds = [], owner = { cookie: '', csrf: '' }, member = { cookie: '', csrf: '' };
async function start() {
  const reservation = createServer();
  await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(3102, '127.0.0.1', resolve); });
  await new Promise((resolve, reject) => reservation.close(error => error ? reject(error) : resolve()));
  server = spawn(process.execPath, ['apps/server/dist/index.js'], { windowsHide: true, stdio: 'ignore', env: { ...process.env, DATABASE_URL: testUrl, PORT: '3102', WEB_ORIGIN: origin, NODE_ENV: 'test', AI_MODE: 'RULES_ONLY', CAMPUS_DEV_INSTANCE: instance } });
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


await database.connect();const recordIds=[];
try{await start();await api(owner,'/auth/csrf');await api(member,'/auth/csrf');ownerId=(await api(owner,'/auth/login','POST',{email:'river@campus.invalid',password:'DemoCampus2026!'})).user.id;await api(member,'/auth/login','POST',{email:'lin@campus.invalid',password:'DemoCampus2026!'});
 const input={requestKey:randomUUID(),text:'一起完成校园作品，日期和人数还要确认。',consent:true},receipt=await api(owner,'/ai/recruitment-draft','POST',input);recordIds.push(receipt.id);if(receipt.mode!=='RULES_ONLY')throw new Error('Recovery unexpectedly used a model');
 const pending={requestKey:randomUUID(),text:'模拟处理中断后的原文恢复。',consent:true},old=await api(owner,'/ai/recruitment-draft','POST',pending);recordIds.push(old.id);await database.query('UPDATE "AiRequest" SET "result"=NULL,"attempted"=true,"createdAt"=clock_timestamp()-interval \'20 seconds\' WHERE "id"=$1',[old.id]);
 for(let i=0;i<2;i++){await stop();await start();const replay=await api(owner,'/ai/recruitment-draft','POST',input);if(JSON.stringify(replay)!==JSON.stringify(receipt))throw new Error('Assistance receipt changed');const recovered=await api(owner,'/ai/recruitment-draft','POST',pending);if(recovered.id!==old.id||recovered.mode!=='RULES_ONLY')throw new Error('Pending job did not recover as rules');}
 const other=await api(member,'/ai/recruitment-draft','POST',input);recordIds.push(other.id);if(other.id===receipt.id)throw new Error('Assistance crossed accounts');
 result={passed:true,apiRestarts:2,originalResultAndKeyPersisted:true,abandonedReservationRecoveredWithoutModel:true,accountsIsolated:true,realModelInvoked:false,checkedAt:new Date().toISOString()};
}finally{await stop();try{if(recordIds.length)await database.query('DELETE FROM "AiRequest" WHERE "id"=ANY($1::uuid[])',[recordIds]);}finally{await database.end();}}
mkdirSync('.local',{recursive:true});writeFileSync('.local/assistance-recovery-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
