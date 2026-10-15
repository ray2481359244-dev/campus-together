import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const esbuild = require(require.resolve('esbuild', { paths: [require.resolve('tsx')] }));
await esbuild.build({ entryPoints: ['apps/server/src/index.ts'], outdir: 'apps/server/dist', platform: 'node', target: 'node24', format: 'esm', bundle: true, packages: 'external', sourcemap: true });
console.log('Server build ready.');
