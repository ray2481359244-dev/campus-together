import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { RecruitmentDraftSchema, type RecruitmentDTO } from '@campus/contracts';
import { app } from './app.js';
import { db } from './db.js';
import { config } from './config.js';

const a = request.agent(app), b = request.agent(app);
const schoolA = '92000000-0000-4000-8000-000000000001', schoolB = '92000000-0000-4000-8000-000000000002';
let topicId = '', wrongTopic = '', csrfA = '', csrfB = '', userA = '', userB = '', publishedId = '', privateId = '';
const write = (agent: typeof a, csrf: string, method: 'post' | 'patch' | 'delete', path: string, body: object) => agent[method](path).set('Origin', config.origin).set('X-CSRF-Token', csrf).send(body);
const at = (hours: number) => new Date(Date.now() + hours * 3600_000).toISOString();
function valid() {
  const captain = randomUUID();
  return RecruitmentDraftSchema.parse({ topicId, title: '寻找一起完成校园项目的伙伴', description: '希望一起完成可以真实运行的校园应用，明确分工并每周沟通，尊重彼此的学习时间。',
    competitionName: '校园应用创新赛', direction: '校园协作工具', goal: '完成可以演示的作品', collaboration: '周二和周四晚间讨论',
    startAt: at(2), endAt: at(24), joinDeadline: at(1), competitionDeadline: at(48), capacity: 3,
    slots: [{ key: captain, name: '项目统筹', capacity: 1 }, { key: randomUUID(), name: '前端开发', capacity: 2, requiredSkills: ['React'] }], captainSlotKey: captain });
}
const create = (draft = valid(), key = randomUUID()) => write(a, csrfA, 'post', '/api/v1/recruitments', { requestKey: key, draft });
const publish = (id: string, revision = 1) => write(a, csrfA, 'post', `/api/v1/recruitments/${id}/publish`, { revision });
beforeAll(async () => {
  if (!new URL(config.databaseUrl!).pathname.endsWith('_test')) throw new Error('Not a test database');
  await db.recruitment.deleteMany(); await db.session.deleteMany(); await db.post.deleteMany(); await db.profile.deleteMany(); await db.user.deleteMany(); await db.topic.deleteMany(); await db.school.deleteMany();
  await db.school.createMany({ data: [{ id: schoolA, name: '招募测试甲校', city: '测试' }, { id: schoolB, name: '招募测试乙校', city: '测试' }] });
  topicId = (await db.topic.create({ data: { category: 'COMPETITION', name: '应用开发', normalizedName: '应用开发' } })).id;
  wrongTopic = (await db.topic.create({ data: { category: 'STUDY', name: '高等数学', normalizedName: '高等数学' } })).id;
  for (const [agent, email, nickname] of [[a, 'recruit-a@campus.invalid', '队长甲'], [b, 'recruit-b@campus.invalid', '旁观乙']] as const) {
    const csrf = (await agent.get('/api/v1/auth/csrf')).body.data.csrfToken;
    const result = await agent.post('/api/v1/auth/register').set('Origin', config.origin).set('X-CSRF-Token', csrf).send({ email, nickname, password: 'TestingPassword123!', schoolId: schoolA }).expect(201);
    if (agent === a) { csrfA = result.body.data.csrfToken; userA = result.body.data.user.id; }
    else { csrfB = result.body.data.csrfToken; userB = result.body.data.user.id; }
  }
});
afterAll(() => db.$disconnect());

describe('real recruitment drafts and transactional publication', () => {
  it('requires login, CSRF and strict competition inputs', async () => {
    await request(app).post('/api/v1/recruitments').set('Origin', config.origin).send({}).expect(401);
    await a.post('/api/v1/recruitments').set('Origin', config.origin).send({}).expect(403);
    await write(a, csrfA, 'post', '/api/v1/recruitments', { requestKey: randomUUID(), draft: valid(), authorId: userB }).expect(400);
    await create({ ...valid(), category: 'GAME' as 'COMPETITION' }).expect(400);
    await create({ ...valid(), topicId: wrongTopic }).expect(422);
  });
  it('keeps incomplete drafts private, persists revisions and never creates a team', async () => {
    const draft = { ...valid(), title: '', description: '', topicId: null, startAt: null, endAt: null, competitionDeadline: null };
    const result = await create(draft).expect(201); privateId = result.body.data.id;
    expect(result.body.data.team).toBeNull();
    await a.get('/api/v1/recruitments/' + privateId).expect(200);
    await b.get('/api/v1/recruitments/' + privateId).expect(404);
    await request(app).get('/api/v1/recruitments/' + privateId).expect(404);
    expect((await b.get('/api/v1/recruitments').query({ schoolId: schoolA })).body.data).toEqual([]);
    expect(await db.team.count()).toBe(0);
    await write(a, csrfA, 'patch', '/api/v1/recruitments/' + privateId, { revision: 1, draft: { ...draft, title: '只属于作者的私有草稿' } }).expect(200);
    await write(a, csrfA, 'patch', '/api/v1/recruitments/' + privateId, { revision: 1, draft }).expect(409);
    await write(b, csrfB, 'patch', '/api/v1/recruitments/' + privateId, { revision: 2, draft }).expect(404);
    expect(((await a.get('/api/v1/me/recruitments')).body.data as RecruitmentDTO[]).some(r => r.id === privateId)).toBe(true);
    expect((await b.get('/api/v1/me/recruitments')).body.data).toEqual([]);
  });
  it('deduplicates concurrent draft creation and rejects a changed request body', async () => {
    const draft = valid(), key = randomUUID();
    const responses = await Promise.all([create(draft, key), create(draft, key)]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 201]);
    expect(responses[0].body.data.id).toBe(responses[1].body.data.id);
    await create({ ...draft, title: '相同请求键但不同的招募标题' }, key).expect(409);
    expect(await db.recruitment.count({ where: { authorId: userA, createRequestKey: key } })).toBe(1);
  });
  it('rejects incomplete publication, wrong role totals and missing captain slot', async () => {
    await publish(privateId, 2).expect(400);
    for (const draft of [{ ...valid(), capacity: 4 }, { ...valid(), captainSlotKey: randomUUID() }]) {
      const id = (await create(draft).expect(201)).body.data.id;
      await publish(id).expect(400);
      expect(await db.team.count({ where: { recruitmentId: id } })).toBe(0);
      expect((await db.recruitment.findUniqueOrThrow({ where: { id } })).publicationStatus).toBe('DRAFT');
    }
  });
  it('validates source ownership and records an actual discussion link', async () => {
    const post = await write(a, csrfA, 'post', '/api/v1/posts', { requestKey: randomUUID(), topicId, title: '先讨论再正式发起招募的项目', body: '这是一条真实讨论，可以作为作者发布竞赛招募的来源。' }).expect(201);
    await write(b, csrfB, 'post', '/api/v1/recruitments', { requestKey: randomUUID(), draft: { ...valid(), sourcePostId: post.body.data.id } }).expect(422);
    const saved = await create({ ...valid(), sourcePostId: post.body.data.id }).expect(201);
    expect((await db.recruitment.findUniqueOrThrow({ where: { id: saved.body.data.id } })).sourcePostId).toBe(post.body.data.id);
  });
  it('publishes atomically, counts the captain and deduplicates concurrent publication', async () => {
    const draft = (await create().expect(201)).body.data;
    publishedId = draft.id;
    const responses = await Promise.all([publish(draft.id), publish(draft.id)]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 201]);
    const value = responses[0].body.data as RecruitmentDTO & { team: NonNullable<RecruitmentDTO['team']> };
    expect(value.publicationStatus).toBe('PUBLISHED'); expect(value.team.memberCount).toBe(1);
    expect(value.team.slots.reduce((n, s) => n + s.capacity, 0)).toBe(3);
    expect(value.team.slots.reduce((n, s) => n + s.occupied, 0)).toBe(1);
    expect(value.team.slots[0].occupied).toBe(1);
    expect(await db.team.count({ where: { recruitmentId: draft.id } })).toBe(1);
    expect(await db.teamMember.count({ where: { teamId: value.team.id, role: 'CAPTAIN', status: 'ACTIVE' } })).toBe(1);
    expect(await db.chatSpace.count({ where: { teamId: value.team.id } })).toBe(1);
    expect(await db.domainEvent.count({ where: { teamId: value.team.id, kind: 'TEAM_CREATED' } })).toBe(1);
    await expect(db.teamMember.create({ data: { teamId: value.team.id, userId: userB, slotId: value.team.slots[0].id, role: 'CAPTAIN' } })).rejects.toMatchObject({ code: 'P2002' });
    const publicRead = (await b.get('/api/v1/recruitments/' + draft.id).expect(200)).body.data;
    expect(publicRead.canEditDraft).toBe(false); expect(publicRead.team.chatAvailable).toBe(false);
    expect(JSON.stringify(publicRead)).not.toMatch(/passwordHash|csrfHash|tokenHash|createRequestHash|recruit-a@/);
  });
  it('filters published data and refuses unsupported published edits', async () => {
    expect((await a.get('/api/v1/recruitments').query({ schoolId: schoolA, q: '校园项目' })).body.data).toHaveLength(1);
    expect((await a.get('/api/v1/recruitments').query({ schoolId: schoolA, q: '校园应用创新赛' })).body.data).toHaveLength(1);
    expect((await a.get('/api/v1/recruitments').query({ schoolId: schoolB })).body.data).toEqual([]);
    await a.get('/api/v1/recruitments').query({ schoolId: schoolA, cursor: 'invalid' }).expect(400);
    await write(a, csrfA, 'patch', '/api/v1/recruitments/' + publishedId, { revision: 2, draft: valid() }).expect(409);
    await write(a, csrfA, 'delete', '/api/v1/recruitments/' + publishedId, { revision: 2 }).expect(409);
    await write(b, csrfB, 'post', `/api/v1/recruitments/${publishedId}/publish`, { revision: 1 }).expect(404);
    await b.post('/api/v1/teams/00000000-0000-4000-8000-000000000001/join').set('Origin', config.origin).send({}).expect(404);
  });
  it('rechecks future deadlines and offline location at publication', async () => {
    for (const draft of [{ ...valid(), joinDeadline: at(-1) }, { ...valid(), mode: 'OFFLINE' as const, locationPublic: '' }]) {
      const id = (await create(draft).expect(201)).body.data.id;
      const response = await publish(id);
      expect([400, 422]).toContain(response.status);
      expect(await db.team.count({ where: { recruitmentId: id } })).toBe(0);
    }
  });
  it('rolls back every earlier child write after a real database failure', async () => {
    const id = (await create().expect(201)).body.data.id;
    // Dedicated test database only: inject a storage failure, not an application bug.
    try {
      await db.$executeRawUnsafe(`CREATE FUNCTION test_reject_chatspace() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test storage fault'; END $$`);
      await db.$executeRawUnsafe(`CREATE TRIGGER test_chatspace_fault BEFORE INSERT ON "ChatSpace" FOR EACH ROW EXECUTE FUNCTION test_reject_chatspace()`);
      await publish(id).expect(503);
      expect((await db.recruitment.findUniqueOrThrow({ where: { id } })).publicationStatus).toBe('DRAFT');
      expect(await db.team.count({ where: { recruitmentId: id } })).toBe(0);
    } finally {
      await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS test_chatspace_fault ON "ChatSpace"');
      await db.$executeRawUnsafe('DROP FUNCTION IF EXISTS test_reject_chatspace()');
    }
    await publish(id).expect(201);
  });
  it('deletes only owned unpublished drafts', async () => {
    await write(b, csrfB, 'delete', '/api/v1/recruitments/' + privateId, { revision: 2 }).expect(404);
    await write(a, csrfA, 'delete', '/api/v1/recruitments/' + privateId, { revision: 2 }).expect(200);
    await a.get('/api/v1/recruitments/' + privateId).expect(404);
  });
  it('keeps a published recruitment readable after its source discussion is deleted', async () => {
    const post = await write(a, csrfA, 'post', '/api/v1/posts', { requestKey: randomUUID(), topicId, title: '来源删除不会破坏独立招募', body: '先讨论方向，再发起正式招募；两类内容分别保存和管理。' }).expect(201);
    const saved = await create({ ...valid(), sourcePostId: post.body.data.id }).expect(201);
    const published = await publish(saved.body.data.id).expect(201);
    await write(a, csrfA, 'delete', '/api/v1/posts/' + post.body.data.id, { revision: post.body.data.revision }).expect(200);
    await b.get('/api/v1/posts/' + post.body.data.id).expect(404);
    const read = await b.get('/api/v1/recruitments/' + saved.body.data.id).expect(200);
    expect(read.body.data.team.id).toBe(published.body.data.team.id);
    expect(read.body.data.draft.sourcePostId).toBe(post.body.data.id);
    expect(read.body.data.sourceAvailable).toBe(false);
  });
});
