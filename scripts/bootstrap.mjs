import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
const db=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:5000});
try{
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL_REQUIRED');await db.connect();await db.query('BEGIN');
  let receipt;
  if(process.argv[2]==='school'){
    const name=(process.env.SCHOOL_NAME||'').trim(),city=(process.env.SCHOOL_CITY||'').trim();if(name.length<2||name.length>80||!city||city.length>40)throw new Error('PROVIDE_SCHOOL_NAME_AND_CITY');
    const result=await db.query('INSERT INTO "School" ("id","name","city","isDemo","active") VALUES ($1,$2,$3,false,true) ON CONFLICT ("name") DO NOTHING RETURNING "id"',[randomUUID(),name,city]);
    if(process.argv.includes('--deactivate-demo-schools'))await db.query('UPDATE "School" SET "active"=false WHERE "isDemo"=true');
    receipt={schoolCreated:!!result.rowCount,existingSchoolsPreserved:true};
  }else if(process.argv[2]==='admin'){
    const id=process.env.ADMIN_USER_ID;if(!/^[a-f0-9-]{36}$/i.test(id||''))throw new Error('PROVIDE_EXISTING_ADMIN_USER_ID');
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended('bootstrap-admin',0))");
    if((await db.query('SELECT count(*)::int AS count FROM "User" WHERE "role"=\'ADMIN\' AND "status"=\'ACTIVE\'')).rows[0].count)throw new Error('FIRST_ADMIN_ALREADY_EXISTS');
    const result=await db.query('UPDATE "User" SET "role"=\'ADMIN\',"updatedAt"=clock_timestamp() WHERE "id"=$1 AND "status"=\'ACTIVE\' RETURNING "id"',[id]);if(result.rowCount!==1)throw new Error('ACTIVE_USER_NOT_FOUND');
    await db.query('INSERT INTO "ModerationAction" ("id","adminId","requestKey","requestHash","action","targetType","targetId","reason","result") VALUES ($1,$2,$3,$4,\'BOOTSTRAP_ADMIN\',\'USER\',$2,\'数据库运维初始化首位管理员\',$5)',[randomUUID(),id,randomUUID(),'0'.repeat(64),JSON.stringify({firstAdmin:true})]);
    receipt={firstAdminCreated:true,credentialsPrinted:false};
  }else throw new Error('USAGE: bootstrap.mjs school [--deactivate-demo-schools] | admin');
  await db.query('COMMIT');console.log(JSON.stringify(receipt));
}catch(error){await db.query('ROLLBACK').catch(()=>{});console.error(/^[A-Z_]+$/.test(error.message)?error.message:'Bootstrap failed: '+(error.code||error.name));process.exitCode=1;}finally{await db.end().catch(()=>{});}
