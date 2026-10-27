import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { ipKeyGenerator } from 'express-rate-limit';
import { RecruitmentDraftSchema } from '@campus/contracts';
import { app } from './app.js';
import { db } from './db.js';
import { config } from './config.js';
import { writeLimit } from './auth.js';
export const actors = [request.agent(app), request.agent(app), request.agent(app)];
export const tokens: string[] = [], ids: string[] = [];
let topicId = '';
export const write = (who: number, path: string, body: object) => actors[who].post('/api/v1' + path).set('Origin', config.origin).set('X-CSRF-Token', tokens[who]).send(body);
export const read = (who: number, path: string) => actors[who].get('/api/v1' + path);
export async function setup() {
  if (!new URL(config.databaseUrl!).pathname.endsWith('_test')) throw new Error('Separate test DB required');
  await db.recruitment.deleteMany(); await db.session.deleteMany(); await db.post.deleteMany(); await db.profile.deleteMany(); await db.user.deleteMany(); await db.topic.deleteMany(); await db.school.deleteMany();
  const school = await db.school.create({ data: { name: '流程验证虚构学校', city: '测试' } });
  topicId = (await db.topic.create({ data: { category: 'COMPETITION', name: '协作开发', normalizedName: '协作开发' } })).id;
  for (let i = 0; i < 3; i++) {
    tokens[i] = (await actors[i].get('/api/v1/auth/csrf')).body.data.csrfToken;
    const row = (await write(i, '/auth/register', { email: `flow-${i}@campus.invalid`, password: 'FlowFixtures2026!', nickname: '流程成员' + i, schoolId: school.id }).expect(201)).body.data;
    tokens[i] = row.csrfToken; ids[i] = row.user.id;
  }
}
export async function reset() { writeLimit.resetKey(ipKeyGenerator('::ffff:127.0.0.1')); await db.recruitment.deleteMany(); await db.user.updateMany({ where: { id: { in: ids } }, data: { status: 'ACTIVE', role: 'USER' } }); }
export async function team(capacity = 3) {
  const key = randomUUID(), at = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
  const draft = RecruitmentDraftSchema.parse({ topicId, title: '多阶段队伍协作流程验证', description: '验证到期、队伍群聊与归档，以及条件匹配的真实权限、时间和数据一致性。', competitionName: '校园协作赛', direction: '校园应用', goal: '完成作品', collaboration: '周二周四晚间协作', startAt: at(24), endAt: at(48), joinDeadline: at(12), competitionDeadline: at(72), capacity, slots: [{ key, name: '统筹', capacity: 1 }, { key: randomUUID(), name: '协作', capacity: capacity - 1 }], captainSlotKey: key });
  const r = (await write(0, '/recruitments', { requestKey: randomUUID(), draft }).expect(201)).body.data;
  return (await write(0, '/recruitments/' + r.id + '/publish', { revision: 1 }).expect(201)).body.data;
}
export async function apply(r: Awaited<ReturnType<typeof team>>, who = 1) { return (await write(who, '/teams/' + r.team.id + '/applications', { requestKey: randomUUID(), slotId: r.team.slots[1].id, timeConfirmed: true, message: '本次流程验证，已确认时间。' }).expect(201)).body.data; }
export async function join(r: Awaited<ReturnType<typeof team>>, who = 1) { const row = await apply(r, who); await write(0, '/applications/' + row.id + '/review', { revision: 1, decision: 'APPROVE', reason: '欢迎协作。' }).expect(200); return row; }
