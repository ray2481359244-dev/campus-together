import 'dotenv/config';
import { existsSync, mkdirSync, realpathSync, cpSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from 'pg';

const run = promisify(execFile);
const url = new URL(process.env.DATABASE_URL ?? '');
if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('db:local only manages a loopback database.');
const port = Number(url.port || 5432);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local database port');
const workspace = realpathSync(process.cwd());
mkdirSync(resolve('.local'), { recursive: true });

// Windows PostgreSQL cannot reliably use Chinese paths, including junction
// targets. A dedicated per-project ASCII runtime lives in LOCALAPPDATA.
const alias = process.platform === 'win32'
  ? join(process.env.LOCALAPPDATA || '', 'CampusTogether', createHash('sha256').update(workspace).digest('hex').slice(0, 12))
  : resolve('.local');
if (process.platform === 'win32' && /[^\x00-\x7f]/.test(alias)) throw new Error('Set LOCALAPPDATA to an ASCII runtime path for PostgreSQL, or use an external PostgreSQL server.');
mkdirSync(alias, { recursive: true });
const require = createRequire(import.meta.url);
const binaryModule = join(dirname(require.resolve('embedded-postgres')), 'binary.js');
const { default: getBinaries } = await import(pathToFileURL(binaryModule).href);
const binaries = await getBinaries() as { initdb: string; pg_ctl: string };
const nativeSource = dirname(dirname(binaries.initdb));
const nativeTarget = join(alias, 'postgres-18.4');
if (process.platform === 'win32' && !existsSync(join(nativeTarget, 'bin', 'pg_ctl.exe'))) cpSync(nativeSource, nativeTarget, { recursive: true });
const directory = join(alias, 'data');
const executable = (name: 'initdb' | 'pg_ctl') => process.platform === 'win32' ? join(nativeTarget, 'bin', name + '.exe') : binaries[name];
const ctl = (args: string[]) => new Promise<void>((done, reject) => {
  const child = spawn(executable('pg_ctl'), args, { windowsHide: true, cwd: alias, stdio: 'ignore' });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? done() : reject(new Error(`pg_ctl failed (${code}); inspect ${join(alias, 'postgres.log')}`)));
});
if (process.argv.includes('--stop')) {
  await ctl(['stop', '-D', directory, '-m', 'fast', '-w']);
  console.log('Project PostgreSQL stopped safely. Persistent data retained.');
  process.exit(0);
}
if (!existsSync(join(directory, 'PG_VERSION'))) {
  const passwordFile = join(alias, 'init-password');
  writeFileSync(passwordFile, decodeURIComponent(url.password) + '\n', { mode: 0o600 });
  try {
    await run(executable('initdb'), ['-D', directory, '--auth=scram-sha-256', '--username=' + decodeURIComponent(url.username), '--pwfile=' + passwordFile, '--encoding=UTF8', '--locale=C'], { windowsHide: true, cwd: alias });
  } finally { unlinkSync(passwordFile); }
}
writeFileSync(resolve('.local/runtime.json'), JSON.stringify({ dataDirectory: directory, runtimeDirectory: alias, port }, null, 2));
const running = await run(executable('pg_ctl'), ['status', '-D', directory], { windowsHide: true, cwd: alias }).then(() => true).catch(() => false);
if (!running) await ctl(['start', '-D', directory, '-l', join(alias, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w']);
const client = new Client({ host: '127.0.0.1', port, user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: 'postgres' });
await client.connect();
for (const name of [url.pathname.slice(1), 'campus_test']) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new Error('Unsafe local database name');
  const result = await client.query('SELECT 1 FROM pg_database WHERE datname=$1', [name]);
  if (!result.rowCount) await client.query(`CREATE DATABASE "${name}"`);
}
await client.end();
console.log(`Local PostgreSQL ready on 127.0.0.1:${port}; persistent data location recorded in .local/runtime.json. Ctrl+C stops it safely.`);
if (process.argv.includes('--once')) process.exit(0);
let stopping = false;
const stop = async () => {
  if (stopping) return; stopping = true;
  await ctl(['stop', '-D', directory, '-m', 'fast', '-w']);
  process.exit(0);
};
process.on('SIGINT', () => void stop()); process.on('SIGTERM', () => void stop());
setInterval(() => {}, 60_000);
