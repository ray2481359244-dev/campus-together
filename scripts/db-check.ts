import 'dotenv/config';
import { db } from '../apps/server/src/db.js';
try {
  const result = await db.$queryRaw<{ version: string; database: string }[]>`SELECT version(), current_database() AS database`;
  console.log(JSON.stringify({ connected: true, database: result[0].database, version: result[0].version, schools: await db.school.count(), topics: await db.topic.count() }));
} finally { await db.$disconnect(); }
