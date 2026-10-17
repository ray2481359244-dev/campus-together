import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from './app.js';
import { db } from './db.js';
import { config } from './config.js';

const schoolId = '93000000-0000-4000-8000-000000000001';
const password = 'SessionBoundary2026!';
async function signup(name: string) {
  const agent = request.agent(app);
  const csrf = (await agent.get('/api/v1/auth/csrf').expect(200)).body.data.csrfToken;
  const r = await agent.post('/api/v1/auth/register').set('Origin', config.origin).set('X-CSRF-Token', csrf)
    .send({ email: name + '@campus.invalid', nickname: '会话检查', password, schoolId }).expect(201);
  return { agent, user: r.body.data.user, csrf: r.body.data.csrfToken as string, cookie: String(r.headers['set-cookie'][0]).split(';')[0] };
}
beforeAll(async () => {
  if (!new URL(config.databaseUrl!).pathname.endsWith('_test')) throw new Error('Not a test database');
  await db.recruitment.deleteMany(); await db.session.deleteMany(); await db.post.deleteMany(); await db.profile.deleteMany(); await db.user.deleteMany(); await db.topic.deleteMany(); await db.school.deleteMany();
  await db.school.create({ data: { id: schoolId, name: '会话边界测试学校', city: '测试', isDemo: true } });
});
afterAll(() => db.$disconnect());

describe('account creation and session boundaries', () => {
  it('rolls registration back if session storage fails and preserves the previous context', async () => {
    const agent = request.agent(app), email = 'registration-rollback@campus.invalid';
    const csrf = (await agent.get('/api/v1/auth/csrf').expect(200)).body.data.csrfToken;
    try {
      await db.$executeRawUnsafe(`CREATE FUNCTION test_reject_user_session() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."userId" IS NOT NULL THEN RAISE EXCEPTION 'test session storage fault'; END IF; RETURN NEW; END $$`);
      await db.$executeRawUnsafe(`CREATE TRIGGER test_user_session_fault BEFORE INSERT ON "Session" FOR EACH ROW EXECUTE FUNCTION test_reject_user_session()`);
      await agent.post('/api/v1/auth/register').set('Origin', config.origin).set('X-CSRF-Token', csrf).send({ email, nickname: '事务检查', password, schoolId }).expect(503);
      expect(await db.user.count({ where: { email } })).toBe(0);
      expect((await agent.get('/api/v1/auth/csrf').expect(200)).body.data.csrfToken).toBe(csrf);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_user_session_fault ON "Session"');
      await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_reject_user_session()');
      // Keep the pre-fix reproduction failure from leaving a test-only orphan.
      await db.user.deleteMany({ where: { email } });
    }
    await agent.post('/api/v1/auth/register').set('Origin', config.origin).set('X-CSRF-Token', csrf).send({ email, nickname: '事务检查', password, schoolId }).expect(201);
  });
  it('refuses stale account identity on private reads and mutations', async () => {
    const a = await signup('identity-a'), b = await signup('identity-b');
    await b.agent.get('/api/v1/me/profile').set('X-Session-User', a.user.id).expect(409);
    await b.agent.patch('/api/v1/me/profile').set('Origin', config.origin).set('X-CSRF-Token', b.csrf).set('X-Session-User', a.user.id)
      .send({ nickname: '不应写到乙账号', schoolId, bio: '', grade: '', skills: [], interests: [] }).expect(409);
    expect((await db.profile.findUniqueOrThrow({ where: { userId: b.user.id } })).nickname).toBe('会话检查');
    await b.agent.get('/api/v1/me/profile').set('X-Session-User', b.user.id).expect(200);
    await b.agent.get('/api/v1/auth/csrf').set('X-Session-User', a.user.id).expect(409);
  });
  it('expires a session at the server and rejects replay without affecting another context', async () => {
    const a = await signup('expire-a'), b = await signup('expire-b');
    await db.session.updateMany({ where: { userId: a.user.id, revokedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await a.agent.get('/api/v1/auth/me')).body.data.user).toBeNull();
    await request(app).get('/api/v1/me/profile').set('Cookie', a.cookie).expect(401);
    await a.agent.patch('/api/v1/me/profile').set('Origin', config.origin).set('X-CSRF-Token', a.csrf).send({}).expect(403);
    expect((await b.agent.get('/api/v1/auth/me')).body.data.user.id).toBe(b.user.id);
  });
  it('rejects a disabled account and revokes its existing HTTP sessions', async () => {
    const a = await signup('disabled-a');
    await db.user.update({ where: { id: a.user.id }, data: { status: 'SUSPENDED' } });
    expect((await a.agent.get('/api/v1/auth/me')).body.data.user).toBeNull();
    expect(await db.session.count({ where: { userId: a.user.id, revokedAt: null } })).toBe(0);
    await request(app).get('/api/v1/profiles/' + a.user.id).expect(404);
    const csrf = (await a.agent.get('/api/v1/auth/csrf')).body.data.csrfToken;
    await a.agent.post('/api/v1/auth/login').set('Origin', config.origin).set('X-CSRF-Token', csrf).send({ email: a.user.email, password }).expect(401);
  });
  it('rotates one previous session only once under concurrent login requests', async () => {
    const a = await signup('rotation-a');
    const login = () => request(app).post('/api/v1/auth/login').set('Origin', config.origin).set('Cookie', a.cookie).set('X-CSRF-Token', a.csrf).send({ email: a.user.email, password });
    const results = await Promise.all([login(), login()]);
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    // A request rejected before CSRF validation is 403; a claimed rotation conflict is 409.
    expect([403, 409]).toContain(results.find(r => r.status !== 200)?.status);
    expect(await db.session.count({ where: { userId: a.user.id, revokedAt: null } })).toBe(1);
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', a.cookie)).body.data.user).toBeNull();
  });
  it('allows only one concurrent login or logout to claim the same previous session', async () => {
    const a = await signup('login-logout-race');
    const login = request(app).post('/api/v1/auth/login').set('Origin', config.origin).set('Cookie', a.cookie).set('X-CSRF-Token', a.csrf).send({ email: a.user.email, password });
    const logout = request(app).post('/api/v1/auth/logout').set('Origin', config.origin).set('Cookie', a.cookie).set('X-CSRF-Token', a.csrf).send({});
    const results = await Promise.all([login, logout]);
    expect(results.filter(r => r.status === 200)).toHaveLength(1);
    const rejected = results.find(r => r.status !== 200)!;
    expect([403, 409]).toContain(rejected.status); expect(rejected.headers['set-cookie']).toBeUndefined();
    expect(await db.session.count({ where: { userId: a.user.id, revokedAt: null } })).toBe(results[0].status === 200 ? 1 : 0);
    await request(app).get('/api/v1/me/profile').set('Cookie', a.cookie).expect(401);
  });
});
