import { execFileSync } from 'node:child_process';
import { mkdirSync, copyFileSync, readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { join, resolve, dirname, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const git=args=>execFileSync('git',args,{encoding:'utf8',maxBuffer:8*1024*1024});
try{
  if(!existsSync('apps/server/dist/index.js')||!existsSync('apps/web/dist/index.html'))throw new Error('BUILD_REQUIRED');
  if(realpathSync(git(['rev-parse','--show-toplevel']).trim())!==realpathSync(process.cwd()))throw new Error('RUN_FROM_REPOSITORY_ROOT');
  const dirty=!!git(['status','--porcelain']).trim();if(dirty&&!process.argv.includes('--preview'))throw new Error('COMMIT_CHANGES_OR_USE_PREVIEW');
  const revision=git(['rev-parse','HEAD']).trim(),root=resolve('.local/releases'),directory=join(root,'campus-'+revision.slice(0,12)+'-'+randomUUID().slice(0,8));mkdirSync(directory,{recursive:true});
  const names=git(['ls-files','--cached','--others','--exclude-standard','-z']).split('\0').filter(Boolean);
  const {readdirSync}=await import('node:fs');function walk(dir){return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name).replaceAll('\\','/')]);}
  const paths=[...new Set([...names,...walk('apps/server/dist'),...walk('apps/web/dist')])].sort(),files=[];
  for(const path of paths){if(!existsSync(path))throw new Error('MISSING_RELEASE_FILE');if(path!=='.env.example'&&/(^|\/)(?:\.env(?:\..*)?|\.local|node_modules|test-results|playwright-report)(\/|$)/.test(path))throw new Error('RUNTIME_FILE_REJECTED');const target=resolve(directory,path);if(!target.startsWith(directory+sep))throw new Error('UNSAFE_RELEASE_PATH');mkdirSync(dirname(target),{recursive:true});copyFileSync(path,target);files.push({path,sha256:createHash('sha256').update(readFileSync(target)).digest('hex')});}
  writeFileSync(join(directory,'RELEASE_MANIFEST.json'),JSON.stringify({format:1,revision,preview:dirty,createdAt:new Date().toISOString(),nodeMajor:24,pnpm:'11.5.1',aiMode:'RULES_ONLY',files},null,2));
  console.log(JSON.stringify({prepared:true,directory,revision,preview:dirty,files:files.length,environmentAndDataIncluded:false}));
}catch(error){console.error('Release preparation failed: '+error.message);process.exitCode=1;}
