import 'dotenv/config';
import assert from 'node:assert/strict';
import { Client } from 'pg';
import { randomUUID, randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { captureDatabase,encryptBackup,decryptBackup,restoreDatabase } from './backup-core.mjs';
const source=process.env.TEST_DATABASE_URL;
if(!source||!new URL(source).pathname.endsWith('_test')||source===process.env.DATABASE_URL)throw new Error('Separate test DB required');
const name='campus_verify_'+randomUUID().replaceAll('-','').slice(0,12)+'_restore',target=new URL(source),adminURL=new URL(source);target.pathname='/'+name;adminURL.pathname='/postgres';
const admin=new Client({connectionString:adminURL.href}),instance='backup-check-'+randomUUID();let server,result;
async function stop(){if(server&&server.exitCode===null&&server.signalCode===null){const exited=once(server,'exit');server.kill();await exited;}}
await admin.connect();
try{
  const snapshot=await captureDatabase(source),table=name=>snapshot.tables.find(t=>t.name===name);
  assert.ok(table('PostImage').count>0,'Run complete browser tests first to include actual encoded images');
  assert.ok(table('ChatMessage').count>0);assert.ok(table('ModerationAction').count>0);assert.ok(table('Notification').count>0);
  const key=randomBytes(32),encrypted=encryptBackup(snapshot,key);mkdirSync('.local/backups',{recursive:true});writeFileSync('.local/backups/verification-'+name+'.ctbackup',encrypted,{flag:'wx',mode:0o600});
  await admin.query('CREATE DATABASE "'+name+'"');
  const migration=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy','--config','prisma7.config.ts'],{windowsHide:true,stdio:'ignore',env:{...process.env,DATABASE_URL:target.href}});assert.equal(migration.status,0,'Fresh isolated restore schema migrated');
  await assert.rejects(()=>restoreDatabase({...snapshot,schemaHash:'wrong-release'},target.href,source),/MISMATCH/);
  const restored=await restoreDatabase(decryptBackup(encrypted,key),target.href,source);
  await assert.rejects(()=>restoreDatabase(snapshot,target.href,source),/MUST_BE_EMPTY/);
  const after=await captureDatabase(target.href);assert.deepEqual(after.tables.filter(t=>t.name!=='Session').map(t=>({name:t.name,hash:t.hash,count:t.count})),snapshot.tables.filter(t=>t.name!=='Session').map(t=>({name:t.name,hash:t.hash,count:t.count})));
  assert.ok(after.tables.find(t=>t.name==='Session').rows.every(row=>JSON.parse(row).revokedAt),'Restored sessions must require fresh authentication');
  const listener=createServer();await new Promise(done=>listener.listen(0,'127.0.0.1',done));const port=listener.address().port;await new Promise(done=>listener.close(done));const origin='http://127.0.0.1:'+port;
  async function start(){server=spawn(process.execPath,['scripts/serve.mjs'],{windowsHide:true,stdio:'ignore',env:{...process.env,DATABASE_URL:target.href,PORT:String(port),NODE_ENV:'test',APP_MODE:'DEMO',SERVE_ORIGIN:origin,CAMPUS_DEV_INSTANCE:instance,AI_MODE:'RULES_ONLY'}});for(let i=0;i<60;i++){if(server.exitCode!==null)throw new Error('Restore API exited early');try{const health=await(await fetch(origin+'/api/v1/health',{signal:AbortSignal.timeout(700)})).json();if(health.data?.devInstance===instance&&(await fetch(origin+'/api/v1/ready')).ok)return;}catch{}await new Promise(done=>setTimeout(done,100));}throw new Error('Restore API startup timed out');}
  let cookie='',csrf;async function api(path,method='GET',body){const response=await fetch(origin+'/api/v1'+path,{method,headers:{Origin:origin,...cookie?{Cookie:cookie}:{},...body?{'Content-Type':'application/json','X-CSRF-Token':csrf}:{}},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});const set=response.headers.get('set-cookie');if(set)cookie=set.split(';')[0];assert.equal(response.status,200,path);const data=(await response.json()).data;if(data.csrfToken)csrf=data.csrfToken;return data;}
  await start();await api('/auth/csrf');const logged=await api('/auth/login','POST',{email:'river@campus.invalid',password:'DemoCampus2026!'});assert.ok(logged.user.id);
  const db=new Client({connectionString:target.href});await db.connect();const image=(await db.query('SELECT i."id" FROM "PostImage" i JOIN "Post" p ON p."id"=i."postId" WHERE p."status"=\'PUBLISHED\' LIMIT 1')).rows[0];await db.end();assert.ok(image);
  for(let i=0;i<2;i++){await stop();await start();assert.equal((await api('/auth/me')).user.id,logged.user.id);assert.equal((await fetch(origin+'/api/v1/media/'+image.id)).status,200);}
  await stop();const sourceAfter=await captureDatabase(source);assert.deepEqual(sourceAfter.tables.map(t=>t.hash),snapshot.tables.map(t=>t.hash),'Source was never changed');
  result={passed:true,encrypted:true,isolatedDatabase:name,...restored,sourceUnchanged:true,mediaRestored:true,utcAndJsonAndBinaryRoundtrip:true,nonemptyTargetRejected:true,schemaMismatchRejected:true,apiRestarts:2,newLoginSessionRetained:true,oldRestoredSessionsRevoked:true,realModelInvoked:false,checkedAt:new Date().toISOString()};
}finally{await stop();await admin.end();}
writeFileSync('.local/backup-restore-check.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
