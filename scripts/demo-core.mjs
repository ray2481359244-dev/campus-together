import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { createConnection } from 'node:net';

export function demoEnvironment(input, root = process.cwd()) {
  if (input.NODE_ENV === 'production') throw new Error('DEMO_REFUSES_PRODUCTION');
  const source = new URL(input.DATABASE_URL || '');
  if (!['postgres:', 'postgresql:'].includes(source.protocol) || !['127.0.0.1', 'localhost'].includes(source.hostname) || !source.username || !source.password || /REPLACE_/.test(source.href)) throw new Error('DEMO_REQUIRES_CONFIGURED_LOOPBACK_POSTGRES');
  const database = input.DEMO_DATABASE_NAME || 'campus_demo';
  if (!/^campus_demo(?:_[a-z0-9]+)*$/.test(database) || database.length > 63 || source.pathname === '/' + database) throw new Error('DEMO_REQUIRES_SEPARATE_NAMED_DATABASE');
  const port = input.DEMO_PORT || '3180';
  if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535 || [5173, Number(input.PORT || 3001)].includes(Number(port))) throw new Error('DEMO_REQUIRES_SEPARATE_PORT');
  if ((input.CSRF_SECRET || '').length < 32 || /REPLACE_/.test(input.CSRF_SECRET)) throw new Error('DEMO_REQUIRES_LOCAL_CSRF_SECRET');
  const workspace = createHash('sha256').update(realpathSync(root)).digest('hex').slice(0, 12);
  const instance = createHash('sha256').update([workspace, source.hostname, source.port || '5432', database].join(':')).digest('hex').slice(0, 24);
  const target = new URL(source); target.pathname = '/' + database;
  const origin = 'http://127.0.0.1:' + port;
  return {
    database, origin, instance, owner: 'campus-together-demo:' + workspace,
    env: { ...input, DATABASE_URL: target.href, PORT: port, HOST: '127.0.0.1', NODE_ENV: 'development', APP_MODE: 'DEMO', SERVE_ORIGIN: origin, WEB_ORIGIN: origin, TRUST_PROXY: '', CAMPUS_DEV_INSTANCE: '', CAMPUS_DEMO_INSTANCE: instance, AI_MODE: 'RULES_ONLY', AI_BASE_URL: '', AI_MODEL: '', AI_API_KEY: '', CHAT_ARCHIVE_SECONDS: '2592000' },
  };
}

export function demoTarget(input) {
  const source = new URL(input.DATABASE_URL || ''); source.pathname = '/postgres';
  const plan = demoEnvironment({ ...input, DATABASE_URL: source.href, DEMO_PORT: input.PORT, PORT: '' });
  if (input.NODE_ENV !== 'development' || input.APP_MODE !== 'DEMO' || input.AI_MODE !== 'RULES_ONLY' || input.DATABASE_URL !== plan.env.DATABASE_URL || input.CAMPUS_DEMO_INSTANCE !== plan.instance || input.SERVE_ORIGIN !== plan.origin) throw new Error('DEMO_RUNTIME_NOT_ISOLATED');
  return plan;
}

export async function inspectDemo({ origin, instance }) {
  const port = Number(new URL(origin).port);
  const socketState = await new Promise(done => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let finished = false;
    const finish = value => { if (finished) return; finished = true; socket.destroy(); done(value); };
    socket.setTimeout(1000, () => finish('unknown'));
    socket.once('connect', () => finish('open'));
    socket.once('error', e => finish(e.code === 'ECONNREFUSED' ? 'closed' : 'unknown'));
  });
  if (socketState === 'closed') return 'STOPPED';
  if (socketState !== 'open') return 'PORT_CONFLICT';
  try {
    const health = await fetch(origin + '/api/v1/health', { signal: AbortSignal.timeout(1500) });
    if (!health.ok || (await health.json()).data?.demoInstance !== instance) return 'PORT_CONFLICT';
    const ready = await fetch(origin + '/api/v1/ready', { signal: AbortSignal.timeout(1500) });
    return ready.ok && (await ready.json()).data?.ready === true ? 'RUNNING' : 'DATABASE_UNAVAILABLE';
  } catch { return 'PORT_CONFLICT'; }
}

export async function ensureDemoDatabase(plan, connect) {
  const url = new URL(plan.env.DATABASE_URL); url.pathname = '/postgres';
  const db = connect(url.href);
  try {
    await db.connect();
    await db.query('SELECT pg_advisory_lock(hashtextextended($1,0))', ['campus-demo:' + plan.database]);
    const existing = await db.query("SELECT shobj_description(oid,'pg_database') AS owner FROM pg_database WHERE datname=$1", [plan.database]);
    if (existing.rowCount) {
      if (existing.rows[0].owner !== plan.owner) throw new Error('DEMO_DATABASE_NOT_OWNED_BY_THIS_CHECKOUT');
      return;
    }
    // Both the identifier and ownership token come from the validated plan above.
    await db.query('CREATE DATABASE "' + plan.database + '"');
    await db.query('COMMENT ON DATABASE "' + plan.database + '" IS \'' + plan.owner + '\'');
  } finally { await db.end(); }
}
