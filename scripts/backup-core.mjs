import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';
export class BackupError extends Error {}
const fail=message=>{throw new BackupError(message);};
const hash=value=>createHash('sha256').update(value).digest('hex');
const quote=value=>'"'+value.replaceAll('"','""')+'"';
const magic=Buffer.from('CTB1'),maxSize=128*1024*1024;
export function encryptBackup(snapshot,key) {
  if(!Buffer.isBuffer(key)||key.length!==32)fail('BACKUP_KEY_INVALID');
  const plain=Buffer.from(JSON.stringify(snapshot));if(plain.length>maxSize)fail('BACKUP_TOO_LARGE_USE_NATIVE_POSTGRES_TOOLS');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(magic);
  const data=Buffer.concat([cipher.update(gzipSync(plain)),cipher.final()]);return Buffer.concat([magic,iv,cipher.getAuthTag(),data]);
}
export function decryptBackup(bytes,key) {
  if(!Buffer.isBuffer(key)||key.length!==32)fail('BACKUP_KEY_INVALID');
  if(bytes.length<33||bytes.length>maxSize||!bytes.subarray(0,4).equals(magic))fail('BACKUP_FORMAT_INVALID');
  try {const cipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(4,16));cipher.setAAD(magic);cipher.setAuthTag(bytes.subarray(16,32));const plain=gunzipSync(Buffer.concat([cipher.update(bytes.subarray(32)),cipher.final()]),{maxOutputLength:maxSize});const result=JSON.parse(plain.toString('utf8'));if(result.format!==1||!Array.isArray(result.tables)||!Array.isArray(result.migrations))fail('BACKUP_FORMAT_INVALID');return result;}catch{fail('BACKUP_AUTHENTICATION_OR_FORMAT_FAILED');}
}
function localMigrations() {
  return readdirSync('prisma/migrations',{withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>{const bytes=readFileSync(join('prisma/migrations',d.name,'migration.sql'),'utf8'),lf=bytes.replace(/\r\n/g,'\n');return {name:d.name,hash:hash(lf),allowed:[hash(bytes),hash(lf),hash(lf.replace(/\n/g,'\r\n'))]};}).sort((a,b)=>a.name.localeCompare(b.name));
}
export async function verifyMigrations(db) {
  const rows=(await db.query('SELECT migration_name,checksum,finished_at,rolled_back_at FROM "_prisma_migrations" ORDER BY migration_name')).rows;
  if(rows.some(r=>!r.finished_at&&!r.rolled_back_at))fail('UNFINISHED_MIGRATION');
  const applied=rows.filter(r=>r.finished_at&&!r.rolled_back_at),local=localMigrations();
  if(applied.length!==local.length||applied.some((r,i)=>r.migration_name!==local[i].name||!local[i].allowed.includes(r.checksum)))fail('MIGRATIONS_DO_NOT_MATCH_THIS_RELEASE');
  return local.map(({name,hash})=>({name,hash}));
}
async function schema(db) {
  const tables=(await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename")).rows.map(r=>r.tablename);
  const columns=(await db.query("SELECT table_name,column_name,udt_name,is_nullable,column_default,ordinal_position FROM information_schema.columns WHERE table_schema='public' AND table_name<>'_prisma_migrations' ORDER BY table_name,ordinal_position")).rows;
  const constraints=(await db.query("SELECT c.relname AS name,con.conname,pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname<>'_prisma_migrations' ORDER BY c.relname,con.conname")).rows;
  const indexes=(await db.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename<>'_prisma_migrations' ORDER BY tablename,indexname")).rows;
  return {tables,fingerprint:hash(JSON.stringify({columns,constraints,indexes}))};
}
async function rowsOf(db,table) {return (await db.query(`SELECT row_to_json(t)::text AS row FROM ${quote(table)} t ORDER BY row_to_json(t)::text`)).rows.map(r=>r.row);}
export async function captureDatabase(url) {
  try{if(!['postgres:','postgresql:'].includes(new URL(url).protocol))fail('DATABASE_URL_INVALID');}catch{fail('DATABASE_URL_INVALID');}
  const db=new Client({connectionString:url,connectionTimeoutMillis:5000,statement_timeout:60000});await db.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await db.query("SET LOCAL TIME ZONE 'UTC'");
    const applied=await verifyMigrations(db),shape=await schema(db),tables=[];let totalSize=0;
    for(const name of shape.tables){const rows=await rowsOf(db,name);totalSize+=rows.reduce((sum,r)=>sum+Buffer.byteLength(r),0);if(totalSize>maxSize/2)fail('BACKUP_TOO_LARGE_USE_NATIVE_POSTGRES_TOOLS');tables.push({name,rows,count:rows.length,hash:hash(rows.join('\n'))});}
    const foreignKeys=(await db.query("SELECT c.relname AS child,p.relname AS parent FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_class p ON p.oid=con.confrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE con.contype='f' AND n.nspname='public' ORDER BY c.relname,p.relname")).rows;
    await db.query('COMMIT');return {format:1,createdAt:new Date().toISOString(),migrations:applied,schemaHash:shape.fingerprint,foreignKeys,tables};
  }catch(error){await db.query('ROLLBACK');throw error;}finally{await db.end();}
}
export function validateRestoreTarget(target,source) {
  let to,from;try{to=new URL(target);from=new URL(source);}catch{fail('RESTORE_URL_INVALID');}
  if(!['postgres:','postgresql:'].includes(to.protocol)||!/^\/[a-z][a-z0-9_]{0,54}_restore$/.test(to.pathname))fail('RESTORE_REQUIRES_DEDICATED_RESTORE_DATABASE');
  const sameServer=to.hostname.replace('localhost','127.0.0.1')===from.hostname.replace('localhost','127.0.0.1')&&(to.port||'5432')===(from.port||'5432');
  if(to.pathname===from.pathname)fail('RESTORE_SOURCE_AND_TARGET_MUST_DIFFER');
}
export async function restoreDatabase(snapshot,target,source) {
  validateRestoreTarget(target,source);const db=new Client({connectionString:target,connectionTimeoutMillis:5000,statement_timeout:60000});await db.connect();
  try{
    await db.query('BEGIN');await db.query("SET LOCAL TIME ZONE 'UTC'");await db.query("SET LOCAL lock_timeout='5s'");
    const shape=await schema(db),applied=await verifyMigrations(db);
    if(shape.fingerprint!==snapshot.schemaHash||JSON.stringify(applied)!==JSON.stringify(snapshot.migrations)||JSON.stringify(shape.tables)!==JSON.stringify(snapshot.tables.map(t=>t.name)))fail('RESTORE_SCHEMA_OR_RELEASE_MISMATCH');
    for(const table of shape.tables)await db.query(`LOCK TABLE ${quote(table)} IN ACCESS EXCLUSIVE MODE`);
    for(const table of shape.tables)if((await db.query(`SELECT EXISTS(SELECT 1 FROM ${quote(table)}) AS occupied`)).rows[0].occupied)fail('RESTORE_TARGET_MUST_BE_EMPTY');
    const remaining=new Set(shape.tables),order=[];
    while(remaining.size){const ready=[...remaining].filter(t=>!snapshot.foreignKeys.some(f=>f.child===t&&f.parent!==t&&remaining.has(f.parent)));if(!ready.length)fail('RESTORE_UNSUPPORTED_FOREIGN_KEY_CYCLE');for(const name of ready){remaining.delete(name);order.push(name);}}
    for(const name of order){const table=snapshot.tables.find(t=>t.name===name);if(!Array.isArray(table.rows)||table.rows.length!==table.count||hash(table.rows.join('\n'))!==table.hash)fail('RESTORE_TABLE_INTEGRITY_FAILED');for(let offset=0;offset<table.rows.length;offset+=100)await db.query(`INSERT INTO ${quote(name)} SELECT * FROM jsonb_populate_recordset(NULL::${quote(name)},$1::jsonb)`,['['+table.rows.slice(offset,offset+100).join(',')+']']);}
    for(const table of snapshot.tables){const rows=await rowsOf(db,table.name);if(rows.length!==table.count||hash(rows.join('\n'))!==table.hash)fail('RESTORE_ROUNDTRIP_MISMATCH');}
    const revoked=await db.query('UPDATE "Session" SET "revokedAt"=clock_timestamp() WHERE "revokedAt" IS NULL');
    await db.query('COMMIT');return {tables:snapshot.tables.length,rows:snapshot.tables.reduce((sum,t)=>sum+t.count,0),dataFingerprintsMatchedBeforeSessionRevocation:true,restoredSessionsRevoked:revoked.rowCount};
  }catch(error){await db.query('ROLLBACK');throw error;}finally{await db.end();}
}
