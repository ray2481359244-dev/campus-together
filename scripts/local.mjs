import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { collectDiagnostics, printDiagnostics } from './doctor.mjs';
function run(args) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', windowsHide: true });
  if (result.status !== 0) throw new Error('Local startup step failed; inspect the preceding output.');
}
async function main() {
  run(['scripts/setup.mjs']);
  const diagnostic = await collectDiagnostics();
  printDiagnostics(diagnostic);
  if (diagnostic.state === 'RUNNING') return;
  if (!diagnostic.canStart) { process.exitCode = 1; return; }
  const require = createRequire(import.meta.url), tsx = require.resolve('tsx/cli');
  // An external server is managed by its owner, not the local PostgreSQL helper.
  const env = { ...parseEnv(readFileSync('.env', 'utf8')), ...process.env };
  if (['127.0.0.1', 'localhost'].includes(new URL(env.DATABASE_URL).hostname)) {
    run([tsx, 'scripts/local-db.ts', '--once']);
  }
  run([resolve('node_modules/prisma/build/index.js'), 'generate', '--config', 'prisma7.config.ts']);
  run([resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--config', 'prisma7.config.ts']);
  run([tsx, 'prisma/seed.ts']);
  await import('./dev.mjs');
}
await main();
