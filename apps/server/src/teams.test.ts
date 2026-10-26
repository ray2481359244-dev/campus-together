import { beforeAll, beforeEach, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { ipKeyGenerator } from 'express-rate-limit';
import { RecruitmentDraftSchema } from '@campus/contracts';
import { app } from './app.js';
import { db } from './db.js';
import { config } from './config.js';
import { writeLimit } from './auth.js';

const a = request.agent(app), b = request.agent(app), c = request.agent(app), school = '96000000-0000-4000-8000-000000000001';
let topicId = '', userA = '', userB = '', userC = '', tokenA = '', tokenB = '', tokenC = '';
const write = (agent: typeof a, token: string, path: string, body: object) => agent.post('/api/v1' + path).set('Origin', config.origin).set('X-CSRF-Token', token).send(body);
async function team(capacity = 3) {
  const key = randomUUID(), at = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString();
  const draft = RecruitmentDraftSchema.parse({ topicId, title: '队伍成员管理与关闭招募验收', description: '通过真实申请和批准形成队伍，随后验证成员的退出、移除及关闭招募时的数据一致性和隐私权限。', competitionName: '校园协作赛', direction: '校园应用', goal: '完成作品', collaboration: '周二周四晚间协作', startAt: at(24), endAt: at(48), joinDeadline: at(12), competitionDeadline: at(72), capacity,
    slots: [{ key, name: '统筹', capacity: 1 }, { key: randomUUID(), name: '协作', capacity: capacity - 1 }], captainSlotKey: key });
  const created = (await write(a, tokenA, '/recruitments', { requestKey: randomUUID(), draft }).expect(201)).body.data;
  return (await write(a, tokenA, '/recruitments/' + created.id + '/publish', { revision: 1 }).expect(201)).body.data;
}
const submission = (r: Awaited<ReturnType<typeof team>>) => ({ requestKey: randomUUID(), slotId: r.team.slots[1].id, timeConfirmed: true, message: '我可以安排本次协作，希望共同完成作品。' });
const submit = (r: Awaited<ReturnType<typeof team>>, agent = b, token = tokenB, input = submission(r)) => write(agent, token, '/teams/' + r.team.id + '/applications', input);
const review = (id: string) => write(a, tokenA, '/applications/' + id + '/review', { revision: 1, decision: 'APPROVE', reason: '欢迎协作。' });
async function join(r: Awaited<ReturnType<typeof team>>, agent = b, token = tokenB) { const row = (await submit(r, agent, token).expect(201)).body.data; await review(row.id).expect(200); return row; }
const getTeam = (id: string, agent = a) => agent.get('/api/v1/teams/' + id);
const leave = (id: string, revision = 1) => write(b, tokenB, '/teams/' + id + '/leave', { revision });
const remove = (id: string, memberId: string, revision = 1, reason = '本轮分工已经调整。') => write(a, tokenA, '/teams/' + id + '/members/' + memberId + '/remove', { revision, reason });
const close = (r: Awaited<ReturnType<typeof team>>, reason = '本轮先由现有成员继续协作。', revision = r.revision) => write(a, tokenA, '/teams/' + r.team.id + '/close-recruitment', { revision, reason });
const manage = (id: string, kind: string, revision = 1, agent = a, token = tokenA, extra = {}) => write(agent, token, '/teams/' + id + '/actions', { kind, revision, reason: '本轮活动安排已与参与者确认。', ...extra });
const transfer = (id: string, member: { id: string; revision: number }, revision = 1, agent = a, token = tokenA) => manage(id, 'TRANSFER', revision, agent, token, { targetMemberId: member.id, targetRevision: member.revision });
beforeAll(async () => {
  if (!new URL(config.databaseUrl!).pathname.endsWith('_test')) throw new Error('Not a test database');
  await db.recruitment.deleteMany(); await db.session.deleteMany(); await db.post.deleteMany(); await db.profile.deleteMany(); await db.user.deleteMany(); await db.topic.deleteMany(); await db.school.deleteMany();
  await db.school.create({ data: { id: school, name: '成员管理演示校', city: '测试' } });
  topicId = (await db.topic.create({ data: { category: 'COMPETITION', name: '协作开发', normalizedName: '协作开发' } })).id;
  for (const [agent, label] of [[a, 'a'], [b, 'b'], [c, 'c']] as const) {
    const csrf = (await agent.get('/api/v1/auth/csrf')).body.data.csrfToken;
    const result = (await write(agent, csrf, '/auth/register', { email: `team-${label}@campus.invalid`, password: 'TeamManagement2026!', nickname: '队伍测试' + label, schoolId: school }).expect(201)).body.data;
    if (agent === a) { tokenA = result.csrfToken; userA = result.user.id; }
    if (agent === b) { tokenB = result.csrfToken; userB = result.user.id; }
    if (agent === c) { tokenC = result.csrfToken; userC = result.user.id; }
  }
});
beforeEach(async () => { writeLimit.resetKey(ipKeyGenerator('::ffff:127.0.0.1')); await db.recruitment.deleteMany(); await db.user.updateMany({ where: { id: { in: [userA, userB, userC] } }, data: { role: 'USER', status: 'ACTIVE' } }); });
afterAll(() => db.$disconnect());

describe('private teams, membership changes and recruitment closure', () => {
  it('requires effective membership and strict authenticated requests; administrators cannot bypass team ownership', async () => {
    const r = await team(), pending = (await submit(r).expect(201)).body.data;
    await request(app).get('/api/v1/me/teams').expect(401); await request(app).get('/api/v1/teams/' + r.team.id).expect(401);
    await request(app).post('/api/v1/teams/' + r.team.id + '/leave').send({ revision: 1 }).expect(401);
    await getTeam(r.team.id, b).expect(404); await getTeam(r.team.id, c).expect(404);
    await db.user.update({ where: { id: userC }, data: { role: 'ADMIN' } }); await getTeam(r.team.id, c).expect(404);
    await write(c, tokenC, '/teams/' + r.team.id + '/close-recruitment', { revision: r.revision }).expect(404);
    await review(pending.id).expect(200);
    const member = (await getTeam(r.team.id, b)).body.data.myMembership;
    await b.post('/api/v1/teams/' + r.team.id + '/leave').set('Origin', config.origin).send({ revision: 1 }).expect(403);
    await write(b, tokenB, '/teams/' + r.team.id + '/leave', { revision: 1, userId: userC }).expect(400);
    await leave(r.team.id, 0).expect(400);
    await remove(r.team.id, member.id, 1, '').expect(400);
    await write(b, tokenB, '/teams/' + r.team.id + '/members/' + member.id + '/remove', { revision: 1, reason: '不应成功' }).expect(404);
    await a.get('/api/v1/me/teams').query({ userId: userB }).expect(400);
    const detail = (await getTeam(r.team.id)).body.data;
    expect(detail.members).toHaveLength(2); expect(detail.members[0].role).toBe('CAPTAIN');
    expect(JSON.stringify(detail)).not.toMatch(/passwordHash|csrf|@campus|actorId/);
    expect(JSON.stringify((await c.get('/api/v1/recruitments/' + r.id)).body.data)).not.toContain('队伍测试b');
  });
  it('leaves once, releases the slot and denies private reads or rejoining while old approval replay stays harmless', async () => {
    const r = await team(2), app = await join(r);
    const responses = await Promise.all([leave(r.team.id), leave(r.team.id)]);
    expect(responses.every(v => v.status === 200 && v.body.data.status === 'LEFT')).toBe(true);
    const member = await db.teamMember.findUniqueOrThrow({ where: { teamId_userId: { teamId: r.team.id, userId: userB } } });
    expect(member).toMatchObject({ status: 'LEFT', revision: 2 }); expect(member.leftAt).not.toBeNull();
    expect(await db.membershipChange.count()).toBe(1);
    expect(await db.domainEvent.count({ where: { kind: 'MEMBER_LEFT' } })).toBe(1);
    expect((await b.get('/api/v1/me/teams')).body.data.items).toEqual([]);
    await getTeam(r.team.id, b).expect(404);
    const current = (await a.get('/api/v1/recruitments/' + r.id)).body.data.team;
    expect(current).toMatchObject({ memberCount: 1, status: 'OPEN', acceptingStatus: 'OPEN' }); expect(current.slots[1].occupied).toBe(0);
    expect((await review(app.id).expect(200)).body.data.membership.status).toBe('LEFT');
    expect((await submit(r).expect(422)).body.error.fields.MEMBERSHIP).toBeDefined();
    const notes = (await b.get('/api/v1/me/notifications')).body.data.items;
    expect(notes.filter((n: { kind: string }) => n.kind === 'MEMBER_LEFT')).toHaveLength(1);
    expect((await a.get('/api/v1/me/notifications')).body.data.items).toEqual([]);
  });
  it('removes once with an immutable reason and prevents removed users from reading or applying again', async () => {
    const r = await team(), app = await join(r), member = (await getTeam(r.team.id, b)).body.data.myMembership;
    const responses = await Promise.all([remove(r.team.id, member.id), remove(r.team.id, member.id)]);
    expect(responses.every(v => v.status === 200)).toBe(true);
    await remove(r.team.id, member.id, 1, '换了原因').expect(409);
    await getTeam(r.team.id, b).expect(404);
    await submit(r).expect(422);
    expect((await review(app.id).expect(200)).body.data.membership.status).toBe('REMOVED');
    const notes = (await b.get('/api/v1/me/notifications')).body.data.items;
    expect(notes.filter((n: { kind: string }) => n.kind === 'MEMBER_REMOVED')).toHaveLength(1);
    expect(notes.find((n: { kind: string }) => n.kind === 'MEMBER_REMOVED').reason).toBe('本轮分工已经调整。');
  });
  it('prevents captain exit, captain removal and foreign-team member operations', async () => {
    const r = await team(), other = await team(); await join(r); await join(other);
    const captain = (await getTeam(r.team.id)).body.data.myMembership;
    await write(a, tokenA, '/teams/' + r.team.id + '/leave', { revision: captain.revision }).expect(409);
    await remove(r.team.id, captain.id).expect(409);
    const foreign = (await getTeam(other.team.id, b)).body.data.myMembership;
    await remove(r.team.id, foreign.id).expect(404);
    expect(await db.membershipChange.count()).toBe(0);
  });
  it('resolves leave versus removal with one winner and one result notification', async () => {
    const r = await team(2); await join(r); const member = (await getTeam(r.team.id, b)).body.data.myMembership;
    const results = await Promise.all([leave(r.team.id), remove(r.team.id, member.id)]);
    expect(results.map(v => v.status).sort()).toEqual([200, 409]);
    expect(await db.membershipChange.count()).toBe(1);
    expect(await db.notification.count({ where: { memberChangeId: { not: null } } })).toBe(1);
    expect((await getTeam(r.team.id)).body.data.memberCount).toBe(1);
  });
  it('refuses old operation versions if a later membership revision exists', async () => {
    const r = await team(); await join(r); const member = (await getTeam(r.team.id, b)).body.data.myMembership;
    await leave(r.team.id).expect(200);
    // Simulates a future administrative repair, not an implemented rejoin feature.
    await db.teamMember.update({ where: { id: member.id }, data: { status: 'ACTIVE', leftAt: null, revision: { increment: 1 } } });
    await leave(r.team.id).expect(409); await remove(r.team.id, member.id).expect(409);
    expect((await db.teamMember.findUniqueOrThrow({ where: { id: member.id } }))).toMatchObject({ status: 'ACTIVE', revision: 3 });
  });
  it('coordinates a freed last seat with another pending approval without overfilling', async () => {
    const r = await team(2), first = (await submit(r).expect(201)).body.data, next = (await submit(r, c, tokenC).expect(201)).body.data;
    await review(first.id).expect(200);
    const results = await Promise.all([leave(r.team.id), review(next.id)]);
    expect(results[0].status).toBe(200); expect([200, 422]).toContain(results[1].status);
    if (results[1].status === 422) await review(next.id).expect(200);
    const current = (await a.get('/api/v1/recruitments/' + r.id)).body.data.team;
    expect(current).toMatchObject({ memberCount: 2, acceptingStatus: 'FULL' }); expect(current.slots[1].occupied).toBe(1);
    expect((await db.teamMember.findUniqueOrThrow({ where: { teamId_userId: { teamId: r.team.id, userId: userB } } })).status).toBe('LEFT');
  });
  it('keeps in-progress status when seats are freed and rejects terminal membership changes', async () => {
    const r = await team(); await join(r); await join(r, c, tokenC);
    const memberC = (await getTeam(r.team.id, c)).body.data.myMembership;
    await db.team.update({ where: { id: r.team.id }, data: { status: 'IN_PROGRESS' } });
    await leave(r.team.id).expect(200); await remove(r.team.id, memberC.id).expect(200);
    expect((await db.team.findUniqueOrThrow({ where: { id: r.team.id } })).status).toBe('IN_PROGRESS');
    await close(r).expect(409);
    for (const status of ['COMPLETED', 'CANCELLED', 'EXPIRED'] as const) {
      await db.team.update({ where: { id: r.team.id }, data: { status } });
      await db.teamMember.update({ where: { id: memberC.id }, data: { status: 'ACTIVE', revision: { increment: 1 } } });
      const revision = (await db.teamMember.findUniqueOrThrow({ where: { id: memberC.id } })).revision;
      await remove(r.team.id, memberC.id, revision).expect(409);
    }
  });
  it('closes recruitment once, expires pending intent and preserves existing members and original request safety', async () => {
    const r = await team(); await join(r); const input = submission(r), pending = (await submit(r, c, tokenC, input).expect(201)).body.data;
    const results = await Promise.all([close(r), close(r)]);
    expect(results.every(v => v.status === 200 && v.body.data.expiredCount === 1)).toBe(true);
    expect(await db.recruitmentClosure.count()).toBe(1);
    await close(r, '不同说明').expect(409); await close(r, '本轮先由现有成员继续协作。', r.revision + 1).expect(409);
    const current = (await a.get('/api/v1/recruitments/' + r.id)).body.data;
    expect(current.team).toMatchObject({ memberCount: 2, acceptingStatus: 'CLOSED', status: 'OPEN' }); expect(current.team.closedAt).not.toBeNull();
    expect(current.revision).toBe(r.revision + 1);
    expect((await getTeam(r.team.id, b)).body.data.members).toHaveLength(2);
    const stored = await db.application.findUniqueOrThrow({ where: { id: pending.id } }); expect(stored).toMatchObject({ status: 'EXPIRED', revision: 2 }); expect(stored.resolvedAt).not.toBeNull();
    expect((await submit(r, c, tokenC, input).expect(200)).body.data.status).toBe('EXPIRED'); await submit(r, c, tokenC).expect(422); await review(pending.id).expect(409);
    expect((await c.get('/api/v1/me/notifications')).body.data.items).toMatchObject([{ kind: 'RECRUITMENT_CLOSED', reason: '本轮先由现有成员继续协作。' }]);
    expect((await a.get('/api/v1/teams/' + r.team.id + '/applications')).body.data).toMatchObject({ items: [], pendingCount: 0 });
    const closedAt = current.team.closedAt; await leave(r.team.id).expect(200);
    expect((await a.get('/api/v1/recruitments/' + r.id)).body.data.team).toMatchObject({ closedAt, acceptingStatus: 'CLOSED', memberCount: 1 });
  });
  it('allows an explicit closure after deadline to persist the derived expiry and its result', async () => {
    const r = await team(), row = (await submit(r).expect(201)).body.data;
    await db.recruitment.update({ where: { id: r.id }, data: { joinDeadline: new Date(Date.now() - 1) } });
    expect((await b.get('/api/v1/me/applications')).body.data[0].status).toBe('EXPIRED');
    expect((await db.application.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('PENDING');
    await close(r).expect(200); expect((await db.application.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('EXPIRED');
    expect((await b.get('/api/v1/me/notifications')).body.data.items[0].kind).toBe('RECRUITMENT_CLOSED');
  });
  it('resolves closure versus approval atomically, with no half membership or duplicate notice', async () => {
    const r = await team(), row = (await submit(r).expect(201)).body.data;
    const results = await Promise.all([close(r), review(row.id)]);
    expect(results[0].status).toBe(200); expect([200, 409]).toContain(results[1].status);
    const stored = await db.application.findUniqueOrThrow({ where: { id: row.id } }), approved = stored.status === 'APPROVED';
    expect(['APPROVED', 'EXPIRED']).toContain(stored.status);
    expect(await db.teamMember.count({ where: { teamId: r.team.id, status: 'ACTIVE' } })).toBe(approved ? 2 : 1);
    expect(await db.notification.count()).toBe(1); expect(await db.recruitmentClosure.count()).toBe(1);
    expect((await a.get('/api/v1/recruitments/' + r.id)).body.data.team.acceptingStatus).toBe('CLOSED');
  });
  it('resolves closure versus new submission without leaving any pending record behind', async () => {
    const r = await team(), results = await Promise.all([close(r), submit(r)]);
    expect(results[0].status).toBe(200); expect([201, 422]).toContain(results[1].status);
    expect(await db.application.count({ where: { teamId: r.team.id, status: 'PENDING' } })).toBe(0);
    const accepted = results[1].status === 201;
    expect(await db.application.count()).toBe(accepted ? 1 : 0); expect(await db.notification.count()).toBe(accepted ? 1 : 0);
  });
  it('resolves closure versus withdrawal without changing an already withdrawn intention', async () => {
    const r = await team(), row = (await submit(r).expect(201)).body.data;
    const results = await Promise.all([close(r), write(b, tokenB, '/applications/' + row.id + '/withdraw', { revision: 1 })]);
    expect(results[0].status).toBe(200); expect([200, 409]).toContain(results[1].status);
    const status = (await db.application.findUniqueOrThrow({ where: { id: row.id } })).status;
    expect(['WITHDRAWN', 'EXPIRED']).toContain(status); expect(await db.notification.count()).toBe(status === 'EXPIRED' ? 1 : 0);
  });
  for (const table of ['Notification', 'DomainEvent']) {
    it(`rolls back membership status and freed seats if ${table} fails`, async () => {
      const r = await team(2); await join(r); const member = (await getTeam(r.team.id, b)).body.data.myMembership;
      await db.$executeRawUnsafe(`CREATE FUNCTION team_change_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test persistence failure'; END $$`);
      await db.$executeRawUnsafe(`CREATE TRIGGER team_change_test_failure BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION team_change_test_failure()`);
      try {
        await remove(r.team.id, member.id).expect(503);
        expect((await db.teamMember.findUniqueOrThrow({ where: { id: member.id } }))).toMatchObject({ status: 'ACTIVE', revision: 1, leftAt: null });
        expect((await db.team.findUniqueOrThrow({ where: { id: r.team.id } })).status).toBe('FULL');
        expect(await db.membershipChange.count()).toBe(0); expect(await db.notification.count()).toBe(1);
      } finally { await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS team_change_test_failure ON "${table}"`); await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS team_change_test_failure()'); }
      await remove(r.team.id, member.id).expect(200);
    });
    it(`rolls back closure, pending expiry and all notices if ${table} fails`, async () => {
      const r = await team(), row = (await submit(r).expect(201)).body.data;
      await db.$executeRawUnsafe(`CREATE FUNCTION team_close_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test persistence failure'; END $$`);
      await db.$executeRawUnsafe(`CREATE TRIGGER team_close_test_failure BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION team_close_test_failure()`);
      try {
        await close(r).expect(503);
        expect((await db.team.findUniqueOrThrow({ where: { id: r.team.id } })).recruitmentClosedAt).toBeNull();
        expect((await db.recruitment.findUniqueOrThrow({ where: { id: r.id } })).revision).toBe(r.revision);
        expect((await db.application.findUniqueOrThrow({ where: { id: row.id } }))).toMatchObject({ status: 'PENDING', revision: 1, resolvedAt: null });
        expect(await db.recruitmentClosure.count()).toBe(0); expect(await db.notification.count()).toBe(0);
      } finally { await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS team_close_test_failure ON "${table}"`); await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS team_close_test_failure()'); }
      await close(r).expect(200);
    });
  }
  it('enforces source ownership for new notifications and preserves private read and read-marking boundaries', async () => {
    const r = await team(); await join(r); const pending = (await submit(r, c, tokenC).expect(201)).body.data;
    await leave(r.team.id).expect(200); await close(r).expect(200);
    const change = await db.membershipChange.findFirstOrThrow(), closure = await db.recruitmentClosure.findFirstOrThrow();
    await db.notification.deleteMany({ where: { memberChangeId: change.id } });
    await expect(db.notification.create({ data: { recipientId: userC, memberChangeId: change.id } })).rejects.toMatchObject({ code: 'P2003' });
    await db.notification.deleteMany({ where: { closureId: closure.id } });
    await expect(db.notification.create({ data: { recipientId: userB, closureId: closure.id, teamId: r.team.id, applicationId: pending.id } })).rejects.toMatchObject({ code: 'P2003' });
    await db.notification.create({ data: { recipientId: userC, closureId: closure.id, teamId: r.team.id, applicationId: pending.id } });
    const note = (await c.get('/api/v1/me/notifications')).body.data.items[0];
    await write(b, tokenB, '/me/notifications/' + note.id + '/read', {}).expect(404);
    const marked = (await write(c, tokenC, '/me/notifications/' + note.id + '/read', {}).expect(200)).body.data;
    expect((await write(c, tokenC, '/me/notifications/' + note.id + '/read', {}).expect(200)).body.data.readAt).toBe(marked.readAt);
  });
  it('paginates only the current user effective teams and rejects another user cursor', async () => {
    const template = await team(), now = new Date();
    for (let i = 0; i < 24; i++) {
      const teamId = randomUUID(), slotId = randomUUID();
      const r = await db.recruitment.create({ data: { authorId: userA, schoolId: school, topicId, title: '队伍分页验证' + i, description: template.description, payload: template.draft, capacity: 2, publicationStatus: 'PUBLISHED', createRequestKey: randomUUID(), createRequestHash: '0'.repeat(64), publishedAt: now, startAt: new Date(template.draft.startAt), endAt: new Date(template.draft.endAt), joinDeadline: new Date(Date.now() + 3600_000) } });
      await db.team.create({ data: { id: teamId, recruitmentId: r.id, captainUserId: userA, createdAt: now } });
      await db.teamSlot.create({ data: { id: slotId, teamId, name: '协作', capacity: 2, position: 0 } });
      await db.teamMember.create({ data: { teamId, slotId, userId: userA, role: 'CAPTAIN' } });
    }
    const first = (await a.get('/api/v1/me/teams').expect(200)).body.data, second = (await a.get('/api/v1/me/teams').query({ cursor: first.nextCursor }).expect(200)).body.data;
    expect(first.items).toHaveLength(20); expect(second.items).toHaveLength(5); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map(row => row.id)).size).toBe(25);
    await b.get('/api/v1/me/teams').query({ cursor: first.nextCursor }).expect(400);
    expect((await b.get('/api/v1/me/teams')).body.data.items).toEqual([]);
  });
});

describe('captain transfer and activity lifecycle', () => {
  it('transfers exactly once, preserves slots, immediately revokes old authority and allows the new captain to review', async () => {
    const r = await team(); await join(r); const pending = (await submit(r, c, tokenC).expect(201)).body.data;
    const old = (await getTeam(r.team.id)).body.data.myMembership, member = (await getTeam(r.team.id, b)).body.data.myMembership;
    const results = await Promise.all([transfer(r.team.id, member), transfer(r.team.id, member)]);
    expect(results.map(v => v.status)).toEqual([200, 200]); expect(results[0].body).toEqual(results[1].body);
    const current = (await getTeam(r.team.id, b)).body.data;
    expect(current).toMatchObject({ captainUserId: userB, revision: 2, memberCount: 2, myMembership: { role: 'CAPTAIN', slotName: member.slotName, revision: 2 } });
    expect((await getTeam(r.team.id)).body.data.myMembership).toMatchObject({ role: 'MEMBER', slotName: old.slotName, revision: 2 });
    expect(await db.teamMember.count({ where: { teamId: r.team.id, role: 'CAPTAIN', status: 'ACTIVE' } })).toBe(1);
    expect(await db.teamAction.count()).toBe(1); expect(await db.notification.count({ where: { actionNoticeId: { not: null } } })).toBe(2);
    await a.get('/api/v1/teams/' + r.team.id + '/applications').expect(404); await review(pending.id).expect(404);
    await manage(r.team.id, 'CANCEL', 2).expect(404); await remove(r.team.id, member.id, 2).expect(404);
    await b.get('/api/v1/teams/' + r.team.id + '/applications').expect(200);
    await write(b, tokenB, '/applications/' + pending.id + '/review', { revision: 1, decision: 'APPROVE', reason: '接任后确认入队。' }).expect(200);
    // A stale exit request from before the role transfer cannot remove the new captain or old captain.
    await leave(r.team.id).expect(409); await write(a, tokenA, '/teams/' + r.team.id + '/leave', { revision: 1 }).expect(409);
    await write(a, tokenA, '/teams/' + r.team.id + '/leave', { revision: 2 }).expect(200);
  });
  it('rejects non-captains, administrators, invalid targets, stale target versions and forged inputs', async () => {
    const r = await team(); await join(r); const member = (await getTeam(r.team.id, b)).body.data.myMembership;
    await request(app).post('/api/v1/teams/' + r.team.id + '/actions').send({ kind: 'CANCEL', revision: 1, reason: '原因' }).expect(401);
    await a.post('/api/v1/teams/' + r.team.id + '/actions').set('Origin', config.origin).send({ kind: 'CANCEL', revision: 1, reason: '原因' }).expect(403);
    await manage(r.team.id, 'START', 1, b, tokenB).expect(404);
    await db.user.update({ where: { id: userC }, data: { role: 'ADMIN' } }); await manage(r.team.id, 'CANCEL', 1, c, tokenC).expect(404);
    await manage(r.team.id, 'START', 1, a, tokenA, { captainUserId: userC }).expect(400);
    await manage(r.team.id, 'CANCEL', 1, a, tokenA, { reason: '' }).expect(400);
    await manage(r.team.id, 'TRANSFER').expect(400); await transfer(r.team.id, { ...member, revision: 2 }).expect(409);
    await transfer(r.team.id, (await getTeam(r.team.id)).body.data.myMembership).expect(409);
    const other = await team(); await join(other); await transfer(r.team.id, (await getTeam(other.team.id, b)).body.data.myMembership).expect(409);
    await db.user.update({ where: { id: userB }, data: { status: 'SUSPENDED' } }); await transfer(r.team.id, member).expect(409);
    expect(await db.teamAction.count()).toBe(0);
  });
  it('refuses transferred requests after a later version, including a transfer back to the original captain', async () => {
    const r = await team(); await join(r); const member = (await getTeam(r.team.id, b)).body.data.myMembership;
    await transfer(r.team.id, member).expect(200);
    await manage(r.team.id, 'TRANSFER', 1, a, tokenA, { targetMemberId: member.id, targetRevision: 1, reason: '另一个说明' }).expect(409);
    const former = (await getTeam(r.team.id)).body.data.myMembership;
    await transfer(r.team.id, former, 2, b, tokenB).expect(200); await transfer(r.team.id, member).expect(409);
    expect((await getTeam(r.team.id)).body.data).toMatchObject({ captainUserId: userA, revision: 3 });
  });
  it('coordinates two different transfer targets with exactly one winner', async () => {
    const r = await team(); await join(r); await join(r, c, tokenC);
    const mb = (await getTeam(r.team.id, b)).body.data.myMembership, mc = (await getTeam(r.team.id, c)).body.data.myMembership;
    const results = await Promise.all([transfer(r.team.id, mb), transfer(r.team.id, mc)]);
    expect(results.map(v => v.status).sort()).toEqual([200, 409]);
    expect(await db.teamMember.count({ where: { teamId: r.team.id, role: 'CAPTAIN', status: 'ACTIVE' } })).toBe(1); expect(await db.teamAction.count()).toBe(1);
  });
  it('coordinates transfer versus exit and never appoints an inactive member', async () => {
    const r = await team(); await join(r); const mb = (await getTeam(r.team.id, b)).body.data.myMembership;
    const results = await Promise.all([transfer(r.team.id, mb), leave(r.team.id)]);
    expect(results.map(v => v.status).sort()).toEqual([200, 409]);
    const current = await db.team.findUniqueOrThrow({ where: { id: r.team.id } });
    expect(await db.teamMember.count({ where: { teamId: r.team.id, userId: current.captainUserId, role: 'CAPTAIN', status: 'ACTIVE' } })).toBe(1);
  });
  it('requires two effective members and an unexpired recruitment phase to start, without automatically starting a full team', async () => {
    const r = await team(2); await manage(r.team.id, 'START').expect(409); await manage(r.team.id, 'COMPLETE').expect(409);
    await join(r); expect((await getTeam(r.team.id)).body.data.status).toBe('FULL');
    await db.recruitment.update({ where: { id: r.id }, data: { joinDeadline: new Date(Date.now() - 1) } });
    await manage(r.team.id, 'START').expect(409); await manage(r.team.id, 'CANCEL').expect(409);
    await transfer(r.team.id, (await getTeam(r.team.id, b)).body.data.myMembership).expect(409);
    expect((await getTeam(r.team.id)).body.data).toMatchObject({ status: 'EXPIRED', canStart: false, canCancel: false, canLeave: false, canClose: false });
    await leave(r.team.id).expect(409);
  });
  it('starts an unfilled team once and expires pending applications and notifications atomically', async () => {
    const r = await team(); await join(r); const pending = (await submit(r, c, tokenC).expect(201)).body.data;
    const results = await Promise.all([manage(r.team.id, 'START'), manage(r.team.id, 'START')]);
    expect(results.every(v => v.status === 200)).toBe(true); expect(results[0].body).toEqual(results[1].body);
    expect(results[0].body.data).toMatchObject({ status: 'IN_PROGRESS', revision: 2, expiredCount: 1 });
    const current = (await getTeam(r.team.id, b)).body.data;
    expect(current).toMatchObject({ status: 'IN_PROGRESS', memberCount: 2, acceptingStatus: 'CLOSED', canLeave: true }); expect(current.startedAt).not.toBeNull();
    expect(await db.application.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ status: 'EXPIRED', revision: 2 });
    await review(pending.id).expect(409); await submit(r, c, tokenC).expect(422);
    const notes = (await c.get('/api/v1/me/notifications')).body.data.items;
    expect(notes).toMatchObject([{ kind: 'APPLICATION_EXPIRED', applicationId: pending.id }]);
    expect(await db.notification.count({ where: { actionNoticeId: { not: null } } })).toBe(3); expect(await db.teamAction.count()).toBe(1);
    await manage(r.team.id, 'START', 2).expect(409);
  });
  it('can start an explicitly closed recruitment and never reopens recruitment when members leave during activity', async () => {
    const r = await team(); await join(r); await close(r).expect(200);
    await manage(r.team.id, 'START').expect(200); await leave(r.team.id).expect(200);
    expect((await getTeam(r.team.id)).body.data).toMatchObject({ status: 'IN_PROGRESS', acceptingStatus: 'CLOSED', memberCount: 1 });
    await manage(r.team.id, 'COMPLETE', 2).expect(200);
    const ended = (await getTeam(r.team.id)).body.data;
    expect(ended).toMatchObject({ status: 'COMPLETED', revision: 3, canComplete: false, canCancel: false }); expect(ended.completedAt).not.toBeNull();
    await manage(r.team.id, 'START').expect(409); await manage(r.team.id, 'CANCEL', 3).expect(409);
  });
  for (const phase of ['OPEN', 'FULL', 'IN_PROGRESS'] as const) {
    it(`cancels ${phase}, keeps members as read-only and cannot reopen or transfer`, async () => {
      const r = await team(phase === 'FULL' ? 2 : 3); await join(r);
      if (phase === 'IN_PROGRESS') await manage(r.team.id, 'START').expect(200);
      const revision = phase === 'IN_PROGRESS' ? 2 : 1;
      const first = (await manage(r.team.id, 'CANCEL', revision).expect(200)).body.data;
      expect((await manage(r.team.id, 'CANCEL', revision).expect(200)).body.data).toEqual(first);
      const current = (await getTeam(r.team.id, b)).body.data;
      expect(current).toMatchObject({ status: 'CANCELLED', memberCount: 2, canLeave: false }); expect(current.cancelledAt).not.toBeNull();
      await leave(r.team.id).expect(409); await remove(r.team.id, current.myMembership.id).expect(409);
      await transfer(r.team.id, current.myMembership, revision + 1).expect(409); await manage(r.team.id, 'START', revision + 1).expect(409);
    });
  }
  it('resolves start versus cancellation and completion versus cancellation without overwriting the winner', async () => {
    const r = await team(); await join(r);
    const first = await Promise.all([manage(r.team.id, 'START'), manage(r.team.id, 'CANCEL')]);
    expect(first.map(v => v.status).sort()).toEqual([200, 409]); expect(await db.teamAction.count()).toBe(1);
    const another = await team(); await join(another); await manage(another.team.id, 'START').expect(200);
    const next = await Promise.all([manage(another.team.id, 'COMPLETE', 2), manage(another.team.id, 'CANCEL', 2)]);
    expect(next.map(v => v.status).sort()).toEqual([200, 409]);
    expect(['COMPLETED', 'CANCELLED']).toContain((await getTeam(another.team.id)).body.data.status);
  });
  it('coordinates start against approval and leaves no pending or half-approved member', async () => {
    const r = await team(); await join(r); const pending = (await submit(r, c, tokenC).expect(201)).body.data;
    const results = await Promise.all([manage(r.team.id, 'START'), review(pending.id)]);
    expect(results[0].status).toBe(200); expect([200, 409]).toContain(results[1].status);
    const row = await db.application.findUniqueOrThrow({ where: { id: pending.id } });
    expect(['APPROVED', 'EXPIRED']).toContain(row.status);
    expect((await getTeam(r.team.id)).body.data).toMatchObject({ status: 'IN_PROGRESS', memberCount: row.status === 'APPROVED' ? 3 : 2, acceptingStatus: 'CLOSED' });
    expect(await db.notification.count({ where: { recipientId: userC } })).toBe(1);
  });
  for (const kind of ['TRANSFER', 'START'] as const) for (const table of ['Notification', 'DomainEvent']) {
    it(`rolls back ${kind} if ${table} persistence fails`, async () => {
      const r = await team(); await join(r); const pending = (await submit(r, c, tokenC).expect(201)).body.data, member = (await getTeam(r.team.id, b)).body.data.myMembership;
      await db.$executeRawUnsafe(`CREATE FUNCTION team_action_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test persistence failure'; END $$`);
      await db.$executeRawUnsafe(`CREATE TRIGGER team_action_test_failure BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION team_action_test_failure()`);
      try {
        await (kind === 'TRANSFER' ? transfer(r.team.id, member) : manage(r.team.id, 'START')).expect(503);
        expect(await db.team.findUniqueOrThrow({ where: { id: r.team.id } })).toMatchObject({ captainUserId: userA, status: 'OPEN', revision: 1, startedAt: null });
        expect(await db.teamMember.findUniqueOrThrow({ where: { id: member.id } })).toMatchObject({ role: 'MEMBER', revision: 1 });
        expect(await db.application.findUniqueOrThrow({ where: { id: pending.id } })).toMatchObject({ status: 'PENDING', revision: 1 });
        expect(await db.teamAction.count()).toBe(0); expect(await db.teamActionNotice.count()).toBe(0); expect(await db.notification.count()).toBe(1);
      } finally { await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS team_action_test_failure ON "${table}"`); await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS team_action_test_failure()'); }
      await (kind === 'TRANSFER' ? transfer(r.team.id, member) : manage(r.team.id, 'START')).expect(200);
    });
  }
  it('enforces action notice recipient and single-source integrity and retains first read time', async () => {
    const r = await team(); await manage(r.team.id, 'CANCEL').expect(200);
    const notice = await db.teamActionNotice.findFirstOrThrow(); await db.notification.deleteMany();
    await expect(db.notification.create({ data: { recipientId: userC, actionNoticeId: notice.id } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(db.notification.create({ data: { recipientId: userA } })).rejects.toThrow();
    const row = await db.notification.create({ data: { recipientId: userA, actionNoticeId: notice.id } });
    await write(c, tokenC, '/me/notifications/' + row.id + '/read', {}).expect(404);
    const first = (await write(a, tokenA, '/me/notifications/' + row.id + '/read', {}).expect(200)).body.data;
    expect(first.kind).toBe('TEAM_CANCELLED'); expect((await write(a, tokenA, '/me/notifications/' + row.id + '/read', {}).expect(200)).body.data.readAt).toBe(first.readAt);
  });
  it('transfers during activity, then completes with both members retained and all writes disabled', async () => {
    const r = await team(); await join(r); await manage(r.team.id, 'START').expect(200);
    await transfer(r.team.id, (await getTeam(r.team.id, b)).body.data.myMembership, 2).expect(200);
    const first = (await manage(r.team.id, 'COMPLETE', 3, b, tokenB).expect(200)).body.data;
    expect((await manage(r.team.id, 'COMPLETE', 3, b, tokenB).expect(200)).body.data).toEqual(first);
    expect((await getTeam(r.team.id)).body.data).toMatchObject({ status: 'COMPLETED', memberCount: 2, canLeave: false });
    await write(a, tokenA, '/teams/' + r.team.id + '/leave', { revision: 2 }).expect(409);
    await manage(r.team.id, 'CANCEL', 4, b, tokenB).expect(409);
    await transfer(r.team.id, (await getTeam(r.team.id)).body.data.myMembership, 4, b, tokenB).expect(409);
  });
});
