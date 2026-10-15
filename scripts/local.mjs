import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url), tsx = require.resolve('tsx/cli');
function run(args) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error('Local startup step failed; inspect the preceding output.');
}
run(['scripts/setup.mjs']);
run([tsx, 'scripts/local-db.ts', '--once']);
run([resolve('node_modules/prisma/build/index.js'), 'generate', '--config', 'prisma7.config.ts']);
run([resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--config', 'prisma7.config.ts']);
run([tsx, 'prisma/seed.ts']);
await import('./dev.mjs');
