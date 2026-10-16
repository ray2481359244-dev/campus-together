import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './app.js';
import { db } from './db.js';
import { config } from './config.js';

const a = request.agent(app), b = request.agent(app);
const schoolA = '91000000-0000-4000-8000-000000000001', schoolB = '91000000-0000-4000-8000-000000000002';
let csrfA = '', csrfB = '', topic = '', otherTopic = '', postId = '';
const valid = () => ({ topicId: topic, title: '真实讨论的测试标题', body: '这是通过真实 API 保存到 PostgreSQL 的讨论正文。' });
beforeAll(async () => {
  if (!new URL(config.databaseUrl!).pathname.endsWith('_test')) throw new Error('Not test database');
  await db.recruitment.deleteMany(); await db.session.deleteMany(); await db.post.deleteMany(); await db.profile.deleteMany(); await db.user.deleteMany(); await db.topic.deleteMany(); await db.school.deleteMany();
  await db.school.createMany({ data: [{ id: schoolA, name: '测试甲校', city: '测试' }, { id: schoolB, name: '测试乙校', city: '测试' }] });
  topic = (await db.topic.create({ data: { category: 'COMPETITION', name: '应用开发', normalizedName: '应用开发' } })).id;
  otherTopic = (await db.topic.create({ data: { category: 'STUDY', name: '高等数学', normalizedName: '高等数学' } })).id;
  for (const [agent, email, nickname, school] of [[a, 'posta@campus.invalid', '讨论甲', schoolA], [b, 'postb@campus.invalid', '讨论乙', schoolB]] as const) {
    const csrf = (await agent.get('/api/v1/auth/csrf')).body.data.csrfToken;
    const r = await agent.post('/api/v1/auth/register').set('Origin', config.origin).set('X-CSRF-Token', csrf).send({ email, password: 'TestingPassword123!', nickname, schoolId: school }).expect(201);
    if (agent === a) csrfA = r.body.data.csrfToken; else csrfB = r.body.data.csrfToken;
  }
});
afterAll(() => db.$disconnect());
const write = (agent: typeof a, csrf: string, method: 'post' | 'patch' | 'delete', path: string, body: object) => agent[method](path).set('Origin', config.origin).set('X-CSRF-Token', csrf).send(body);

describe('persistent discussion contracts and permissions', () => {
  it('rejects anonymous writes and missing-CSRF writes', async () => {
    await request(app).post('/api/v1/posts').set('Origin', config.origin).send(valid()).expect(401);
    await a.post('/api/v1/posts').set('Origin', config.origin).send(valid()).expect(403);
  });
  it('enforces content and forbids client-controlled author/school', async () => {
    await write(a, csrfA, 'post', '/api/v1/posts', { ...valid(), title: '短' }).expect(400);
    await write(a, csrfA, 'post', '/api/v1/posts', { ...valid(), schoolId: schoolB }).expect(400);
    await write(a, csrfA, 'post', '/api/v1/posts', { ...valid(), authorId: schoolB }).expect(400);
  });
  it('creates a post and reads it through an independent account', async () => {
    const r = await write(a, csrfA, 'post', '/api/v1/posts', valid()).expect(201);
    postId = r.body.data.id;
    expect((await db.post.findUniqueOrThrow({ where: { id: postId } })).body).toBe(valid().body);
    const read = (await b.get('/api/v1/posts/' + postId).expect(200)).body.data;
    expect(read.title).toBe(valid().title); expect(read.canEdit).toBe(false);
    expect(JSON.stringify(read)).not.toMatch(/passwordHash|csrfHash|tokenHash|posta@/);
  });
  it('filters schools/categories/topics and supports Chinese search', async () => {
    expect((await a.get('/api/v1/posts').query({ schoolId: schoolB })).body.data).toHaveLength(0);
    expect((await a.get('/api/v1/posts').query({ schoolId: schoolA, category: 'STUDY' })).body.data).toHaveLength(0);
    expect((await a.get('/api/v1/posts').query({ schoolId: schoolA, topicId: topic, q: '测试标题' })).body.data).toHaveLength(1);
    expect((await a.get('/api/v1/topics').query({ category: 'COMPETITION' })).body.data.every((t: { category: string }) => t.category === 'COMPETITION')).toBe(true);
    await a.get('/api/v1/topics').query({ category: 'WRONG' }).expect(400);
  });
  it('rejects editing/deleting another author’s post', async () => {
    await write(b, csrfB, 'patch', '/api/v1/posts/' + postId, { title: '试图修改其他人的内容', body: valid().body, revision: 1 }).expect(403);
    await write(b, csrfB, 'delete', '/api/v1/posts/' + postId, { revision: 1 }).expect(403);
  });
  it('uses revisions to prevent stale overwrite', async () => {
    const r = await write(a, csrfA, 'patch', '/api/v1/posts/' + postId, { title: '更新后的真实讨论标题', body: valid().body, revision: 1 }).expect(200);
    expect(r.body.data.revision).toBe(2);
    await write(a, csrfA, 'patch', '/api/v1/posts/' + postId, { title: '不应覆盖的新标题', body: valid().body, revision: 1 }).expect(409);
  });
  it('pages with stable cursors and rejects malformed pagination', async () => {
    for (let i = 0; i < 3; i++) await write(a, csrfA, 'post', '/api/v1/posts', { ...valid(), title: '分页讨论测试标题 ' + i }).expect(201);
    const first = (await a.get('/api/v1/posts').query({ schoolId: schoolA, limit: 2 })).body;
    const second = (await a.get('/api/v1/posts').query({ schoolId: schoolA, limit: 2, cursor: first.meta.nextCursor })).body;
    expect(new Set([...first.data, ...second.data].map(p => p.id)).size).toBe(4);
    await a.get('/api/v1/posts').query({ schoolId: schoolA, cursor: 'invalid' }).expect(400);
  });
  it('refuses disabled topics and keeps user content as plain text', async () => {
    await db.topic.update({ where: { id: otherTopic }, data: { active: false } });
    await write(a, csrfA, 'post', '/api/v1/posts', { ...valid(), topicId: otherTopic }).expect(422);
    const r = await write(a, csrfA, 'post', '/api/v1/posts', { ...valid(), body: '<script>alert("not executed")</script>' }).expect(201);
    expect(r.body.data.body).toContain('<script>');
  });
  it('soft deletes, removes from list, and denies old direct links', async () => {
    await write(a, csrfA, 'delete', '/api/v1/posts/' + postId, { revision: 2 }).expect(200);
    await b.get('/api/v1/posts/' + postId).expect(404);
    const post = await db.post.findUniqueOrThrow({ where: { id: postId } });
    expect(post.status).toBe('DELETED'); expect(post.deletedAt).not.toBeNull();
  });
});
