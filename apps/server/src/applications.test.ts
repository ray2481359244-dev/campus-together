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
const school = '94000000-0000-4000-8000-000000000001', otherSchool = '94000000-0000-4000-8000-000000000002';
let topicId = '', userA = '', userB = '', userC = '', tokenA = '', tokenB = '', tokenC = '';
const write = (agent: typeof a, token: string, path: string, body: object) => agent.post('/api/v1' + path).set('Origin', config.origin).set('X-CSRF-Token', token).send(body);
async function team() {
  const captain = randomUUID();
  const draft = RecruitmentDraftSchema.parse({ topicId, title: '一起完成可实际使用的校园协作作品', description: '我们想要明确分工，尊重各自学习时间，每周交流，完成可以演示和持续使用的校园作品。',
    competitionName: '校园创新作品赛', direction: '校园协作', goal: '完成作品', collaboration: '周二周四晚间，每周约五小时',
    startAt: new Date(Date.now() + 24 * 3600_000).toISOString(), endAt: new Date(Date.now() + 48 * 3600_000).toISOString(),
    joinDeadline: new Date(Date.now() + 12 * 3600_000).toISOString(), competitionDeadline: new Date(Date.now() + 72 * 3600_000).toISOString(),
    capacity: 3, captainSlotKey: captain, slots: [{ key: captain, name: '统筹', capacity: 1 }, { key: randomUUID(), name: '界面开发', capacity: 2, requiredSkills: ['React'] }] });
  const created = (await write(a, tokenA, '/recruitments', { requestKey: randomUUID(), draft }).expect(201)).body.data;
  return (await write(a, tokenA, '/recruitments/' + created.id + '/publish', { revision: 1 }).expect(201)).body.data;
}
const content = (r: Awaited<ReturnType<typeof team>>, message = '我可以安排所列时间，希望一起协作。') => ({ slotId: r.team.slots[1].id as string, timeConfirmed: true, message });
const submit = (r: Awaited<ReturnType<typeof team>>, body = content(r), key = randomUUID(), agent = b, token = tokenB) => write(agent, token, '/teams/' + r.team.id + '/applications', { requestKey: key, ...body });
const check = (r: Awaited<ReturnType<typeof team>>, input: object = {}) => write(b, tokenB, '/recruitments/' + r.id + '/eligibility', { slotId: content(r).slotId, timeConfirmed: true, ...input });
beforeAll(async () => {
  if (!new URL(config.databaseUrl!).pathname.endsWith('_test')) throw new Error('Not a test database');
  await db.recruitment.deleteMany(); await db.session.deleteMany(); await db.post.deleteMany(); await db.profile.deleteMany(); await db.user.deleteMany(); await db.topic.deleteMany(); await db.school.deleteMany();
  await db.school.createMany({ data: [{ id: school, name: '申请甲校', city: '测试' }, { id: otherSchool, name: '申请乙校', city: '测试' }] });
  topicId = (await db.topic.create({ data: { category: 'COMPETITION', name: '应用开发', normalizedName: '应用开发' } })).id;
  for (const [agent, label] of [[a, 'a'], [b, 'b'], [c, 'c']] as const) {
    const token = (await agent.get('/api/v1/auth/csrf')).body.data.csrfToken;
    const result = (await write(agent, token, '/auth/register', { email: `applications-${label}@campus.invalid`, password: 'ApplicationTest2026!', nickname: '申请测试' + label, schoolId: school }).expect(201)).body.data;
    if (agent === a) { tokenA = result.csrfToken; userA = result.user.id; }
    if (agent === b) { tokenB = result.csrfToken; userB = result.user.id; }
    if (agent === c) { tokenC = result.csrfToken; userC = result.user.id; }
  }
});
beforeEach(async () => {
  writeLimit.resetKey(ipKeyGenerator('::ffff:127.0.0.1'));
  await db.recruitment.deleteMany();
  await db.profile.updateMany({ where: { userId: { in: [userB, userC] } }, data: { schoolId: school, skills: ['React'] } });
  await db.school.update({ where: { id: school }, data: { active: true } });
});
afterAll(() => db.$disconnect());

describe('private applicant workflow and live eligibility', () => {
  it('requires identity, CSRF and strict bodies without exposing drafts or other applicants', async () => {
    const r = await team();
    await request(app).get('/api/v1/me/applications').expect(401);
    await request(app).post('/api/v1/teams/' + r.team.id + '/applications').set('Origin', config.origin).send({}).expect(401);
    await b.post('/api/v1/teams/' + r.team.id + '/applications').set('Origin', config.origin).send({}).expect(403);
    await submit(r, { ...content(r), applicantId: userA } as ReturnType<typeof content>).expect(400);
    await b.get('/api/v1/me/applications').query({ applicantId: userA }).expect(400);
    const draft = (await write(a, tokenA, '/recruitments', { requestKey: randomUUID(), draft: RecruitmentDraftSchema.parse({ slots: [{ key: randomUUID(), name: '', capacity: 3 }] }) }).expect(201)).body.data;
    await write(b, tokenB, '/recruitments/' + draft.id + '/eligibility', {}).expect(404);
    await write(b, tokenB, '/recruitments/' + randomUUID() + '/eligibility', {}).expect(404);
    expect((await a.get('/api/v1/me/applications')).body.data).toEqual([]);
  });
  it('reports PASS FAIL UNKNOWN with explicit evidence and never infers absent skills or time', async () => {
    const r = await team();
    const ready = await check(r, { slotId: content(r).slotId, timeConfirmed: true }).expect(200);
    expect(ready.body.data.status).toBe('PASS');
    expect(ready.body.data.checks.every((v: { status: string }) => v.status === 'PASS')).toBe(true);
    await db.profile.update({ where: { userId: userB }, data: { skills: [] } });
    const missing = await check(r, { timeConfirmed: null }).expect(200);
    expect(missing.body.data.status).toBe('UNKNOWN');
    expect(missing.body.data.checks.find((v: { code: string }) => v.code === 'SKILLS').status).toBe('UNKNOWN');
    await db.profile.update({ where: { userId: userB }, data: { schoolId: otherSchool } });
    const conflict = await check(r, { timeConfirmed: false }).expect(200);
    expect(conflict.body.data.status).toBe('FAIL');
    expect(conflict.body.data.checks.find((v: { code: string }) => v.code === 'TIME').status).toBe('FAIL');
    expect(conflict.body.data.checks.find((v: { code: string }) => v.code === 'SCHOOL').status).toBe('FAIL');
    await db.recruitment.update({ where: { id: r.id }, data: { allowCrossSchool: true } });
    expect((await check(r, { timeConfirmed: true })).body.data.checks.find((v: { code: string }) => v.code === 'SCHOOL').status).toBe('PASS');
  });
  it('rechecks changed profiles and foreign/full slots at submission instead of trusting a prior PASS', async () => {
    const r = await team(), other = await team();
    await check(r, { slotId: content(r).slotId, timeConfirmed: true }).expect(200);
    await db.profile.update({ where: { userId: userB }, data: { skills: [] } });
    await submit(r).expect(422);
    await db.profile.update({ where: { userId: userB }, data: { skills: ['Ｒｅａｃｔ'] } });
    await submit(r, { ...content(r), slotId: other.team.slots[1].id }).expect(422);
    await submit(r, { ...content(r), slotId: r.team.slots[0].id }).expect(422);
    expect(await db.application.count()).toBe(0); expect(await db.applicationRequest.count()).toBe(0);
    await submit(r).expect(201);
    await expect(db.application.create({ data: { teamId: r.team.id, applicantId: userC, slotId: other.team.slots[1].id, message: '', timeConfirmed: true, submissionHash: '0'.repeat(64), eligibilitySnapshot: {} } })).rejects.toThrow();
  });
  it('deduplicates concurrent creation, preserves request snapshots and leaves memberships unchanged', async () => {
    const r = await team(), input = content(r), key = randomUUID();
    const results = await Promise.all([submit(r, input, key), submit(r, input, key)]);
    expect(results.map(v => v.status).sort()).toEqual([200, 201]);
    const row = results[0].body.data;
    expect(results[1].body.data.id).toBe(row.id);
    expect(row.eligibilitySnapshot.ruleVersion).toBe('competition-application-v2');
    expect(row.reviewAvailable).toBe(true);
    await submit(r, input).expect(200);
    await submit(r, { ...input, message: '不同内容不能覆盖原申请' }, key).expect(409);
    await submit(r, { ...input, message: '换标识也不能覆盖原申请' }).expect(409);
    expect(await db.application.count()).toBe(1); expect(await db.applicationRequest.count()).toBe(2);
    expect(await db.teamMember.count({ where: { teamId: r.team.id, status: 'ACTIVE' } })).toBe(1);
    expect(await db.domainEvent.count({ where: { kind: 'APPLICATION_SUBMITTED' } })).toBe(1);
    const stored = await db.applicationRequest.findUniqueOrThrow({ where: { applicantId_requestKey: { applicantId: userB, requestKey: key } } });
    expect(stored.snapshot).toMatchObject({ message: input.message, timeConfirmed: true });
    const mine = (await b.get('/api/v1/me/applications').query({ teamId: r.team.id }).expect(200)).body.data;
    expect(mine).toHaveLength(1); expect(mine[0].id).toBe(row.id);
    expect(JSON.stringify(mine)).not.toMatch(/passwordHash|requestHash|csrf|@campus/);
    expect((await c.get('/api/v1/me/applications').expect(200)).body.data).toEqual([]);
    await write(c, tokenC, '/applications/' + row.id + '/withdraw', { revision: 1 }).expect(404);
    await write(a, tokenA, '/applications/' + row.id + '/withdraw', { revision: 1 }).expect(404);
  });
  it('withdraws once, enforces cooldown and never lets old creation or withdrawal undo a later submission', async () => {
    const r = await team(), original = content(r), key = randomUUID();
    const row = (await submit(r, original, key).expect(201)).body.data;
    const results = await Promise.all([write(b, tokenB, '/applications/' + row.id + '/withdraw', { revision: 1 }), write(b, tokenB, '/applications/' + row.id + '/withdraw', { revision: 1 })]);
    expect(results.every(v => v.status === 200 && v.body.data.status === 'WITHDRAWN')).toBe(true);
    expect(await db.domainEvent.count({ where: { kind: 'APPLICATION_WITHDRAWN' } })).toBe(1);
    expect((await submit(r, original, key).expect(200)).body.data.status).toBe('WITHDRAWN');
    await submit(r).expect(409);
    await db.application.update({ where: { id: row.id }, data: { resolvedAt: new Date(Date.now() - 600_001) } });
    const next = (await submit(r, content(r, '本次补充了新的申请说明')).expect(201)).body.data;
    expect(next.id).toBe(row.id); expect(next.submission).toBe(2); expect(next.revision).toBe(3);
    await submit(r, original, key).expect(409);
    await write(b, tokenB, '/applications/' + row.id + '/withdraw', { revision: 1 }).expect(409);
    expect((await db.application.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PENDING');
    expect(await db.applicationRequest.count()).toBe(2);
  });
  it('serializes create-versus-withdraw so a retry cannot resurrect intent', async () => {
    const r = await team(), input = content(r), key = randomUUID();
    const row = (await submit(r, input, key).expect(201)).body.data;
    const results = await Promise.all([submit(r, input, key), write(b, tokenB, '/applications/' + row.id + '/withdraw', { revision: 1 })]);
    expect(results.every(v => v.status === 200)).toBe(true);
    expect((await db.application.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('WITHDRAWN');
    expect((await submit(r, input, key)).body.data.status).toBe('WITHDRAWN');
  });
  it('stops new applications when closed/full, returns effective expiry and excludes expired intent from limits', async () => {
    const r = await team(), input = content(r), key = randomUUID();
    await submit(r, input, key).expect(201);
    await db.recruitment.update({ where: { id: r.id }, data: { joinDeadline: new Date(Date.now() - 1) } });
    expect((await b.get('/api/v1/me/applications')).body.data[0].status).toBe('EXPIRED');
    expect((await submit(r, input, key).expect(200)).body.data.status).toBe('EXPIRED');
    await submit(r, input, randomUUID(), c, tokenC).expect(422);
    const fresh = await team();
    await db.team.update({ where: { id: fresh.team.id }, data: { status: 'IN_PROGRESS' } });
    await submit(fresh).expect(422);
    expect((await a.get('/api/v1/recruitments/' + fresh.id)).body.data.team.acceptingStatus).toBe('CLOSED');
    await db.team.update({ where: { id: fresh.team.id }, data: { status: 'OPEN' } });
    await db.teamMember.createMany({ data: [{ teamId: fresh.team.id, slotId: fresh.team.slots[1].id, userId: userB, role: 'MEMBER' }, { teamId: fresh.team.id, slotId: fresh.team.slots[1].id, userId: userC, role: 'MEMBER' }] });
    expect((await a.get('/api/v1/recruitments/' + fresh.id)).body.data.team.acceptingStatus).toBe('FULL');
    await submit(fresh).expect(422);
  });
  it('rejects removed members and allows only missing-information status for inactive school data', async () => {
    const r = await team();
    await db.teamMember.create({ data: { teamId: r.team.id, slotId: r.team.slots[1].id, userId: userB, role: 'MEMBER', status: 'REMOVED' } });
    await submit(r).expect(422);
    await db.teamMember.deleteMany({ where: { userId: userB } });
    await db.school.update({ where: { id: school }, data: { active: false } });
    const result = await check(r, { slotId: content(r).slotId, timeConfirmed: true }).expect(200);
    expect(result.body.data.checks.find((v: { code: string }) => v.code === 'SCHOOL').status).toBe('UNKNOWN');
    await submit(r).expect(422);
  });
  it('serializes the per-user ten-pending limit across two teams', async () => {
    for (let i = 0; i < 9; i++) {
      const r = await team();
      await db.application.create({ data: { teamId: r.team.id, applicantId: userB, slotId: content(r).slotId, message: 'limit fixture', timeConfirmed: true, submissionHash: '0'.repeat(64), eligibilitySnapshot: {} } });
    }
    const left = await team(), right = await team();
    const responses = await Promise.all([submit(left), submit(right)]);
    expect(responses.map(v => v.status).sort()).toEqual([201, 409]);
    expect(await db.application.count({ where: { applicantId: userB, status: 'PENDING' } })).toBe(10);
    const blocked = responses.findIndex(v => v.status === 409), target = blocked === 0 ? left : right;
    const old = await db.application.findMany({ where: { applicantId: userB }, take: 9 });
    await db.recruitment.updateMany({ where: { team: { id: { in: old.map(v => v.teamId) } } }, data: { joinDeadline: new Date(Date.now() - 1) } });
    await submit(target).expect(201);
  });
  it('serializes the per-team hundred-pending limit without occupying seats', async () => {
    const r = await team(), ids = Array.from({ length: 99 }, () => randomUUID());
    await db.user.createMany({ data: ids.map(id => ({ id, email: `${id}@campus.invalid`, passwordHash: 'unusable-test-fixture' })) });
    await db.application.createMany({ data: ids.map(applicantId => ({ teamId: r.team.id, applicantId, slotId: content(r).slotId, message: 'limit fixture', timeConfirmed: true, submissionHash: '0'.repeat(64), eligibilitySnapshot: {} })) });
    const results = await Promise.all([submit(r), submit(r, content(r), randomUUID(), c, tokenC)]);
    expect(results.map(v => v.status).sort()).toEqual([201, 409]);
    expect(await db.application.count({ where: { teamId: r.team.id } })).toBe(100);
    expect(await db.teamMember.count({ where: { teamId: r.team.id } })).toBe(1);
  });
  it('rolls back application and event if storing the request snapshot fails', async () => {
    const r = await team();
    await db.$executeRawUnsafe(`CREATE FUNCTION application_request_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test storage failure'; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER application_request_test_failure BEFORE INSERT ON "ApplicationRequest" FOR EACH ROW EXECUTE FUNCTION application_request_test_failure()`);
    try {
      await submit(r).expect(503);
      expect(await db.application.count()).toBe(0);
      expect(await db.applicationRequest.count()).toBe(0);
      expect(await db.domainEvent.count({ where: { kind: 'APPLICATION_SUBMITTED' } })).toBe(0);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS application_request_test_failure ON "ApplicationRequest"');
      await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS application_request_test_failure()');
    }
  });
});
