import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './app.js';
import { db } from './db.js';
import { config } from './config.js';

const schoolId = '90000000-0000-4000-8000-000000000001';
const a = request.agent(app), b = request.agent(app);
let csrfA = '', csrfB = '', userA = '', oldCookie = '';
beforeAll(async () => {
  if (!new URL(config.databaseUrl!).pathname.endsWith('_test')) throw new Error('Not a test database');
  await db.session.deleteMany(); await db.post.deleteMany(); await db.profile.deleteMany(); await db.user.deleteMany(); await db.topic.deleteMany(); await db.school.deleteMany();
  await db.school.create({ data: { id: schoolId, name: 'API 测试学校', city: '测试', isDemo: true } });
});
afterAll(() => db.$disconnect());

describe('real PostgreSQL authentication and profile privacy', () => {
  it('rejects cross-origin and missing-CSRF registration', async () => {
    await request(app).post('/api/v1/auth/register').set('Origin', config.origin).send({}).expect(403);
    const r = await a.get('/api/v1/auth/csrf').expect(200); csrfA = r.body.data.csrfToken;
    await a.post('/api/v1/auth/register').set('Origin', 'https://wrong.invalid').set('X-CSRF-Token', csrfA).send({}).expect(403);
  });
  it('registers, rotates the anonymous session, and stores only password/session hashes', async () => {
    const r = await a.post('/api/v1/auth/register').set('Origin', config.origin).set('X-CSRF-Token', csrfA).send({ email: 'TesterA@campus.invalid', password: 'TestingPassword123!', nickname: '测试甲', schoolId }).expect(201);
    csrfA = r.body.data.csrfToken; userA = r.body.data.user.id;
    expect(r.body.data.user.emailVerified).toBe(false);
    expect(r.body.data.user.identityStatus).toBe('SELF_REPORTED');
    oldCookie = String(r.headers['set-cookie'][0]).split(';')[0];
    expect(r.headers['set-cookie'][0]).toContain('HttpOnly');
    expect(r.headers['set-cookie'][0]).toContain('SameSite=Lax');
    const user = await db.user.findUniqueOrThrow({ where: { id: userA } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(JSON.stringify(r.body)).not.toContain('passwordHash');
    const active = await db.session.findFirstOrThrow({ where: { userId: userA, revokedAt: null } });
    expect(active.tokenHash).toHaveLength(64);
    expect(oldCookie).not.toContain(active.tokenHash);
  });
  it('keeps a real session and returns a stable CSRF token across refreshes', async () => {
    expect((await a.get('/api/v1/auth/me')).body.data.user.id).toBe(userA);
    expect((await a.get('/api/v1/auth/csrf')).body.data.csrfToken).toBe(csrfA);
  });
  it('rejects duplicate accounts and privileged input fields', async () => {
    await a.post('/api/v1/auth/register').set('Origin', config.origin).set('X-CSRF-Token', csrfA).send({ email: 'testera@campus.invalid', password: 'TestingPassword123!', nickname: '测试甲', schoolId }).expect(409);
    await a.post('/api/v1/auth/register').set('Origin', config.origin).set('X-CSRF-Token', csrfA).send({ email: 'bad@campus.invalid', password: 'TestingPassword123!', nickname: '测试甲', schoolId, role: 'ADMIN' }).expect(400);
  });
  it('keeps two account sessions independent and filters public profile fields', async () => {
    csrfB = (await b.get('/api/v1/auth/csrf')).body.data.csrfToken;
    const r = await b.post('/api/v1/auth/register').set('Origin', config.origin).set('X-CSRF-Token', csrfB).send({ email: 'testerb@campus.invalid', password: 'TestingPassword123!', nickname: '测试乙', schoolId }).expect(201);
    csrfB = r.body.data.csrfToken;
    expect((await a.get('/api/v1/auth/me')).body.data.user.id).toBe(userA);
    expect(r.body.data.user.id).not.toBe(userA);
    const profile = (await b.get('/api/v1/profiles/' + userA).expect(200)).body.data;
    expect(profile.nickname).toBe('测试甲');
    for (const key of ['email', 'passwordHash', 'availability', 'sessions', 'role']) expect(profile).not.toHaveProperty(key);
  });
  it('edits only the current profile and rejects unsupported fields', async () => {
    const input = { nickname: '更新后的甲', schoolId, bio: '这是一段本人资料', grade: '二年级', skills: ['前端开发'], interests: ['COMPETITION'] };
    const r = await a.patch('/api/v1/me/profile').set('Origin', config.origin).set('X-CSRF-Token', csrfA).send(input).expect(200);
    expect(r.body.data.nickname).toBe('更新后的甲');
    await a.patch('/api/v1/me/profile').set('Origin', config.origin).set('X-CSRF-Token', csrfA).send({ ...input, userId: 'someone-else' }).expect(400);
    expect((await b.get('/api/v1/me/profile')).body.data.nickname).toBe('测试乙');
  });
  it('logout revokes the old session even when its cookie is replayed', async () => {
    await a.post('/api/v1/auth/logout').set('Origin', config.origin).set('X-CSRF-Token', csrfA).send({}).expect(200);
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', oldCookie)).body.data.user).toBeNull();
    await a.get('/api/v1/me/profile').expect(401);
  });
  it('fails wrong credentials and allows a fresh login', async () => {
    csrfA = (await a.get('/api/v1/auth/csrf')).body.data.csrfToken;
    await a.post('/api/v1/auth/login').set('Origin', config.origin).set('X-CSRF-Token', csrfA).send({ email: 'testera@campus.invalid', password: 'wrong-password' }).expect(401);
    const r = await a.post('/api/v1/auth/login').set('Origin', config.origin).set('X-CSRF-Token', csrfA).send({ email: 'testera@campus.invalid', password: 'TestingPassword123!' }).expect(200);
    expect(r.body.data.user.id).toBe(userA);
  });
});
