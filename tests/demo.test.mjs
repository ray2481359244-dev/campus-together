import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { demoEnvironment, demoTarget, inspectDemo, ensureDemoDatabase } from '../scripts/demo-core.mjs';

const env = { NODE_ENV: 'development', DATABASE_URL: 'postgresql://demo:fixture-not-a-real-password@127.0.0.1:5432/campus', CSRF_SECRET: 'fixture-secret-for-demo-test-only-32-chars' };

test('demo targets an isolated loopback database and pins rules, origins and retention', () => {
  const plan = demoEnvironment({ ...env, AI_MODE: 'LIVE', AI_API_KEY: 'fixture-key', HOST: '0.0.0.0', CHAT_ARCHIVE_SECONDS: '1' });
  assert.equal(new URL(plan.env.DATABASE_URL).pathname, '/campus_demo');
  assert.equal(plan.env.AI_MODE, 'RULES_ONLY'); assert.equal(plan.env.AI_API_KEY, '');
  assert.equal(plan.env.HOST, '127.0.0.1'); assert.equal(plan.env.CHAT_ARCHIVE_SECONDS, '2592000');
  assert.equal(plan.env.SERVE_ORIGIN, plan.origin); assert.equal(plan.env.WEB_ORIGIN, plan.origin);
  assert.equal(demoTarget(plan.env).database, plan.database);
  assert.throws(() => demoTarget({ ...plan.env, DATABASE_URL: env.DATABASE_URL }), /DEMO_RUNTIME_NOT_ISOLATED/);
});

test('production, remote DB, main/test/restore names and reused source DB are refused', () => {
  assert.throws(() => demoEnvironment({ ...env, NODE_ENV: 'production' }), /DEMO_REFUSES_PRODUCTION/);
  assert.throws(() => demoEnvironment({ ...env, DATABASE_URL: 'postgresql://a:b@db.example/campus' }), /LOOPBACK/);
  for (const name of ['campus', 'campus_test', 'campus_restore', 'campus_demo";DROP DATABASE campus;--']) assert.throws(() => demoEnvironment({ ...env, DEMO_DATABASE_NAME: name }), /SEPARATE_NAMED_DATABASE/);
  assert.throws(() => demoEnvironment({ ...env, DATABASE_URL: env.DATABASE_URL + '_demo' }), /SEPARATE_NAMED_DATABASE/);
  for (const port of ['0', '5173', '3001', '65536', 'abc']) assert.throws(() => demoEnvironment({ ...env, DEMO_PORT: port }), /SEPARATE_PORT/);
});

test('an existing unmarked or other-checkout demo DB is never claimed or modified', async () => {
  const plan = demoEnvironment(env);
  for (const owner of [null, 'campus-together-demo:another-checkout']) {
    const writes = [], client = { connect: async () => {}, end: async () => {}, query: async (sql) => {
      if (sql.startsWith('SELECT shobj_description')) return { rowCount: 1, rows: [{ owner }] };
      if (!sql.startsWith('SELECT')) writes.push(sql);
      return { rowCount: 0, rows: [] };
    } };
    await assert.rejects(ensureDemoDatabase(plan, () => client), /NOT_OWNED/); assert.deepEqual(writes, []);
  }
});

test('only newly created demo DB receives an ownership marker; owned existing DB has no writes', async () => {
  const plan = demoEnvironment(env);
  for (const exists of [true, false]) {
    const writes = [], client = { connect: async () => {}, end: async () => {}, query: async (sql) => {
      if (sql.startsWith('SELECT shobj_description')) return { rowCount: exists ? 1 : 0, rows: exists ? [{ owner: plan.owner }] : [] };
      if (!sql.startsWith('SELECT')) writes.push(sql); return { rowCount: 0, rows: [] };
    } };
    await ensureDemoDatabase(plan, () => client); assert.equal(writes.length, exists ? 0 : 2);
    assert.ok(writes.every(sql => sql.includes('"campus_demo"')));
  }
});

test('single-port diagnostics distinguish owned, foreign and DB-unavailable services', async t => {
  let instance = 'foreign', ready = true;
  const server = createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); res.statusCode = req.url.endsWith('/ready') && !ready ? 503 : 200; res.end(JSON.stringify({ data: req.url.endsWith('/health') ? { demoInstance: instance } : { ready } })); });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => { server.closeAllConnections(); server.close(done); }));
  const plan = { origin: 'http://127.0.0.1:' + server.address().port, instance: 'owned' };
  assert.equal(await inspectDemo(plan), 'PORT_CONFLICT'); instance = 'owned';
  assert.equal(await inspectDemo(plan), 'RUNNING'); ready = false;
  assert.equal(await inspectDemo(plan), 'DATABASE_UNAVAILABLE');
});
