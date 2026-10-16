import 'dotenv/config';
const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl || !new URL(testUrl).pathname.endsWith('_test') || testUrl === process.env.DATABASE_URL) throw new Error('E2E only clears a separate _test database.');
process.env.DATABASE_URL = testUrl; process.env.APP_MODE = 'DEMO';
const { db } = await import('../apps/server/src/db.js');
await db.recruitment.deleteMany(); await db.session.deleteMany(); await db.post.deleteMany(); await db.profile.deleteMany(); await db.user.deleteMany(); await db.topic.deleteMany(); await db.school.deleteMany();
await import('../prisma/seed.js');
