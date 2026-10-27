import { verifyMigrations } from './backup-core.mjs';
import 'dotenv/config';
import { existsSync } from 'node:fs';
import { Client } from 'pg';
import { productionChecks } from './production-config.mjs';
import { backupKey } from './backup.mjs';
const checks=productionChecks(process.env),add=(code,pass,message)=>checks.push({code,pass:!!pass,message});
add('NODE',Number(process.versions.node.split('.')[0])===24,'运行 Node.js 24。');
add('BUILD',existsSync('apps/server/dist/index.js')&&existsSync('apps/web/dist/index.html'),'前后端构建产物存在。');
try{backupKey();add('BACKUP_KEY',true,'备份密钥可用，未显示内容。');}catch{add('BACKUP_KEY',false,'通过 BACKUP_KEY_FILE 提供独立备份密钥，另留一份安全副本。');}
if(checks.find(c=>c.code==='DATABASE')?.pass) {
  const db=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000,statement_timeout:5000});
  try{
    await db.connect();await db.query('BEGIN READ ONLY');
    const {rows:[role]}=await db.query("SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user");
    add('DB_ROLE',!role.rolsuper&&!role.rolcreatedb&&!role.rolcreaterole,'生产应用使用专属普通数据库角色。');
    add('DB_VERSION',Number((await db.query('SHOW server_version_num')).rows[0].server_version_num)>=180000,'PostgreSQL 18 或更高兼容版本。');
    add('MIGRATIONS',await verifyMigrations(db).then(()=>true,()=>false),'本次迁移与源码校验和一致且已全部应用。');
    const demo=(await db.query('SELECT count(*)::int AS count FROM "User" WHERE "email" LIKE \'%@campus.invalid\'')).rows[0].count;
    add('DEMO_ACCOUNTS',demo===0,'正式数据库不含公开密码的演示账号。');
    const schools=(await db.query('SELECT count(*) FILTER(WHERE "active" AND NOT "isDemo")::int AS real, count(*) FILTER(WHERE "active" AND "isDemo")::int AS demo FROM "School"')).rows[0];
    add('SCHOOLS',schools.real>0&&schools.demo===0,'启用负责人提供的实际试用学校，停用虚构学校。学校仍标为自述。');
    add('ADMIN',(await db.query('SELECT EXISTS(SELECT 1 FROM "User" WHERE "role"=\'ADMIN\' AND "status"=\'ACTIVE\') AS present')).rows[0].present,'至少有一名实际管理员。');
    await db.query('ROLLBACK');
  }catch{add('DATABASE_READY',false,'生产数据库尚不可用、迁移未完成或权限不齐。');}finally{await db.end().catch(()=>{});}
}
const passed=checks.every(c=>c.pass);console.log(JSON.stringify({readyToDeploy:passed,checks},null,2));process.exitCode=passed?0:1;
