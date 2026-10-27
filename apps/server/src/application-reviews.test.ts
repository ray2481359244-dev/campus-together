import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { ipKeyGenerator } from 'express-rate-limit';
import { RecruitmentDraftSchema } from '@campus/contracts';
import { app } from './app.js';
import { db } from './db.js';
import { config } from './config.js';
import { writeLimit } from './auth.js';

const a = request.agent(app), b = request.agent(app), c = request.agent(app);
const school = '95000000-0000-4000-8000-000000000001', otherSchool = '95000000-0000-4000-8000-000000000002';
let topicId = '', userA = '', userB = '', userC = '', tokenA = '', tokenB = '', tokenC = '';
const write = (agent: typeof a, token: string, path: string, body: object) => agent.post('/api/v1' + path).set('Origin', config.origin).set('X-CSRF-Token', token).send(body);
async function team(capacity = 2, separateSlots = false) {
  const captain = randomUUID(), at = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString();
  const draft = RecruitmentDraftSchema.parse({ topicId, title: '队长审核与正式入队验证队伍', description: '我们会明确分工并尊重彼此的学习时间，通过实际协作完成可以演示和继续使用的校园作品。',
    competitionName: '校园协作赛', direction: '应用开发', goal: '完成作品', collaboration: '周二周四晚间，每周五小时', startAt: at(24), endAt: at(48), joinDeadline: at(12), competitionDeadline: at(72), capacity,
    captainSlotKey: captain, slots: [{ key: captain, name: '统筹', capacity: 1 }, { key: randomUUID(), name: '界面开发', capacity: separateSlots ? 1 : capacity - 1, requiredSkills: ['React'] }, ...(separateSlots ? [{ key: randomUUID(), name: '设计', capacity: capacity - 2 }] : [])] });
  const created = (await write(a, tokenA, '/recruitments', { requestKey: randomUUID(), draft }).expect(201)).body.data;
  return (await write(a, tokenA, '/recruitments/' + created.id + '/publish', { revision: 1 }).expect(201)).body.data;
}
const submit = (r: Awaited<ReturnType<typeof team>>, agent = b, token = tokenB, slot = 1) => write(agent, token, '/teams/' + r.team.id + '/applications', { requestKey: randomUUID(), slotId: r.team.slots[slot].id, timeConfirmed: true, message: '希望共同承担实际工作，这是本次申请说明。' });
const review = (id: string, revision = 1, decision = 'APPROVE', reason = '欢迎一起完成作品。') => write(a, tokenA, '/applications/' + id + '/review', { revision, decision, reason });
const list = (teamId: string) => a.get('/api/v1/teams/' + teamId + '/applications');
beforeAll(async () => {
  if (!new URL(config.databaseUrl!).pathname.endsWith('_test')) throw new Error('Not a test database');
  await db.recruitment.deleteMany(); await db.session.deleteMany(); await db.post.deleteMany(); await db.profile.deleteMany(); await db.user.deleteMany(); await db.topic.deleteMany(); await db.school.deleteMany();
  await db.school.createMany({ data: [{ id: school, name: '审核甲校', city: '测试' }, { id: otherSchool, name: '审核乙校', city: '测试' }] });
  topicId = (await db.topic.create({ data: { category: 'COMPETITION', name: '应用开发', normalizedName: '应用开发' } })).id;
  for (const [agent, label] of [[a, 'a'], [b, 'b'], [c, 'c']] as const) {
    const csrf = (await agent.get('/api/v1/auth/csrf')).body.data.csrfToken;
    const result = (await write(agent, csrf, '/auth/register', { email: `review-${label}@campus.invalid`, password: 'ReviewTest2026!', nickname: '审核测试' + label, schoolId: school }).expect(201)).body.data;
    if (agent === a) { tokenA = result.csrfToken; userA = result.user.id; }
    if (agent === b) { tokenB = result.csrfToken; userB = result.user.id; }
    if (agent === c) { tokenC = result.csrfToken; userC = result.user.id; }
  }
});
beforeEach(async () => {
  writeLimit.resetKey(ipKeyGenerator('::ffff:127.0.0.1'));
  await db.recruitment.deleteMany();
  await db.profile.updateMany({ where: { userId: { in: [userB, userC] } }, data: { schoolId: school, skills: ['React'] } });
  await db.user.updateMany({ where: { id: { in: [userA, userB, userC] } }, data: { status: 'ACTIVE', role: 'USER' } });
});
afterAll(() => db.$disconnect());

describe('captain review, membership and private result notifications', () => {
  it('requires current captain identity, CSRF and strict input; an administrator cannot bypass ownership', async () => {
    const r = await team(), row = (await submit(r).expect(201)).body.data;
    await request(app).get('/api/v1/teams/' + r.team.id + '/applications').expect(401);
    await request(app).post('/api/v1/applications/' + row.id + '/review').send({}).expect(401);
    await b.get('/api/v1/teams/' + r.team.id + '/applications').expect(404);
    await write(b, tokenB, '/applications/' + row.id + '/review', { revision: 1, decision: 'APPROVE' }).expect(404);
    await db.user.update({ where: { id: userC }, data: { role: 'ADMIN' } });
    await c.get('/api/v1/teams/' + r.team.id + '/applications').expect(404);
    await write(c, tokenC, '/applications/' + row.id + '/review', { revision: 1, decision: 'REJECT' }).expect(404);
    await a.post('/api/v1/applications/' + row.id + '/review').set('Origin', config.origin).send({ revision: 1, decision: 'APPROVE' }).expect(403);
    await write(a, tokenA, '/applications/' + row.id + '/review', { revision: 1, decision: 'APPROVE', applicantId: userA }).expect(400);
    await review(row.id, 0).expect(400);
    await review(row.id, 1, 'APPROVE', '长'.repeat(501)).expect(400);
    await list(r.team.id).query({ applicantId: userB }).expect(400);
    const captain = (await list(r.team.id).expect(200)).body.data;
    expect(captain.items[0].applicant.nickname).toBe('审核测试b');
    expect(captain.items[0].message).toBe(row.message);
    expect(JSON.stringify(captain)).not.toMatch(/passwordHash|csrf|@campus|submissionHash|reviewerId/);
    expect(await db.applicationReview.count()).toBe(0);
  });
  it('approves atomically and makes concurrent identical retries return one membership, result and notification', async () => {
    const r = await team(), row = (await submit(r).expect(201)).body.data;
    const results = await Promise.all([review(row.id), review(row.id)]);
    expect(results.map(x => x.status)).toEqual([200, 200]);
    const saved = results[0].body.data;
    expect(saved).toMatchObject({ status: 'APPROVED', revision: 2, membership: { status: 'ACTIVE', slotName: '界面开发' }, review: { decision: 'APPROVE', reason: '欢迎一起完成作品。', eligibilitySnapshot: { status: 'PASS' } } });
    expect(await db.teamMember.count({ where: { teamId: r.team.id, status: 'ACTIVE' } })).toBe(2);
    expect(await db.applicationReview.count()).toBe(1); expect(await db.notification.count({ where: { noticeId: null } })).toBe(1);
    expect(await db.domainEvent.count({ where: { kind: 'APPLICATION_APPROVED' } })).toBe(1);
    expect((await list(r.team.id)).body.data).toMatchObject({ items: [], pendingCount: 0 });
    expect((await list(r.team.id).query({ status: 'ALL' })).body.data.items[0].canReview).toBe(false);
    const publicTeam = (await c.get('/api/v1/recruitments/' + r.id)).body.data.team;
    expect(publicTeam).toMatchObject({ status: 'FULL', acceptingStatus: 'FULL', memberCount: 2 });
    expect(publicTeam.slots[1].occupied).toBe(1);
    expect((await b.get('/api/v1/me/applications')).body.data[0].membership.status).toBe('ACTIVE');
    expect((await b.get('/api/v1/me/notifications')).body.data).toMatchObject({ unreadCount: 1, items: [{ kind: 'APPLICATION_APPROVED', reason: '欢迎一起完成作品。' }] });
    expect((await c.get('/api/v1/me/notifications')).body.data.items).toEqual([]);
    await b.get('/api/v1/teams/' + r.team.id + '/applications').expect(404);
    await db.recruitment.update({ where: { id: r.id }, data: { joinDeadline: new Date(Date.now() - 1) } });
    await review(row.id).expect(200);
    expect(await db.notification.count({ where: { reviewId: { not: null } } })).toBe(1);
    expect(await db.notification.count({ where: { actionNoticeId: { not: null } } })).toBe(2);
  });
  it('rejects without occupying a seat, preserves historical notices and refuses old reviews after reapplication', async () => {
    const r = await team(3, true), row = (await submit(r).expect(201)).body.data;
    const rejected = await Promise.all([review(row.id, 1, 'REJECT', '本轮分工暂不合适。'), review(row.id, 1, 'REJECT', '本轮分工暂不合适。')]);
    expect(rejected.every(v => v.status === 200 && v.body.data.status === 'REJECTED')).toBe(true);
    expect(await db.teamMember.count({ where: { teamId: r.team.id } })).toBe(1);
    expect(await db.applicationReview.count()).toBe(1);
    await review(row.id).expect(409); await review(row.id, 2, 'APPROVE').expect(409); await submit(r).expect(409);
    await db.application.update({ where: { id: row.id }, data: { resolvedAt: new Date(Date.now() - 600_001) } });
    const next = (await submit(r, b, tokenB, 2).expect(201)).body.data;
    expect(next).toMatchObject({ id: row.id, submission: 2, revision: 3, review: null });
    await review(row.id, 1, 'REJECT', '本轮分工暂不合适。').expect(409);
    await review(row.id, 3, 'APPROVE', '欢迎加入设计岗位。').expect(200);
    expect(await db.applicationReview.count()).toBe(2);
    const notifications = (await b.get('/api/v1/me/notifications')).body.data.items;
    expect(notifications).toHaveLength(2);
    expect(notifications.find((n: { kind: string }) => n.kind === 'APPLICATION_REJECTED')).toMatchObject({ slotName: '界面开发', reason: '本轮分工暂不合适。' });
    expect(notifications.find((n: { kind: string }) => n.kind === 'APPLICATION_APPROVED')).toMatchObject({ slotName: '设计', reason: '欢迎加入设计岗位。' });
  });
  it('rechecks current skills and accepts the original pending version after real profile repair', async () => {
    const r = await team(), row = (await submit(r).expect(201)).body.data;
    const profile = { nickname: '审核测试b', schoolId: school, bio: '', grade: '', interests: [], skills: [] as string[] };
    await b.patch('/api/v1/me/profile').set('Origin', config.origin).set('X-CSRF-Token', tokenB).send(profile).expect(200);
    const failed = await review(row.id).expect(422);
    expect(failed.body.error.fields.SKILLS).toBeDefined();
    expect(await db.applicationReview.count()).toBe(0); expect(await db.notification.count({ where: { noticeId: null } })).toBe(0);
    expect((await db.application.findUniqueOrThrow({ where: { id: row.id } })).revision).toBe(1);
    await b.patch('/api/v1/me/profile').set('Origin', config.origin).set('X-CSRF-Token', tokenB).send({ ...profile, skills: ['Ｒｅａｃｔ'] }).expect(200);
    expect((await review(row.id).expect(200)).body.data.review.eligibilitySnapshot.status).toBe('PASS');
  });
  it('rechecks applicant account, school, membership and the original time confirmation', async () => {
    const r = await team(3), row = (await submit(r).expect(201)).body.data;
    await db.profile.update({ where: { userId: userB }, data: { schoolId: otherSchool } });
    expect((await review(row.id).expect(422)).body.error.fields.SCHOOL).toBeDefined();
    await db.profile.update({ where: { userId: userB }, data: { schoolId: school } });
    await db.user.update({ where: { id: userB }, data: { status: 'SUSPENDED' } });
    expect((await review(row.id).expect(422)).body.error.fields.ACCOUNT).toBeDefined();
    await db.user.update({ where: { id: userB }, data: { status: 'ACTIVE' } });
    await db.application.update({ where: { id: row.id }, data: { timeConfirmed: false } });
    expect((await review(row.id).expect(422)).body.error.fields.TIME).toBeDefined();
    await db.application.update({ where: { id: row.id }, data: { timeConfirmed: true } });
    await db.teamMember.create({ data: { teamId: r.team.id, slotId: row.slotId, userId: userB, role: 'MEMBER', status: 'REMOVED' } });
    expect((await review(row.id).expect(422)).body.error.fields.MEMBERSHIP).toBeDefined();
    expect(await db.applicationReview.count()).toBe(0); expect(await db.notification.count({ where: { noticeId: null } })).toBe(0);
  });
  it('does not process effectively expired applications or non-recruiting teams', async () => {
    const r = await team(), row = (await submit(r).expect(201)).body.data;
    await db.recruitment.update({ where: { id: r.id }, data: { joinDeadline: new Date(Date.now() - 1) } });
    await review(row.id).expect(409); await review(row.id, 1, 'REJECT').expect(409);
    expect((await list(r.team.id)).body.data).toMatchObject({ items: [], pendingCount: 0 });
    expect((await list(r.team.id).query({ status: 'ALL' })).body.data.items[0]).toMatchObject({ status: 'EXPIRED', canReview: false });
    await db.recruitment.update({ where: { id: r.id }, data: { joinDeadline: new Date(Date.now() + 3600_000) } });
    await db.team.update({ where: { id: r.team.id }, data: { status: 'IN_PROGRESS' } });
    await review(row.id).expect(409);
    expect(await db.applicationReview.count()).toBe(0);
  });
  it('serializes two approvals for the last total seat without overfilling', async () => {
    const r = await team(), rows = await Promise.all([submit(r), submit(r, c, tokenC)]);
    expect(rows.every(v => v.status === 201)).toBe(true);
    const responses = await Promise.all(rows.map(v => review(v.body.data.id)));
    expect(responses.map(v => v.status).sort()).toEqual([200, 422]);
    expect(await db.teamMember.count({ where: { teamId: r.team.id, status: 'ACTIVE' } })).toBe(2);
    expect(await db.application.count({ where: { status: 'APPROVED' } })).toBe(1);
    expect(await db.notification.count({ where: { noticeId: null } })).toBe(1);
    expect((await db.team.findUniqueOrThrow({ where: { id: r.team.id } })).status).toBe('FULL');
  });
  it('serializes the last slot seat while keeping a different slot and the team open', async () => {
    const r = await team(3, true), rows = await Promise.all([submit(r), submit(r, c, tokenC)]);
    const responses = await Promise.all(rows.map(v => review(v.body.data.id)));
    expect(responses.map(v => v.status).sort()).toEqual([200, 422]);
    expect(responses.find(v => v.status === 422)?.body.error.fields.SLOT).toBeDefined();
    const current = (await a.get('/api/v1/recruitments/' + r.id)).body.data.team;
    expect(current).toMatchObject({ status: 'OPEN', acceptingStatus: 'OPEN', memberCount: 2 });
    expect(current.slots[1].occupied).toBe(1); expect(current.slots[2].occupied).toBe(0);
  });
  it('resolves approval versus withdrawal with one winner and no half membership', async () => {
    const r = await team(), row = (await submit(r).expect(201)).body.data;
    const results = await Promise.all([review(row.id), write(b, tokenB, '/applications/' + row.id + '/withdraw', { revision: 1 })]);
    expect(results.map(v => v.status).sort()).toEqual([200, 409]);
    const approved = (await db.application.findUniqueOrThrow({ where: { id: row.id } })).status === 'APPROVED';
    expect(await db.teamMember.count({ where: { teamId: r.team.id, status: 'ACTIVE' } })).toBe(approved ? 2 : 1);
    expect(await db.applicationReview.count()).toBe(approved ? 1 : 0); expect(await db.notification.count({ where: { noticeId: null } })).toBe(approved ? 1 : 0);
  });
  it('resolves opposing decisions for the same revision and refuses changed retry content', async () => {
    const r = await team(), row = (await submit(r).expect(201)).body.data;
    const results = await Promise.all([review(row.id), review(row.id, 1, 'REJECT', '本轮不合适。')]);
    expect(results.map(v => v.status).sort()).toEqual([200, 409]);
    expect(await db.applicationReview.count()).toBe(1); expect(await db.notification.count({ where: { noticeId: null } })).toBe(1);
    const saved = await db.applicationReview.findFirstOrThrow();
    await review(row.id, 1, saved.decision, saved.reason + '修改').expect(409);
    expect(await db.teamMember.count({ where: { teamId: r.team.id } })).toBe(saved.decision === 'APPROVE' ? 2 : 1);
  });
  for (const table of ['Notification', 'DomainEvent']) {
    it(`rolls back approval, membership, status and review if ${table} persistence fails`, async () => {
      const r = await team(), row = (await submit(r).expect(201)).body.data;
      await db.$executeRawUnsafe(`CREATE FUNCTION review_result_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test storage failure'; END $$`);
      await db.$executeRawUnsafe(`CREATE TRIGGER review_result_test_failure BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION review_result_test_failure()`);
      try {
        await review(row.id).expect(503);
        expect(await db.teamMember.count({ where: { teamId: r.team.id } })).toBe(1);
        expect((await db.team.findUniqueOrThrow({ where: { id: r.team.id } })).status).toBe('OPEN');
        expect((await db.application.findUniqueOrThrow({ where: { id: row.id } }))).toMatchObject({ status: 'PENDING', revision: 1, resolvedAt: null });
        expect(await db.applicationReview.count()).toBe(0); expect(await db.notification.count({ where: { noticeId: null } })).toBe(0);
        expect(await db.domainEvent.count({ where: { kind: 'APPLICATION_APPROVED' } })).toBe(0);
      } finally {
        await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS review_result_test_failure ON "${table}"`);
        await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS review_result_test_failure()');
      }
      await review(row.id).expect(200);
    });
  }
  it('paginates private notifications and marks only the owner record read, idempotently', async () => {
    const r = await team(), row = (await submit(r).expect(201)).body.data, now = new Date();
    const records = Array.from({ length: 25 }, (_, i) => ({ id: randomUUID(), applicationId: row.id, applicantId: userB, reviewerId: userA, submission: i + 1, expectedRevision: i * 2 + 1, decision: 'REJECT' as const, reason: '分页验证', slotName: '界面开发', recruitmentTitle: r.title, createdAt: now }));
    await db.applicationReview.createMany({ data: records });
    await db.notification.createMany({ data: records.map(v => ({ recipientId: userB, reviewId: v.id, createdAt: now })) });
    await request(app).get('/api/v1/me/notifications').expect(401);
    await b.get('/api/v1/me/notifications').query({ recipientId: userC }).expect(400);
    const first = (await b.get('/api/v1/me/notifications').expect(200)).body.data;
    expect(first.items).toHaveLength(20); expect(first.unreadCount).toBe(25);
    const second = (await b.get('/api/v1/me/notifications').query({ cursor: first.nextCursor }).expect(200)).body.data;
    expect(second.items).toHaveLength(5); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map(n => n.id)).size).toBe(25);
    expect(JSON.stringify(first)).not.toMatch(/passwordHash|@campus|reviewerId|recipientId/);
    const id = first.items[0].id;
    await c.get('/api/v1/me/notifications').query({ cursor: id }).expect(400);
    await write(c, tokenC, '/me/notifications/' + id + '/read', {}).expect(404);
    await b.post('/api/v1/me/notifications/' + id + '/read').set('Origin', config.origin).send({}).expect(403);
    await write(b, tokenB, '/me/notifications/' + id + '/read', { recipientId: userC }).expect(400);
    const read = (await write(b, tokenB, '/me/notifications/' + id + '/read', {}).expect(200)).body.data;
    expect((await write(b, tokenB, '/me/notifications/' + id + '/read', {}).expect(200)).body.data.readAt).toBe(read.readAt);
    expect((await b.get('/api/v1/me/notifications')).body.data.unreadCount).toBe(24);
    expect((await c.get('/api/v1/me/notifications')).body.data.items).toEqual([]);
  });
  it('enforces notification recipient linkage in the database as well as the API', async () => {
    const r = await team(), row = (await submit(r).expect(201)).body.data;
    await review(row.id).expect(200);
    const result = await db.applicationReview.findFirstOrThrow();
    await db.notification.deleteMany();
    await expect(db.notification.create({ data: { recipientId: userC, reviewId: result.id } })).rejects.toMatchObject({ code: 'P2003' });
    expect(await db.notification.count({ where: { noticeId: null } })).toBe(0);
  });
  it('paginates captain-only applications without mixing another team or accepting foreign cursors', async () => {
    const r = await team(), other = await team(), now = new Date(), ids = Array.from({ length: 25 }, () => randomUUID());
    await db.user.createMany({ data: ids.map(id => ({ id, email: id + '@campus.invalid', passwordHash: 'unusable-pagination-fixture' })) });
    await db.application.createMany({ data: ids.map(applicantId => ({ teamId: r.team.id, applicantId, slotId: r.team.slots[1].id, message: '分页验证', timeConfirmed: true, submissionHash: '0'.repeat(64), eligibilitySnapshot: { ruleVersion: 'competition-application-v1', assessedAt: now.toISOString(), status: 'PASS', checks: [] }, submittedAt: now })) });
    const first = (await list(r.team.id).expect(200)).body.data;
    const second = (await list(r.team.id).query({ cursor: first.nextCursor }).expect(200)).body.data;
    expect(first.items).toHaveLength(20); expect(first.pendingCount).toBe(25);
    expect(second.items).toHaveLength(5); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map(row => row.id)).size).toBe(25);
    await list(other.team.id).query({ cursor: first.nextCursor }).expect(400);
  });
  it('waits for applicant data writes before rechecking conditions, and profile writes honor the same lock', async () => {
    const r = await team(), row = (await submit(r).expect(201)).body.data;
    let release!: () => void, locked!: () => void;
    const gate = new Promise<void>(done => { release = done; }), ready = new Promise<void>(done => { locked = done; });
    const edit = db.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userB}::uuid FOR NO KEY UPDATE`;
      locked(); await gate;
      await tx.profile.update({ where: { userId: userB }, data: { skills: [] } });
    });
    await ready;
    const attempted = review(row.id).then(value => value);
    try {
      await expect.poll(async () => (await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%FOR NO KEY UPDATE%'`)[0].count, { timeout: 4000 }).toBeGreaterThan(0n);
    } finally { release(); await edit; }
    expect((await attempted).status).toBe(422);
    expect(await db.teamMember.count({ where: { teamId: r.team.id } })).toBe(1);
    let releaseProfile!: () => void, lockedProfile!: () => void;
    const profileGate = new Promise<void>(done => { releaseProfile = done; }), profileReady = new Promise<void>(done => { lockedProfile = done; });
    const held = db.$transaction(async tx => { await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userB}::uuid FOR NO KEY UPDATE`; lockedProfile(); await profileGate; });
    await profileReady;
    const patched = b.patch('/api/v1/me/profile').set('Origin', config.origin).set('X-CSRF-Token', tokenB).send({ nickname: '审核测试b', schoolId: school, bio: '', grade: '', interests: [], skills: ['React'] }).then(value => value);
    try {
      await expect.poll(async () => (await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%FOR NO KEY UPDATE%'`)[0].count, { timeout: 4000 }).toBeGreaterThan(0n);
    } finally { releaseProfile(); await held; }
    expect((await patched).status).toBe(200);
    await review(row.id).expect(200);
  });
});
