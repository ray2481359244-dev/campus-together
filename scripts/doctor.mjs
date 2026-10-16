import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { parseEnv } from 'node:util';
import { createConnection } from 'node:net';
import { pathToFileURL } from 'node:url';

export function workspaceId(root) {
  return createHash('sha256').update(realpathSync(root)).digest('hex').slice(0, 12);
}

async function portState(port) {
  return new Promise(done => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const finish = state => { socket.destroy(); done(state); };
    socket.setTimeout(1200, () => finish('unknown'));
    socket.once('connect', () => finish('open'));
    socket.once('error', error => finish(error.code === 'ECONNREFUSED' ? 'closed' : 'unknown'));
  });
}
async function json(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return { status: response.status, body: await response.json() };
  } catch { return null; }
}
export async function collectDiagnostics({ root = process.cwd() } = {}) {
  const checks = [];
  const add = (code, pass, message) => checks.push({ code, status: pass ? 'PASS' : 'FAIL', message });
  add('NODE', Number(process.versions.node.split('.')[0]) === 24, `Node ${process.versions.node}，要求 24 LTS。`);
  const require = createRequire(join(resolve(root), 'package.json'));
  let dependencies = true;
  try { require.resolve('tsx/cli'); require.resolve('pg'); }
  catch { dependencies = false; }
  dependencies &&= existsSync(join(root, 'apps/web/node_modules/vite/bin/vite.js')) && existsSync(join(root, 'node_modules/prisma/build/index.js'));
  add('DEPENDENCIES', dependencies, dependencies ? '开发依赖已安装。' : '依赖未齐全，请先运行 pnpm.cmd install --frozen-lockfile。');
  let env = {}, validEnv = false;
  try {
    env = { ...parseEnv(readFileSync(join(root, '.env'), 'utf8')), ...process.env };
    const url = new URL(env.DATABASE_URL);
    validEnv = ['postgresql:', 'postgres:'].includes(url.protocol) && !!url.username && !!url.password &&
      !env.DATABASE_URL.includes('REPLACE_') && (env.CSRF_SECRET?.length ?? 0) >= 32 && !env.CSRF_SECRET.includes('REPLACE_') &&
      ['DEMO', 'STANDARD'].includes(env.APP_MODE) && env.NODE_ENV !== 'production';
  } catch { /* Report only the variable class, never its secret content. */ }
  add('ENV', validEnv, validEnv ? '本地环境已配置，未显示任何密钥。' : '环境缺失或无效：运行 pnpm.cmd setup，核对 DATABASE_URL、CSRF_SECRET、APP_MODE 和开发模式；不要把 .env 发给别人。');
  const apiPort = Number(env.PORT || 3001);
  const originOK = Number.isInteger(apiPort) && apiPort >= 1024 && apiPort <= 65535 && apiPort !== 5173 &&
    (env.WEB_ORIGIN || 'http://127.0.0.1:5173') === 'http://127.0.0.1:5173';
  add('PORT_CONFIG', originOK, originOK ? `网页 5173，API ${apiPort}，均为本机端口。` : '开发网页固定为 http://127.0.0.1:5173；PORT 应为另一个有效端口，WEB_ORIGIN 须与网页一致。');
  const environmentReady = checks.every(check => check.status === 'PASS');
  if (!environmentReady) return { state: 'ENVIRONMENT_ERROR', environmentReady, canStart: false, checks };

  const services = await inspectServices({ root, apiPort });
  checks.push({ code: 'SERVICES', status: ['RUNNING', 'STOPPED'].includes(services.state) ? 'PASS' : 'FAIL', message: services.message });
  return { ...services, environmentReady, canStart: services.state === 'STOPPED', checks };
}
export async function inspectServices({ root = process.cwd(), webPort = 5173, apiPort = 3001 } = {}) {
  const [webState, serverPort] = await Promise.all([portState(webPort), portState(apiPort)]);
  const instance = workspaceId(root);
  const [health, proxiedHealth, readiness] = await Promise.all([
    serverPort === 'open' ? json(`http://127.0.0.1:${apiPort}/api/v1/health`) : null,
    webState === 'open' ? json(`http://127.0.0.1:${webPort}/api/v1/health`) : null,
    webState === 'open' ? json(`http://127.0.0.1:${webPort}/api/v1/ready`) : null,
  ]);
  const own = result => result?.status === 200 && result.body?.data?.devInstance === instance;
  const sameProject = own(health) && own(proxiedHealth);
  const ready = readiness?.status === 200 && readiness.body?.data?.ready === true;
  let state;
  if (sameProject && ready) state = 'RUNNING';
  else if (webState === 'closed' && serverPort === 'closed') state = 'STOPPED';
  else if (sameProject) state = 'DATABASE_UNAVAILABLE';
  else state = 'PORT_CONFLICT';
  const messages = {
    RUNNING: '本项目网页、API 和数据库均可访问。无需再次启动。',
    STOPPED: '网页服务尚未启动，这会导致浏览器提示连接被拒绝。运行 pnpm.cmd local 或双击“启动平台.cmd”。',
    DATABASE_UNAVAILABLE: '本项目网页和 API 已运行，但数据库未就绪；先核对数据库终端或运行 pnpm.cmd db:local。',
    PORT_CONFLICT: '端口已被使用或状态不明，不能确认是本项目完整服务。请检查原开发终端和端口；不会自动结束未知程序。',
  };
  return { state, message: messages[state], url: `http://127.0.0.1:${webPort}/`, apiPort };
}
export function printDiagnostics(result) {
  console.log('\n碰个头本地运行检查');
  for (const check of result.checks) console.log(`[${check.status}] ${check.message}`);
  if (result.state === 'RUNNING') console.log(`打开：${result.url}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await collectDiagnostics();
  if (process.argv.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else printDiagnostics(result);
  process.exitCode = result.environmentReady && ['RUNNING', 'STOPPED'].includes(result.state) ? 0 : 1;
}
