import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { productionChecks } from '../scripts/production-config.mjs';
import { encryptBackup,decryptBackup,validateRestoreTarget } from '../scripts/backup-core.mjs';
import { mkdirSync,mkdtempSync,writeFileSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const env={NODE_ENV:'production',APP_MODE:'STANDARD',SERVE_ORIGIN:'https://campus.university.edu',DATABASE_URL:'postgresql://app:fixture-password-long@127.0.0.1/campus_live',CSRF_SECRET:'fixture-value-for-config-tests-only-2026',TRUST_PROXY:'loopback',AI_MODE:'RULES_ONLY'};
test('生产配置必须指定 HTTPS、正式模式、独立库和密钥，AI 无需配置',()=>{
 assert.ok(productionChecks(env).every(c=>c.pass));
 for(const patch of [{APP_MODE:'DEMO'},{NODE_ENV:'development'},{SERVE_ORIGIN:'http://campus.university.edu'},{SERVE_ORIGIN:'https://campus.university.edu/path'},{SERVE_ORIGIN:'https://example.com'},{DATABASE_URL:'postgresql://app:fixture-password-long@127.0.0.1/campus_test'},{CSRF_SECRET:'short'},{TRUST_PROXY:'true'},{HOST:'0.0.0.0'},{AI_MODE:'LIVE'}])assert.ok(productionChecks({...env,...patch}).some(c=>!c.pass));
});
test('加密备份能恢复原值，错误密钥、篡改和错误版本均拒绝',()=>{
 const key=randomBytes(32),snapshot={format:1,tables:[],migrations:[],fixture:'private-fixture-marker-2026'},bytes=encryptBackup(snapshot,key);
 assert.ok(!bytes.includes(Buffer.from(snapshot.fixture)));assert.deepEqual(decryptBackup(bytes,key),snapshot);
 assert.throws(()=>decryptBackup(bytes,randomBytes(32)),/AUTHENTICATION/);const tampered=Buffer.from(bytes);tampered[tampered.length-1]^=1;assert.throws(()=>decryptBackup(tampered,key),/AUTHENTICATION/);assert.throws(()=>decryptBackup(Buffer.from('wrong format'),key),/FORMAT/);
});
test('恢复操作只允许独立恢复库，拒绝主库、同库别名和测试库',()=>{
 const source='postgresql://app:fixture@127.0.0.1/campus';
 validateRestoreTarget('postgresql://app:fixture@127.0.0.1/campus_probe_restore',source);
 for(const target of [source,'postgresql://app:fixture@127.0.0.1/campus_test','postgresql://app:fixture@localhost/campus'])assert.throws(()=>validateRestoreTarget(target,source),/RESTORE/);
 assert.throws(()=>validateRestoreTarget('postgresql://app:fixture@localhost/campus_restore','postgresql://app:fixture@127.0.0.1/campus_restore'),/MUST_DIFFER/);
});
test('发布清单接受原文件并拒绝改动和额外文件',()=>{
 const local=resolve('.local');mkdirSync(local,{recursive:true});const root=mkdtempSync(join(local,'release-verifier-'));
 const content='fixture release file',sha256=createHash('sha256').update(content).digest('hex');
 writeFileSync(join(root,'fixture.txt'),content);writeFileSync(join(root,'RELEASE_MANIFEST.json'),JSON.stringify({revision:'fixture',preview:true,files:[{path:'fixture.txt',sha256}]}));
 const run=()=>spawnSync(process.execPath,['scripts/verify-release.mjs',root],{stdio:'ignore',windowsHide:true}).status;
 assert.equal(run(),0);writeFileSync(join(root,'fixture.txt'),'changed');assert.equal(run(),1);writeFileSync(join(root,'fixture.txt'),content);writeFileSync(join(root,'unexpected.txt'),'extra');assert.equal(run(),1);
});
