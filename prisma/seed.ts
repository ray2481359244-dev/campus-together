import 'dotenv/config';
import { db } from '../apps/server/src/db.js';
import { categories } from '../packages/contracts/src/index.js';
import { hashPassword } from '../apps/server/src/password.js';

const schools = [
  { id: '10000000-0000-4000-8000-000000000001', name: '星原大学（虚构演示）', city: '演示城市' },
  { id: '10000000-0000-4000-8000-000000000002', name: '青禾学院（虚构演示）', city: '演示城市' },
];
const names = {
  GAME: ['无畏契约', '怪物猎人', '桌游'], STUDY: ['高等数学', '英语四级', '程序设计'],
  COMPETITION: ['应用开发', '数学建模', '创意设计'], OUTDOOR: ['城市摄影', '轻徒步', '校园跑步'],
};
try {
  for (const s of schools) await db.school.upsert({ where: { id: s.id }, update: {}, create: { ...s, isDemo: true } });
  for (const category of categories) for (const name of names[category]) {
    await db.topic.upsert({ where: { category_normalizedName: { category, normalizedName: name.normalize('NFKC').toLowerCase() } }, update: {}, create: { category, name, normalizedName: name.normalize('NFKC').toLowerCase(), description: `围绕${name}交流想法，找到一起行动的人。` } });
  }
  if (process.env.APP_MODE === 'DEMO') {
    const passwordHash = await hashPassword('DemoCampus2026!');
    for (const [email, nickname] of [['river@campus.invalid', '小河（演示）'], ['lin@campus.invalid', '小林（演示）']]) {
      await db.user.upsert({ where: { email }, update: {}, create: { email, passwordHash, profile: { create: { nickname, schoolId: schools[0].id, skills: ['前端开发'], interests: ['COMPETITION'] } } } });
    }
    const author = await db.user.findUniqueOrThrow({ where: { email: 'river@campus.invalid' } });
    const posts = [
      ['COMPETITION', '应用开发', '第一次做校园项目，如何把点子变成作品？', '我们准备从一个真实的小问题开始，先访谈同学，再做能用的原型。你最近在校园里遇到过什么值得解决的问题？欢迎分享。'],
      ['STUDY', '高等数学', '复习高数时，大家怎样整理错题思路？', '最近在整理极限和导数的错题，发现比答案更重要的是记清楚当时为什么会做错。想听听大家复盘题目的习惯。'],
      ['GAME', '桌游', '新手第一次参加桌游，有哪些入门建议？', '想在课后找一些轻松、规则容易学的桌游。更喜欢一起合作解决问题的玩法，欢迎推荐适合新手体验的类型。'],
      ['OUTDOOR', '城市摄影', '校园里的光影，值得一起记录', '傍晚走过教学楼时，发现树影和窗户很好看。不需要专业相机，手机就能记录。你最喜欢校园里的哪个角落？'],
    ] as const;
    for (let i = 0; i < posts.length; i++) {
      const [category, topicName, title, body] = posts[i];
      const topic = await db.topic.findUniqueOrThrow({ where: { category_normalizedName: { category, normalizedName: topicName } } });
      await db.post.upsert({ where: { id: `20000000-0000-4000-8000-00000000000${i + 1}` }, update: {}, create: { id: `20000000-0000-4000-8000-00000000000${i + 1}`, authorId: author.id, schoolId: schools[0].id, topicId: topic.id, title, body } });
    }
    console.log('DEMO seed ready: 2 fictional schools, 12 topics, 2 fictional accounts, 4 posts. Password documented in README; no real users.');
  } else console.log('Reference schools/topics only; demo users and posts skipped. Replace fictional schools before real trials.');
} finally { await db.$disconnect(); }
