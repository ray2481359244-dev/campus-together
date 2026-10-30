import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const require=createRequire(import.meta.url),cli=require.resolve('@playwright/test/cli');
const files=readdirSync('tests/e2e').filter(name=>name.endsWith('.spec.ts')).sort();
// Each invocation owns a fresh isolated test server/database. Separate account
// recovery from community journeys so the suite respects the real auth limiter.
const account=new Set(['sessions.spec.ts','ui-quality.spec.ts']);
const groups=[
  files.filter(name=>!account.has(name)&&!name.startsWith('workflow-')),
  files.filter(name=>account.has(name)),
  files.filter(name=>name.startsWith('workflow-')),
];
for(const [index,group] of groups.entries()){
  if(!group.length)continue;
  console.log(`Browser regression group ${index+1}/${groups.length}`);
  const result=spawnSync(process.execPath,[cli,'test',...group.map(name=>'tests/e2e/'+name),'--reporter=line','--output',join(tmpdir(),`campus-browser-${process.pid}-${index+1}`)],{stdio:'inherit',windowsHide:true});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status||1);
}
