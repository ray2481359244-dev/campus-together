import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node.js 24 LTS.');
if (existsSync('.env')) {
  const env = readFileSync('.env', 'utf8');
  if (!/^CSRF_SECRET=.+/m.test(env)) writeFileSync('.env', env + '\nCSRF_SECRET=' + randomBytes(32).toString('hex') + '\n', { mode: 0o600 });
  console.log('Existing .env preserved.');
} else {
  const password = randomBytes(24).toString('hex');
  writeFileSync('.env', readFileSync('.env.example', 'utf8').replaceAll('REPLACE_WITH_LOCAL_PASSWORD', password).replace('REPLACE_WITH_RANDOM_CSRF_SECRET', randomBytes(32).toString('hex')), { mode: 0o600 });
  console.log('Created local .env with random PostgreSQL password (not printed).');
}
console.log('Next: pnpm db:local (keep terminal open), then pnpm db:generate && pnpm db:migrate && pnpm db:seed.');
