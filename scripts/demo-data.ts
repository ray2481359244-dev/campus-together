import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { demoTarget, inspectDemo } from './demo-core.mjs';
import { RecruitmentDraftSchema, type RecruitmentDraft, type RecruitmentDTO } from '../packages/contracts/src/recruitments.js';

const plan = demoTarget(process.env);
if (await inspectDemo(plan) !== 'RUNNING') throw new Error('DEMO_SERVICE_IDENTITY_REQUIRED');
const { db } = await import('../apps/server/src/db.js');
const { hashPassword } = await import('../apps/server/src/password.js');
try {
  const owned = await db.$queryRaw<{ owner: string }[]>`SELECT shobj_description(oid,'pg_database') AS owner FROM pg_database WHERE datname=current_database()`;
  if (owned[0]?.owner !== plan.owner) throw new Error('DEMO_DATABASE_NOT_OWNED_BY_THIS_CHECKOUT');
  const schoolId = '10000000-0000-4000-8000-000000000001';
  const passwordHash = await hashPassword('DemoCampus2026!');
  await db.$transaction(async tx => {
    await tx.user.upsert({ where: { email: 'mei@campus.invalid' }, update: {}, create: { email: 'mei@campus.invalid', passwordHash, profile: { create: { nickname: '小梅（演示）', schoolId, skills: ['界面设计'], interests: ['COMPETITION', 'OUTDOOR'] } } } });
    let admin = await tx.user.findUnique({ where: { email: 'admin@campus.invalid' } });
    if (!admin) {
      admin = await tx.user.create({ data: { email: 'admin@campus.invalid', passwordHash, role: 'ADMIN', profile: { create: { nickname: '管理员（演示）', schoolId } } } });
      await tx.moderationAction.create({ data: { adminId: admin.id, requestKey: randomUUID(), requestHash: '0'.repeat(64), action: 'DEMO_ADMIN_SEED', targetType: 'USER', targetId: admin.id, reason: '仅在本地专用演示库初始化虚构管理员', result: { demoOnly: true } } });
    }
  });

  const directory = resolve('.local/demo', plan.instance); mkdirSync(directory, { recursive: true });
  const currentFile = resolve(directory, 'current.json');
  type Scene = { version: number; id: string; createdAt: string; drafts: { requestKey: string; draft: RecruitmentDraft }[] };
  let scene: Scene;
  if (!process.argv.includes('--new-scene') && existsSync(currentFile)) {
    scene = JSON.parse(readFileSync(currentFile, 'utf8'));
    if (scene.version !== 1 || !/^[a-f0-9-]{36}$/.test(scene.id) || scene.drafts.length !== 4) throw new Error('DEMO_SCENE_RECEIPT_INVALID');
  } else {
    const id = randomUUID(), suffix = ' · 演示 ' + id.slice(0, 6), at = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
    const categories = ['COMPETITION', 'STUDY', 'GAME', 'OUTDOOR'] as const;
    const names = ['应用开发', '高等数学', '桌游', '城市摄影'];
    const titles = ['一起做校园协作参赛作品', '高等数学复习与错题讨论', '课后合作桌游新手体验', '校园光影手机摄影漫步'];
    const drafts: Scene['drafts'] = [];
    for (const [index, category] of categories.entries()) {
      const topic = await db.topic.findUniqueOrThrow({ where: { category_normalizedName: { category, normalizedName: names[index] } } });
      const captain = randomUUID();
      const draft = RecruitmentDraftSchema.parse({
        category, topicId: topic.id, title: titles[index] + suffix,
        description: '这是参赛本地演示的虚构活动，用于体验发布、条件核对、加入、成员管理和群聊，不代表真实比赛报名或实际组织的线下活动。操作结果会保留，重新启动不会重置。',
        mode: category === 'OUTDOOR' ? 'OFFLINE' : 'ONLINE', locationPublic: category === 'OUTDOOR' ? '虚构演示校园公共区域' : '',
        allowCrossSchool: false, joinMode: category === 'STUDY' ? 'AUTO' : 'APPROVAL',
        startAt: at(8), endAt: at(8.1), joinDeadline: at(7), competitionDeadline: at(14),
        capacity: 3, goal: category === 'COMPETITION' ? '完成校园协作作品' : '共同完成一次体验', collaboration: '本条列明的单次协作时段，请参与者自行确认',
        competitionName: category === 'COMPETITION' ? '校园作品演示赛（虚构）' : '', direction: category === 'COMPETITION' ? '校园协作 Web 应用' : '',
        slots: category === 'COMPETITION' ? [{ key: captain, name: '统筹与后端', capacity: 1 }, { key: randomUUID(), name: '前端开发', capacity: 1, requiredSkills: ['前端开发'] }, { key: randomUUID(), name: '界面设计', capacity: 1, requiredSkills: ['界面设计'] }] : [{ key: captain, name: '成员', capacity: 3 }], captainSlotKey: captain,
        ...(category === 'GAME' ? { game: { server: '线下桌游，无服务器限制', platform: 'ANY', playMode: '合作解谜，新手友好' } } : {}),
        ...(category === 'STUDY' ? { study: { subject: '高等数学积分与导数', level: '入门复习', method: 'DISCUSS', methodRequired: false, frequency: '单次，按所列协作时间' } } : {}),
        ...(category === 'OUTDOOR' ? { outdoor: { activity: '校园手机摄影', region: '虚构校园公共步道', budget: 0, distance: '步行约一公里', intensity: 'LOW', experience: '不要求经验', equipment: '自备手机和饮水' } } : {}),
      });
      drafts.push({ requestKey: randomUUID(), draft });
    }
    scene = { version: 1, id, createdAt: new Date().toISOString(), drafts };
    // Save immutable request intents before any HTTP write; retries keep the original dates and keys.
    writeFileSync(resolve(directory, 'scene-' + id + '.json'), JSON.stringify(scene, null, 2), { flag: 'wx' });
    writeFileSync(currentFile, JSON.stringify(scene, null, 2));
  }

  // A private bootstrap session uses the actual login/CSRF guards and is logged out afterward.
  let cookie = '', csrf = '', userId = 'anonymous';
  async function request(path: string, data?: unknown) {
    const response = await fetch(plan.origin + '/api/v1' + path, { method: data === undefined ? 'GET' : 'POST', headers: { Origin: plan.origin, Cookie: cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'X-Session-User': userId }, ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(15000) });
    const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0];
    const body = await response.json(); if (!response.ok) throw new Error('DEMO_API_' + (body.error?.code || response.status));
    return body.data;
  }
  const captain = await db.user.findUniqueOrThrow({ where: { email: 'river@campus.invalid' } });
  const rows: { category: string; id: string; teamId: string; title: string; status: string; joinDeadline: string | null }[] = [];
  try {
    for (const intent of scene.drafts) {
      const claim = await db.recruitmentCreateRequest.findUnique({ where: { authorId_requestKey: { authorId: captain.id, requestKey: intent.requestKey } }, include: { recruitment: { include: { team: true } } } });
      if (claim && !claim.recruitment) throw new Error('DEMO_SCENE_DELETED_CREATE_NEW_SCENE');
      let existing = claim?.recruitment;
      if (!existing || existing.publicationStatus !== 'PUBLISHED') {
        if (!cookie) {
          csrf = (await request('/auth/csrf')).csrfToken;
          const login = await request('/auth/login', { email: 'river@campus.invalid', password: 'DemoCampus2026!' }); csrf = login.csrfToken; userId = login.user.id;
        }
        const draft = existing ? { id: existing.id, revision: existing.revision } : await request('/recruitments', intent);
        const published: RecruitmentDTO = await request('/recruitments/' + draft.id + '/publish', { revision: draft.revision });
        existing = await db.recruitment.findUniqueOrThrow({ where: { id: published.id }, include: { team: true } });
      }
      rows.push({ category: existing.category, id: existing.id, teamId: existing.team!.id, title: existing.title, status: existing.team!.status, joinDeadline: existing.joinDeadline?.toISOString() ?? null });
    }
  } finally { if (cookie && userId !== 'anonymous') await request('/auth/logout', {}).catch(() => {}); }
  const receipt = { sceneId: scene.id, createdAt: scene.createdAt, database: plan.database, origin: plan.origin, recruitments: rows, fictional: true, realModelInvoked: false };
  writeFileSync(resolve(directory, 'ready.json'), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
  if (rows.some(row => !['OPEN', 'FULL'].includes(row.status) || Date.parse(row.joinDeadline || '') <= Date.now())) console.log('当前场景已有结束或过期活动；需要重新演示时执行 pnpm demo:scene 新建一组，旧记录保留。');
} catch (error) {
  const failure = error as { message?: string; code?: string; name?: string };
  console.error('演示场景未完成：' + (/^[A-Z0-9_]+$/.test(failure.message || '') ? failure.message : failure.code || failure.name));
  process.exitCode = 1;
} finally { await db.$disconnect(); }
