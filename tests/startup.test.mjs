import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { inspectServices, workspaceId } from '../scripts/doctor.mjs';

async function fixture(t, { instance = workspaceId(process.cwd()), ready = true, foreign = false } = {}) {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (foreign) { res.end(JSON.stringify({ name: 'unrelated local service' })); return; }
    if (req.url === '/api/v1/health') res.end(JSON.stringify({ data: { devInstance: instance } }));
    else { res.statusCode = ready ? 200 : 503; res.end(JSON.stringify({ data: { ready } })); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => { server.closeAllConnections(); server.close(done); }));
  return server.address().port;
}
test('closed sockets are distinguished from a running service', async t => {
  const port = await fixture(t);
  // This listener belongs to the test and is closed before checking stopped state.
  // Obtain a genuinely unused port rather than assuming a fixed system port is free.
  const server = createServer();
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const stopped = server.address().port;
  await new Promise(done => server.close(done));
  assert.equal((await inspectServices({ webPort: stopped, apiPort: stopped })).state, 'STOPPED');
  assert.equal((await inspectServices({ webPort: port, apiPort: port })).state, 'RUNNING');
});
test('an unrelated HTTP service is never reused as this project', async t => {
  const port = await fixture(t, { foreign: true });
  assert.equal((await inspectServices({ webPort: port, apiPort: port })).state, 'PORT_CONFLICT');
});
test('another checkout of the same app is not mistaken for this checkout', async t => {
  const port = await fixture(t, { instance: 'different-workspace' });
  assert.equal((await inspectServices({ webPort: port, apiPort: port })).state, 'PORT_CONFLICT');
});
test('a reachable app with a failed database is not reported ready', async t => {
  const port = await fixture(t, { ready: false });
  assert.equal((await inspectServices({ webPort: port, apiPort: port })).state, 'DATABASE_UNAVAILABLE');
});
