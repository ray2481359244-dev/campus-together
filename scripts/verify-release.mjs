import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { createHash } from 'node:crypto';
try{
 const root=resolve(process.argv[2]||'.local/nonexistent-release'),manifest=JSON.parse(readFileSync(join(root,'RELEASE_MANIFEST.json'),'utf8'));
 const expected=new Set(['RELEASE_MANIFEST.json']);
 for(const file of manifest.files){const path=resolve(root,file.path);if(!path.startsWith(root+sep)||expected.has(file.path))throw new Error('UNSAFE_MANIFEST');expected.add(file.path);const hash=createHash('sha256').update(readFileSync(path)).digest('hex');if(hash!==file.sha256)throw new Error('FILE_HASH_MISMATCH');}
 function walk(dir,prefix=''){for(const entry of readdirSync(dir,{withFileTypes:true})){const name=prefix+entry.name;if(entry.isDirectory())walk(join(dir,entry.name),name+'/');else if(!expected.has(name))throw new Error('UNEXPECTED_RELEASE_FILE');}}
 walk(root);console.log(JSON.stringify({verified:true,revision:manifest.revision,preview:manifest.preview,files:manifest.files.length}));
}catch(error){console.error('Release verification failed: '+(error.code||error.message));process.exitCode=1;}
