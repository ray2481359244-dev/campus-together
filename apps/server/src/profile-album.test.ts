import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { app } from './app.js';
import { config } from './config.js';
import { db } from './db.js';
import { actors, ids, read, setup, tokens, write } from './test-fixtures.js';

const album = () => '/profiles/' + ids[0] + '/album';
const img = (id: string, size = 'full') => '/profile-photos/' + id + '/' + size;
const mutate = (actor: number, method: 'patch' | 'put' | 'delete', path: string, body: object = {}) =>
  actors[actor][method]('/api/v1' + path).set('Origin', config.origin).set('X-CSRF-Token', tokens[actor]).send(body);
let photo: string, second: string, input: { requestKey: string; base64: string };

beforeAll(setup);
afterAll(() => db.$disconnect());

it('creates a private photo, strips metadata, and deduplicates the same upload', async () => {
  const bytes = await sharp({ create: { width: 840, height: 560, channels: 3, background: '#c9a9d6' } })
    .jpeg().withExif({ IFD0: { ImageDescription: 'Private source metadata' } }).toBuffer();
  input = { requestKey: randomUUID(), base64: bytes.toString('base64') };
  const first = await write(0, '/me/album', input).expect(201);
  photo = first.body.data.id;
  expect(first.body.data).toMatchObject({ width: 840, height: 560, visibility: 'PRIVATE', revision: 1 });
  const retry = await write(0, '/me/album', input).expect(200);
  expect(retry.body.data.id).toBe(photo);
  expect((await read(0, album()).expect(200)).body.data).toHaveLength(1);
  expect((await read(1, album()).expect(200)).body.data).toEqual([]);
  await read(1, img(photo, 'thumb')).expect(404);
  await request(app).get('/api/v1' + img(photo)).expect(401);
  const full = await read(0, img(photo)).expect(200).expect('Cache-Control', 'no-store');
  expect((await sharp(full.body).metadata()).exif).toBeUndefined();
  const thumb = await read(0, img(photo, 'thumb')).expect(200);
  expect((await sharp(thumb.body).metadata()).width).toBe(420);
  await write(0, '/me/album', { requestKey: randomUUID(), base64: Buffer.from('invalid image').toString('base64') }).expect(422);
});

it('rechecks both image sizes after sharing, blocking, or switching back to private', async () => {
  await mutate(1, 'patch', '/me/album/' + photo, { visibility: 'CAMPUS', revision: 1 }).expect(404);
  await mutate(0, 'patch', '/me/album/' + photo, { visibility: 'CAMPUS', revision: 1 }).expect(200);
  expect((await read(1, album()).expect(200)).body.data.map((row: { id: string }) => row.id)).toEqual([photo]);
  await read(1, img(photo, 'thumb')).expect(200);
  await read(1, img(photo)).expect(200);
  await db.userBlock.create({ data: { blockerId: ids[1], blockedId: ids[0] } });
  expect((await read(1, album()).expect(200)).body.data).toEqual([]);
  await read(1, img(photo)).expect(404);
  await db.userBlock.deleteMany();
  await mutate(0, 'patch', '/me/album/' + photo, { visibility: 'PRIVATE', revision: 2 }).expect(200);
  await read(1, img(photo)).expect(404);
  await read(1, img(photo, 'thumb')).expect(404);
});

it('keeps the album order after a retry and honors owner removal without recreating the upload', async () => {
  second = (await write(0, '/me/album', { ...input, requestKey: randomUUID() }).expect(201)).body.data.id;
  const request = { previous: [photo, second], order: [second, photo] };
  for (let tries = 0; tries < 2; tries++) {
    const sorted = await mutate(0, 'put', '/me/album/order', request).expect(200);
    expect(sorted.body.data.map((row: { id: string }) => row.id)).toEqual(request.order);
  }
  await mutate(1, 'put', '/me/album/order', request).expect(409);
  await mutate(1, 'delete', '/me/album/' + photo).expect(404);
  await mutate(0, 'delete', '/me/album/' + photo).expect(200);
  await mutate(0, 'delete', '/me/album/' + photo).expect(200);
  await write(0, '/me/album', input).expect(410);
  await read(0, img(photo)).expect(404);
  await mutate(0, 'put', '/me/album/order', request).expect(409);
});

it('limits photo reports to visible photos and makes a moderated photo unavailable to both accounts', async () => {
  const report = { requestKey: randomUUID(), targetType: 'PROFILE_PHOTO', targetId: second, reason: '检查相册的举报和下架路径。' };
  await write(1, '/reports', report).expect(404);
  await mutate(0, 'patch', '/me/album/' + second, { visibility: 'CAMPUS', revision: 1 }).expect(200);
  const reported = await write(1, '/reports', report).expect(201);
  const id = reported.body.data.id;
  await db.user.update({ where: { id: ids[2] }, data: { role: 'ADMIN' } });
  const evidence = '/admin/profile-photo-reports/' + id + '/image';
  await read(1, evidence).expect(404);
  await read(2, evidence).expect(200).expect('Cache-Control', 'no-store');
  await write(2, '/admin/reports/' + id + '/resolve', { requestKey: randomUUID(), revision: 1, outcome: 'HIDE', reason: '图片已按本地测试流程撤下。' }).expect(200);
  await read(0, img(second)).expect(404);
  await read(1, img(second, 'thumb')).expect(404);
  await read(2, evidence).expect(404);
  expect((await read(0, album()).expect(200)).body.data).toEqual([]);
});
