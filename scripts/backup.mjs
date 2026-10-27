import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BackupError, captureDatabase, encryptBackup, decryptBackup, restoreDatabase } from './backup-core.mjs';
export function backupKey() {
  const value=process.env.BACKUP_KEY || (existsSync(process.env.BACKUP_KEY_FILE||'.local/backup.key')?readFileSync(process.env.BACKUP_KEY_FILE||'.local/backup.key','utf8').trim():'');
  if(!/^[a-f0-9]{64}$/i.test(value))throw new BackupError('BACKUP_KEY_MISSING_OR_INVALID');return Buffer.from(value,'hex');
}
export async function backupCommand(args=process.argv.slice(2)) {
  args=args.filter(arg=>arg!=='--');
  const mode=args[0],directory=resolve(process.env.BACKUP_DIR||'.local/backups');
  if(mode==='init-key'){const file=resolve(process.env.BACKUP_KEY_FILE||'.local/backup.key');mkdirSync(resolve(file,'..'),{recursive:true});writeFileSync(file,randomBytes(32).toString('hex')+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({keyCreated:true,keyPrinted:false}));return;}
  const key=backupKey();
  if(mode==='create'){
    const snapshot=await captureDatabase(process.env.DATABASE_URL),bytes=encryptBackup(snapshot,key);mkdirSync(directory,{recursive:true});const path=join(directory,'campus-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(4).toString('hex')+'.ctbackup');writeFileSync(path,bytes,{flag:'wx',mode:0o600});console.log(JSON.stringify({created:true,path,encrypted:true,tables:snapshot.tables.length,rows:snapshot.tables.reduce((n,t)=>n+t.count,0)}));return;
  }
  if(mode==='restore'){
    if(!args[1]||args[2]!=='--confirm-empty-target')throw new BackupError('RESTORE_REQUIRES_FILE_AND_CONFIRM_EMPTY_TARGET');const snapshot=decryptBackup(readFileSync(resolve(args[1])),key);const result=await restoreDatabase(snapshot,process.env.RESTORE_DATABASE_URL,process.env.DATABASE_URL);console.log(JSON.stringify({restored:true,...result}));return;
  }
  throw new BackupError('USAGE: backup.mjs init-key | create | restore FILE --confirm-empty-target');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)backupCommand().catch(error=>{console.error(error instanceof BackupError?error.message:'Backup operation failed: '+(error.code||error.name));process.exitCode=1;});
