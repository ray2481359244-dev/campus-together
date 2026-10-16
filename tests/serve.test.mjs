import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { resolve, join, sep } from 'node:path';
import { parseEnv } from 'node:util';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('built SPA deep links work under a hidden parent and API 404 stays JSON', async () => {
  const root = process.cwd(), local = resolve('.local');
  await mkdir(local, { recursive: true });
  const fixture = await mkdtemp(join(local, 'serve-probe-'));
  const site = join(fixture, 'apps/web/dist');
  await mkdir(site, { recursive: true });
  await writeFile(join(site, 'index.html'), '<!doctype html><title>Hidden directory SPA probe</title>');
  const socket = createServer();
  await new Promise(done => socket.listen(0, '127.0.0.1', done));
  const port = socket.address().port;
  await new Promise(done => socket.close(done));
  const env = { ...parseEnv(await readFile('.env', 'utf8')), ...process.env, PORT: String(port), NODE_ENV: 'test' };
  const child = spawn(process.execPath, [resolve('scripts/serve.mjs')], { cwd: fixture, env, stdio: 'ignore', windowsHide: true });
  try {
    const url = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 50; i++) {
      if (child.exitCode !== null) throw new Error('Build service exited; run pnpm build before test:serve');
      try { ready = (await fetch(url + '/api/v1/health')).ok; } catch {}
      if (ready) break;
      await new Promise(done => setTimeout(done, 100));
    }
    assert.ok(ready, 'build service became available');
    for (const route of ['/', '/register', '/posts/example']) {
      const response = await fetch(url + route, { headers: { Accept: 'text/html' } });
      assert.equal(response.status, 200, route);
      assert.match(await response.text(), /Hidden directory SPA probe/);
    }
    const response = await fetch(url + '/api/v1/unknown-route', { headers: { Accept: 'text/html' } });
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type'), /application\/json/);
  } finally {
    if (child.exitCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; }
    // The only recursively removed path is the newly created owned fixture.
    if (!fixture.startsWith(local + sep) || fixture === local) throw new Error('Unsafe fixture cleanup path');
    await rm(fixture, { recursive: true, force: true });
  }
});
