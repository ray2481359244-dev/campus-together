import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { app } from './app.js';
import { config } from './config.js';
import { db } from './db.js';
import { actors, ids, read, setup, tokens } from './test-fixtures.js';

const path = '/api/v1/me/avatar';
const mutate = (method: 'put' | 'delete', body: object) => actors[0][method](path)
  .set('Origin', config.origin).set('X-CSRF-Token', tokens[0]).send(body);

beforeAll(setup);
afterAll(() => db.$disconnect());

it('re-encodes the photo, scopes access, and only serves the current revision', async () => {
  const png = await sharp({ create: { width: 640, height: 320, channels: 3, background: '#a189bf' } })
    .png().withExif({ IFD0: { ImageDescription: 'Unpublished metadata' } }).toBuffer();
  const first = { base64: png.toString('base64'), revision: 0 };
  await request(app).put(path).send(first).expect(401);
  await actors[0].put(path).set('Origin', config.origin).send(first).expect(403);
  await mutate('put', { revision: 0, base64: 'aW52YWxpZA==' }).expect(422);
  expect((await mutate('put', first).expect(200)).body.data).toEqual({ avatarRevision: 1, avatarVersion: 1 });
  expect((await mutate('put', first).expect(200)).body.data.avatarRevision).toBe(1);

  const resource = '/profiles/' + ids[0] + '/avatar/1';
  const avatar = await read(1, resource).expect(200).expect('Content-Type', 'image/webp').expect('Cache-Control', 'no-store');
  const meta = await sharp(avatar.body).metadata();
  expect(meta).toMatchObject({ width: 320, height: 320, format: 'webp' });
  expect(meta.exif).toBeUndefined();
  await request(app).get('/api/v1' + resource).expect(404);
  await db.userBlock.create({ data: { blockerId: ids[0], blockedId: ids[1] } });
  await read(1, resource).expect(404);
  await read(0, resource).expect(200);

  const replacement = (await sharp(png).flop().webp().toBuffer()).toString('base64');
  await mutate('put', { base64: replacement, revision: 0 }).expect(409);
  expect((await mutate('put', { base64: replacement, revision: 1 }).expect(200)).body.data.avatarVersion).toBe(2);
  await read(0, resource).expect(404);
  await mutate('delete', { revision: 1 }).expect(409);
  expect((await mutate('delete', { revision: 2 }).expect(200)).body.data).toEqual({ avatarRevision: 3, avatarVersion: null });
  await mutate('delete', { revision: 2 }).expect(200);
  await read(0, resource.replace(/1$/, '2')).expect(404);
  expect(await db.profileAvatar.findUnique({ where: { profileId: ids[0] } })).toBeNull();
});
